import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONNECTION_HELPER_TREE_SHA256,
  createHelperInvocation
} from "../skills/proofpilot/scripts/connection-helper.js";
import { exportProjectSessions } from "../skills/proofpilot/scripts/export-project-sessions.js";

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), "..");
const exportScript = path.join(root, "skills", "proofpilot", "scripts", "export-project-sessions.js");

function write(file, contents, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, contents, { mode });
}

function snapshot(directory) {
  const entries = [];
  function visit(current, relative = "") {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const name = path.join(relative, entry.name);
      const file = path.join(current, entry.name);
      const stat = fs.lstatSync(file, { bigint: true });
      const metadata = `${stat.mode}:${stat.size}:${stat.mtimeNs}`;
      if (entry.isDirectory()) { entries.push(`d:${name}:${metadata}`); visit(file, name); }
      else if (entry.isFile()) entries.push(`f:${name}:${metadata}:${fs.readFileSync(file).toString("hex")}`);
      else entries.push(`o:${name}`);
    }
  }
  visit(directory);
  return entries;
}

function runInvocation(invocation) {
  try {
    return spawnSync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      encoding: "utf8",
      shell: invocation.shell,
      timeout: 15000
    });
  } finally { invocation.cleanup(); }
}

// Execute only in an isolated child. Native Windows binaries/ACLs need separate
// Windows coverage; this exercises the Windows trust and real transport branch
// while retaining this host's subprocess execution and filesystem semantics.
async function windowsBranchFixtures(fixture, helperUrl, connectionUrl) {
  const assert = (await import("node:assert/strict")).default;
  const fs = (await import("node:fs")).default;
  const os = (await import("node:os")).default;
  const path = (await import("node:path")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const node = process.execPath;
  const home = path.join(fixture, "home");
  const attacker = path.join(fixture, "caller-systemroot");
  const runtime = path.join(fixture, "caller-runtime");
  const root = path.join(fixture, "Windows");
  const system = path.join(root, "System32");
  const received = path.join(fixture, "caller-received");
  const runtimeReceived = path.join(fixture, "runtime-received");
  const systemReceived = path.join(fixture, "system-received");
  const bearer = "SYNTHETIC_WINDOWS_REGRESSION_BEARER";
  const write = (file, contents = "fixture") => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, contents, { mode: 0o700 });
  };
  const curl = (directory, marker) => write(path.join(directory, "curl.exe"),
    `#!${node}\nlet input=''; process.stdin.on('data',chunk=>input+=chunk); process.stdin.on('end',()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({input,root:process.env.SystemRoot,windir:process.env.WINDIR})); process.stdout.write('{"ok":true}\\nPROOFPILOT_HTTP_STATUS:200');});\n`);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  curl(attacker, received);
  curl(runtime, runtimeReceived);
  curl(system, systemReceived);
  write(path.join(runtime, "node.exe"));
  const modules = [path.join(system, "ntdll.dll"), path.join(system, "kernel32.dll")];
  for (const module of modules) write(module);
  fs.mkdirSync(path.join(system, "Wbem"));
  fs.mkdirSync(path.join(system, "WindowsPowerShell", "v1.0"), { recursive: true });
  const userInfo = os.userInfo;
  os.userInfo = options => ({ ...userInfo(options), homedir: home });
  os.homedir = () => home;
  Object.defineProperty(process, "platform", { ...Object.getOwnPropertyDescriptor(process, "platform"), value: "win32" });
  process.getuid = undefined;
  process.env.SystemRoot = attacker;
  process.env.WINDIR = attacker;
  syncBuiltinESMExports();
  const { helperEnvironment, helperSearchPath } = await import(helperUrl);
  const { runColosseumRequest, parseColosseumResponse } = await import(connectionUrl);
  const env = { SystemRoot: attacker, systemroot: runtime, WINDIR: attacker, windir: runtime, PATH: attacker };
  let helperInvocations = 0;
  const request = () => runColosseumRequest({ url: "https://copilot.colosseum.com/api/v2/status", method: "GET", body: null }, {
    env,
    createHelperInvocation: () => {
      helperInvocations++;
      return { command: node, args: ["-e", `process.stdout.write(${JSON.stringify(bearer)}+'\\n')`],
        cwd: home, env: {}, shell: false, cleanup() {} };
    }
  });
  let cases = 0;
  // The real host report cannot authorize a caller's fabricated Windows root.
  assert.deepEqual(parseColosseumResponse(await request()), { error: "transport_missing", http_status: null });
  assert.equal(helperInvocations, 0, "An untrusted Windows transport must stop before constructing the token helper");
  assert.equal(fs.existsSync(received), false, "Forged SystemRoot delivered a bearer to caller curl.exe");
  cases++;

  const unavailable = () => {
    const clean = helperEnvironment(env);
    assert.equal(clean.PATH, "");
    assert.equal(clean.SystemRoot, undefined);
    assert.equal(clean.WINDIR, undefined);
    assert.equal(helperSearchPath(`${attacker}${path.delimiter}${runtime}`), "");
  };
  process.report.getReport = undefined;
  unavailable();
  cases++;
  process.report.getReport = () => { throw new Error("report unavailable"); };
  unavailable();
  cases++;

  let sharedObjects = modules;
  let reports = 0;
  process.report.getReport = () => {
    reports++;
    return { sharedObjects, get environmentVariables() { throw new Error("Report environment must never be inspected or serialized"); } };
  };
  reports = 0;
  const clean = helperEnvironment({ ...env, PATH: [attacker, runtime, system].join(path.delimiter) });
  assert.equal(reports, 1, "Resolve the OS anchor once for the entire helper environment");
  assert.equal(clean.SystemRoot, root);
  assert.equal(clean.WINDIR, root);
  assert.deepEqual(clean.PATH.split(path.delimiter), [root, system, path.join(system, "Wbem"), path.join(system, "WindowsPowerShell", "v1.0")]);
  reports = 0;
  assert.equal(helperSearchPath([attacker, runtime, system].join(path.delimiter)), clean.PATH);
  assert.equal(reports, 1, "Resolve the OS anchor once for the entire PATH");
  cases++;

  // Node's runtime is invoked directly. Its directory grants no curl authority.
  process.execPath = path.join(runtime, "node.exe");
  env.PATH = runtime;
  assert.deepEqual(parseColosseumResponse(await request()), { data: { ok: true }, http_status: 200 });
  const trusted = JSON.parse(fs.readFileSync(systemReceived, "utf8"));
  assert.ok(trusted.input.includes(`Authorization: Bearer ${bearer}`));
  assert.equal(trusted.root, root);
  assert.equal(trusted.windir, root);
  assert.equal(fs.existsSync(received), false);
  assert.equal(fs.existsSync(runtimeReceived), false, "A Node runtime directory authorized caller curl.exe");
  cases++;

  // The PATH entry is anchored, but its file link must not confer that trust on
  // a canonical target outside the allowed OS directories. This models an
  // existing link; it does not establish native Windows permission to create it.
  const systemCurl = path.join(system, "curl.exe");
  fs.rmSync(systemCurl);
  fs.symlinkSync(path.join(attacker, "curl.exe"), systemCurl, "file");
  const beforeEscapedLink = helperInvocations;
  assert.deepEqual(parseColosseumResponse(await request()), { error: "transport_missing", http_status: null });
  assert.equal(helperInvocations, beforeEscapedLink, "An escaped canonical Windows target must stop before token-helper construction");
  assert.equal(fs.existsSync(received), false, "The system-directory link delivered a bearer to the caller target");
  cases++;

  // A link whose canonical target remains in another accepted OS directory is
  // still usable. Verify the complete synthetic transfer, not only a resolver.
  const anchoredTarget = path.join(system, "Wbem", "anchored-curl.exe");
  fs.rmSync(systemCurl);
  curl(system, systemReceived);
  fs.renameSync(systemCurl, anchoredTarget);
  fs.symlinkSync(anchoredTarget, systemCurl, "file");
  fs.rmSync(systemReceived, { force: true });
  const beforeAnchoredLink = helperInvocations;
  assert.deepEqual(parseColosseumResponse(await request()), { data: { ok: true }, http_status: 200 });
  assert.equal(helperInvocations, beforeAnchoredLink + 1);
  const anchoredTransfer = JSON.parse(fs.readFileSync(systemReceived, "utf8"));
  assert.ok(anchoredTransfer.input.includes(`Authorization: Bearer ${bearer}`));
  assert.equal(anchoredTransfer.root, root);
  assert.equal(fs.existsSync(received), false);
  cases++;
  fs.rmSync(systemCurl);
  fs.renameSync(anchoredTarget, systemCurl);

  const wow = path.join(root, "SysWOW64");
  const wowModules = [path.join(wow, "ntdll.dll"), path.join(wow, "kernel32.dll")];
  for (const module of wowModules) write(module);
  sharedObjects = wowModules;
  assert.deepEqual(helperSearchPath(attacker).split(path.delimiter), [root, wow]);
  cases++;

  for (const invalid of [undefined, {}, [], [modules[0]], [...modules, modules[0]], [modules[0], wowModules[1]],
    [path.join(system, "missing", "ntdll.dll"), modules[1]]]) {
    sharedObjects = invalid;
    unavailable();
    cases++;
  }

  const redirected = path.join(fixture, "redirected-System32");
  fs.symlinkSync(system, redirected, "dir");
  sharedObjects = [path.join(redirected, "ntdll.dll"), path.join(redirected, "kernel32.dll")];
  unavailable();
  cases++;
  const aliasSystem = path.join(fixture, "alias-Windows", "System32");
  write(path.join(aliasSystem, "kernel32.dll"));
  fs.symlinkSync(modules[0], path.join(aliasSystem, "ntdll.dll"), "file");
  sharedObjects = [path.join(aliasSystem, "ntdll.dll"), path.join(aliasSystem, "kernel32.dll")];
  unavailable();
  cases++;

  sharedObjects = modules;
  const powershell = path.join(system, "WindowsPowerShell", "v1.0");
  fs.rmdirSync(powershell);
  fs.symlinkSync(attacker, powershell, "dir");
  const paths = helperSearchPath(`${redirected}${path.delimiter}${powershell}`).split(path.delimiter);
  assert.deepEqual(paths, [root, system, path.join(system, "Wbem")]);
  assert.equal(fs.existsSync(received), false);
  assert.equal(fs.existsSync(runtimeReceived), false);
  cases++;
  return cases;
}

export function runProjectSessionFailureRegressionTests() {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-export-failures-")));
  const native = Object.fromEntries(["openSync", "readSync", "writeSync", "readdirSync", "writeFileSync", "renameSync", "appendFileSync"]
    .map(name => [name, fs[name]]));
  const fault = (methods, run) => {
    Object.assign(fs, methods);
    try { return run(); } finally { for (const name of Object.keys(methods)) fs[name] = native[name]; }
  };
  const failure = code => Object.assign(new Error("fixture disk/read failure"), { code });
  let cases = 0;
  const fixture = label => {
    const directory = path.join(temporary, label);
    const options = { projectDir: path.join(directory, "project"), outputDir: path.join(directory, "output"),
      claudeHome: path.join(directory, "claude"), codexHome: path.join(directory, "codex") };
    fs.mkdirSync(options.projectDir, { recursive: true });
    return options;
  };
  const session = (options, provider = "claude", name = "current.jsonl", content = "CURRENT", mtime) => {
    const file = path.join(provider === "claude" ? options.claudeHome : options.codexHome,
      provider === "claude" ? "projects" : "sessions", "fixture", name);
    const bytes = JSON.stringify({ type: "user", cwd: options.projectDir, message: { content } }) + "\n";
    write(file, bytes);
    if (mtime) fs.utimesSync(file, new Date(mtime), new Date(mtime));
    return { file, bytes };
  };
  const foreignBytes = "FOREIGN EDITOR SAVE MUST SURVIVE";
  const change = (destination, kind) => {
    if (kind === "replace") {
      native.writeFileSync(destination + ".editor-save", foreignBytes);
      native.renameSync(destination + ".editor-save", destination);
    } else if (kind === "edit") native.writeFileSync(destination, foreignBytes);
  };
  const expectsFailure = (run, preserved = false) => assert.throws(run, error => {
    assert.match(error.message, /fixture disk\/read failure/);
    if (preserved) assert.match(error.message, /cleanup preserved an output/);
    else assert.doesNotMatch(error.message, /cleanup preserved an output/);
    return true;
  });
  try {
    for (const kind of ["replace", "edit", "unchanged"]) {
      const options = fixture("completed-" + kind);
      session(options);
      session(options, "codex");
      const destination = path.join(options.outputDir, "claude-session.jsonl");
      fault({ openSync(file, flags, ...args) {
        if (file === path.join(options.outputDir, "codex-session.jsonl") && flags === "wx") {
          change(destination, kind);
          throw failure("ENOSPC");
        }
        return native.openSync(file, flags, ...args);
      } }, () => expectsFailure(() => exportProjectSessions(options), kind !== "unchanged"));
      if (kind === "unchanged") assert.equal(fs.existsSync(destination), false, "Unedited completed output must roll back");
      else assert.equal(fs.readFileSync(destination, "utf8"), foreignBytes, "Rollback removed a foreign completed-output save");
      cases++;
    }
    for (const kind of ["replace", "edit", "unchanged"]) {
      const options = fixture("partial-" + kind);
      session(options, "claude", "current.jsonl", "x".repeat(80000));
      const destination = path.join(options.outputDir, "claude-session.jsonl");
      let output;
      let writes = 0;
      fault({
        openSync(file, flags, ...args) {
          const descriptor = native.openSync(file, flags, ...args);
          if (file === destination && flags === "wx") output = descriptor;
          return descriptor;
        },
        writeSync(descriptor, ...args) {
          if (descriptor === output && ++writes === 2) {
            change(destination, kind);
            throw failure("ENOSPC");
          }
          return native.writeSync(descriptor, ...args);
        }
      }, () => expectsFailure(() => exportProjectSessions(options), kind !== "unchanged"));
      assert.equal(writes, 2, "Partial-output fixture must fail after a successful first write");
      if (kind === "unchanged") assert.equal(fs.existsSync(destination), false, "Unedited partial output must be removed");
      else assert.equal(fs.readFileSync(destination, "utf8"), foreignBytes, "Cleanup removed a foreign partial-output save");
      cases++;
    }
    for (const kind of ["unknown-write-outcome", "concurrent-append", "short-writes"]) {
      const options = fixture(kind);
      const source = session(options, "claude", "current.jsonl", "x".repeat(80000));
      const destination = path.join(options.outputDir, "claude-session.jsonl");
      let output;
      let writes = 0;
      fault({
        openSync(file, flags, ...args) {
          const descriptor = native.openSync(file, flags, ...args);
          if (file === destination && flags === "wx") output = descriptor;
          return descriptor;
        },
        writeSync(descriptor, buffer, offset, length, position) {
          if (descriptor !== output) return native.writeSync(descriptor, buffer, offset, length, position);
          writes++;
          if (kind === "short-writes") return native.writeSync(descriptor, buffer, offset, Math.min(length, 8192), position);
          if (writes === 2) throw failure("ENOSPC");
          const count = native.writeSync(descriptor, buffer, offset, length, position);
          if (kind === "unknown-write-outcome") throw failure("EIO");
          native.appendFileSync(destination, foreignBytes);
          return count;
        }
      }, () => {
        if (kind === "short-writes") {
          assert.equal(exportProjectSessions(options).exported.length, 1);
          assert.equal(fs.readFileSync(destination, "utf8"), source.bytes);
          assert.ok(writes > 2, "Fixture must exercise real short writes");
        } else expectsFailure(() => exportProjectSessions(options), true);
      });
      if (kind === "unknown-write-outcome") assert.ok(fs.statSync(destination).size > 0, "Unknown write results must preserve output");
      if (kind === "concurrent-append") assert.ok(fs.readFileSync(destination, "utf8").endsWith(foreignBytes),
        "An append made before the export's fstat must survive cleanup");
      cases++;
    }
    for (const location of ["provider-root", "nested"]) {
      const options = fixture("unreadable-" + location);
      const older = session(options, "claude", "older.jsonl", "OLDER");
      const directory = location === "provider-root" ? path.join(options.claudeHome, "projects") : path.dirname(older.file);
      fault({ readdirSync(file, ...args) {
        if (file === directory) throw failure(location === "provider-root" ? "EIO" : "EACCES");
        return native.readdirSync(file, ...args);
      } }, () => assert.throws(() => exportProjectSessions(options), /Could not inspect project session directory.*no export was selected/));
      assert.equal(fs.existsSync(options.outputDir), false, "Incomplete directory inspection published stale evidence");
      cases++;
    }
    for (const operation of ["open", "read"]) {
      const options = fixture("unreadable-newest-" + operation);
      session(options, "claude", "older.jsonl", "OLDER", "2026-03-01T00:00:00Z");
      const newer = session(options, "claude", "newest.jsonl", "NEWEST", "2026-03-02T00:00:00Z");
      let unreadable;
      fault({
        openSync(file, ...args) {
          if (file === newer.file && operation === "open") throw failure("EACCES");
          const descriptor = native.openSync(file, ...args);
          if (file === newer.file) unreadable = descriptor;
          return descriptor;
        },
        readSync(descriptor, ...args) {
          if (operation === "read" && descriptor === unreadable) throw failure("EIO");
          return native.readSync(descriptor, ...args);
        }
      }, () => assert.throws(() => exportProjectSessions(options), /Could not inspect project session .*no export was selected/));
      assert.equal(fs.existsSync(options.outputDir), false, "An inaccessible newer file silently exported the old session");
      cases++;
    }
    const absent = fixture("absent-roots");
    assert.deepEqual(exportProjectSessions(absent).not_found, ["claude", "codex"]);
    assert.equal(fs.existsSync(absent.outputDir), false);
    cases++;
    const vanished = fixture("vanished-candidate");
    const old = session(vanished, "claude", "older.jsonl", "OLDER");
    const missing = session(vanished, "claude", "vanished.jsonl", "VANISHED");
    fault({ openSync(file, ...args) {
      if (file === missing.file) throw failure("ENOENT");
      return native.openSync(file, ...args);
    } }, () => assert.equal(fs.readFileSync(exportProjectSessions(vanished).exported[0].path, "utf8"), old.bytes));
    cases++;
    if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {
      const options = fixture("native-permission-denied");
      session(options, "claude", "older.jsonl", "OLDER", "2026-03-01T00:00:00Z");
      const newer = session(options, "claude", "newest.jsonl", "NEWEST", "2026-03-02T00:00:00Z");
      fs.chmodSync(newer.file, 0o000);
      try {
        assert.throws(() => exportProjectSessions(options), /Could not inspect project session .*EACCES.*no export was selected/);
        assert.equal(fs.existsSync(options.outputDir), false);
      } finally { fs.chmodSync(newer.file, 0o600); }
      cases++;
    }
    return { cases };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export function runProjectSessionConsistencyRegressionTests() {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-export-consistency-")));
  const native = Object.fromEntries(["openSync", "readSync", "writeFileSync", "appendFileSync", "truncateSync", "renameSync"]
    .map(name => [name, fs[name]]));
  const fault = (methods, run) => {
    Object.assign(fs, methods);
    try { return run(); } finally { for (const name of Object.keys(methods)) fs[name] = native[name]; }
  };
  const fixture = label => {
    const directory = path.join(temporary, label);
    const options = { projectDir: path.join(directory, "project-own"), outputDir: path.join(directory, "output"),
      claudeHome: path.join(directory, "claude"), codexHome: path.join(directory, "codex") };
    fs.mkdirSync(options.projectDir, { recursive: true, mode: 0o700 });
    return options;
  };
  const record = (provider, cwd, content) => provider === "codex" ?
    JSON.stringify({ type: "session_meta", payload: { cwd, id: "fixture" } }) + "\n" +
      JSON.stringify({ type: "response_item", payload: { role: "user", content } }) + "\n" :
    JSON.stringify({ type: "user", cwd, message: { content } }) + "\n";
  const session = (options, provider, content = "PRIVATE OWN SESSION " + "x".repeat(80000), name = "current.jsonl") => {
    const file = path.join(provider === "claude" ? options.claudeHome : options.codexHome,
      provider === "claude" ? "projects" : "sessions", "fixture", name);
    const bytes = record(provider, options.projectDir, content);
    const foreign = record(provider, path.join(path.dirname(options.projectDir), "project-alt"), "FOREIGN ALT SESSION " + "y".repeat(80000));
    write(file, bytes);
    return { file, bytes, foreign, inode: fs.statSync(file, { bigint: true }).ino };
  };
  const destination = (options, provider) => path.join(options.outputDir, `${provider}-session.jsonl`);
  const assertOwnExport = (result, options, provider, bytes) => {
    assert.deepEqual(result.exported, [{ provider, path: destination(options, provider) }]);
    assert.equal(result.uploaded, false);
    assert.ok(fs.readFileSync(destination(options, provider), "utf8") === bytes,
      "Export must publish the exact captured bytes whose project metadata was inspected");
  };
  const foreignOutput = "FOREIGN EDITOR SAVE MUST SURVIVE SOURCE FAILURE";
  let cases = 0;
  try {
    for (const provider of ["claude", "codex"]) {
      const options = fixture(`stable-${provider}`);
      const source = session(options, provider);
      assertOwnExport(exportProjectSessions(options), options, provider, source.bytes);
      cases++;
    }
    for (const provider of ["claude", "codex"]) {
      for (const mutation of ["rewrite", "append", "truncate"]) {
        const options = fixture(`after-validation-${provider}-${mutation}`);
        const source = session(options, provider);
        assert.equal(Buffer.byteLength(source.foreign), Buffer.byteLength(source.bytes), "Rewrite must preserve the selected size");
        let changed = false;
        const result = fault({ openSync(file, flags, ...args) {
          const descriptor = native.openSync(file, flags, ...args);
          if (file === destination(options, provider) && flags === "wx") {
            if (mutation === "rewrite") native.writeFileSync(source.file, source.foreign);
            else if (mutation === "append") native.appendFileSync(source.file, source.foreign);
            else native.truncateSync(source.file, 0);
            changed = true;
          }
          return descriptor;
        } }, () => exportProjectSessions(options));
        assert.equal(changed, true, "Mutation must occur after validation and before output is written");
        assert.equal(fs.statSync(source.file, { bigint: true }).ino, source.inode, "Fixture must rewrite the same source inode");
        assertOwnExport(result, options, provider, source.bytes);
        cases++;
      }
    }
    for (const provider of ["claude", "codex"]) {
      const options = fixture(`during-capture-${provider}`);
      const source = session(options, provider);
      let opens = 0;
      let captured;
      let changed = false;
      fault({
        openSync(file, flags, ...args) {
          const descriptor = native.openSync(file, flags, ...args);
          if (file === source.file && ++opens === 2) captured = descriptor;
          return descriptor;
        },
        readSync(descriptor, ...args) {
          const count = native.readSync(descriptor, ...args);
          if (descriptor === captured && count && !changed) {
            native.writeFileSync(source.file, source.foreign);
            changed = true;
          }
          return count;
        }
      }, () => assert.throws(() => exportProjectSessions(options), /Selected project session changed/));
      assert.equal(changed, true, "Fixture must mutate source while its export snapshot is being read");
      assert.equal(fs.existsSync(destination(options, provider)), false, "An inconsistent source snapshot must not leave an export");
      cases++;
    }
    for (const outputChange of ["unchanged", "edit", "replace"]) {
      const options = fixture(`second-provider-source-failure-${outputChange}`);
      session(options, "claude");
      const source = session(options, "codex");
      const completed = destination(options, "claude");
      let opens = 0;
      let captured;
      let changed = false;
      fault({
        openSync(file, flags, ...args) {
          const descriptor = native.openSync(file, flags, ...args);
          if (file === source.file && ++opens === 2) captured = descriptor;
          return descriptor;
        },
        readSync(descriptor, ...args) {
          const count = native.readSync(descriptor, ...args);
          if (descriptor === captured && count && !changed) {
            native.writeFileSync(source.file, source.foreign);
            if (outputChange === "edit") native.writeFileSync(completed, foreignOutput);
            if (outputChange === "replace") {
              native.writeFileSync(completed + ".editor-save", foreignOutput);
              native.renameSync(completed + ".editor-save", completed);
            }
            changed = true;
          }
          return count;
        }
      }, () => assert.throws(() => exportProjectSessions(options), error => {
        assert.match(error.message, /Selected project session changed/);
        if (outputChange !== "unchanged") assert.match(error.message, /cleanup preserved an output/);
        return true;
      }));
      assert.equal(changed, true);
      assert.equal(fs.existsSync(destination(options, "codex")), false);
      if (outputChange === "unchanged") assert.equal(fs.existsSync(completed), false, "An owned first-provider output must roll back");
      else assert.equal(fs.readFileSync(completed, "utf8"), foreignOutput, "Source failure must preserve another writer's completed output");
      cases++;
    }
    const existing = fixture("preexisting-output");
    session(existing, "claude");
    write(destination(existing, "claude"), foreignOutput);
    assert.throws(() => exportProjectSessions(existing), /Export destination already exists/);
    assert.equal(fs.readFileSync(destination(existing, "claude"), "utf8"), foreignOutput);
    cases++;
    const foreignFirst = fixture("codex-foreign-first-metadata");
    const foreign = record("codex", path.join(temporary, "another-project"), "FOREIGN") +
      record("codex", foreignFirst.projectDir, "LATER MATCH DOES NOT OWN THIS LOG");
    write(path.join(foreignFirst.codexHome, "sessions", "fixture", "current.jsonl"), foreign);
    assert.deepEqual(exportProjectSessions(foreignFirst).exported, []);
    assert.equal(fs.existsSync(foreignFirst.outputDir), false);
    cases++;
    return { cases };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export function runHelperExportRegressionTests() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-helper-export-"));
  let cases = 0;
  const previousTmp = process.env.TMPDIR;
  try {
    const shared = path.join(temporary, "shared-tmp");
    const fakeBin = path.join(shared, "node_modules", ".bin");
    const marker = path.join(temporary, "foreign-node-ran");
    fs.mkdirSync(fakeBin, { recursive: true, mode: 0o777 });
    fs.chmodSync(shared, 0o777);
    write(path.join(fakeBin, "node"), `#!/bin/sh\nprintf compromised > ${JSON.stringify(marker)}\nexec ${JSON.stringify(process.execPath)} "$@"\n`, 0o755);
    write(path.join(fakeBin, "npm"), `#!/bin/sh\nprintf compromised > ${JSON.stringify(marker)}\nexit 0\n`, 0o755);
    process.env.TMPDIR = shared;
    assert.equal(os.tmpdir(), shared, "The attack fixture did not become Node's shared temporary directory");

    const populatedCache = path.join(temporary, "populated-cache");
    const packageRoot = path.join(populatedCache, "_npx", "exact", "node_modules", "@colosseum-org", "copilot-connect");
    write(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@colosseum-org/copilot-connect",
      version: "0.2.2",
      type: "module",
      bin: { "copilot-connect": "src/cli.js" }
    }));
    write(path.join(packageRoot, "src", "cli.js"), "if (process.argv.includes('--version')) process.stdout.write('0.2.2\\n'); else process.exitCode = 9;\n");
    const cacheBefore = snapshot(populatedCache);
    const invocation = createHelperInvocation(["--version"], {
      cache: populatedCache,
      env: { PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` }
    });
    assert.equal(invocation.command, process.execPath);
    assert.equal(path.resolve(invocation.cwd).startsWith(path.resolve(shared) + path.sep), false,
      "Helper workspace must not descend from the shared temporary directory");
    const result = runInvocation(invocation);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOTCACHED/);
    assert.equal(fs.existsSync(marker), false, "A node binary in the shared temporary ancestor was executed");
    assert.deepEqual(snapshot(populatedCache), cacheBefore, "Offline helper lookup mutated an untrusted _npx tree");
    cases++;

    const poisonedManagedCache = path.join(temporary, "poisoned-managed-cache");
    const poisonedRoot = path.join(poisonedManagedCache, "_proofpilot_helpers", "copilot-connect-0.2.2", "node_modules", "@colosseum-org", "copilot-connect");
    const poisonedMarker = path.join(temporary, "poisoned-managed-helper-ran");
    write(path.join(poisonedRoot, "package.json"), JSON.stringify({
      name: "@colosseum-org/copilot-connect", version: "0.2.2", bin: { "copilot-connect": "src/cli.js" }
    }));
    write(path.join(poisonedRoot, "src", "cli.js"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(poisonedMarker)}, "ran");\n`);
    const poisonedBefore = snapshot(poisonedManagedCache);
    const poisonedHelperRoot = path.join(fs.realpathSync(poisonedManagedCache), "_proofpilot_helpers", "copilot-connect-0.2.2");
    for (const online of [false, false, true]) {
      const refusal = createHelperInvocation(["--version"], { online, cache: poisonedManagedCache, env: { PATH: process.env.PATH ?? "" } });
      assert.equal(refusal.helperCacheIssue?.code, "helper_untrusted", "An existing invalid managed root must not look absent");
      assert.equal(refusal.helperCacheIssue.path, poisonedHelperRoot);
      assert.ok(path.isAbsolute(refusal.helperCacheIssue.path));
      assert.equal(refusal.args[0], "--input-type=module");
      assert.equal(refusal.args.some(arg => path.basename(arg) === "npm-cli.js" || arg === CONNECTION_HELPER_TREE_SHA256), false,
        "A rejected cache must not reach npm preparation");
      assert.equal(refusal.args.some(arg => arg.startsWith(poisonedHelperRoot + path.sep)), false, "A rejected cached entrypoint must not be executed");
      assert.equal(path.basename(refusal.cwd).startsWith(".proofpilot-helper-"), false, "A rejected cache must not create an online workspace");
      const poisoned = runInvocation(refusal);
      assert.notEqual(poisoned.status, 0);
      assert.match(poisoned.stderr, /EHELPERCACHE/);
      assert.doesNotMatch(poisoned.stderr, /ENOTCACHED/);
      assert.ok(poisoned.stderr.includes(JSON.stringify(poisonedHelperRoot)), "The diagnostic must name the exact absolute managed cache");
      assert.match(poisoned.stderr, /Preserve it: confirm that this directory belongs to your account.*move the whole directory aside.*explicitly retry helper preparation/);
      assert.equal(fs.existsSync(poisonedMarker), false, "A same-name/version managed helper with different content executed");
      assert.deepEqual(snapshot(poisonedManagedCache), poisonedBefore, "Repeated refusal mutated or removed the poisoned managed tree");
    }
    const quarantine = `${poisonedHelperRoot}.quarantine`;
    fs.renameSync(poisonedHelperRoot, quarantine);
    const afterQuarantine = createHelperInvocation(["--version"], { cache: poisonedManagedCache, env: { PATH: process.env.PATH ?? "" } });
    assert.equal(afterQuarantine.helperCacheIssue, undefined, "An operator-quarantined cache is absent and may be prepared again");
    const absentAgain = runInvocation(afterQuarantine);
    assert.match(absentAgain.stderr, /ENOTCACHED/);
    assert.ok(fs.existsSync(path.join(quarantine, "node_modules", "@colosseum-org", "copilot-connect", "src", "cli.js")), "The quarantined tree must be preserved");
    assert.equal(fs.existsSync(poisonedMarker), false);
    cases++;

    const metadataOnlyCache = path.join(temporary, "metadata-only-cache");
    write(path.join(metadataOnlyCache, "_cacache", "content-v2", "fixture"), "cached tarball metadata without an _npx install tree\n");
    const metadataBefore = snapshot(metadataOnlyCache);
    const missing = createHelperInvocation(["--version"], { cache: metadataOnlyCache, env: { PATH: process.env.PATH ?? "" } });
    const missingResult = runInvocation(missing);
    assert.notEqual(missingResult.status, 0);
    assert.match(missingResult.stderr, /ENOTCACHED/);
    assert.equal(fs.existsSync(path.join(metadataOnlyCache, "_npx")), false,
      "Offline status recreated the npm exec installation tree");
    assert.deepEqual(snapshot(metadataOnlyCache), metadataBefore, "Offline status changed npm cache contents");
    cases++;

    const hostileConfig = path.join(temporary, "attacker-config");
    const online = createHelperInvocation(["--version"], { online: true, cache: metadataOnlyCache, env: {
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      NODE_TLS_REJECT_UNAUTHORIZED: "0", NODE_PRESERVE_SYMLINKS: "1", NODE_REDIRECT_WARNINGS: path.join(temporary, "warnings"),
      NODE_EXTRA_CA_CERTS: path.join(temporary, "enterprise-ca.pem"), SSLKEYLOGFILE: path.join(temporary, "tls-keys"),
      CURL_CA_BUNDLE: path.join(temporary, "attacker-ca.pem"), SSL_CERT_FILE: path.join(temporary, "attacker-cert.pem"),
      HTTPS_PROXY: "http://127.0.0.1:9999", HTTP_PROXY: "http://127.0.0.1:9998", ALL_PROXY: "socks5://127.0.0.1:9997",
      NO_PROXY: "*", SSH_AUTH_SOCK: path.join(temporary, "agent.sock"), CI_JOB_JWT_V2: "synthetic-jwt",
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(temporary, "attacker-bus")}`,
      XDG_RUNTIME_DIR: path.join(temporary, "attacker-runtime"), OPENSSL_CONF: path.join(temporary, "attacker-openssl.cnf"),
      GITHUB_TOKEN: "synthetic-token", XDG_CONFIG_HOME: hostileConfig, HOME: temporary, USERPROFILE: temporary,
      PREFIX: path.join(temporary, "attacker-prefix"), DESTDIR: path.join(temporary, "attacker-dest"),
      DATABASE_URL: "postgres://user:secret@database.invalid/app", REDIS_URL: "redis://:secret@cache.invalid",
      SENTRY_DSN: "https://secret@example.invalid/1", SESSION_COOKIE: "synthetic-session-cookie",
      AZURE_STORAGE_CONNECTION_STRING: "AccountName=fixture;AccountKey=synthetic-secret",
      UNRECOGNIZED_PRIVATE_CONTEXT: "synthetic-private-value", KEEP: "must-not-cross-helper-boundary",
      BROWSER: path.join(temporary, "attacker-browser"), GIO_EXTRA_MODULES: path.join(temporary, "attacker-modules"),
      LANG: "C.UTF-8", LC_CTYPE: "C.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor",
      DISPLAY: ":99", WAYLAND_DISPLAY: "wayland-9", XAUTHORITY: path.join(temporary, "xauthority"),
      XDG_CURRENT_DESKTOP: "synthetic-desktop", XDG_SESSION_TYPE: "wayland", DESKTOP_SESSION: "synthetic-session"
    } });
    try {
      assert.equal(online.command, process.execPath);
      assert.ok(path.isAbsolute(online.command));
      const npmCli = online.args.find(arg => path.isAbsolute(arg) && path.basename(arg) === "npm-cli.js");
      assert.equal(online.args[0], "--input-type=module");
      assert.match(online.args[2], /process\.umask\(0o077\)/);
      assert.ok(npmCli && online.args.includes("--eval") && online.args.includes("@colosseum-org/copilot-connect@0.2.2") &&
        online.args.includes(CONNECTION_HELPER_TREE_SHA256),
        "Online preparation must use the npm CLI tied to the running Node executable and then execute the validated package directly");
      assert.equal(online.args.some(arg => /npx(?:-cli)?/.test(path.basename(arg))), false);
      assert.equal(npmCli.startsWith(fakeBin + path.sep), false, "Caller PATH must not select npm");
      for (const name of [
        "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_PRESERVE_SYMLINKS", "NODE_REDIRECT_WARNINGS", "NODE_EXTRA_CA_CERTS",
        "SSLKEYLOGFILE", "CURL_CA_BUNDLE", "SSL_CERT_FILE", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
        "SSH_AUTH_SOCK", "CI_JOB_JWT_V2", "GITHUB_TOKEN", "OPENSSL_CONF", "PREFIX", "DESTDIR",
        "DATABASE_URL", "REDIS_URL", "SENTRY_DSN", "SESSION_COOKIE", "AZURE_STORAGE_CONNECTION_STRING",
        "UNRECOGNIZED_PRIVATE_CONTEXT", "KEEP", "BROWSER", "GIO_EXTRA_MODULES"
      ]) {
        assert.equal(online.env[name], undefined);
      }
      for (const [name, value] of Object.entries({
        LANG: "C.UTF-8", LC_CTYPE: "C.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor",
        DISPLAY: ":99", WAYLAND_DISPLAY: "wayland-9", XAUTHORITY: path.join(temporary, "xauthority"),
        XDG_CURRENT_DESKTOP: "synthetic-desktop", XDG_SESSION_TYPE: "wayland", DESKTOP_SESSION: "synthetic-session"
      })) assert.equal(online.env[name], value, `${name} is required nonsecret process context`);
      if (process.platform !== "linux") {
        assert.equal(online.env.DBUS_SESSION_BUS_ADDRESS, undefined);
        assert.equal(online.env.XDG_RUNTIME_DIR, undefined);
      } else {
        assert.notEqual(online.env.DBUS_SESSION_BUS_ADDRESS, `unix:path=${path.join(temporary, "attacker-bus")}`);
        assert.notEqual(online.env.XDG_RUNTIME_DIR, path.join(temporary, "attacker-runtime"));
      }
      assert.notEqual(online.env.HOME, temporary);
      assert.notEqual(online.env.USERPROFILE, temporary);
      assert.notEqual(online.env.XDG_CONFIG_HOME, hostileConfig);
      assert.equal(online.env.PATH.split(path.delimiter).includes(fakeBin), false, "Caller-controlled PATH entries must be removed");
      assert.equal(path.resolve(online.cwd).startsWith(path.resolve(shared) + path.sep), false);
    } finally { online.cleanup(); }
    cases++;

    const localStatus = createHelperInvocation(["status", "--local"], {
      cache: metadataOnlyCache, env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: hostileConfig }
    });
    try {
      assert.equal(localStatus.env.XDG_CONFIG_HOME, path.join(fs.realpathSync(os.userInfo().homedir), ".config"));
      assert.equal(localStatus.cwd, fs.realpathSync(os.userInfo().homedir));
    } finally { localStatus.cleanup(); }
    assert.equal(fs.existsSync(hostileConfig), false, "Preparing offline status touched caller-selected config storage");
    cases++;

    if (process.platform !== "win32") {
      const windowsFixture = path.join(fs.realpathSync(temporary), "windows-branch");
      fs.mkdirSync(windowsFixture, { mode: 0o700 });
      const windowsScript = `const cases = await (${windowsBranchFixtures.toString()})(${JSON.stringify(windowsFixture)}, ` +
        `${JSON.stringify(new URL("../skills/proofpilot/scripts/connection-helper.js", import.meta.url).href)}, ` +
        `${JSON.stringify(new URL("../skills/proofpilot/scripts/colosseum-connection.js", import.meta.url).href)});\n` +
        `console.log(JSON.stringify({ cases }));\n`;
      const windows = spawnSync(process.execPath, ["--input-type=module", "--eval", windowsScript], {
        env: { PATH: process.env.PATH ?? "", HOME: windowsFixture, USERPROFILE: windowsFixture },
        encoding: "utf8", timeout: 15000
      });
      assert.equal(windows.status, 0, windows.stderr);
      cases += JSON.parse(windows.stdout).cases;

      const privateParent = fs.mkdtempSync(path.join(os.homedir(), ".proofpilot-helper-path-test-"));
      try {
        fs.chmodSync(privateParent, 0o700);
        const danglingHome = path.join(privateParent, "dangling-home");
        const danglingTarget = path.join(privateParent, "outside", "config");
        fs.mkdirSync(danglingHome, { mode: 0o700 });
        fs.symlinkSync(danglingTarget, path.join(danglingHome, ".config"), "dir");
        const danglingCache = path.join(privateParent, "dangling-cache");
        fs.mkdirSync(danglingCache, { mode: 0o700 });
        const moduleUrl = new URL("../skills/proofpilot/scripts/connection-helper.js", import.meta.url).href;
        const danglingScript = `import os from "node:os";\n` +
          `import { syncBuiltinESMExports } from "node:module";\n` +
          `const original = os.userInfo;\n` +
          `os.homedir = () => ${JSON.stringify(danglingHome)};\n` +
          `os.userInfo = options => ({ ...original(options), homedir: ${JSON.stringify(danglingHome)} });\n` +
          `syncBuiltinESMExports();\n` +
          `const { createHelperInvocation } = await import(${JSON.stringify(`${moduleUrl}?dangling-config`)});\n` +
          `try { createHelperInvocation(["status", "--local"], { cache: ${JSON.stringify(danglingCache)}, env: { PATH: ${JSON.stringify(process.env.PATH ?? "")} } }); console.log(JSON.stringify({ accepted: true })); }\n` +
          `catch (error) { console.log(JSON.stringify({ accepted: false, message: error.message })); }\n`;
        const dangling = spawnSync(process.execPath, ["--input-type=module", "--eval", danglingScript], {
          env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 15000
        });
        assert.equal(dangling.status, 0, dangling.stderr);
        const danglingResult = JSON.parse(dangling.stdout);
        assert.equal(danglingResult.accepted, false, "A dangling config symlink must not become XDG_CONFIG_HOME");
        assert.match(danglingResult.message, /config path is unsafe/);
        assert.equal(fs.existsSync(danglingTarget), false, "Config validation must not create a dangling symlink target");
        cases++;

        const fakeHome = path.join(privateParent, "home");
        const unsafeStore = path.join(privateParent, "unsafe-store");
        fs.mkdirSync(fakeHome, { mode: 0o700 });
        fs.mkdirSync(unsafeStore, { mode: 0o777 });
        fs.chmodSync(unsafeStore, 0o777);
        fs.symlinkSync(unsafeStore, path.join(fakeHome, ".proofpilot"), "dir");
        const managed = path.join(unsafeStore, "helpers", "copilot-connect-0.2.2", "node_modules", "@colosseum-org", "copilot-connect");
        const managedMarker = path.join(privateParent, "unsafe-managed-helper-ran");
        write(path.join(managed, "package.json"), JSON.stringify({
          name: "@colosseum-org/copilot-connect", version: "0.2.2", bin: { "copilot-connect": "cli.cjs" }
        }));
        write(path.join(managed, "cli.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(managedMarker)}, "ran");\n`);
        const safeCache = path.join(privateParent, "safe-cache");
        fs.mkdirSync(safeCache, { mode: 0o700 });
        const safeConfig = path.join(privateParent, "custom-config");
        const safeConfigInvocation = createHelperInvocation(["--version"], {
          cache: safeCache, env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: safeConfig }
        });
        try { assert.equal(safeConfigInvocation.env.XDG_CONFIG_HOME, safeConfig); }
        finally { safeConfigInvocation.cleanup(); }
        const script = `import { createHelperInvocation } from ${JSON.stringify(moduleUrl)};\n` +
          `const invocation = createHelperInvocation(["status", "--local"], { cache: ${JSON.stringify(safeCache)} });\n` +
          `try { console.log(JSON.stringify({ cwd: invocation.cwd, home: invocation.env.HOME, config: invocation.env.XDG_CONFIG_HOME })); }\n` +
          `finally { invocation.cleanup(); }\n`;
        const rejected = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
          env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome }, encoding: "utf8", timeout: 15000
        });
        assert.equal(rejected.status, 0, rejected.stderr);
        const isolated = JSON.parse(rejected.stdout);
        assert.equal(isolated.home, fs.realpathSync(os.userInfo().homedir));
        assert.equal(path.resolve(isolated.cwd).startsWith(path.resolve(fakeHome) + path.sep), false);
        assert.equal(isolated.config, path.join(isolated.home, ".config"));
        assert.equal(fs.existsSync(managedMarker), false, "A caller HOME redirected lookup to a helper behind a symlinked store");
        cases++;
      } finally { fs.rmSync(privateParent, { recursive: true, force: true }); }
    }

    const link = path.join(temporary, "export-through-link.mjs");
    try { fs.symlinkSync(exportScript, link, "file"); }
    catch (error) {
      if (process.platform !== "win32") throw error;
    }
    if (fs.existsSync(link)) {
      const project = path.join(temporary, "project");
      fs.mkdirSync(project);
      const linked = spawnSync(process.execPath, [link, "--invalid"], {
        cwd: project,
        env: { ...process.env, CLAUDE_HOME: path.join(temporary, "claude"), CODEX_HOME: path.join(temporary, "codex") },
        encoding: "utf8",
        timeout: 15000
      });
      assert.equal(linked.status, 1);
      assert.match(linked.stderr, /Usage: export-project-sessions\.js/);
      assert.equal(linked.stdout, "");
      cases++;
    }

    const exportFixture = label => {
      const fixture = path.join(temporary, `export-${label}`);
      const projectDir = path.join(fixture, "project");
      fs.mkdirSync(projectDir, { recursive: true, mode: 0o700 });
      return { projectDir, outputDir: path.join(fixture, "exports"),
        claudeHome: path.join(fixture, "claude"), codexHome: path.join(fixture, "codex") };
    };
    const userRecord = (cwd, content) => JSON.stringify({ type: "user", cwd, message: { role: "user", content } }) + "\n";
    const session = (options, name, content, mtime) => {
      const file = path.join(options.claudeHome, "projects", "fixture", name);
      write(file, content);
      if (mtime) fs.utimesSync(file, new Date(mtime), new Date(mtime));
      return file;
    };

    const large = exportFixture("large-first-record");
    session(large, "older.jsonl", userRecord(large.projectDir, "OLDER"), "2026-03-01T00:00:00Z");
    const largeBytes = userRecord(large.projectDir, "NEWEST " + "x".repeat(300000) + "🌱");
    session(large, "newest.jsonl", largeBytes, "2026-03-02T00:00:00Z");
    const largeResult = exportProjectSessions(large);
    assert.equal(largeResult.exported.length, 1);
    assert.equal(fs.readFileSync(largeResult.exported[0].path, "utf8"), largeBytes,
      "A complete large first record must select the newest matching session");
    cases++;

    const unterminated = exportFixture("large-record-without-newline");
    const lastRecord = JSON.stringify({ type: "user", message: { content: "x".repeat(300000) + "🌱" }, cwd: unterminated.projectDir });
    session(unterminated, "current.jsonl", lastRecord);
    const lastResult = exportProjectSessions(unterminated);
    assert.equal(fs.readFileSync(lastResult.exported[0].path, "utf8"), lastRecord,
      "The complete final record and cwd beyond the old header limit must be inspected");
    cases++;

    const afterLarge = exportFixture("metadata-after-large-record");
    const laterMetadata = JSON.stringify({ type: "progress", content: "x".repeat(300000) }) + "\n" +
      userRecord(afterLarge.projectDir, "REAL_METADATA");
    session(afterLarge, "current.jsonl", laterMetadata);
    assert.equal(fs.readFileSync(exportProjectSessions(afterLarge).exported[0].path, "utf8"), laterMetadata);
    cases++;

    const foreign = exportFixture("foreign-first-record");
    const ownOlder = userRecord(foreign.projectDir, "OWN_OLDER");
    session(foreign, "older.jsonl", ownOlder, "2026-03-01T00:00:00Z");
    session(foreign, "newest-foreign.jsonl", userRecord(path.join(temporary, "another-project"), "x".repeat(300000)) +
      userRecord(foreign.projectDir, "LATER_MUST_NOT_CHANGE_OWNERSHIP"), "2026-03-02T00:00:00Z");
    assert.equal(fs.readFileSync(exportProjectSessions(foreign).exported[0].path, "utf8"), ownOlder,
      "A large foreign first cwd must reject later messages referring to this project");
    cases++;

    const malformed = exportFixture("malformed-cwd-text");
    session(malformed, "invalid.jsonl", '{"type":"user","cwd":' + JSON.stringify(malformed.projectDir) +
      ',"content":"' + "x".repeat(300000) + '\n' + userRecord(path.join(temporary, "foreign-project"), "REAL_FOREIGN_METADATA") +
      userRecord(malformed.projectDir, "LATER_PROJECT_MENTION"));
    assert.deepEqual(exportProjectSessions(malformed).exported, [], "Malformed JSON must never establish cwd ownership");
    assert.equal(fs.existsSync(malformed.outputDir), false);
    cases++;

    const crowded = exportFixture("candidate-limit");
    session(crowded, "00000-old.jsonl", userRecord(crowded.projectDir, "OLD_MATCH"), "2026-03-01T00:00:00Z");
    for (let index = 1; index < 10000; index++) {
      session(crowded, `${String(index).padStart(5, "0")}-foreign.jsonl`, userRecord(path.join(temporary, "foreign-project"), "FOREIGN"));
    }
    const crowdedNewest = userRecord(crowded.projectDir, "NEWEST_BEYOND_OLD_SCAN_LIMIT");
    session(crowded, "zz-newest.jsonl", crowdedNewest, "2026-03-02T00:00:00Z");
    assert.throws(() => exportProjectSessions(crowded), /inspection limit exceeded: more than 10000 candidate files/);
    assert.equal(fs.existsSync(crowded.outputDir), false, "An incomplete scan must not publish a stale session export");
    cases++;
    fs.rmSync(path.join(crowded.claudeHome, "projects", "fixture", "00001-foreign.jsonl"));
    assert.equal(fs.readFileSync(exportProjectSessions(crowded).exported[0].path, "utf8"), crowdedNewest,
      "The newest matching session must be selected at the exact candidate bound");
    cases++;

    const oversized = exportFixture("session-size-limit");
    session(oversized, "older.jsonl", userRecord(oversized.projectDir, "OLDER"), "2026-03-01T00:00:00Z");
    const oversizedFile = session(oversized, "newest.jsonl", userRecord(oversized.projectDir, "NEWEST"), "2026-03-02T00:00:00Z");
    fs.truncateSync(oversizedFile, 128 * 1024 * 1024 + 1);
    assert.throws(() => exportProjectSessions(oversized), /inspection limit exceeded: a candidate exceeds/);
    assert.equal(fs.existsSync(oversized.outputDir), false, "An uninspected large candidate must not silently fall back to an older export");
    cases++;

    const deep = exportFixture("directory-depth-limit");
    const deepFile = path.join(deep.claudeHome, "projects", ...Array.from({ length: 33 }, () => "nested"), "current.jsonl");
    write(deepFile, userRecord(deep.projectDir, "CURRENT"));
    assert.throws(() => exportProjectSessions(deep), /inspection limit exceeded: directory depth/);
    assert.equal(fs.existsSync(deep.outputDir), false);
    cases++;

    if (process.platform !== "win32") {
      const special = exportFixture("nonregular-session");
      const realSession = path.join(temporary, "outside-session.jsonl");
      write(realSession, userRecord(special.projectDir, "MUST_NOT_FOLLOW"));
      const specialDirectory = path.join(special.claudeHome, "projects", "fixture");
      fs.mkdirSync(specialDirectory, { recursive: true, mode: 0o700 });
      fs.symlinkSync(realSession, path.join(specialDirectory, "link.jsonl"), "file");
      assert.equal(spawnSync("/usr/bin/mkfifo", [path.join(specialDirectory, "pipe.jsonl")]).status, 0);
      const specialResult = exportProjectSessions(special);
      assert.deepEqual(specialResult.exported, []);
      assert.equal(fs.existsSync(special.outputDir), false);
      cases++;
    }

    const relocated = exportFixture("relocated-claude-config");
    const relocatedHome = path.join(temporary, "relocated-config");
    const legacyHome = path.join(temporary, "legacy-claude-home");
    const relocatedBytes = userRecord(relocated.projectDir, "OFFICIAL_CONFIG_SESSION");
    write(path.join(relocatedHome, "projects", "fixture", "current.jsonl"), relocatedBytes);
    const legacyBytes = userRecord(relocated.projectDir, "LEGACY_HOME_SESSION");
    write(path.join(legacyHome, "projects", "fixture", "current.jsonl"), legacyBytes);
    const exporterEnv = { ...process.env, CLAUDE_CONFIG_DIR: relocatedHome, CLAUDE_HOME: legacyHome, CODEX_HOME: relocated.codexHome };
    const runExport = (name, changes = {}) => {
      const output = path.join(temporary, `cli-export-${name}`);
      const result = spawnSync(process.execPath, [exportScript, output], {
        cwd: relocated.projectDir, env: { ...exporterEnv, ...changes }, encoding: "utf8", timeout: 15000
      });
      assert.ifError(result.error);
      return { ...result, output };
    };
    const relocatedResult = runExport("official-config");
    assert.equal(relocatedResult.status, 0, relocatedResult.stderr);
    assert.equal(fs.readFileSync(JSON.parse(relocatedResult.stdout).exported[0].path, "utf8"), relocatedBytes,
      "CLAUDE_CONFIG_DIR must take precedence over legacy CLAUDE_HOME");
    cases++;
    const legacyResult = runExport("legacy-config", { CLAUDE_CONFIG_DIR: "" });
    assert.equal(legacyResult.status, 0, legacyResult.stderr);
    assert.equal(fs.readFileSync(JSON.parse(legacyResult.stdout).exported[0].path, "utf8"), legacyBytes);
    cases++;
    for (const [name, changes] of [
      ["relative-official-config", { CLAUDE_CONFIG_DIR: "relative-config" }],
      ["tilde-official-config", { CLAUDE_CONFIG_DIR: "~/.claude" }],
      ["relative-legacy-home", { CLAUDE_CONFIG_DIR: "", CLAUDE_HOME: "relative-home" }],
      ["relative-codex-home", { CODEX_HOME: "relative-codex" }]
    ]) {
      const rejected = runExport(name, changes);
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.equal(rejected.stdout, "");
      assert.match(rejected.stderr, /must be an absolute path/);
      assert.equal(fs.existsSync(rejected.output), false, "Invalid configured roots must fail before writing exports");
      cases++;
    }

    return { cases: cases + runProjectSessionFailureRegressionTests().cases + runProjectSessionConsistencyRegressionTests().cases };
  } finally {
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(filename)) {
  console.log(`Helper/export regression tests passed: ${runHelperExportRegressionTests().cases} cases.`);
}
