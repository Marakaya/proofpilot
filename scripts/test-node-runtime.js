import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nodeRuntimeDiagnostic } from "../skills/proofpilot/scripts/node-runtime.js";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oldRuntimePreload = "data:text/javascript," + encodeURIComponent(
  "Object.defineProperty(process.versions, 'node', { value: '18.20.7', configurable: true });"
);

// All version overrides and side-effect traps stay in a child. Production
// modules are imported after the preload, exercising their actual import graph.
async function oldRuntimeFixtures(repository, fixture) {
  const assert = (await import("node:assert/strict")).default;
  const fs = (await import("node:fs")).default;
  const os = (await import("node:os")).default;
  const path = (await import("node:path")).default;
  const childProcess = (await import("node:child_process")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const scripts = path.join(repository, "skills", "proofpilot", "scripts");
  const { installPackage } = await import(pathToFileURL(path.join(repository, "scripts", "install-package.js")));
  const { installDependencies, markCoreOnly, runDependencyCli } = await import(pathToFileURL(path.join(scripts, "install-dependencies.js")));
  const { createHelperInvocation } = await import(pathToFileURL(path.join(scripts, "connection-helper.js")));
  const { getSetupStatus, checkColosseum, runSetupCli } = await import(pathToFileURL(path.join(scripts, "setup.js")));
  assert.equal(process.versions.node, "18.20.7");

  let cases = 0;
  const test = async (name, run) => {
    try { await run(); cases++; }
    catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  };
  const calls = [];
  const blocked = operation => () => { calls.push(operation); throw new Error(`Unexpected ${operation} on Node 18`); };
  for (const name of ["mkdirSync", "mkdtempSync", "writeFileSync", "appendFileSync", "copyFileSync", "cpSync", "renameSync", "linkSync", "symlinkSync", "unlinkSync", "rmSync", "chmodSync"]) {
    fs[name] = blocked(`filesystem ${name}`);
  }
  os.userInfo = blocked("account home lookup");
  os.homedir = blocked("home lookup");
  childProcess.spawnSync = blocked("helper subprocess");
  childProcess.spawn = blocked("helper subprocess");
  globalThis.fetch = blocked("network request");
  syncBuiltinESMExports();
  const pendingFile = path.join(fixture, "pending", ".proofpilot-transaction.json");
  const readFile = fs.readFileSync;
  fs.readFileSync = (file, ...args) => {
    if (String(file) === pendingFile) return blocked("pending transaction read")();
    return readFile(file, ...args);
  };
  const oldRuntimeError = error => error.code === "ENODERUNTIME" && /Node\.js 20 or later/.test(error.message) && /18\.20\.7/.test(error.message);
  const missingRoot = path.join(fixture, "missing", "skills");
  const installOptions = { helperVersion: blocked("helper version check"), sourceProvider: blocked("source download") };
  const capture = () => {
    let output = "", errors = "";
    return { stdout: { write: text => { output += text; } }, stderr: { write: text => { errors += text; } },
      output: () => output, errors: () => errors };
  };
  const assertUnknown = result => {
    assert.equal(result.setup_required, true);
    assert.equal(result.colosseum.status, "unavailable");
    assert.equal(result.colosseum.reason, "node_runtime_unsupported");
    assert.equal(result.colosseum.next_action, "select_node_runtime");
    assert.equal(result.colosseum.credential_presence, "unknown");
    assert.equal(result.colosseum.credentials_inspected, false);
    assert.equal(result.colosseum.configured, false);
    assert.equal(result.colosseum.live_check_performed, false);
    assert.equal(result.colosseum.verification_basis, "none");
    assert.match(result.colosseum.diagnostic, /18\.20\.7/);
  };

  await test("core installation stops before staging or destination inspection", () => {
    for (const coreOnly of [false, true]) {
      assert.throws(() => installPackage({ destination: path.join(missingRoot, "proofpilot"), coreOnly }, installOptions), oldRuntimeError);
    }
    assert.equal(fs.existsSync(path.dirname(missingRoot)), false);
  });
  await test("support installation stops before acquiring its lock or fetching sources", () => {
    assert.throws(() => installDependencies(missingRoot, installOptions), oldRuntimeError);
    assert.equal(fs.existsSync(path.dirname(missingRoot)), false);
  });
  await test("core-only bookkeeping stops before creating state or its lock", () => {
    assert.throws(() => markCoreOnly(missingRoot), oldRuntimeError);
    assert.equal(fs.existsSync(path.dirname(missingRoot)), false);
  });
  await test("portable CLI stops before pending recovery and helper-backed inventory", () => {
    for (const action of [[], ["--update"], ["--offline"], ["--status"]]) {
      const stream = capture();
      assert.equal(runDependencyCli(["--root", path.dirname(pendingFile), ...action], { ...installOptions, ...stream }), 1);
      assert.equal(stream.output(), "");
      assert.match(stream.errors(), /Node\.js 20 or later/);
      assert.match(stream.errors(), /18\.20\.7/);
    }
  });
  await test("helper invocation stops before looking up the private home or preparing npm", () => {
    for (const online of [false, true]) assert.throws(() => createHelperInvocation(["--version"], { online }), oldRuntimeError);
  });
  const setupOptions = { helperRunner: blocked("credential helper"), prepareRunner: blocked("helper preparation"),
    loginRunner: blocked("sign-in"), statusRunner: blocked("live status request"), runner: blocked("live request") };
  await test("setup status preserves unknown account state without inspecting credentials", () => {
    assertUnknown(getSetupStatus(setupOptions));
  });
  await test("programmatic live check stops on unsupported local runtime", async () => {
    assertUnknown(await checkColosseum(setupOptions));
  });
  await test("offline status CLI emits a useful JSON diagnostic without authentication claims", async () => {
    for (const args of [[], ["--status", "--json"]]) {
      const stream = capture();
      assert.equal(await runSetupCli(args, { ...setupOptions, ...stream }), 0);
      assert.equal(stream.errors(), "");
      assertUnknown(JSON.parse(stream.output()));
    }
  });
  for (const args of [["--prepare-colosseum-helper"], ["--connect-colosseum"], ["--connect-colosseum", "--device"], ["--check-colosseum"]]) {
    await test(`setup ${args.join(" ")} stops before its callback`, async () => {
      const stream = capture();
      assert.equal(await runSetupCli(args, { ...setupOptions, ...stream }), 1);
      assert.equal(stream.output(), "");
      assert.match(stream.errors(), /Node\.js 20 or later/);
      assert.match(stream.errors(), /18\.20\.7/);
    });
  }
  await test("portable dependency and setup help remain available without helper access", async () => {
    const dependencies = capture(), setup = capture();
    assert.equal(runDependencyCli(["--help"], dependencies), 0);
    assert.equal(await runSetupCli(["--help"], { ...setupOptions, ...setup }), 0);
    assert.match(dependencies.output(), /Usage:/);
    assert.match(setup.output(), /Usage:/);
  });
  assert.deepEqual(calls, [], "Unsupported runtime must not touch files, accounts, subprocesses or network");
  return { cases };
}

export function runNodeRuntimeTests() {
  let cases = 0;
  for (const version of ["20.0.0", "20.20.2", "22.0.0", process.versions.node]) {
    assert.equal(nodeRuntimeDiagnostic({ version, platform: "darwin", arch: "x64" }), null);
  }
  cases++;
  const diagnostic = nodeRuntimeDiagnostic({ version: "18.20.7", platform: "darwin", arch: "x64" });
  assert.match(diagnostic, /Node\.js 20 or later/);
  assert.match(diagnostic, /18\.20\.7/);
  assert.match(diagnostic, /Catalina 10\.15/);
  assert.match(diagnostic, /darwin-x64/);
  assert.match(diagnostic, /absolute path/);
  assert.match(diagnostic, /already running agent/);
  for (const version of ["18.20.7", "19.9.0", "invalid"]) {
    assert.ok(nodeRuntimeDiagnostic({ version, platform: "linux", arch: "x64" }));
  }
  cases++;

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-node-runtime-"));
  const fixture = fs.realpathSync(temporary);
  const home = path.join(fixture, "home");
  fs.mkdirSync(home, { mode: 0o700 });
  const pendingFile = path.join(fixture, "pending", ".proofpilot-transaction.json");
  fs.mkdirSync(path.dirname(pendingFile));
  const pendingBytes = "Preserve this pending recovery sentinel unchanged.\n";
  fs.writeFileSync(pendingFile, pendingBytes);
  const env = { ...process.env, HOME: home, USERPROFILE: home, PROOFPILOT_TEST_HOME: home,
    CODEX_HOME: path.join(home, ".codex"), CLAUDE_HOME: path.join(home, ".claude"), CLAUDE_CONFIG_DIR: path.join(home, ".claude") };
  const runChild = args => {
    const result = spawnSync(process.execPath, ["--import", oldRuntimePreload, ...args], {
      cwd: repository, env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024
    });
    assert.ifError(result.error);
    return result;
  };
  try {
    const fixtureSource = `const result = await (${oldRuntimeFixtures.toString()})(${JSON.stringify(repository)}, ${JSON.stringify(fixture)}); console.log(JSON.stringify(result));`;
    const fixtures = runChild(["--input-type=module", "--eval", fixtureSource]);
    assert.equal(fixtures.status, 0, fixtures.stderr || fixtures.stdout);
    cases += JSON.parse(fixtures.stdout).cases;
    assert.equal(fs.readFileSync(pendingFile, "utf8"), pendingBytes);
    assert.equal(fs.existsSync(path.join(fixture, "missing")), false);
    assert.deepEqual(fs.readdirSync(home), []);

    const cli = path.join(repository, "scripts", "cli.js");
    for (const args of [["--help"], ["inspect", "--json"]]) {
      const result = runChild([cli, ...args]);
      assert.equal(result.status, 0, result.stderr);
      if (args[0] === "inspect") assert.equal(JSON.parse(result.stdout).version, "0.3.0");
      else assert.match(result.stdout, /Usage:/);
      cases++;
    }
    const destination = path.join(fixture, "cli-missing", "skills", "proofpilot");
    for (const args of [[cli, "install", "--target", "codex", "--dir", destination],
      [path.join(repository, "scripts", "install-skills.js"), "--target", path.dirname(destination)],
      [path.join(repository, "skills", "proofpilot", "scripts", "install-dependencies.js"), "--root", path.dirname(pendingFile)]]) {
      const result = runChild(args);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /Node\.js 20 or later/);
      assert.match(result.stderr, /18\.20\.7/);
      assert.equal(result.stdout, "");
      cases++;
    }
    assert.equal(fs.existsSync(path.join(fixture, "cli-missing")), false);
    assert.equal(fs.readFileSync(pendingFile, "utf8"), pendingBytes);
    return { cases };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  console.log(`Node runtime tests passed: ${runNodeRuntimeTests().cases} cases.`);
}
