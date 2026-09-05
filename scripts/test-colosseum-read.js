import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildColosseumReadRequest, readColosseum, runColosseumReadCurl, runColosseumReadCli } from "../skills/proofpilot/scripts/colosseum-read.js";

const filename = fileURLToPath(import.meta.url);
const BASE = "https://copilot.colosseum.com/api/v1";
const token = 'synthetic-read-pat-quote"-backslash\\-must-stay-secret';
const now = new Date("2026-09-05T12:00:00.000Z");
const reply = (status, body) => ({ status: 0, stdout: `${JSON.stringify(body)}\nPROOFPILOT_HTTP_STATUS:${status}`, stderr: "" });
const authenticated = () => reply(200, { authenticated: true, scope: "colosseum_copilot:read", expiresAt: "2026-11-01T00:00:00Z" });

export function runColosseumReadTests() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-colosseum-read-"));
  let cases = 0;
  try {
    const home = path.join(temporaryRoot, "home");
    const configDir = path.join(temporaryRoot, "config");
    fs.mkdirSync(home);
    fs.mkdirSync(configDir);
    const options = { home, now, env: { PROOFPILOT_CONFIG_DIR: configDir, COLOSSEUM_COPILOT_PAT: token } };
    const noLeaks = value => {
      const rendered = typeof value === "string" ? value : JSON.stringify(value);
      assert.ok(!rendered.includes(token), "Selected credential leaked into output");
      assert.ok(!rendered.includes(JSON.stringify(token).slice(1, -1)), "Escaped credential leaked into output");
    };
    const casesByOperation = [
      { args: ["filters"], route: "/filters", body: { hackathons: [] } },
      { args: ["search-projects", "--query", "stablecoin payments", "--limit", "2"], route: "/search/projects", body: { results: [{ slug: "stablepal" }], totalFound: 1 } },
      { args: ["search-archives", "--query", "prediction markets"], route: "/search/archives", body: { results: [{ documentId: "sample" }], searchTier: "vector" } },
      { args: ["project", "--slug", "stablepal"], route: "/projects/by-slug/stablepal", body: { slug: "stablepal", name: "StablePal" } },
      { args: ["project", "--slug", "misk.fi-stablecoin-payments-for-your-business"], route: "/projects/by-slug/misk.fi-stablecoin-payments-for-your-business", body: { slug: "misk.fi-stablecoin-payments-for-your-business", name: "MISK.FI" } },
      { args: ["archive", "--id", "12345678-1234-1234-1234-123456789abc", "--offset", "8000", "--max-chars", "200"], route: "/archives/12345678-1234-1234-1234-123456789abc?offset=8000&maxChars=200", body: { documentId: "12345678-1234-1234-1234-123456789abc", content: "Archive slice" } },
      { args: ["cluster", "--key", "v1-c12"], route: "/clusters/v1-c12", body: { key: "v1-c12", label: "Example cluster" } }
    ];
    for (const scenario of casesByOperation) {
      const request = buildColosseumReadRequest(scenario.args);
      assert.equal(request.url, BASE + scenario.route);
      let statusCalls = 0;
      let readCalls = 0;
      const result = readColosseum(scenario.args, {
        ...options,
        statusRunner: selected => { statusCalls += 1; assert.equal(selected, token); return authenticated(); },
        runner: (selected, args) => { readCalls += 1; assert.equal(statusCalls, 1); assert.equal(selected, token); assert.deepEqual(args, scenario.args); return reply(200, scenario.body); }
      });
      assert.equal(result.ok, true);
      assert.equal(result.operation_verified, true);
      assert.equal(statusCalls, 1);
      assert.equal(readCalls, 1);
      assert.deepEqual(result.data, scenario.body);
      noLeaks(result);
      cases += 1;
    }

    const invalidArgs = [
      [], ["feedback"], ["https://evil.example"], ["filters", "--url", "https://evil.example"],
      ["filters", "--token", token], ["filters", "--json", "--json"], ["filters", "--insecure"],
      ["search-projects"], ["search-projects", "--query", " "], ["search-projects", "--query", "x".repeat(501)],
      ["search-projects", "--query", "line\nbreak"], ["search-projects", "--query", "foo", "--limit", "0"],
      ["search-projects", "--query", "foo", "--limit", "21"], ["search-projects", "--query", "foo", "--limit", "1.5"],
      ["search-projects", "--query", "foo", "--query", "bar"], ["search-projects", "--query", "--token"],
      ["search-archives", "--query", "foo", "--limit", "11"], ["project", "--slug", "../status"],
      ["project", "--slug", "%2e%2e%2fstatus"], ["project", "--slug", "foo?token=bar"],
      ["project", "--slug", "."], ["project", "--slug", ".."],
      ["archive", "--id", "not-a-uuid"], ["cluster", "--key", "v1-c12/../../status"],
      ["archive", "--id", "12345678-1234-1234-1234-123456789abc", "--max-chars", "20001"],
      ["search-projects", "--query", "foo", "--offset", "1000001"], ["filters", "--config", "@secret-file"]
    ];
    for (const args of invalidArgs) {
      let calls = 0;
      const result = readColosseum(args, { ...options, statusRunner: () => { calls += 1; return authenticated(); }, runner: () => { calls += 1; return reply(200, {}); } });
      assert.equal(result.error.code, "invalid_arguments");
      assert.equal(calls, 0, "Invalid arguments must be rejected before any network call");
      noLeaks(result);
      cases += 1;
    }

    for (const status of [401, 402, 403, 429, 500]) {
      let reads = 0;
      const result = readColosseum(["filters"], { ...options, statusRunner: () => reply(status, { error: token }), runner: () => { reads += 1; return reply(200, { hackathons: [] }); } });
      assert.equal(result.ok, false);
      assert.equal(result.phase, "authentication");
      assert.equal(result.http_status, status);
      assert.equal(reads, 0);
      noLeaks(result);
      cases += 1;
    }
    for (const body of [{ authenticated: false, scope: "colosseum_copilot:read" }, { authenticated: true, scope: "wrong" }, { authenticated: true, scope: "colosseum_copilot:read", expiresAt: "2026-01-01T00:00:00Z" }]) {
      let reads = 0;
      const result = readColosseum(["filters"], { ...options, statusRunner: () => reply(200, body), runner: () => { reads += 1; return reply(200, { hackathons: [] }); } });
      assert.equal(result.error.code, "invalid_response");
      assert.equal(reads, 0);
      cases += 1;
    }

    const expectedErrors = { 401: "unauthorized401", 402: "payment_required402", 403: "forbidden403", 404: "not_found404", 429: "rate_limited429", 302: "redirect_refused", 500: "unavailable" };
    for (const [code, expected] of Object.entries(expectedErrors)) {
      let reads = 0;
      const result = readColosseum(["filters"], { ...options, statusRunner: authenticated, runner: () => { reads += 1; return reply(Number(code), { error: token }); } });
      assert.equal(result.error.code, expected);
      assert.equal(result.operation_verified, false);
      assert.equal(reads, 1, "A failed read must not automatically retry");
      noLeaks(result);
      cases += 1;
    }

    for (const response of [
      { status: 7, stdout: token, stderr: token },
      { status: null, error: new Error(token), stdout: token },
      { status: 0, stdout: `not-json ${token}\nPROOFPILOT_HTTP_STATUS:200` },
      { status: 0, stdout: `${token}\nPROOFPILOT_HTTP_STATUS:nope` },
      reply(200, { error: token }),
      { status: 0, stdout: "x".repeat(2 * 1024 * 1024 + 1) }
    ]) {
      const result = readColosseum(["filters"], { ...options, statusRunner: authenticated, runner: () => response });
      assert.equal(result.ok, false);
      noLeaks(result);
      cases += 1;
    }
    const thrown = readColosseum(["filters"], { ...options, statusRunner: authenticated, runner: () => { throw new Error(token); } });
    assert.equal(thrown.error.code, "unavailable");
    noLeaks(thrown);
    cases += 1;

    const echoed = readColosseum(["search-projects", "--query", "foo"], { ...options, statusRunner: authenticated, runner: () => reply(200, { results: [{ name: token, nested: { [token]: `prefix ${token}` } }] }) });
    assert.equal(echoed.ok, true);
    assert.equal(echoed.data.results[0].name, "[redacted]");
    noLeaks(echoed);
    cases += 1;

    // Same resolver and exact token are used by status and the subsequent read.
    const credentialFile = path.join(configDir, "credentials.json");
    fs.writeFileSync(credentialFile, JSON.stringify({ colosseum_copilot_pat: token }));
    const noEnvironmentToken = { ...options, env: { PROOFPILOT_CONFIG_DIR: configDir } };
    const sameToken = readColosseum(["filters"], {
      ...noEnvironmentToken,
      statusRunner: selected => { assert.equal(selected, token); fs.writeFileSync(credentialFile, JSON.stringify({ colosseum_copilot_pat: "different-token-written-after-check" })); return authenticated(); },
      runner: selected => { assert.equal(selected, token, "Read must use the exact token that was just checked"); return reply(200, { hackathons: [] }); }
    });
    assert.equal(sameToken.ok, true);
    fs.unlinkSync(credentialFile);
    const legacyDir = path.join(home, ".superstack");
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, "config.json"), JSON.stringify({ copilotToken: token, preserve: true }));
    assert.equal(readColosseum(["filters"], { ...noEnvironmentToken, statusRunner: authenticated, runner: selected => { assert.equal(selected, token); return reply(200, { hackathons: [] }); } }).ok, true);
    fs.unlinkSync(path.join(legacyDir, "config.json"));
    let missingCalls = 0;
    const missing = readColosseum(["filters"], { ...noEnvironmentToken, statusRunner: () => { missingCalls += 1; return authenticated(); } });
    assert.equal(missing.error.code, "missing");
    assert.equal(missingCalls, 0);
    cases += 3;

    let statusCalls = 0;
    for (let trial = 0; trial < 2; trial += 1) {
      assert.equal(readColosseum(["filters"], { ...options, statusRunner: () => { statusCalls += 1; return authenticated(); }, runner: () => reply(200, { hackathons: [] }) }).ok, true);
    }
    assert.equal(statusCalls, 2, "Even a cached verified status must not skip the live preflight");
    cases += 1;

    // Both transport invocations remain fixed to the documented host, with auth only on stdin.
    const spawned = [];
    const fakeSpawn = (command, args, transport) => {
      spawned.push({ command, args, transport });
      assert.equal(command, "curl");
      assert.deepEqual(args, ["--disable", "--config", "-"]);
      assert.equal(transport.env.COLOSSEUM_COPILOT_PAT, undefined);
      assert.ok(!JSON.stringify(args).includes(token));
      assert.ok(transport.input.includes("Authorization: Bearer"));
      assert.ok(transport.timeout <= 21000);
      assert.ok(transport.maxBuffer <= 2 * 1024 * 1024);
      assert.ok(!/^(location|retry|insecure|user-agent)\s*=/m.test(transport.input));
      const urlLine = transport.input.split("\n").find(line => line.startsWith("url = "));
      const url = JSON.parse(urlLine.slice(6));
      assert.equal(new URL(url).origin, "https://copilot.colosseum.com");
      return url.endsWith("/status") ? authenticated() : reply(200, { results: [] });
    };
    const spawnResult = readColosseum(["search-projects", "--query", 'safe "quoted" query $(no-shell)', "--limit", "20"], { ...options, spawn: fakeSpawn });
    assert.equal(spawnResult.ok, true);
    assert.equal(spawned.length, 2);
    assert.ok(spawned[0].transport.input.includes("/status"));
    assert.ok(spawned[1].transport.input.includes("/search/projects"));
    assert.throws(() => runColosseumReadCurl("bad\ntoken", ["filters"], { spawn: fakeSpawn }));
    const customBase = readColosseum(["filters"], { ...options, env: { ...options.env, COLOSSEUM_COPILOT_API_BASE: "https://evil.example" }, spawn: () => { throw new Error("Must never be called"); } });
    assert.equal(customBase.ok, false);
    assert.equal(customBase.phase, "authentication");
    cases += 3;

    let output = "";
    const helpStatus = runColosseumReadCli(["--help"], { stdout: { write: text => { output += text; } }, statusRunner: () => { throw new Error("Help must be offline"); } });
    assert.equal(helpStatus, 0);
    assert.ok(output.includes("search-projects"));
    output = "";
    assert.equal(runColosseumReadCli(["filters", "--token", token], { ...options, stdout: { write: text => { output += text; } } }), 1);
    noLeaks(output);
    cases += 1;
    return { cases };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  const summary = runColosseumReadTests();
  console.log(`Colosseum read helper passed: ${summary.cases} offline cases. No account API called.`);
}
