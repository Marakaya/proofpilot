import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildColosseumReadRequest, readColosseum, runColosseumReadCli } from "../skills/proofpilot/scripts/colosseum-read.js";

const filename = fileURLToPath(import.meta.url);
const BASE = "https://copilot.colosseum.com/api/v2";
const sentinel = "synthetic-read-credential-never-display";
const reply = (http, body) => ({ status: 0, stdout: `${JSON.stringify(body)}\nPROOFPILOT_HTTP_STATUS:${http}` });
const authenticated = () => reply(200, { authenticated: true, scope: "evidence:read", expiresAt: null });
const helperRunner = () => ({ status: 0, stdout: JSON.stringify({ state: "stored credentials present (not verified)", credentialState: "ready", scopes: ["evidence:read"] }) });
const options = { env: {}, helperRunner, statusRunner: authenticated };

export async function runColosseumReadTests() {
  let cases = 0;
  const noLeak = value => assert.ok(!JSON.stringify(value).includes(sentinel));
  const scenarios = [
    { args: ["filters"], route: "/filters", body: { hackathons: [] } },
    { args: ["categories"], route: "/categories", body: { areas: [], groups: [] } },
    { args: ["search-projects", "--query", "stablecoin payments", "--limit", "25", "--winners-only", "true", "--accelerator-only", "false"], route: "/search/projects", body: { results: [], totalFound: 0 } },
    { args: ["search-archives", "--query", "prediction markets", "--offset", "50"], route: "/search/archives", body: { results: [], searchTier: "vector" } },
    { args: ["project", "--slug", "stablepal"], route: "/projects/by-slug/stablepal", body: { slug: "stablepal" } },
    { args: ["project", "--slug", "misk.fi-stablecoin-payments-for-your-business"], route: "/projects/by-slug/misk.fi-stablecoin-payments-for-your-business", body: { slug: "misk.fi-stablecoin-payments-for-your-business" } },
    { args: ["archive", "--id", "12345678-1234-1234-1234-123456789abc", "--offset", "8000", "--max-chars", "200"], route: "/archives/12345678-1234-1234-1234-123456789abc?offset=8000&maxChars=200", body: { documentId: "12345678-1234-1234-1234-123456789abc", content: "Excerpt", isExcerpt: true } }
  ];
  for (const scenario of scenarios) {
    const request = buildColosseumReadRequest(scenario.args);
    assert.equal(request.url, BASE + scenario.route);
    let authCalls = 0;
    let reads = 0;
    const result = await readColosseum(scenario.args, { ...options,
      statusRunner: req => { authCalls++; assert.equal(req.url, BASE + "/status"); return authenticated(); },
      runner: req => { reads++; assert.equal(authCalls, 1); assert.deepEqual(req, request); return reply(200, scenario.body); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.api_version, "v2");
    assert.equal(result.operation_verified, true);
    assert.equal(reads, 1);
    assert.deepEqual(result.data, scenario.body);
    noLeak(result);
    cases++;
  }
  for (const [requested, returned] of [["stablepal", "STABLEPAL"], ["STABLEPAL", "stablepal"]]) {
    const result = await readColosseum(["project", "--slug", requested], {
      ...options, runner: () => reply(200, { slug: returned, name: "Correct project" })
    });
    assert.equal(result.ok, true);
    assert.equal(result.operation_verified, true);
    assert.equal(result.data.slug, returned);
    cases++;
  }
  const archiveId = "12345678-1234-1234-1234-123456789abc";
  for (const [requested, returned] of [[archiveId, archiveId.toUpperCase()], [archiveId.toUpperCase(), archiveId]]) {
    const result = await readColosseum(["archive", "--id", requested], {
      ...options, runner: () => reply(200, { documentId: returned, content: "Correct document" })
    });
    assert.equal(result.ok, true);
    assert.equal(result.operation_verified, true);
    assert.equal(result.data.documentId, returned);
    cases++;
  }
  for (const [args, body] of [
    ...["", ".", "..", "bad slug", "../other", "unsafe\nslug", "x".repeat(201), "another-project"].map(slug =>
      [["project", "--slug", "stablepal"], { slug, name: sentinel }]),
    ...["", "not-a-uuid", "87654321-4321-4321-4321-cba987654321"].map(documentId =>
      [["archive", "--id", archiveId], { documentId, content: sentinel }])
  ]) {
    let output = "";
    const exit = await runColosseumReadCli(args, { ...options,
      stdout: { write: text => { output += text; } }, runner: () => reply(200, body) });
    const result = JSON.parse(output);
    assert.equal(exit, 1);
    assert.equal(result.ok, false);
    assert.equal(result.operation_verified, false);
    assert.equal(result.error.code, "invalid_response");
    assert.equal(result.phase, "request");
    assert.equal(result.http_status, 200);
    assert.equal(Object.hasOwn(result, "data"), false);
    noLeak(output);
    cases++;
  }
  for (const expiresAt of ["2026-02-30T00:00:00Z", "2026-10-02T24:00:00Z", "2026-10-02T00:00:00"]) {
    let reads = 0;
    const result = await readColosseum(["filters"], { ...options, now: "2026-03-01T00:00:00Z",
      statusRunner: () => reply(200, { authenticated: true, scope: "evidence:read", expiresAt }),
      runner: () => { reads++; return reply(200, { hackathons: [], private: sentinel }); } });
    assert.equal(result.ok, false);
    assert.equal(result.operation_verified, false);
    assert.equal(result.error.code, "invalid_response");
    assert.equal(result.phase, "authentication");
    assert.equal(reads, 0, "Malformed authentication expiry must stop before a corpus read");
    noLeak(result);
    cases++;
  }
  assert.deepEqual(buildColosseumReadRequest(scenarios[2].args).body.filters, { winnersOnly: true, acceleratorOnly: false });
  const invalidArgs = [
    [], ["feedback"], ["share"], ["me"], ["https://evil.invalid"], ["cluster", "--key", "v1-c12"],
    ["filters", "--url", "https://evil.invalid"], ["filters", "--token", sentinel], ["filters", "--json", "--json"], ["filters", "--insecure"],
    ["search-projects"], ["search-projects", "--query", " "], ["search-projects", "--query", "x".repeat(501)],
    ["search-projects", "--query", "line\nbreak"], ["search-projects", "--query", "foo", "--limit", "0"],
    ["search-projects", "--query", "foo", "--limit", "26"], ["search-projects", "--query", "foo", "--limit", "1.5"],
    ["search-projects", "--query", "foo", "--query", "bar"], ["search-projects", "--query", "--token"],
    ["search-projects", "--query", "foo", "--winners-only", "yes"], ["search-projects", "--query", "foo", "--accelerator-only", "1"],
    ["search-archives", "--query", "foo", "--limit", "11"], ["search-archives", "--query", "foo", "--offset", "51"],
    ["project", "--slug", "../status"], ["project", "--slug", "%2e%2e%2fstatus"], ["project", "--slug", "foo?token=bar"],
    ["project", "--slug", "."], ["project", "--slug", ".."], ["archive", "--id", "not-a-uuid"],
    ["archive", "--id", "12345678-1234-1234-1234-123456789abc", "--max-chars", "20001"],
    ["search-projects", "--query", "foo", "--offset", "1000001"], ["filters", "--config", "@secret-file"]
  ];
  for (const args of invalidArgs) {
    let calls = 0;
    const result = await readColosseum(args, { helperRunner: () => { calls++; return helperRunner(); }, runner: () => { calls++; return reply(200, {}); } });
    assert.equal(result.error.code, "invalid_arguments");
    assert.equal(calls, 0);
    noLeak(result);
    cases++;
  }
  for (const http of [401, 402, 403, 429, 500]) {
    let reads = 0;
    const result = await readColosseum(["filters"], { ...options, statusRunner: () => reply(http, { error: sentinel }), runner: () => { reads++; return reply(200, {}); } });
    assert.equal(result.ok, false);
    assert.equal(result.phase, "authentication");
    assert.equal(result.http_status, http);
    assert.equal(reads, 0);
    noLeak(result);
    cases++;
  }
  const cache = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-read-rejected-helper-")));
  const originalFetch = globalThis.fetch;
  try {
    const helperRoot = path.join(cache, "_proofpilot_helpers", "copilot-connect-0.2.2");
    const packageRoot = path.join(helperRoot, "node_modules", "@colosseum-org", "copilot-connect");
    const marker = path.join(cache, "untrusted-helper-ran");
    fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@colosseum-org/copilot-connect", version: "0.2.2", type: "module", bin: { "copilot-connect": "src/cli.js" }
    }), { mode: 0o600 });
    fs.writeFileSync(path.join(packageRoot, "src", "cli.js"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(sentinel)});\n`, { mode: 0o600 });
    const snapshot = directory => fs.readdirSync(directory).sort().flatMap(name => {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      return [[path.relative(cache, file), stat.mode, stat.isFile() ? fs.readFileSync(file, "hex") : null],
        ...(stat.isDirectory() ? snapshot(file) : [])];
    });
    const before = snapshot(cache);
    let forbiddenCalls = 0;
    const noOperation = () => { forbiddenCalls++; throw new Error("Rejected helper cache must not execute or access credentials/network"); };
    globalThis.fetch = noOperation;
    const rejectedOptions = { env: { PATH: process.env.PATH }, helperCache: cache,
      spawn: noOperation, spawnSync: noOperation, statusRunner: noOperation, runner: noOperation,
      loginRunner: noOperation, tokenRunner: noOperation };
    const assertRejected = result => {
      assert.equal(result.ok, false);
      assert.equal(result.operation_verified, false);
      assert.equal(result.operation, "filters");
      assert.equal(result.phase, "authentication");
      assert.equal(result.http_status, null);
      assert.equal(result.error.code, "helper_untrusted");
      assert.match(result.error.message, /Preserve the cache.*setup\.js --status.*exact path and recovery/);
      assert.match(result.error.message, /repeating sign-in alone cannot repair/);
      assert.equal(Object.hasOwn(result, "data"), false);
      assert.equal(Object.hasOwn(result, "diagnostic"), false, "Reads must not forward helper diagnostics");
      assert.equal(JSON.stringify(result).includes(helperRoot), false, "The bounded read uses a fixed recovery message");
      assert.equal(forbiddenCalls, 0, "Local refusal must precede any status/read/login/token/process/network operation");
      assert.equal(fs.existsSync(marker), false, "Rejected helper bytes must never execute");
      assert.deepEqual(snapshot(cache), before, "Read refusal must preserve the managed cache");
      noLeak(result);
    };
    assertRejected(await readColosseum(["filters"], rejectedOptions));
    cases++;
    let output = "";
    const exit = await runColosseumReadCli(["filters", "--json"], { ...rejectedOptions,
      stdout: { write: text => { output += text; } } });
    assert.equal(exit, 1);
    assertRejected(JSON.parse(output));
    noLeak(output);
    cases++;
  } finally { globalThis.fetch = originalFetch; fs.rmSync(cache, { recursive: true, force: true }); }
  for (const body of [{ authenticated: false, scope: "evidence:read" }, { authenticated: true, scope: "colosseum_copilot:read" }, { authenticated: true, scope: "evidence:read", expiresAt: "2020-01-01T00:00:00Z" }]) {
    const result = await readColosseum(["filters"], { ...options, statusRunner: () => reply(200, body), runner: () => { throw new Error("Must not read"); } });
    assert.equal(result.error.code, "invalid_response");
    cases++;
  }
  for (const [http, expected] of [[401, "unauthorized401"], [402, "payment_required402"], [403, "forbidden403"], [404, "not_found404"], [429, "rate_limited429"], [302, "redirect_refused"], [500, "unavailable"]]) {
    let reads = 0;
    const result = await readColosseum(["filters"], { ...options, runner: () => { reads++; return reply(http, { error: sentinel }); } });
    assert.equal(result.error.code, expected);
    assert.equal(reads, 1);
    assert.equal(result.operation_verified, false);
    noLeak(result);
    cases++;
  }
  for (const response of [
    { status: 7, stdout: sentinel }, { status: null, error: new Error(sentinel) },
    { status: 0, stdout: `not-json ${sentinel}\nPROOFPILOT_HTTP_STATUS:200` },
    { status: 0, stdout: `${sentinel}\nPROOFPILOT_HTTP_STATUS:nope` }, reply(200, { error: sentinel }),
    { status: 0, stdout: "x".repeat(2 * 1024 * 1024 + 1) }
  ]) {
    const result = await readColosseum(["filters"], { ...options, runner: () => response });
    assert.equal(result.ok, false);
    noLeak(result);
    cases++;
  }
  for (const [helperRunner, expected, message] of [
    [() => ({ status: 1, stdout: "", stderr: "ENOTCACHED" }), "helper_missing", /--prepare-colosseum-helper.*--status/],
    [() => { throw new Error(sentinel); }, "helper_environment_unavailable", /setup\.js --status.*preserve saved credentials/]
  ]) {
    let calls = 0;
    const result = await readColosseum(["filters"], { helperRunner,
      statusRunner: () => { calls++; throw new Error("An unavailable local helper must stop before API access"); },
      runner: () => { calls++; throw new Error("An unavailable local helper must stop before corpus access"); } });
    assert.equal(result.error.code, expected);
    assert.match(result.error.message, message);
    assert.equal(result.phase, "authentication");
    assert.equal(calls, 0);
    noLeak(result);
    cases++;
  }
  const environmentFailure = await readColosseum(["filters"], { ...options,
    runner: () => ({ helper_error: "helper_environment_unavailable" }) });
  assert.equal(environmentFailure.error.code, "helper_environment_unavailable");
  assert.equal(environmentFailure.phase, "request");
  noLeak(environmentFailure);
  cases++;
  let output = "";
  assert.equal(await runColosseumReadCli(["--help"], { stdout: { write: text => { output += text; } } }), 0);
  assert.ok(output.includes("V2"));
  output = "";
  assert.equal(await runColosseumReadCli(["filters", "--token", sentinel], { stdout: { write: text => { output += text; } } }), 1);
  noLeak(output);
  cases++;
  return { cases };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(filename)) {
  console.log(`Colosseum V2 reads passed: ${(await runColosseumReadTests()).cases} offline cases.`);
}
