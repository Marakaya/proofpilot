import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { getSetupStatus, checkColosseum, runSetupCli } from "../skills/proofpilot/scripts/setup.js";
import { runConnectionHelper, loginColosseum, COLOSSEUM_HELPER_PACKAGE } from "../skills/proofpilot/scripts/colosseum-connection.js";

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
    assert.equal(status.colosseum.next_action, "connect_colosseum");
    assert.equal(status.colosseum.configured, false);
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
        assert.equal(status.colosseum.credentials_inspected, false);
        assert.equal(status.colosseum.credential_required, false, "Only helper trust failed; credentials are not reported absent");
        assert.equal(status.colosseum.live_check_performed, false);
        assert.match(status.colosseum.reason, /not inspected or changed/);

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
      assert.equal(absent.colosseum.next_action, "connect_colosseum");
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
  await test("legacy files are neither read nor rewritten", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-old-credentials-"));
    try {
      const files = [".config/proofpilot/credentials.json", ".config/proofpilot/setup-state.json", ".superstack/config.json"];
      for (const file of files) { const target = path.join(home, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, sentinel); }
      getSetupStatus({ home, env: {}, helperRunner: () => local(), fs: { openSync: () => { throw new Error("Legacy files must not be opened"); } } });
      for (const file of files) assert.equal(fs.readFileSync(path.join(home, file), "utf8"), sentinel);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  for (const args of [["--configure-colosseum"], ["--token", sentinel], ["--connect-colosseum", sentinel], ["--device"], ["--status", "--device"], ["--json", "--json"], ["--status", "--check-colosseum"]]) {
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
