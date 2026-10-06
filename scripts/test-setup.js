import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getSetupStatus, checkColosseum, runSetupCli } from "../skills/proofpilot/scripts/setup.js";
import { runConnectionHelper, loginColosseum, prepareColosseumHelper, helperFailureCode, COLOSSEUM_HELPER_PACKAGE } from "../skills/proofpilot/scripts/colosseum-connection.js";
import { CONNECTION_HELPER_TREE_SHA256, createHelperInvocation, trustedNpmCli } from "../skills/proofpilot/scripts/connection-helper.js";

const filename = fileURLToPath(import.meta.url);
const sentinel = "synthetic-v1-credential-never-display";
const now = new Date("2026-10-01T08:00:00Z");
const local = (extra = {}) => ({ status: 0, stdout: JSON.stringify({ state: "stored credentials present (not verified)", credentialState: "ready", scopes: ["evidence:read"], ...extra }) });
const reply = (http, body) => ({ status: 0, stdout: `${JSON.stringify(body)}\nPROOFPILOT_HTTP_STATUS:${http}` });
const ready = () => reply(200, { authenticated: true, scope: "evidence:read self-data:read telemetry:write", expiresAt: "2026-11-01T00:00:00Z" });

function localHelper(cache) {
  const cli = path.join(cache, "helper.cjs");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(cli, "process.exitCode = 99;\n");
  return fs.realpathSync(cli);
}

// The managed-helper validator's length-framed listing, computed for a synthetic tree.
function treeDigest(root) {
  const digest = createHash("sha256");
  const walk = (directory, relative = "") => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const entry = relative ? `${relative}/${name}` : name;
      if (fs.lstatSync(file).isDirectory()) {
        digest.update(`d ${Buffer.byteLength(entry)}:${entry}\n`);
        walk(file, entry);
      } else {
        const bytes = fs.readFileSync(file);
        digest.update(`f ${Buffer.byteLength(entry)}:${entry} ${bytes.length} ${createHash("sha256").update(bytes).digest("hex")}\n`);
      }
    }
  };
  walk(root);
  return digest.digest("hex");
}

function treeSnapshot(directory, prefix = "") {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    const entry = `${prefix}${name}:${stat.mode}`;
    return stat.isDirectory() ? [entry, ...treeSnapshot(file, `${prefix}${name}/`)] : [`${entry}:${fs.readFileSync(file, "hex")}`];
  });
}

// Explicit validator seam: copies of the connection modules whose pinned digest is
// replaced by a synthetic tree's digest. This models only "the managed cache passed
// validation"; it makes no claim that the synthetic package is the official helper.
async function acceptingValidatorSeam(directory, digest) {
  const scripts = new URL("../skills/proofpilot/scripts/", import.meta.url);
  const pinned = /^export const CONNECTION_HELPER_TREE_SHA256 = "[0-9a-f]{64}";/gm;
  const source = fs.readFileSync(new URL("connection-helper.js", scripts), "utf8");
  assert.equal(source.match(pinned)?.length, 1, "The seam must replace exactly the pinned tree digest");
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, "package.json"), "{\"private\":true,\"type\":\"module\"}\n");
  fs.writeFileSync(path.join(directory, "connection-helper.js"), source.replace(pinned, `export const CONNECTION_HELPER_TREE_SHA256 = "${digest}";`));
  fs.copyFileSync(new URL("colosseum-connection.js", scripts), path.join(directory, "colosseum-connection.js"));
  fs.copyFileSync(new URL("node-runtime.js", scripts), path.join(directory, "node-runtime.js"));
  return {
    helper: await import(pathToFileURL(path.join(directory, "connection-helper.js")).href),
    connection: await import(pathToFileURL(path.join(directory, "colosseum-connection.js")).href)
  };
}

// A synthetic Node installation that is only inspected, never executed.
function nodeLayout(root, name, withNpm) {
  const prefix = path.join(root, name);
  const node = path.join(prefix, "bin", "node");
  fs.mkdirSync(path.dirname(node), { recursive: true, mode: 0o700 });
  fs.writeFileSync(node, "synthetic Node layout, never executed\n", { mode: 0o700 });
  if (!withNpm) return { node, npmCli: null };
  const npm = path.join(prefix, "lib", "node_modules", "npm");
  fs.mkdirSync(path.join(npm, "bin"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(npm, "bin", "npm-cli.js"), "synthetic npm, never executed\n", { mode: 0o600 });
  fs.writeFileSync(path.join(npm, "package.json"), JSON.stringify({ name: "npm", version: "10.9.0" }), { mode: 0o600 });
  return { node, npmCli: path.join(npm, "bin", "npm-cli.js") };
}

// Resolve the running Node into a synthetic layout for npm discovery only;
// `nodeOwner` emulates a Node executable owned by another account.
async function withNodeLayout(node, run, nodeOwner) {
  const realpath = fs.realpathSync;
  const stat = fs.statSync;
  fs.realpathSync = Object.assign((file, ...args) => realpath(file === process.execPath ? node : file, ...args), { native: realpath.native });
  if (nodeOwner !== undefined) {
    fs.statSync = (file, ...args) => {
      const result = stat(file, ...args);
      if (file === node && result) result.uid = nodeOwner;
      return result;
    };
  }
  try { return await run(); } finally { fs.realpathSync = realpath; fs.statSync = stat; }
}

export async function runSetupTests() {
  let cases = 0;
  const test = async (name, run) => { await run(); cases++; };
  const options = { now, env: {}, helperRunner: () => local(), statusRunner: ready };
  const noLeak = value => assert.ok(!JSON.stringify(value).includes(sentinel));

  await test("offline status never verifies saved access or calls the API", () => {
    const status = getSetupStatus({ ...options, statusRunner: () => { throw new Error("Must stay offline"); } });
    assert.equal(status.schema_version, "2");
    assert.equal(status.colosseum.status, "configured_unverified");
    assert.equal(status.colosseum.auth_method, "oauth_pkce");
    assert.equal(status.colosseum.live_check_performed, false);
    assert.equal(status.setup_required, true);
  });
  for (const [state, expected] of [["ready", "configured_unverified"], ["refresh-pending", "refresh_pending"], ["expired", "expired"], ["revoked", "revoked"]]) {
    await test(`local state ${state}`, () => assert.equal(getSetupStatus({ helperRunner: () => local({ credentialState: state }) }).colosseum.status, expected));
  }
  await test("expired access timestamp alone does not force a new login", async () => {
    const status = await checkColosseum({ ...options, helperRunner: () => local({ accessExpiresAt: "2020-01-01T00:00:00Z" }) });
    assert.equal(status.colosseum.status, "verified", "The official helper can renew saved authorization");
  });
  await test("missing connection cannot trigger login or a data request", async () => {
    const status = await checkColosseum({ ...options, helperRunner: () => ({ status: 5, stdout: JSON.stringify({ state: "not-logged-in" }) }), statusRunner: () => { throw new Error("No API call expected"); } });
    assert.equal(status.colosseum.status, "missing");
    assert.equal(status.colosseum.configured, false);
    assert.equal(status.colosseum.credential_presence, "missing");
    assert.equal(status.colosseum.credential_required, true);
    assert.equal(status.colosseum.credentials_inspected, true);
  });
  for (const result of [
    { status: null, error: { code: "ETIMEDOUT", message: sentinel }, stdout: "", stderr: sentinel },
    { status: 5, error: { code: "ETIMEDOUT", message: sentinel }, stdout: "", stderr: sentinel },
    { status: 1, stdout: "", stderr: sentinel },
    { status: 0, stdout: "{", stderr: sentinel },
    { status: 0, stdout: JSON.stringify({ state: sentinel }), stderr: sentinel }
  ]) {
    await test("an uninspected local state cannot require new credentials", async () => {
      let output = "";
      const status = getSetupStatus({ helperRunner: () => result });
      assert.equal(status.colosseum.configured, false);
      assert.equal(status.colosseum.credential_presence, "unknown");
      assert.equal(status.colosseum.credential_required, false);
      assert.equal(status.colosseum.credentials_inspected, false);
      assert.equal(status.colosseum.next_action, "check_colosseum");
      const exit = await runSetupCli(["--status", "--json"], { helperRunner: () => result,
        stdout: { write: value => { output += value; } } });
      assert.equal(exit, 0);
      assert.deepEqual(JSON.parse(output), status);
      noLeak(output);
    });
  }
  await test("a helper environment exception never forwards private exception text or requests credentials", () => {
    const status = getSetupStatus({ helperRunner: () => { throw new Error(sentinel); } });
    assert.equal(status.colosseum.reason, "helper_environment_unavailable");
    assert.equal(status.colosseum.next_action, "repair_helper_environment");
    assert.equal(status.colosseum.credential_presence, "unknown");
    assert.equal(status.colosseum.credential_required, false);
    assert.match(status.colosseum.diagnostic, /retry setup\.js --status/);
    noLeak(status);
  });
  await test("fresh verified access after local exit 6 establishes a connection without falsely requiring credentials", async () => {
    const localOptions = { ...options, helperRunner: () => ({ status: 6, stdout: "", stderr: sentinel }) };
    const offline = getSetupStatus(localOptions).colosseum;
    assert.equal(offline.status, "refresh_pending");
    assert.equal(offline.credential_presence, "unknown");
    assert.equal(offline.credential_required, false);
    const live = (await checkColosseum(localOptions)).colosseum;
    assert.equal(live.status, "verified");
    assert.equal(live.configured, true);
    assert.equal(live.credential_presence, "present");
    assert.equal(live.credential_required, false);
    assert.equal(live.credentials_inspected, false, "A live grant does not retroactively inspect local storage");
    assert.equal(live.live_check_performed, true);
    assert.equal(live.credential_source, "copilot_connect");
    noLeak(live);
  });
  for (const [exit, expected] of [[1, "unavailable"], [2, "expired"], [3, "revoked"], [4, "unavailable"], [5, "missing"], [6, "refresh_pending"], [7, "evidence_unavailable"], [8, "forbidden403"]]) {
    await test(`helper exit ${exit} remains distinct`, () => {
      const status = getSetupStatus({ helperRunner: () => ({ status: exit, stdout: "", stderr: sentinel }) });
      assert.equal(status.colosseum.status, expected);
      noLeak(status);
    });
  }
  await test("missing helper transport with null stdout reports preparation instead of an invalid response", () => {
    const status = getSetupStatus({ helperRunner: () => ({ status: null, stdout: null, stderr: null, error: { code: "ENOENT", message: sentinel } }) });
    assert.equal(status.colosseum.status, "helper_missing");
    assert.equal(status.colosseum.next_action, "prepare_helper");
    assert.equal(status.colosseum.configured, false);
    assert.equal(status.colosseum.credential_presence, "unknown");
    assert.equal(status.colosseum.credential_required, false);
    assert.equal(status.colosseum.next_command.at(-1), "--prepare-colosseum-helper");
    noLeak(status);
  });
  await test("damaged managed helper cache is distinguished from an absent one and gives recovery instead of a connect loop", async () => {
    const cache = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-setup-damaged-helper-")));
    try {
      const helperRoot = path.join(cache, "_proofpilot_helpers", "copilot-connect-0.2.2");
      const packageRoot = path.join(helperRoot, "node_modules", "@colosseum-org", "copilot-connect");
      const marker = path.join(cache, "damaged-helper-ran");
      fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
        name: "@colosseum-org/copilot-connect", version: "0.2.2", type: "module", bin: { "copilot-connect": "src/cli.js" }
      }), { mode: 0o600 });
      fs.writeFileSync(path.join(packageRoot, "src", "cli.js"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "${sentinel}");\n`, { mode: 0o600 });
      const tree = () => {
        const entries = [];
        const visit = (directory, prefix = "") => {
          for (const name of fs.readdirSync(directory).sort()) {
            const relative = prefix ? path.join(prefix, name) : name;
            const file = path.join(directory, name);
            const stat = fs.lstatSync(file);
            entries.push(stat.isFile() ? `${relative}:${fs.readFileSync(file, "hex")}` : relative);
            if (stat.isDirectory()) visit(file, relative);
          }
        };
        visit(cache);
        return entries;
      };
      const before = tree();
      const noSpawn = () => { throw new Error("A rejected helper cache must not start any process"); };
      for (let attempt = 0; attempt < 2; attempt++) {
        const status = getSetupStatus({ env: { PATH: process.env.PATH }, helperCache: cache, spawnSync: noSpawn });
        assert.equal(status.colosseum.status, "helper_untrusted");
        assert.equal(status.colosseum.next_action, "repair_helper_cache", "Retrying sign-in cannot repair a damaged cache");
        assert.equal(status.colosseum.helper_cache, helperRoot);
        assert.ok(path.isAbsolute(status.colosseum.helper_cache));
        assert.ok(status.colosseum.diagnostic.includes(JSON.stringify(helperRoot)));
        assert.match(status.colosseum.diagnostic, /Preserve it.*belongs to your account.*move the whole directory aside.*explicitly retry helper preparation/);
        assert.match(status.colosseum.diagnostic, /--prepare-colosseum-helper.*--status/);
        assert.doesNotMatch(status.colosseum.diagnostic, /--connect-colosseum/);
        assert.equal(status.colosseum.credentials_inspected, false);
        assert.equal(status.colosseum.credential_required, false, "Only helper trust failed; credentials are not reported absent");
        assert.equal(status.colosseum.live_check_performed, false);
        assert.match(status.colosseum.reason, /not inspected or changed/);

        let preparationOutput = "", preparationError = "";
        const preparationExit = await runSetupCli(["--prepare-colosseum-helper"], {
          env: { PATH: process.env.PATH }, helperCache: cache, spawn: noSpawn, spawnSync: noSpawn,
          helperRunner: noSpawn, loginRunner: noSpawn, statusRunner: noSpawn,
          stdout: { write: text => { preparationOutput += text; } }, stderr: { write: text => { preparationError += text; } }
        });
        assert.equal(preparationExit, 1);
        assert.equal(preparationOutput, "");
        assert.match(preparationError, /--prepare-colosseum-helper.*--status/);
        assert.doesNotMatch(preparationError, /--connect-colosseum/);

        let output = "";
        let errorText = "";
        const exit = await runSetupCli(["--connect-colosseum"], { env: { PATH: process.env.PATH }, helperCache: cache,
          spawn: noSpawn, spawnSync: noSpawn, statusRunner: noSpawn,
          stdout: { write: text => { output += text; } }, stderr: { write: text => { errorText += text; } } });
        assert.equal(exit, 1);
        assert.equal(output, "");
        assert.match(errorText, /^Colosseum sign-in was not started\. /);
        assert.ok(errorText.includes(JSON.stringify(helperRoot)), "Setup must name the exact absolute managed cache");
        assert.match(errorText, /move the whole directory aside/);
        noLeak(errorText);

        const check = await checkColosseum({ env: { PATH: process.env.PATH }, helperCache: cache, spawnSync: noSpawn, statusRunner: noSpawn });
        assert.equal(check.colosseum.status, "helper_untrusted");
        const login = await loginColosseum({ env: { PATH: process.env.PATH }, helperCache: cache, spawn: noSpawn });
        assert.equal(login.error, "helper_untrusted");
        assert.equal(login.helper_cache, helperRoot);
        assert.equal(fs.existsSync(marker), false, "The damaged helper bytes executed");
        assert.deepEqual(tree(), before, "Refusal removed, repaired or changed the damaged cache");
      }

      fs.renameSync(helperRoot, `${helperRoot}.quarantine`);
      const absent = getSetupStatus({ env: { PATH: process.env.PATH }, helperCache: cache,
        spawnSync: () => ({ status: 1, stdout: "", stderr: "ENOTCACHED: exact connection helper is not installed in the managed helper cache\n" }) });
      assert.equal(absent.colosseum.status, "helper_missing", "After operator quarantine the cache is absent and can be prepared again");
      assert.equal(absent.colosseum.next_action, "prepare_helper");
      assert.equal(absent.colosseum.helper_cache, undefined);
      assert.ok(fs.existsSync(path.join(`${helperRoot}.quarantine`, "node_modules", "@colosseum-org", "copilot-connect", "src", "cli.js")));
      assert.equal(fs.existsSync(marker), false);
    } finally { fs.rmSync(cache, { recursive: true, force: true }); }
  });
  await test("fresh V2 status checks current scope instead of saved grants", async () => {
    let calls = 0;
    const status = await checkColosseum({ ...options, statusRunner: request => {
      calls++;
      assert.equal(request.url, "https://copilot.colosseum.com/api/v2/status");
      assert.equal(request.method, "GET");
      return ready();
    } });
    assert.equal(calls, 1);
    assert.equal(status.colosseum.status, "verified");
    assert.equal(status.setup_required, false);
    assert.equal(status.colosseum.live_check_performed, true);
  });
  await test("compatibility alias for evidence scope is accepted", async () => {
    const status = await checkColosseum({ ...options, statusRunner: () => reply(200, { authenticated: true, scope: "copilot:retrieval", expiresAt: null }) });
    assert.equal(status.colosseum.status, "verified");
  });
  for (const [expiresAt, normalized] of [
    ["2024-02-29T06:30:00.123456+05:30", "2024-02-29T01:00:00.123Z"],
    ["2024-02-29T18:30:00.1-05:30", "2024-03-01T00:00:00.100Z"],
    ["2024-02-29T01:00:00Z", "2024-02-29T01:00:00.000Z"]
  ]) {
    await test("valid leap dates, fractional seconds and explicit offsets remain verified", async () => {
      const status = await checkColosseum({ ...options, now: "2024-02-28T00:00:00Z",
        statusRunner: () => reply(200, { authenticated: true, scope: "evidence:read", expiresAt }) });
      assert.equal(status.colosseum.status, "verified");
      assert.equal(status.colosseum.expires_at, normalized);
      assert.equal(getSetupStatus({ helperRunner: () => local({ accessExpiresAt: expiresAt }) }).colosseum.expires_at, normalized);
    });
  }
  for (const expiresAt of [null, undefined]) {
    await test("null or omitted expiry keeps the declared status contract", async () => {
      const status = await checkColosseum({ ...options,
        statusRunner: () => reply(200, { authenticated: true, scope: "evidence:read", expiresAt }) });
      assert.equal(status.colosseum.status, "verified");
      assert.equal(status.colosseum.expires_at, null);
    });
  }
  for (const expiresAt of [
    "2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z",
    "2026-13-01T00:00:00Z", "2026-10-02T24:00:00Z", "2026-10-02T25:00:00Z",
    "2026-10-02T00:60:00Z", "2026-10-02T00:00:60Z", "2026-10-02T00:00:00",
    "2026-10-02T00:00:00+24:00", "2026-10-02T00:00:00+01:60", sentinel
  ]) {
    await test("malformed expiry cannot be normalized into ready setup or displayed", async () => {
      let output = "";
      const status = await runSetupCli(["--check-colosseum"], { ...options, now: "2026-03-01T00:00:00Z",
        stdout: { write: text => { output += text; } },
        statusRunner: () => reply(200, { authenticated: true, scope: "evidence:read", expiresAt }) });
      assert.equal(status, 1);
      const result = JSON.parse(output);
      assert.equal(result.colosseum.status, "invalid_response");
      assert.equal(result.setup_required, true);
      assert.equal(result.colosseum.expires_at, null);
      assert.equal(result.colosseum.configured, true);
      assert.equal(getSetupStatus({ helperRunner: () => local({ accessExpiresAt: expiresAt }) }).colosseum.expires_at, null);
      noLeak(output);
    });
  }
  for (const body of [
    { authenticated: false, scope: "evidence:read" },
    { authenticated: true, scope: "colosseum_copilot:read" },
    { authenticated: true, scope: null },
    { authenticated: true, scope: ["evidence:read"] },
    { authenticated: true, scope: "evidence:read", expiresAt: "2020-01-01T00:00:00Z" },
    { authenticated: true, scope: "evidence:read", expiresAt: "invalid" }
  ]) {
    await test("invalid V2 access cannot become verified", async () => assert.equal((await checkColosseum({ ...options, statusRunner: () => reply(200, body) })).colosseum.status, "invalid_response"));
  }
  await test("explicit evidence disable keeps credentials", async () => assert.equal((await checkColosseum({ ...options, statusRunner: () => reply(200, { authenticated: true, scope: "evidence:read", capabilities: { evidence: false } }) })).colosseum.status, "evidence_unavailable"));
  for (const [http, expected] of [[401, "unauthorized401"], [402, "payment_required402"], [403, "forbidden403"], [404, "not_found404"], [429, "rate_limited429"], [302, "redirect_refused"], [500, "unavailable"]]) {
    await test(`HTTP ${http} does not reset or retry`, async () => {
      let calls = 0;
      const status = await checkColosseum({ ...options, statusRunner: () => { calls++; return reply(http, { error: sentinel }); } });
      assert.equal(calls, 1);
      assert.equal(status.colosseum.status, expected);
      assert.equal(status.colosseum.configured, true);
      noLeak(status);
    });
  }
  await test("subprocess errors never leak", async () => {
    const status = await checkColosseum({ ...options, statusRunner: () => { throw new Error(sentinel); } });
    assert.equal(status.colosseum.status, "unavailable");
    noLeak(status);
  });
  await test("helper failure before HTTPS is not live verification", async () => {
    const status = await checkColosseum({ ...options, statusRunner: () => ({ helper_error: "refresh_pending" }) });
    assert.equal(status.colosseum.live_check_performed, false);
    assert.equal(status.colosseum.status, "refresh_pending");
  });
  await test("legacy secrets and bases are not passed to the pinned cached helper", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-setup-helper-"));
    try {
      const helperCli = localHelper(cache);
      const configDir = path.join(cache, "config");
      fs.mkdirSync(configDir);
      const userConfig = path.join(configDir, "user.npmrc");
      const globalConfig = path.join(configDir, "global.npmrc");
      fs.writeFileSync(userConfig, "");
      fs.writeFileSync(globalConfig, "");
      runConnectionHelper(["status", "--local"], { helperCache: cache,
        createHelperInvocation: (args, invocationOptions) => ({
          command: process.execPath, args: [helperCli, ...args], cwd: configDir, shell: false,
          env: { ...invocationOptions.env, npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig },
          cleanup() {}
        }),
        env: { COLOSSEUM_COPILOT_PAT: sentinel, COLOSSEUM_COPILOT_API_BASE: "https://evil.invalid", KEEP: "yes", NODE_OPTIONS: "--require=/synthetic/preload", PATH: `/synthetic/project/node_modules/.bin${path.delimiter}${process.env.PATH}` }, spawnSync: (command, args, transport) => {
        assert.equal(command, process.execPath);
        assert.ok(path.isAbsolute(command));
        assert.deepEqual(args, [helperCli, "status", "--local"]);
        assert.equal(transport.shell, false);
        assert.equal(transport.env.COLOSSEUM_COPILOT_PAT, undefined);
        assert.equal(transport.env.COLOSSEUM_COPILOT_API_BASE, undefined);
        assert.equal(transport.env.KEEP, undefined);
        assert.equal(transport.env.NODE_OPTIONS, undefined);
        assert.ok(!transport.env.PATH.includes("/synthetic/project/node_modules/.bin"));
        for (const name of ["npm_config_userconfig", "npm_config_globalconfig"]) {
          assert.equal(path.dirname(transport.env[name]), transport.cwd);
          assert.equal(fs.readFileSync(transport.env[name], "utf8"), "");
        }
        noLeak(args);
        return local();
      } });
      assert.throws(() => runConnectionHelper(["token"]), /Unsupported/);
    } finally { fs.rmSync(cache, { recursive: true, force: true }); }
  });
  await test("explicit online login uses Node with an absolute trusted npm CLI and direct helper bootstrap", async () => {
    const result = await loginColosseum({ device: true, env: { COLOSSEUM_COPILOT_PAT: sentinel, PATH: process.env.PATH }, spawn: (command, args, transport) => {
      assert.equal(command, process.execPath);
      assert.ok(path.isAbsolute(command));
      assert.equal(args[0], "--input-type=module");
      const npmCli = args.find(arg => path.isAbsolute(arg) && path.basename(arg) === "npm-cli.js");
      assert.ok(npmCli);
      assert.ok(args.includes("--eval") && args.includes(COLOSSEUM_HELPER_PACKAGE));
      assert.deepEqual(args.slice(-2), ["login", "--device"]);
      assert.equal(args.some(arg => /npx(?:-cli)?/.test(path.basename(arg))), false);
      assert.equal(transport.shell, false);
      assert.equal(transport.env.COLOSSEUM_COPILOT_PAT, undefined);
      assert.ok(!transport.env.PATH.includes("node_modules/.bin"));
      for (const name of ["npm_config_userconfig", "npm_config_globalconfig"]) {
        assert.equal(path.dirname(transport.env[name]), transport.cwd);
        assert.equal(fs.readFileSync(transport.env[name], "utf8"), "");
      }
      noLeak(args);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    } });
    assert.equal(result.status, 0);
  });
  {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-helper-npm-")));
    try {
      const home = fs.realpathSync(os.userInfo().homedir);
      const helperWork = path.join(home, ".proofpilot", "helper-work");
      const workspaces = () => fs.existsSync(helperWork) ? fs.readdirSync(helperWork).filter(name => name.startsWith(".proofpilot-helper-")).sort() : [];
      const withoutNpm = nodeLayout(root, "node-without-npm", false);
      const withNpm = nodeLayout(root, "node-with-npm", true);
      const unavailable = [["absent npm", withoutNpm.node]];
      // npm owned by the user while the Node executable belongs to another account.
      if (typeof process.getuid === "function") unavailable.push(["npm not owned like node", withNpm.node, process.getuid() === 0 ? 1 : 0]);
      const cache = path.join(root, "validated-cache");
      const helperRoot = path.join(cache, "_proofpilot_helpers", "copilot-connect-0.2.2");
      const packageRoot = path.join(helperRoot, "node_modules", "@colosseum-org", "copilot-connect");
      const cli = path.join(packageRoot, "bin", "cli.js");
      fs.mkdirSync(path.dirname(cli), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
        name: "@colosseum-org/copilot-connect", version: "0.2.2", type: "module", bin: { "copilot-connect": "bin/cli.js" }
      }), { mode: 0o600 });
      fs.writeFileSync(cli, "process.exitCode = 97; // synthetic helper fixture, never executed\n", { mode: 0o600 });
      const digest = treeDigest(packageRoot);
      assert.notEqual(digest, CONNECTION_HELPER_TREE_SHA256, "The synthetic tree must not match the official pinned digest");
      const seam = await acceptingValidatorSeam(path.join(root, "seam"), digest);
      const emptyCache = path.join(root, "empty-cache");
      fs.mkdirSync(emptyCache, { mode: 0o700 });
      const env = { PATH: process.env.PATH, COLOSSEUM_COPILOT_PAT: sentinel, NODE_OPTIONS: "--require=/synthetic/preload",
        npm_config_registry: "https://registry.invalid" };
      const exited = code => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit("close", code));
        return child;
      };

      await test("a validated helper signs in directly whether npm is absent, foreign-owned or trusted", async () => {
        for (const [condition, node, nodeOwner] of [...unavailable, ["trusted npm", withNpm.node]]) {
          await withNodeLayout(node, async () => {
            assert.equal(trustedNpmCli(), condition === "trusted npm" ? withNpm.npmCli : null, `${condition} fixture`);
            const before = workspaces();
            for (const [args, online] of [[["login"], true], [["token"], false], [["status", "--local"], false]]) {
              const invocation = seam.helper.createHelperInvocation(args, { online, cache, env });
              try {
                assert.equal(invocation.command, process.execPath);
                assert.deepEqual(invocation.args, [cli, ...args], `${condition}: the validated helper must run ${args[0]} directly`);
                assert.equal(invocation.cwd, helperRoot);
                assert.equal(invocation.shell, false);
                assert.equal(invocation.helperCacheIssue ?? invocation.helperPrerequisiteIssue, undefined);
                assert.equal(invocation.env.HOME, home);
                for (const name of ["npm_config_userconfig", "npm_config_globalconfig", "npm_config_cache", "npm_config_registry",
                  "TMPDIR", "TMP", "TEMP", "COLOSSEUM_COPILOT_PAT", "NODE_OPTIONS"]) {
                  assert.equal(invocation.env[name], undefined, `${name} must not reach a validated helper`);
                }
              } finally { invocation.cleanup(); }
            }
            const spawned = [];
            const login = await seam.connection.loginColosseum({ device: true, env, helperCache: cache, spawn: (command, args, transport) => {
              spawned.push({ command, args, transport });
              return exited(0);
            } });
            assert.deepEqual(login, { status: 0 }, `${condition}: sign-in must use the validated helper`);
            assert.equal(spawned.length, 1);
            assert.equal(spawned[0].command, process.execPath);
            assert.deepEqual(spawned[0].args, [cli, "login", "--device"]);
            assert.equal(spawned[0].transport.cwd, helperRoot);
            assert.equal(spawned[0].transport.shell, false);
            assert.equal(spawned[0].transport.env.npm_config_userconfig, undefined);
            assert.equal(spawned[0].transport.env.COLOSSEUM_COPILOT_PAT, undefined);
            noLeak(spawned[0].args);
            let output = "";
            const exit = await runSetupCli(["--connect-colosseum"], { ...options, env, helperCache: cache,
              loginRunner: seam.connection.loginColosseum,
              spawn: (command, args) => { assert.deepEqual(args, [cli, "login"]); return exited(0); },
              stdout: { write: text => { output += text; } }, stderr: { write: () => {} } });
            assert.equal(exit, 0, `${condition}: --connect-colosseum must complete with the validated helper`);
            assert.equal(JSON.parse(output).colosseum.status, "verified");
            assert.deepEqual(workspaces(), before, "No npm workspace may be prepared for a validated helper");
          }, nodeOwner);
        }
      });
      await test("an absent helper without trusted npm reports that prerequisite instead of ENOTCACHED", async () => {
        for (const [condition, node, nodeOwner] of unavailable) {
          await withNodeLayout(node, async () => {
            assert.equal(trustedNpmCli(), null, `${condition} fixture`);
            const before = workspaces();
            const invocation = createHelperInvocation(["login"], { online: true, cache: emptyCache, env });
            let result;
            try {
              assert.equal(invocation.helperPrerequisiteIssue?.code, "helper_npm_unavailable");
              assert.match(invocation.helperPrerequisiteIssue.diagnostic, /preparing it needs the npm CLI/);
              assert.match(invocation.helperPrerequisiteIssue.diagnostic, /--prepare-colosseum-helper.*--status/);
              assert.doesNotMatch(invocation.helperPrerequisiteIssue.diagnostic, /--connect-colosseum/);
              assert.equal(invocation.helperCacheIssue, undefined);
              assert.equal(invocation.cwd, home, "No preparation workspace is created");
              assert.equal(invocation.args.includes("login"), false, "No helper operation may run");
              assert.equal(invocation.args.some(arg => arg === COLOSSEUM_HELPER_PACKAGE || path.basename(arg) === "npm-cli.js"), false);
              assert.equal(invocation.env.npm_config_userconfig, undefined);
              result = spawnSync(invocation.command, invocation.args, { cwd: invocation.cwd, env: invocation.env, encoding: "utf8", timeout: 15000 });
            } finally { invocation.cleanup(); }
            assert.equal(result.status, 1, result.stderr);
            assert.match(result.stderr, /EHELPERNPM: .*preparing it needs the npm CLI/);
            assert.doesNotMatch(result.stderr, /ENOTCACHED/);
            assert.match(result.stderr, /--prepare-colosseum-helper.*--status/);
            assert.doesNotMatch(result.stderr, /--connect-colosseum/);
            assert.notEqual(helperFailureCode(result), "helper_missing", "A missing npm prerequisite is not a missing helper");
            const spawned = [];
            const login = await loginColosseum({ env, helperCache: emptyCache, spawn: (command, args) => { spawned.push(args); return exited(1); } });
            assert.deepEqual(login, { status: 1, error: "helper_npm_unavailable" });
            assert.equal(spawned.length, 1);
            assert.match(spawned[0].join("\n"), /EHELPERNPM/);
            assert.doesNotMatch(spawned[0].join("\n"), /ENOTCACHED/);
            let output = "";
            let errorText = "";
            const exit = await runSetupCli(["--connect-colosseum"], { env, helperCache: emptyCache, spawn: () => exited(1),
              statusRunner: () => { throw new Error("A failed sign-in must not check status"); },
              stdout: { write: text => { output += text; } }, stderr: { write: text => { errorText += text; } } });
            assert.equal(exit, 1);
            assert.equal(output, "");
            assert.match(errorText, /sign-in did not complete/);
            assert.deepEqual(workspaces(), before, "Missing npm must not create a preparation workspace");
            assert.deepEqual(fs.readdirSync(emptyCache), [], "Nothing may be prepared or downloaded into the cache");
          }, nodeOwner);
        }
      });
      await test("an absent helper with trusted npm still prepares through the isolated bootstrap", async () => {
        await withNodeLayout(withNpm.node, async () => {
          assert.equal(trustedNpmCli(), withNpm.npmCli);
          const invocation = createHelperInvocation(["login"], { online: true, cache: emptyCache, env });
          try {
            assert.equal(invocation.helperPrerequisiteIssue, undefined);
            assert.equal(invocation.args[0], "--input-type=module");
            assert.ok(invocation.args.includes(withNpm.npmCli) && invocation.args.includes(COLOSSEUM_HELPER_PACKAGE) &&
              invocation.args.includes(CONNECTION_HELPER_TREE_SHA256), "Preparation must use the npm CLI tied to the running Node");
            assert.equal(invocation.args.at(-1), "login");
            assert.ok(path.basename(invocation.cwd).startsWith(".proofpilot-helper-"));
            for (const name of ["npm_config_userconfig", "npm_config_globalconfig"]) assert.equal(path.dirname(invocation.env[name]), invocation.cwd);
            assert.equal(invocation.env.npm_config_cache, emptyCache);
          } finally { invocation.cleanup(); }
          assert.equal(fs.existsSync(invocation.cwd), false, "cleanup removes its preparation workspace");
        });
      });
      await test("an untrusted existing helper stays refused and preserved when npm is unavailable", async () => {
        const before = treeSnapshot(cache);
        await withNodeLayout(withoutNpm.node, async () => {
          for (const online of [true, false]) {
            const refusal = createHelperInvocation(["login"], { online, cache, env });
            try {
              assert.equal(refusal.helperCacheIssue?.code, "helper_untrusted", "The shipped pinned digest refuses the synthetic tree");
              assert.equal(refusal.helperCacheIssue.path, helperRoot);
              assert.equal(refusal.helperPrerequisiteIssue, undefined, "Cache refusal precedes any npm prerequisite");
              assert.equal(refusal.cwd, home);
              assert.equal(refusal.args.some(arg => arg.startsWith(helperRoot + path.sep) || path.basename(arg) === "npm-cli.js"), false);
            } finally { refusal.cleanup(); }
          }
          const login = await loginColosseum({ env, helperCache: cache, spawn: () => { throw new Error("A rejected cache must not start a process"); } });
          assert.equal(login.error, "helper_untrusted");
          assert.equal(login.helper_cache, helperRoot);
        });
        assert.deepEqual(treeSnapshot(cache), before, "Refusal changed the untrusted cache");
      });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
  await test("legacy files are neither read nor rewritten", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-old-credentials-"));
    try {
      const files = [".config/proofpilot/credentials.json", ".config/proofpilot/setup-state.json", ".superstack/config.json"];
      for (const file of files) { const target = path.join(home, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, sentinel); }
      getSetupStatus({ home, env: {}, helperRunner: () => local(), fs: { openSync: () => { throw new Error("Legacy files must not be opened"); } } });
      for (const file of files) assert.equal(fs.readFileSync(path.join(home, file), "utf8"), sentinel);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  for (const kind of ["non-directory-parent", "unsafe-config", ...(process.platform === "win32" ? [] : ["writable-parent", "symlinked-parent"])]) {
    await test(`unsafe helper environment ${kind} is actionable offline and on connect without starting a process`, async () => {
      const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-unsafe-helper-environment-")));
      const userInfo = os.userInfo, homedir = os.homedir;
      const parent = path.join(home, ".proofpilot", "helpers");
      const issuePath = kind === "unsafe-config" ? path.join(home, ".config") : parent;
      try {
        fs.mkdirSync(path.dirname(parent), { mode: 0o700 });
        if (kind === "non-directory-parent" || kind === "unsafe-config") fs.writeFileSync(issuePath, "synthetic preserved obstruction\n", { mode: 0o600 });
        else if (kind === "writable-parent") { fs.mkdirSync(parent, { mode: 0o700 }); fs.chmodSync(parent, 0o775); }
        else {
          const target = path.join(home, "preserved-target");
          fs.mkdirSync(target, { mode: 0o700 });
          fs.symlinkSync(target, parent, "dir");
        }
        const before = fs.lstatSync(issuePath);
        os.homedir = () => home;
        os.userInfo = options => ({ ...userInfo(options), homedir: home });
        let forbidden = 0;
        const noOperation = () => { forbidden++; throw new Error(sentinel); };
        const options = { env: {}, spawn: noOperation, spawnSync: noOperation, statusRunner: noOperation };
        const status = getSetupStatus(options).colosseum;
        assert.equal(status.status, "unavailable");
        assert.equal(status.reason, "helper_environment_unavailable");
        assert.equal(status.next_action, "repair_helper_environment");
        assert.equal(status.credential_presence, "unknown");
        assert.equal(status.credential_required, false);
        assert.equal(status.credentials_inspected, false);
        assert.ok(status.diagnostic.includes(JSON.stringify(issuePath)), "The constructed diagnostic must identify the actual unsafe path");
        assert.match(status.diagnostic, /Preserve the path.*retry setup\.js --status/);
        assert.equal((await checkColosseum(options)).colosseum.next_action, "repair_helper_environment");
        let stderr = "", stdout = "";
        const exit = await runSetupCli(["--connect-colosseum"], { ...options,
          stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
        assert.equal(exit, 1);
        assert.equal(stdout, "");
        assert.match(stderr, /sign-in was not started/);
        assert.ok(stderr.includes(status.diagnostic), "Connect must preserve the safe offline diagnostic");
        const prepared = prepareColosseumHelper(options);
        assert.equal(prepared.error, "helper_environment_unavailable");
        assert.equal(prepared.diagnostic, status.diagnostic);
        const after = fs.lstatSync(issuePath);
        assert.equal(after.ino, before.ino);
        assert.equal(after.mode, before.mode);
        assert.equal(forbidden, 0, "Unsafe paths must be rejected before helper, npm, login or API execution");
        noLeak({ status, stderr, prepared });
      } finally { os.userInfo = userInfo; os.homedir = homedir; fs.rmSync(home, { recursive: true, force: true }); }
    });
  }
  await test("helper-only preparation invokes a version check and leaves login, accounts and installation preferences alone", async () => {
    let prepared = 0, spawned = 0, cleaned = 0, output = "";
    const noAccount = () => { throw new Error("Preparation must not inspect an account or start login"); };
    const exit = await runSetupCli(["--prepare-colosseum-helper", "--json"], {
      env: {}, helperRunner: noAccount, statusRunner: noAccount, loginRunner: noAccount,
      createHelperInvocation: (args, options) => {
        prepared++;
        assert.deepEqual(args, ["--version"]);
        assert.equal(options.online, true);
        return { command: process.execPath, args: ["synthetic-version-only"], env: {}, cwd: os.homedir(), shell: false,
          cleanup() { cleaned++; } };
      },
      spawnSync: (command, args, transport) => {
        spawned++;
        assert.deepEqual(args, ["synthetic-version-only"]);
        assert.equal(transport.shell, false);
        assert.deepEqual(transport.stdio, ["ignore", "pipe", "pipe"]);
        return { status: 0, stdout: "0.2.2\n", stderr: sentinel };
      },
      stdout: { write: value => { output += value; } }
    });
    assert.equal(exit, 0);
    assert.deepEqual([prepared, spawned, cleaned], [1, 1, 1]);
    const result = JSON.parse(output);
    assert.equal(result.helper_prepared, true);
    assert.equal(result.credentials_inspected, false);
    assert.equal(result.live_check_performed, false);
    assert.equal(result.next_command.at(-1), "--status");
    assert.equal(Object.hasOwn(result, "colosseum"), false, "Helper preparation must not claim connection readiness");
    noLeak(output);
  });
  await test("helper-only preparation does not expose failed version output", async () => {
    let stderr = "";
    const exit = await runSetupCli(["--prepare-colosseum-helper"], { env: {},
      createHelperInvocation: () => ({ command: process.execPath, args: [], env: {}, cwd: os.homedir(), shell: false, cleanup() {} }),
      spawnSync: () => ({ status: 0, stdout: sentinel, stderr: sentinel }),
      stderr: { write: value => { stderr += value; } } });
    assert.equal(exit, 1);
    assert.match(stderr, /No login or account inspection was attempted/);
    noLeak(stderr);
  });
  for (const args of [["--configure-colosseum"], ["--token", sentinel], ["--connect-colosseum", sentinel], ["--device"], ["--status", "--device"], ["--prepare-colosseum-helper", "--device"], ["--prepare-colosseum-helper", "--connect-colosseum"], ["--json", "--json"], ["--status", "--check-colosseum"]]) {
    await test("invalid CLI cannot open login or echo arguments", async () => {
      let output = "";
      const status = await runSetupCli(args, { stdout: { write: text => { output += text; } }, stderr: { write: text => { output += text; } }, loginRunner: () => { throw new Error("Must not login"); } });
      assert.equal(status, 1);
      noLeak(output);
    });
  }
  for (const device of [false, true]) {
    await test("explicit sign-in preserves choice and verifies access", async () => {
      let output = "";
      const status = await runSetupCli(["--connect-colosseum", ...(device ? ["--device"] : [])], { ...options, stdout: { write: text => { output += text; } }, loginRunner: passed => { assert.equal(passed.device, device); return { status: 0 }; } });
      assert.equal(status, 0);
      assert.equal(JSON.parse(output).colosseum.status, "verified");
    });
  }
  await test("browser success alone is not readiness", async () => {
    let output = "";
    const status = await runSetupCli(["--connect-colosseum"], { ...options, stdout: { write: text => { output += text; } }, loginRunner: () => ({ status: 0 }), statusRunner: () => reply(403, {}) });
    assert.equal(status, 1);
    assert.equal(JSON.parse(output).colosseum.status, "forbidden403");
  });
  return { cases };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(filename)) {
  console.log(`ProofPilot V2 setup passed: ${(await runSetupTests()).cases} offline cases.`);
}
