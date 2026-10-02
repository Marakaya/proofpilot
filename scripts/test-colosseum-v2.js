import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { getSetupStatus, checkColosseum } from "../skills/proofpilot/scripts/setup.js";
import { readColosseum } from "../skills/proofpilot/scripts/colosseum-read.js";
import { runColosseumRequest, parseColosseumResponse } from "../skills/proofpilot/scripts/colosseum-connection.js";

export async function runColosseumTransportPreflightTests({ caseName } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-curl-preflight-")));
  const originalRealpath = fs.realpathSync;
  const curlName = process.platform === "win32" ? "curl.exe" : "curl";
  const curl = path.join(home, curlName);
  const helperCommand = path.join(home, "synthetic-helper");
  const token = "SYNTHETIC_PREFLIGHT_BEARER_NEVER_DISPLAY";
  const request = { url: "https://copilot.colosseum.com/api/v2/status", method: "GET", body: null };
  const local = () => ({ status: 0, stdout: JSON.stringify({ state: "stored credentials present (not verified)",
    credentialState: "ready", scopes: ["evidence:read"] }) });
  let cases = 0;
  const test = async (name, run) => {
    if (caseName && caseName !== name) return;
    await run();
    cases++;
  };
  // Resolve only the transport candidates differently. PATH alone cannot hide
  // helperEnvironment's built-in system directories or their default curl.
  const withCurl = async (available, run) => {
    const attempted = [];
    const resolve = (native, file, ...args) => {
      if (typeof file === "string" && path.basename(file).toLowerCase() === curlName) {
        attempted.push(file);
        if (available) return curl;
        throw Object.assign(new Error("synthetic missing trusted curl"), { code: "ENOENT" });
      }
      return native(file, ...args);
    };
    fs.realpathSync = (file, ...args) => resolve(originalRealpath, file, ...args);
    fs.realpathSync.native = (file, ...args) => resolve(originalRealpath.native, file, ...args);
    try { return await run(attempted); } finally { fs.realpathSync = originalRealpath; }
  };
  const fixture = ({ helperExit = 0, helperMissing = false, helperUntrusted = false, env = {} } = {}) => {
    const state = { helper_created: 0, helper_spawned: 0, curl_spawned: 0, cleanup: 0 };
    const options = { env, createHelperInvocation(args) {
      state.helper_created++;
      assert.deepEqual(args, ["token"]);
      return { command: helperCommand, args: ["token"], cwd: home, env: {}, shell: false,
        ...(helperUntrusted ? { helperCacheIssue: { code: "helper_untrusted" } } : {}),
        cleanup() { state.cleanup++; } };
    }, spawn(command, args, transport) {
      const helper = command === helperCommand;
      if (helper) state.helper_spawned++;
      else {
        state.curl_spawned++;
        assert.equal(command, curl, "Only the preflight's trusted resolved executable may receive the bearer");
        assert.deepEqual(args, ["--disable", "--config", "-"]);
      }
      assert.equal(transport.shell, false);
      assert.equal(transport.cwd, home);
      assert.equal(JSON.stringify(args).includes(token), false);
      assert.equal(JSON.stringify(transport.env).includes(token), false);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      let input = "";
      child.stdin.on("data", chunk => { input += chunk; });
      child.stdin.on("finish", () => queueMicrotask(() => {
        if (!helper) {
          assert.ok(input.includes(`Authorization: Bearer ${token}`), "The synthetic bearer must travel only over stdin");
          child.stdout.end(JSON.stringify({ value: token }) + "\nPROOFPILOT_HTTP_STATUS:200");
        } else {
          if (helperMissing) child.stderr.write("ENOTCACHED: synthetic helper missing\n");
          child.stdout.end(helperExit ? "" : token + "\n");
        }
        child.stderr.end();
        child.emit("close", helper ? helperExit : 0);
      }));
      return child;
    } };
    return { options, state };
  };
  try {
    fs.writeFileSync(curl, "synthetic fixture, never executed\n", { mode: 0o700 });
    for (const name of ["missing", "untrusted-caller"]) {
      await test(name, async () => {
        const callerBin = path.join(home, name);
        fs.mkdirSync(callerBin, { mode: 0o777 });
        fs.chmodSync(callerBin, 0o777);
        const callerCurl = path.join(callerBin, curlName);
        fs.writeFileSync(callerCurl, "synthetic caller curl, never executed\n", { mode: 0o700 });
        const { options, state } = fixture({ env: name === "untrusted-caller" ? { PATH: callerBin } : {} });
        await withCurl(false, async attempted => {
          const result = await runColosseumRequest(request, options);
          assert.deepEqual({ code: result.transport_error, ...state },
            { code: "transport_missing", helper_created: 0, helper_spawned: 0, curl_spawned: 0, cleanup: 0 },
            "Unavailable trusted curl must be diagnosed before constructing or invoking a token helper");
          assert.deepEqual(parseColosseumResponse(result), { error: "transport_missing", http_status: null });
          if (process.platform !== "win32") assert.ok(attempted.length > 0, "Fixture must hide actual default-system curl candidates");
          assert.equal(attempted.includes(callerCurl), false, "Untrusted caller PATH must not supply a bearer transport");
          assert.equal(JSON.stringify(result).includes(token), false);
        });
      });
    }
    await test("invalid-request-first", async () => {
      const { options, state } = fixture();
      await withCurl(false, async attempted => {
        const result = await runColosseumRequest({ ...request, url: "https://attacker.invalid/api/v2/status" }, options);
        assert.equal(result.transport_error, "invalid_arguments");
        assert.equal(attempted.length, 0, "Invalid request must stop before even transport preflight");
        assert.deepEqual(state, { helper_created: 0, helper_spawned: 0, curl_spawned: 0, cleanup: 0 });
      });
    });
    await test("setup-diagnostic", async () => {
      const { options, state } = fixture();
      const status = await withCurl(false, () => checkColosseum({ ...options, helperRunner: local }));
      assert.equal(status.colosseum.status, "transport_missing");
      assert.match(status.colosseum.reason, /curl/i);
      assert.equal(status.colosseum.next_action, "prepare_curl");
      assert.equal(status.colosseum.configured, true, "Missing curl does not establish missing saved credentials");
      assert.equal(status.colosseum.credential_required, false);
      assert.equal(status.colosseum.live_check_performed, false);
      assert.deepEqual(state, { helper_created: 0, helper_spawned: 0, curl_spawned: 0, cleanup: 0 });
    });
    await test("read-diagnostic", async () => {
      const { options, state } = fixture();
      const result = await withCurl(false, () => readColosseum(["filters"], { ...options, helperRunner: local }));
      assert.equal(result.ok, false);
      assert.equal(result.operation_verified, false);
      assert.equal(result.error.code, "transport_missing");
      assert.match(result.error.message, /curl/i);
      assert.equal(result.phase, "authentication");
      assert.equal(result.http_status, null);
      assert.deepEqual(state, { helper_created: 0, helper_spawned: 0, curl_spawned: 0, cleanup: 0 });
    });
    await test("trusted-normal", async () => {
      const { options, state } = fixture();
      const result = await withCurl(true, () => runColosseumRequest(request, options));
      assert.deepEqual(parseColosseumResponse(result), { data: { value: "[redacted]" }, http_status: 200 });
      assert.deepEqual(state, { helper_created: 1, helper_spawned: 1, curl_spawned: 1, cleanup: 1 });
      assert.equal(JSON.stringify(result).includes(token), false);
    });
    for (const [name, helperExit, helperMissing, expected] of [
      ["expired-helper-cleanup", 2, false, "expired"], ["missing-helper-cleanup", 1, true, "helper_missing"]
    ]) {
      await test(name, async () => {
        const { options, state } = fixture({ helperExit, helperMissing });
        const result = await withCurl(true, () => runColosseumRequest(request, options));
        assert.equal(result.helper_error, expected);
        assert.deepEqual(state, { helper_created: 1, helper_spawned: 1, curl_spawned: 0, cleanup: 1 });
      });
    }
    await test("untrusted-helper-cleanup", async () => {
      const { options, state } = fixture({ helperUntrusted: true });
      const result = await withCurl(true, () => runColosseumRequest(request, options));
      assert.equal(result.helper_error, "helper_untrusted");
      assert.deepEqual(state, { helper_created: 1, helper_spawned: 0, curl_spawned: 0, cleanup: 1 });
    });
    if (caseName && !cases) throw new Error(`Unknown transport preflight test case: ${caseName}`);
    return { cases };
  } finally {
    fs.realpathSync = originalRealpath;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

export async function runColosseumV2MigrationTests() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-colosseum-v2-"));
  try {
    const legacy = path.join(home, ".config", "proofpilot", "credentials.json");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    const contents = JSON.stringify({ colosseum_copilot_pat: "synthetic-v1-pat-do-not-read" });
    fs.writeFileSync(legacy, contents);
    let calls = 0;
    const result = getSetupStatus({ home, env: {}, helperRunner: args => {
      calls++;
      assert.deepEqual(args, ["status", "--local"]);
      return { status: 0, stdout: JSON.stringify({ state: "stored credentials present (not verified)", credentialState: "ready", scopes: ["evidence:read"] }) };
    } });
    assert.equal(result.colosseum.auth_method, "oauth_pkce", "ProofPilot still uses the PAT connector instead of V2 sign-in");
    assert.equal(result.colosseum.status, "configured_unverified");
    assert.equal(result.colosseum.credential_source, "copilot_connect");
    assert.equal(calls, 1);
    assert.equal(fs.readFileSync(legacy, "utf8"), contents, "Migration must preserve existing V1 credentials");
    assert.ok(!JSON.stringify(result).includes("synthetic-v1-pat-do-not-read"));
    let cases = 1;
    const token = 'synthetic-v2-quote"-backslash\\-do-not-show';
    const fixture = path.join(home, "process-fixture.cjs");
    fs.writeFileSync(fixture, `
const assert = require("node:assert/strict");
const token = ${JSON.stringify(token)};
const mode = process.argv[2];
if (mode === "expired" || mode === "pending") { process.stderr.write(token); process.exit(mode === "expired" ? 2 : 6); }
else if (mode === "bad-token") process.stdout.write("bad\\nheader-injection");
else if (mode === "oversized-token") process.stdout.write("x".repeat(9000));
else if (mode === "token") process.stdout.write(token + "\\n");
else {
  let input = "";
  process.stdin.on("data", chunk => { input += chunk; });
  process.stdin.on("end", () => {
    const headers = input.split("\\n").filter(line => line.startsWith("header = ")).map(line => JSON.parse(line.slice(9)));
    assert.ok(headers.includes("Authorization: Bearer " + token));
    assert.ok(input.includes("https://copilot.colosseum.com/api/v2/search/projects"));
    assert.ok(!input.includes("/api/v1"));
    assert.ok(!/^(location|retry|insecure|user-agent)\\s*=/m.test(input));
    const body = JSON.parse(input.split("\\n").find(line => line.startsWith("data-binary = ")).slice(14));
    assert.equal(JSON.parse(body).query, 'safe "quoted" query $(no-shell)');
    const encoded = JSON.stringify({ results: [{ name: token, label: "Қазақша", nested: { [token]: token }, array: [token, { echo: token }] }] })
      .replaceAll(JSON.stringify(token).slice(1, -1), [...token].map(char => "\\\\u" + char.charCodeAt(0).toString(16).padStart(4, "0")).join(""));
    const bytes = Buffer.from(encoded + "\\nPROOFPILOT_HTTP_STATUS:200");
    const boundary = bytes.indexOf(Buffer.from("Қ")) + 1;
    process.stdout.write(bytes.subarray(0, boundary));
    setTimeout(() => { process.stdout.write(bytes.subarray(boundary)); }, 1);
    process.stderr.write(token);
  });
}
`);
    const helperCache = path.join(home, "helper-cache");
    const helperEntrypoint = path.join(home, "transport-helper.cjs");
    fs.writeFileSync(helperEntrypoint, "process.exitCode = 99;\n");
    const canonicalHelperEntrypoint = fs.realpathSync(helperEntrypoint);
    const helperCwd = path.join(home, "helper-invocation");
    fs.mkdirSync(helperCwd);
    const helperUserConfig = path.join(helperCwd, "user.npmrc");
    const helperGlobalConfig = path.join(helperCwd, "global.npmrc");
    fs.writeFileSync(helperUserConfig, ""); fs.writeFileSync(helperGlobalConfig, "");
    const helperInvocation = args => ({ command: process.execPath, args: [canonicalHelperEntrypoint, ...args], cwd: helperCwd,
      env: { npm_config_userconfig: helperUserConfig, npm_config_globalconfig: helperGlobalConfig }, shell: false, cleanup() {} });
    const request = { url: "https://copilot.colosseum.com/api/v2/search/projects", method: "POST", body: { query: 'safe "quoted" query $(no-shell)', limit: 2 } };
    const makeSpawn = (mode, calls) => (command, args, transport) => {
      calls.push(command);
      assert.equal(transport.env.COLOSSEUM_COPILOT_PAT, undefined);
      assert.equal(transport.env.COLOSSEUM_COPILOT_API_BASE, undefined);
      assert.ok(!JSON.stringify(args).includes(token));
      if (path.basename(command).toLowerCase() === (process.platform === "win32" ? "curl.exe" : "curl")) {
        assert.ok(path.isAbsolute(command), "The bearer transport must use an absolute executable path");
        assert.deepEqual(args, ["--disable", "--config", "-"]);
        assert.equal(transport.env.npm_config_userconfig, undefined);
        assert.equal(transport.cwd, helperCwd, "The bearer transport must not inherit the caller's working directory");
        assert.equal(transport.shell, false);
      } else {
        assert.equal(command, process.execPath);
        assert.ok(path.isAbsolute(command));
        assert.deepEqual(args, [canonicalHelperEntrypoint, "token"]);
        assert.equal(transport.shell, false);
        for (const name of ["npm_config_userconfig", "npm_config_globalconfig"]) {
          assert.equal(path.dirname(transport.env[name]), transport.cwd);
          assert.equal(fs.readFileSync(transport.env[name], "utf8"), "");
        }
      }
      const transportMode = path.basename(command).toLowerCase().startsWith("curl") ? "curl" : mode;
      return spawn(process.execPath, [fixture, transportMode], { ...transport, shell: false });
    };
    const transportEnv = { COLOSSEUM_COPILOT_PAT: "synthetic-v1-ignore", COLOSSEUM_COPILOT_API_BASE: "https://attacker.invalid" };
    const spawnedCommands = [];
    const response = await runColosseumRequest(request, { env: transportEnv, helperCache, createHelperInvocation: helperInvocation, spawn: makeSpawn("token", spawnedCommands) });
    assert.equal(spawnedCommands.length, 2);
    assert.ok(!JSON.stringify(response).includes(token));
    assert.ok(!JSON.stringify(response).includes(JSON.stringify(token).slice(1, -1)));
    const parsed = parseColosseumResponse(response);
    assert.equal(parsed.data.results[0].name, "[redacted]");
    assert.equal(parsed.data.results[0].label, "Қазақша", "UTF-8 must survive subprocess chunk boundaries");
    assert.deepEqual(parsed.data.results[0].nested, { "[redacted]": "[redacted]" });
    assert.deepEqual(parsed.data.results[0].array, ["[redacted]", { echo: "[redacted]" }]);
    assert.ok(!JSON.stringify(parsed).includes(token), "Decoding JSON must not recover an escaped private bearer");
    cases++;
    for (const [mode, code] of [["expired", "expired"], ["pending", "refresh_pending"], ["bad-token", "invalid_response"], ["oversized-token", "unavailable"]]) {
      const attempted = [];
      const result = await runColosseumRequest(request, { env: transportEnv, helperCache, createHelperInvocation: helperInvocation, spawn: makeSpawn(mode, attempted) });
      assert.equal(result.helper_error, code);
      assert.equal(attempted.length, 1, "Helper failure must stop before any curl request");
      assert.ok(!JSON.stringify(result).includes(token));
      cases++;
    }
    for (const url of [
      "https://attacker.invalid/api/v2/search/projects",
      "https://copilot.colosseum.com/api/v1/search/projects",
      "https://copilot.colosseum.com/api/v2/session-shares",
      "https://copilot.colosseum.com/api/v2/search/projects\nheader = \"X-Evil: yes\"",
      "https://copilot.colosseum.com/api/v2/search/projects\rheader = \"X-Evil: yes\"",
      "https://copilot.colosseum.com/api/v2/search/projects\t"
    ]) {
      const result = await runColosseumRequest({ ...request, url }, { spawn: () => { throw new Error("Invalid request must not spawn"); } });
      assert.equal(result.transport_error, "invalid_arguments");
      cases++;
    }
    const emptyCache = path.join(home, "empty-cache");
    fs.mkdirSync(emptyCache);
    const missing = getSetupStatus({ env: { PATH: process.env.PATH }, helperCache: emptyCache });
    assert.equal(missing.colosseum.status, "helper_missing");
    assert.equal(missing.colosseum.next_action, "connect_colosseum");
    cases++;
    const missingCachedHelper = await runColosseumRequest(request, { env: { PATH: process.env.PATH }, helperCache: emptyCache });
    assert.equal(missingCachedHelper.helper_error, "helper_missing", "The async transport must retain its isolated npm config and explicit empty cache");
    cases++;
    const emptyBin = path.join(home, "empty-bin");
    fs.mkdirSync(emptyBin);
    assert.equal(getSetupStatus({ env: { PATH: emptyBin }, helperCache: emptyCache }).colosseum.status, "helper_missing");
    const missingExecutable = await runColosseumRequest(request, { env: { PATH: emptyBin }, helperCache: emptyCache });
    assert.equal(missingExecutable.helper_error, "helper_missing");
    cases++;
    if (process.platform !== "win32") {
      const timeoutCache = path.join(home, "timeout-helper-cache");
      fs.mkdirSync(timeoutCache);
      const lateMarker = path.join(home, "descendant-ran-after-timeout");
      const startedMarker = path.join(home, "cached-helper-launched");
      const script = path.join(home, "hold.cjs");
      fs.writeFileSync(script, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(startedMarker)}, "started"); require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(`setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(lateMarker)}, "late"), 3000)`)}], { stdio: "inherit" }); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
      const started = Date.now();
      const timed = await runColosseumRequest(request, {
        env: { PATH: process.env.PATH }, helperCache: timeoutCache, timeoutMs: 1500,
        createHelperInvocation: args => ({ command: process.execPath, args: [script, ...args], cwd: helperCwd,
          env: { npm_config_userconfig: helperUserConfig, npm_config_globalconfig: helperGlobalConfig }, shell: false, cleanup() {} })
      });
      assert.equal(timed.helper_error, "unavailable");
      assert.ok(fs.existsSync(startedMarker), "The pinned cached helper must launch before the deadline");
      assert.ok(Date.now() - started < 2300, "Deadline must complete without waiting for inherited pipes");
      await new Promise(resolve => setTimeout(resolve, 3300));
      assert.ok(!fs.existsSync(lateMarker), "The helper's descendants must stop before their delayed action");
      cases++;
    }
    return { cases: cases + (await runColosseumTransportPreflightTests()).cases };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  console.log(`Colosseum V2 migration passed: ${(await runColosseumV2MigrationTests()).cases} cases.`);
}
