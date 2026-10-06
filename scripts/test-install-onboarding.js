import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printInstallNotice } from "./install-package.js";

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), "..");
const cli = path.join(root, "scripts", "cli.js");
const installer = path.join(root, "scripts", "install-skills.js");
const skillNames = [
  "proofpilot",
  "proofpilot-idea-discovery",
  "proofpilot-venture-validation",
  "proofpilot-mvp-planner",
  "proofpilot-readiness-review",
  "proofpilot-submission-builder"
];

export function runInstallOnboardingTests() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-install-onboarding-"));
  let cases = 0;
  try {
    const isolatedHome = path.join(temporaryRoot, "home");
    const configDir = path.join(temporaryRoot, "config");
    const binDir = path.join(temporaryRoot, "bin");
    const curlMarker = path.join(temporaryRoot, "network-attempt");
    const wrongNodeMarker = path.join(temporaryRoot, "wrong-node-attempt");
    fs.mkdirSync(isolatedHome);
    fs.mkdirSync(binDir);
    const preload = path.join(temporaryRoot, "isolate.cjs");
    // Scope child processes to synthetic local state and reject accidental network use.
    fs.writeFileSync(preload, [
      `require("node:os").homedir = () => ${JSON.stringify(isolatedHome)};`,
      `const realUserInfo = require("node:os").userInfo; require("node:os").userInfo = () => ({ ...realUserInfo(), homedir: ${JSON.stringify(isolatedHome)} });`,
      'const denied = () => { throw new Error("Unexpected network access in offline installation test"); };',
      'globalThis.fetch = denied;',
      'require("node:http").request = require("node:http").get = denied;',
      'require("node:https").request = require("node:https").get = denied;',
      'require("node:net").Socket.prototype.connect = denied;'
    ].join("\n"));
    fs.writeFileSync(path.join(binDir, "curl"), `#!/bin/sh\n: > '${curlMarker.replaceAll("'", "'\\''")}'\nexit 95\n`, { mode: 0o700 });
    fs.writeFileSync(path.join(binDir, "node"), `#!/bin/sh\n: > '${wrongNodeMarker.replaceAll("'", "'\\''")}'\nexit 96\n`, { mode: 0o700 });
    const env = {
      PATH: binDir,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
      PROOFPILOT_CONFIG_DIR: configDir
    };
    const run = (script, args = [], expectedStatus = 0) => {
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: temporaryRoot,
        env,
        encoding: "utf8",
        timeout: 15000
      });
      assert.ifError(result.error);
      assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
      return result;
    };
    const assertPending = result => {
      const status = JSON.parse(result.stdout);
      assert.equal(status.colosseum.required, true, "Colosseum must be a setup requirement");
      assert.equal(status.colosseum.configured, false, "An empty installation must not claim a configured connection");
      assert.equal(status.setup_required, true, "An empty installation must still require setup");
      assert.notEqual(status.colosseum.status, "verified", "Installation alone must not verify account access");
      return status;
    };
    const assertNotice = (result, destination) => {
      assert.ok(result.stdout.includes("ask your agent to use ProofPilot to complete initial setup"), "Installer must provide an actionable first agent prompt");
      assert.ok(result.stdout.includes("https://colosseum.com/arena/copilot/connections"), "Installer must link to connection management");
      assert.ok(result.stdout.includes(path.join(destination, "scripts", "setup.js")), "Installer must identify the installed portable helper");
      assert.ok(result.stdout.includes("optional"), "Installer must distinguish optional service setup");
    };
    const captureNotice = result => {
      const lines = [];
      const originalLog = console.log;
      try {
        console.log = (...values) => lines.push(values.join(" "));
        printInstallNotice(result);
        return { stdout: lines.join("\n") };
      } finally {
        console.log = originalLog;
      }
    };
    const noticeDestination = path.join(temporaryRoot, "notice only skill");
    const noticeResult = { destination: noticeDestination, profiles: 5, backups: [] };
    const fullNotice = captureNotice({ ...noticeResult, dependencies: {
      skills: ["colosseum-copilot", ...Array.from({ length: 35 }, (_, index) => `support-${index}`)],
      installed: [], updated: [], reused: [], backups: []
    } });
    assertNotice(fullNotice, noticeDestination);
    assert.match(fullNotice.stdout, /Colosseum Copilot.*included.*already installed/, "A full install must identify its installed research skill");
    assert.match(fullNotice.stdout, /authorize the skill.*official browser\/device helper/, "Account authorization must use the official helper");
    assert.match(fullNotice.stdout, /report connected only after current V2 evidence access is verified/, "An account login alone must not be reported as connected");
    assert.match(fullNotice.stdout, /After current V2 evidence access is verified.*describe.*capabilities.*36 support skills.*resume your original task/, "Full onboarding must describe installed capabilities and resume the task after verified access");
    const coreNotice = captureNotice({ ...noticeResult, dependencies: null });
    assertNotice(coreNotice, noticeDestination);
    assert.doesNotMatch(coreNotice.stdout, /Colosseum Copilot.*included.*already installed/, "Core-only must not claim that the research skill was installed");
    assert.match(coreNotice.stdout, /honor core-only mode.*describe.*available ProofPilot capabilities.*limited research setup.*resume your original task/, "Core-only onboarding must respect its scope and resume the task");
    cases += 2;

    const destination = path.join(temporaryRoot, "standalone skill");
    const install = run(cli, ["install", "--target", "codex", "--dir", destination, "--core-only"]);
    assertNotice(install, destination);
    if (process.platform !== "win32") {
      const command = install.stdout.split("\n").find(line => line.startsWith("Offline setup status: "))?.slice("Offline setup status: ".length);
      assert.ok(command);
      const noticeRun = spawnSync("/bin/sh", ["-c", command], { cwd: temporaryRoot, env, encoding: "utf8", timeout: 15000 });
      assert.ifError(noticeRun.error);
      assert.equal(noticeRun.status, 0, noticeRun.stderr || noticeRun.stdout);
      assertPending(noticeRun);
      assert.equal(fs.existsSync(wrongNodeMarker), false, "Printed setup command must retain the installing Node executable instead of selecting node from PATH");
      cases++;
    }
    assertPending(run(path.join(destination, "scripts", "setup.js"), ["--status", "--json"]));
    run(cli, ["install", "--target", "codex", "--dir", destination, "--core-only"]);
    cases += 1;

    for (const copy of [false, true]) {
      const target = path.join(temporaryRoot, copy ? "copied profiles" : "linked profiles");
      const installed = run(installer, ["--target", target, "--core-only", ...(copy ? ["--copy"] : [])]);
      assertNotice(installed, path.join(target, "proofpilot"));
      for (const skillName of skillNames) {
        assertPending(run(path.join(target, skillName, "scripts", "setup.js"), ["--status", "--json"]));
      }
      run(installer, ["--target", target, "--core-only", ...(copy ? ["--copy"] : [])]);
      cases += 1;
    }

    const portableStatus = assertPending(run(path.join(root, "skills", "proofpilot", "scripts", "setup.js"), ["--status", "--json"]));
    const cliStatus = assertPending(run(cli, ["setup", "--status", "--json"]));
    const defaultStatus = assertPending(run(cli, ["setup"]));
    assert.deepEqual(cliStatus.colosseum, portableStatus.colosseum, "CLI must forward status to the portable helper");
    assert.deepEqual(defaultStatus.colosseum, portableStatus.colosseum, "Default setup must remain offline");
    run(cli, ["setup", "--unknown-option"], 1);
    cases += 1;

    assert.equal(fs.existsSync(curlMarker), false, "Installation or offline status attempted a network call");
    assert.equal(fs.existsSync(path.join(configDir, "credentials.json")), false, "Installation or status must not create credentials");
    return { cases, installedEntrypoints: 13 };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(filename)) {
  const summary = runInstallOnboardingTests();
  console.log(`Installation onboarding passed: ${summary.cases} cases, ${summary.installedEntrypoints} installed entrypoints, no account network calls.`);
}
