import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installPackage, profileNames, defaultSkillRoots, printInstallNotice } from "./install-package.js";
import { acquireDependencyInstallLock, backupInstalledPath, installDependencies, getDependencyStatus, loadDependencyManifest, recoverPendingInstallation } from "../skills/proofpilot/scripts/install-dependencies.js";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(repository, "skills/proofpilot");
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const pathIdentity = file => {
  const stat = fs.lstatSync(file, { bigint: true });
  return { dev: stat.dev.toString(), ino: stat.ino.toString(),
    type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "special" };
};
const recordCoreIdentity = (root, name, location) => {
  const stateFile = path.join(root, ".proofpilot-bundle.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.core_entries[name].path_identity = pathIdentity(location);
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
};
function tracePersistence(run, beforeSync = () => {}) {
  const original = { open: fs.openSync, close: fs.closeSync, sync: fs.fsyncSync, rename: fs.renameSync };
  const paths = new Map(), events = [];
  fs.openSync = (file, ...args) => { const fd = original.open(file, ...args); paths.set(fd, String(file)); return fd; };
  fs.closeSync = fd => { paths.delete(fd); return original.close(fd); };
  fs.fsyncSync = fd => {
    const file = paths.get(fd); beforeSync(file, events);
    const result = original.sync(fd); events.push({ op: "sync", file }); return result;
  };
  fs.renameSync = (from, to) => { const result = original.rename(from, to); events.push({ op: "rename", from, to }); return result; };
  try { return run(events); }
  finally { fs.openSync = original.open; fs.closeSync = original.close; fs.fsyncSync = original.sync; fs.renameSync = original.rename; }
}
export function runInstallSafetyTests({ testNamePattern } = {}) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-install-safety-")));
  let cases = 0;
  const test = (name, run) => {
    if (testNamePattern && !testNamePattern.test(name)) return;
    try { run(); cases++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  };
  const destination = name => path.join(temporary, name, "skills/proofpilot");
  const core = (name, args = {}) => installPackage({ destination: destination(name), coreOnly: true, ...args });
  try {
    const clone = path.join(temporary, "source-clone");
    fs.mkdirSync(clone);
    fs.copyFileSync(path.join(repository, "package.json"), path.join(clone, "package.json"));
    fs.copyFileSync(path.join(repository, "package-lock.json"), path.join(clone, "package-lock.json"));
    fs.cpSync(path.join(repository, "skills"), path.join(clone, "skills"), { recursive: true });
    for (const file of ["cli.js", "install-package.js", "install-skills.js", "sync-profiles.js", "check-release.js"]) write(path.join(clone, "scripts", file), fs.readFileSync(path.join(repository, "scripts", file)));
    const sentinel = path.join(clone, ".git/source-sentinel");
    write(sentinel, "Keep the source repository active.\n");
    const cli = (...args) => spawnSync(process.execPath, [path.join(clone, "scripts/cli.js"), ...args], { cwd: clone, encoding: "utf8" });
    test("relocated Claude configuration selects its exact skills root and refuses its config directory", () => {
      const configured = path.join(temporary, "custom Claude configuration");
      const legacy = path.join(temporary, "legacy Claude configuration");
      const previous = { config: process.env.CLAUDE_CONFIG_DIR, home: process.env.CLAUDE_HOME };
      process.env.CLAUDE_CONFIG_DIR = configured; process.env.CLAUDE_HOME = legacy;
      try {
        assert.equal(defaultSkillRoots("claude").claude, path.join(configured, "skills"));
        const installed = cli("install", "--target", "claude", "--core-only");
        assert.equal(installed.status, 0, installed.stderr);
        assert.equal(fs.existsSync(path.join(configured, "skills/proofpilot/SKILL.md")), true);
        assert.equal(fs.existsSync(path.join(legacy, "skills/proofpilot")), false);
        const invalidRoot = cli("install", "--target", "claude", "--dir", path.join(configured, "proofpilot"), "--core-only");
        assert.equal(invalidRoot.status, 1);
        assert.match(invalidRoot.stderr, /runtime configuration/);
        for (const value of ["relative-claude", "~/claude"]) {
          process.env.CLAUDE_CONFIG_DIR = value;
          assert.throws(() => defaultSkillRoots("claude"), /absolute path/);
          const result = cli("install", "--target", "claude", "--core-only");
          assert.equal(result.status, 1); assert.match(result.stderr, /absolute path/);
        }
        delete process.env.CLAUDE_CONFIG_DIR;
        assert.equal(defaultSkillRoots("claude").claude, path.join(legacy, "skills"));
      } finally {
        for (const [key, value] of [["CLAUDE_CONFIG_DIR", previous.config], ["CLAUDE_HOME", previous.home]]) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    });
    test("Windows install notices quote literal PowerShell paths and name the shell", () => {
      const platform = process.platform, log = console.log, lines = [];
      try {
        Object.defineProperty(process, "platform", { value: "win32", configurable: true });
        console.log = (...values) => lines.push(values.join(" "));
        printInstallNotice({ destination: "C:\\Users\\O'Neil\\My ‘Skills’ $literal`\\proofpilot", profiles: 0, backups: [], dependencies: null });
      } finally { console.log = log; Object.defineProperty(process, "platform", { value: platform, configurable: true }); }
      assert.ok(lines.some(line => line === "Run the following commands in PowerShell:"));
      assert.ok(lines.find(line => line.startsWith("Offline setup status:")).includes("O''Neil"));
      assert.ok(lines.find(line => line.startsWith("Offline setup status:")).includes("‘‘Skills’’ $literal`"));
      assert.ok(!lines.join("\n").includes("'\\''"));
      assert.ok(!lines.join("\n").includes("$proofpilot:"));
    });
    test("a copied core rollback retains ownership for the next forced update", () => {
      const target = destination("core-rollback-ownership");
      core("core-rollback-ownership");
      fs.appendFileSync(path.join(target, "SKILL.md"), "\nUser customization survives rollback.\n");
      const original = fs.readFileSync(path.join(target, "SKILL.md"));
      assert.throws(() => installPackage({ destination: target, coreOnly: true, force: true }, {
        afterCoreActivated: () => { throw new Error("controlled core rollback"); }
      }), /controlled core rollback/);
      assert.deepEqual(fs.readFileSync(path.join(target, "SKILL.md")), original);
      const state = JSON.parse(fs.readFileSync(path.join(path.dirname(target), ".proofpilot-bundle.json"), "utf8"));
      assert.deepEqual(state.core_entries.proofpilot.path_identity, pathIdentity(target));
      assert.equal(fs.existsSync(path.join(path.dirname(target), ".proofpilot-transaction.json")), false);
      const retry = core("core-rollback-ownership", { force: true });
      assert.deepEqual(retry.installed, ["proofpilot"]);
      assert.ok(retry.backups.some(backup => fs.existsSync(path.join(backup, "SKILL.md")) && fs.readFileSync(path.join(backup, "SKILL.md")).equals(original)));
    });
    test("owned forced updates accept plain and balanced quoted names with YAML inline comments", () => {
      for (const [index, name] of ['proofpilot # user note', '"proofpilot" # user note', "'proofpilot'\t# user note"].entries()) {
        const label = `yaml-name-comment-${index}`, target = destination(label);
        core(label);
        const entrypoint = path.join(target, "SKILL.md");
        fs.writeFileSync(entrypoint, fs.readFileSync(entrypoint, "utf8").replace(/^name:.*$/m, `name: ${name}`));
        const customized = fs.readFileSync(entrypoint), identity = pathIdentity(target);
        const result = core(label, { force: true });
        assert.deepEqual(result.installed, ["proofpilot"]);
        assert.ok(result.backups.some(backup => fs.readFileSync(path.join(backup, "SKILL.md")).equals(customized)));
        assert.deepEqual(fs.readFileSync(entrypoint), fs.readFileSync(path.join(source, "SKILL.md")));
        assert.notDeepEqual(pathIdentity(target), identity);
        assert.equal(fs.existsSync(path.join(path.dirname(target), ".proofpilot-transaction.json")), false);
      }
    });
    test("YAML comments do not authorize wrong names, malformed scalars or unowned cores", () => {
      const invalid = ['other-skill # note', '"proofpilot\' # note', "'proofpilot\" # note", '"proofpilot # note"', 'proofpilot#note', 'proofpilot\nname: other-skill'];
      for (const [index, name] of invalid.entries()) {
        const label = `yaml-name-refused-${index}`, target = destination(label);
        core(label);
        const entrypoint = path.join(target, "SKILL.md");
        fs.writeFileSync(entrypoint, fs.readFileSync(entrypoint, "utf8").replace(/^name:.*$/m, `name: ${name}`));
        const customized = fs.readFileSync(entrypoint), identity = pathIdentity(target);
        assert.throws(() => core(label, { force: true }), /unowned existing path/);
        assert.deepEqual(fs.readFileSync(entrypoint), customized);
        assert.deepEqual(pathIdentity(target), identity);
        assert.equal(fs.existsSync(path.join(path.dirname(target), ".proofpilot-transaction.json")), false);
      }
      const target = destination("yaml-name-unowned");
      fs.cpSync(source, target, { recursive: true });
      const entrypoint = path.join(target, "SKILL.md");
      fs.writeFileSync(entrypoint, fs.readFileSync(entrypoint, "utf8").replace(/^name:.*$/m, "name: proofpilot # user note"));
      const customized = fs.readFileSync(entrypoint), identity = pathIdentity(target);
      assert.throws(() => core("yaml-name-unowned", { force: true }), /unowned existing path/);
      assert.deepEqual(fs.readFileSync(entrypoint), customized);
      assert.deepEqual(pathIdentity(target), identity);
    });
    if (process.platform !== "win32") test("Windows dangling managed core and profile links recover without following the old checkout", () => {
      const sourceA = path.join(temporary, "disappearing-source");
      fs.cpSync(clone, sourceA, { recursive: true });
      const target = destination("windows-dangling-links");
      const worker = path.join(temporary, "windows-dangling-links.mjs");
      write(worker, `import fs from 'node:fs'; import {pathToFileURL} from 'node:url';\n` +
        `const a=await import(pathToFileURL(${JSON.stringify(path.join(sourceA, "scripts/install-package.js"))}));\n` +
        `const target=${JSON.stringify(target)};a.installPackage({destination:target,coreOnly:true,profiles:true,mode:'symlink'});\n` +
        `fs.rmSync(${JSON.stringify(sourceA)},{recursive:true,force:true});\n` +
        `const b=await import(pathToFileURL(${JSON.stringify(path.join(clone, "scripts/install-package.js"))}));\n` +
        `Object.defineProperty(process,'platform',{value:'win32'});let failure;const types=[];const symlink=fs.symlinkSync;fs.symlinkSync=(to,location,type)=>{types.push(type);return symlink(to,location,type);};\n` +
        `try{b.installPackage({destination:target,coreOnly:true,profiles:true,force:true,mode:'copy'},{afterCoreActivated:()=>{throw new Error('controlled dangling rollback');}});}catch(e){failure=e.message;}\n` +
        `console.log(JSON.stringify({failure,types,link:fs.lstatSync(target).isSymbolicLink(),pending:fs.existsSync(${JSON.stringify(path.join(path.dirname(target), ".proofpilot-transaction.json"))})}));\n`);
      const result = spawnSync(process.execPath, [worker], { encoding: "utf8", timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      const data = JSON.parse(result.stdout);
      assert.match(data.failure, /controlled dangling rollback/);
      assert.ok(!data.failure.includes("could not safely recover"), data.failure);
      assert.equal(data.link, true); assert.equal(data.pending, false);
      assert.equal(data.types.filter(type => type === "file").length, 5);
      assert.equal(data.types.filter(type => type === "dir").length, 12);
      assert.ok(data.types.every(type => ["file", "dir"].includes(type)));
    });
    test("profile packaging rejects links and mode drift while ignoring npm metadata", () => {
      const runCheck = () => spawnSync(process.execPath, [path.join(clone, "scripts/sync-profiles.js"), "--check"], { cwd: clone, encoding: "utf8" });
      assert.equal(runCheck().status, 0);
      const mainScript = path.join(clone, "skills/proofpilot/scripts/quality.js");
      const profileScript = path.join(clone, `skills/${profileNames[0]}/scripts/quality.js`);
      fs.rmSync(profileScript);
      fs.linkSync(mainScript, profileScript);
      assert.equal(runCheck().status, 1);
      fs.rmSync(profileScript);
      fs.copyFileSync(mainScript, profileScript);
      fs.chmodSync(profileScript, fs.lstatSync(mainScript).mode & 0o777);
      if (process.platform !== "win32") {
        const profileSkill = path.join(clone, `skills/${profileNames[0]}/SKILL.md`);
        const profileBytes = fs.readFileSync(profileSkill);
        fs.rmSync(profileSkill);
        fs.symlinkSync(path.relative(path.dirname(profileSkill), path.join(clone, "skills/proofpilot/SKILL.md")), profileSkill);
        assert.equal(runCheck().status, 1);
        fs.rmSync(profileSkill);
        fs.writeFileSync(profileSkill, profileBytes);
        fs.chmodSync(profileScript, 0o644);
        assert.equal(runCheck().status, 1);
        fs.chmodSync(profileScript, fs.lstatSync(mainScript).mode & 0o777);
      }
      write(path.join(clone, "skills/proofpilot/AUDIT-NOTES.md"), "must not ship\n");
      assert.equal(runCheck().status, 1);
      fs.rmSync(path.join(clone, "skills/proofpilot/AUDIT-NOTES.md"));
      write(path.join(clone, "scripts/.vscode/settings.json"), "{}\n");
      assert.equal(runCheck().status, 1);
      fs.rmSync(path.join(clone, "scripts/.vscode"), { recursive: true });
      write(path.join(clone, "skills/.DS_Store"), "");
      write(path.join(clone, "skills/proofpilot/references/.DS_Store"), "");
      assert.equal(runCheck().status, 0);
      fs.rmSync(path.join(clone, "skills/.DS_Store"));
      fs.rmSync(path.join(clone, "skills/proofpilot/references/.DS_Store"));
    });
    test("packaging rejects environment files throughout the published trees", () => {
      const runCheck = () => spawnSync(process.execPath, [path.join(clone, "scripts/sync-profiles.js"), "--check"], { cwd: clone, encoding: "utf8" });
      for (const relative of ["skills/proofpilot/agents/.envrc", "skills/proofpilot/references/.envrc", "scripts/.envrc", "docs/nested/.envrc", "examples/nested/.env.private", "scripts/.ENVrc", "skills/proofpilot/references/.npmignore", "skills/proofpilot/references/.gitignore", "docs/nested/AUDIT-NOTES.md"]) {
        const file = path.join(clone, relative);
        write(file, "SYNTHETIC_TEST_VALUE=do-not-package\n");
        try {
          const result = runCheck();
          assert.equal(result.status, 1, `${relative} must stop prepack`);
          assert.match(result.stderr, /local build or audit artifact would be published/);
        } finally { fs.rmSync(file); }
      }
      assert.equal(runCheck().status, 0);
    });
    test("fresh clone core-only install does not require Ajv", () => {
      assert.equal(fs.existsSync(path.join(clone, "node_modules")), false);
      const result = cli("install", "--target", "codex", "--dir", destination("fresh-clone"), "--core-only");
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.existsSync(path.join(destination("fresh-clone"), "scripts/connection-helper.js")));
    });
    test("source and its ancestors/descendants cannot be moved with force", () => {
      for (const target of [clone, path.join(clone, "skills"), temporary]) {
        const result = cli("install", "--target", "codex", "--dir", target, "--core-only", "--profiles", "--force");
        assert.equal(result.status, 1);
        assert.match(result.stderr, /canonical source/);
        assert.equal(fs.readFileSync(sentinel, "utf8"), "Keep the source repository active.\n");
      }
    });
    test("release preparation rejects package and taxonomy version drift before packing", () => {
      const file = path.join(clone, "package.json");
      const original = fs.readFileSync(file);
      try {
        fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original), version: "9.9.9" }));
        const result = spawnSync(process.execPath, [path.join(clone, "scripts/check-release.js")], { encoding: "utf8" });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /versions must agree/);
      } finally { fs.writeFileSync(file, original); }
    });
    test("nearest existing symlink parent cannot hide a source descendant", () => {
      const alias = path.join(temporary, "source-alias");
      fs.symlinkSync(clone, alias, "dir");
      const result = cli("install", "--target", "codex", "--dir", path.join(alias, "absent/proofpilot"), "--core-only", "--force");
      assert.equal(result.status, 1);
      assert.match(result.stderr, /canonical source/);
      assert.equal(fs.existsSync(path.join(clone, "absent")), false);
      assert.ok(fs.existsSync(sentinel));
    });
    test("case-only source alias is rejected on case-insensitive filesystems", () => {
      const alias = path.join(path.dirname(clone), path.basename(clone).toUpperCase());
      if (!fs.existsSync(alias) || !fs.statSync(alias).isDirectory()) return;
      const result = cli("install", "--target", "codex", "--dir", alias, "--core-only", "--force");
      assert.equal(result.status, 1);
      assert.match(result.stderr, /canonical source/);
      const dependencies = cli("dependencies", "--root", path.join(alias, "skills"), "--offline");
      assert.equal(dependencies.status, 1);
      assert.match(dependencies.stderr, /canonical source/);
      assert.equal(fs.readFileSync(sentinel, "utf8"), "Keep the source repository active.\n");
    });
    if (process.platform === "darwin") test("physical aliases share one installation lock", () => {
      const root = path.join(temporary, "firmlink-lock", "skills");
      fs.mkdirSync(root, { recursive: true });
      const alias = path.join("/System/Volumes/Data", fs.realpathSync(root));
      if (!fs.existsSync(alias) || fs.statSync(alias).ino !== fs.statSync(root).ino) return;
      const release = acquireDependencyInstallLock(root);
      try { assert.throws(() => acquireDependencyInstallLock(alias), /already in progress/); }
      finally { release(); }
    });
    test("force refuses a foreign nonempty destination", () => {
      const foreign = path.join(temporary, "foreign", "skills", "unrelated destination");
      const marker = path.join(foreign, "keep.txt");
      write(marker, "foreign content\n");
      assert.throws(() => installPackage({ destination: foreign, coreOnly: true, force: true }), /unowned existing path/);
      assert.equal(fs.readFileSync(marker, "utf8"), "foreign content\n");
      assert.equal(fs.existsSync(path.join(temporary, "foreign", ".proofpilot-backups")), false);
    });
    test("force may replace an empty directory without treating it as managed content", () => {
      const empty = destination("empty-force");
      fs.mkdirSync(empty, { recursive: true });
      const result = core("empty-force", { force: true });
      assert.equal(result.installed.includes("proofpilot"), true);
      assert.equal(fs.existsSync(path.join(empty, "SKILL.md")), true);
    });
    if (typeof process.getuid === "function") test("a group/world-writable skill root is rejected before activation", () => {
      const root = path.dirname(destination("writable-root"));
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      fs.chmodSync(root, 0o777);
      try {
        assert.throws(() => core("writable-root"), /owned by the current user|not writable by other users/);
        assert.equal(fs.existsSync(destination("writable-root")), false);
      } finally { fs.chmodSync(root, 0o700); }
    });
    if (typeof process.getuid === "function") test("new copy and symlink profile trees remain private and reusable under permissive umasks", () => {
      const assertPrivateTree = location => {
        const stat = fs.lstatSync(location);
        if (!stat.isSymbolicLink()) assert.equal(stat.mode & 0o022, 0, `Writable installed path: ${location}`);
        if (stat.isDirectory()) for (const name of fs.readdirSync(location)) assertPrivateTree(path.join(location, name));
      };
      for (const mode of ["copy", "symlink"]) for (const mask of [0o002, 0o000]) {
        const name = `umask-core-${mode}-${mask.toString(8)}`;
        const previous = process.umask(mask);
        try {
          core(name, { profiles: true, mode });
          assertPrivateTree(path.dirname(destination(name)));
          assert.deepEqual(core(name, { mode }).reused.sort(), ["proofpilot", ...profileNames].sort());
        } finally { process.umask(previous); }
      }
    });
    if (typeof process.getuid === "function") test("an unsafe writable ancestor is rejected unless it is sticky", () => {
      const shared = path.join(temporary, "unsafe-ancestor");
      const root = path.join(shared, "skills");
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      fs.chmodSync(shared, 0o777);
      assert.throws(() => installPackage({ destination: path.join(root, "proofpilot"), coreOnly: true }), /unsafe writable or unowned ancestor/);
      assert.equal(fs.existsSync(path.join(root, "proofpilot")), false);
      fs.chmodSync(shared, 0o1777);
      assert.equal(installPackage({ destination: path.join(root, "proofpilot"), coreOnly: true }).installed.includes("proofpilot"), true);
    });
    test("a failed cross-device backup restores the complete active source", () => {
      const root = path.join(temporary, "exdev-report", "skills");
      const active = path.join(root, "proofpilot");
      write(path.join(active, "keep.txt"), "active bytes\n");
      write(path.join(active, "second.txt"), "second active bytes\n");
      const rename = fs.renameSync;
      const copy = fs.copyFileSync;
      let copies = 0;
      fs.renameSync = (from, to) => {
        if (from === active && to.includes(".proofpilot-backups")) {
          const error = new Error("Synthetic EXDEV"); error.code = "EXDEV"; throw error;
        }
        return rename(from, to);
      };
      fs.copyFileSync = (...args) => {
        if (++copies === 2) { const error = new Error("Synthetic cross-device copy failure"); error.code = "EIO"; throw error; }
        return copy(...args);
      };
      try {
        assert.throws(() => backupInstalledPath(active, root), /Synthetic cross-device copy failure/);
      } finally {
        fs.renameSync = rename;
        fs.copyFileSync = copy;
      }
      assert.equal(fs.readFileSync(path.join(active, "keep.txt"), "utf8"), "active bytes\n");
      assert.equal(fs.readFileSync(path.join(active, "second.txt"), "utf8"), "second active bytes\n");
    });
    test("stale state cannot adopt a replacement same-name core skill", () => {
      core("stale-core-owner");
      const target = destination("stale-core-owner");
      const root = path.dirname(target);
      recordCoreIdentity(root, "proofpilot", target);
      const replacement = `${target}-replacement`;
      write(path.join(replacement, "SKILL.md"), "---\nname: proofpilot\ndescription: Personal replacement.\n---\n\nPersonal sentinel.\n");
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(replacement, target);
      assert.throws(() => core("stale-core-owner", { force: true }), /unowned existing path/);
      assert.match(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), /Personal sentinel/);
      assert.equal(fs.existsSync(path.join(temporary, "stale-core-owner/.proofpilot-backups")), false);
    });
    test("force requires every recorded core and profile to retain its declared skill name", () => {
      core("owned-name-core");
      const coreFile = path.join(destination("owned-name-core"), "SKILL.md");
      write(coreFile, "---\nname: my-private-notes\ndescription: Personal replacement.\n---\n\nKeep me.\n");
      assert.throws(() => core("owned-name-core", { force: true }), /unowned existing path/);
      assert.match(fs.readFileSync(coreFile, "utf8"), /my-private-notes/);

      core("owned-name-profile", { profiles: true });
      const profile = path.join(path.dirname(destination("owned-name-profile")), profileNames[0]);
      fs.rmSync(path.join(profile, "SKILL.md"));
      write(path.join(profile, "personal.txt"), "Profile-local personal content.\n");
      assert.throws(() => core("owned-name-profile", { profiles: true, force: true }), /unowned existing path/);
      assert.equal(fs.readFileSync(path.join(profile, "personal.txt"), "utf8"), "Profile-local personal content.\n");
    });
    test("stale state cannot adopt a replacement same-name profile skill", () => {
      core("stale-profile-owner", { profiles: true });
      const root = path.dirname(destination("stale-profile-owner"));
      const name = profileNames[0];
      const target = path.join(root, name);
      recordCoreIdentity(root, name, target);
      const replacement = `${target}-replacement`;
      write(path.join(replacement, "SKILL.md"), `---\nname: ${name}\ndescription: Personal replacement.\n---\n\nPersonal profile sentinel.\n`);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(replacement, target);
      assert.throws(() => core("stale-profile-owner", { profiles: true, force: true }), /unowned existing path|recorded ProofPilot profile.*changed identity/);
      assert.match(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), /Personal profile sentinel/);
    });
    test("an explicit legacy migration preserves and replaces a pre-identity core install", () => {
      core("legacy-core");
      const target = destination("legacy-core");
      const root = path.dirname(target);
      const stateFile = path.join(root, ".proofpilot-bundle.json");
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      delete state.core_entries;
      state.bundle_id = `${state.bundle_id}-previous`;
      fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
      const skillFile = path.join(target, "SKILL.md");
      fs.appendFileSync(skillFile, "\nLegacy customized core.\n");
      assert.throws(() => core("legacy-core", { force: true }), /unowned existing path/);
      const migrated = core("legacy-core", { force: true, adoptLegacyCore: true });
      assert.equal(migrated.backups.length, 1);
      assert.match(fs.readFileSync(path.join(migrated.backups[0], "SKILL.md"), "utf8"), /Legacy customized core/);
      const upgraded = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert.equal(upgraded.core_entries.proofpilot.path_identity.type, "directory");
    });
    test("a second directory declaring the ProofPilot core name is rejected", () => {
      const root = path.join(temporary, "duplicate-core", "skills");
      const original = path.join(root, "proofpilot");
      write(path.join(original, "SKILL.md"), "---\nname: proofpilot\ndescription: Existing manual copy.\n---\n");
      const alternative = path.join(root, "proofpilot-new");
      assert.throws(() => installPackage({ destination: alternative, coreOnly: true }), /another entry declaring name: proofpilot/);
      assert.equal(fs.existsSync(alternative), false);
      assert.match(fs.readFileSync(path.join(original, "SKILL.md"), "utf8"), /Existing manual copy/);
    });
    test("a modern owned core remains replaceable after the bundle id changes", () => {
      const target = destination("bundle-id-upgrade");
      const current = loadDependencyManifest();
      const previous = structuredClone(current);
      previous.bundle_id = `${current.bundle_id}-previous`;
      installPackage({ destination: target, coreOnly: true }, { manifest: previous });
      const skillFile = path.join(target, "SKILL.md");
      fs.appendFileSync(skillFile, "\nPrevious bundle customization.\n");
      const upgraded = installPackage({ destination: target, coreOnly: true, force: true }, { manifest: current });
      assert.equal(upgraded.backups.length, 1);
      assert.match(fs.readFileSync(path.join(upgraded.backups[0], "SKILL.md"), "utf8"), /Previous bundle customization/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(target), ".proofpilot-bundle.json"), "utf8")).bundle_id, current.bundle_id);
    });
    test("installed profiles refresh with the main package even when --profiles is omitted", () => {
      core("profile-refresh", { profiles: true });
      const root = path.dirname(destination("profile-refresh"));
      const changed = path.join(root, profileNames[0], "SKILL.md");
      fs.appendFileSync(changed, "\nPrevious profile release customization.\n");
      const refreshed = core("profile-refresh", { force: true });
      assert.equal(refreshed.profiles, 5);
      assert.equal(refreshed.backups.length, 6);
      assert.ok(refreshed.backups.some(backup => fs.existsSync(path.join(backup, "SKILL.md")) &&
        fs.readFileSync(path.join(backup, "SKILL.md"), "utf8").includes("Previous profile release customization.")));
      assert.doesNotMatch(fs.readFileSync(changed, "utf8"), /Previous profile release customization/);
    });
    test("copy reuse requires exact contents without extra regular files", () => {
      core("extra-regular");
      const extra = path.join(destination("extra-regular"), "personal.txt");
      write(extra, "Personal content.\n");
      assert.throws(() => core("extra-regular"), /different files/);
      assert.equal(fs.readFileSync(extra, "utf8"), "Personal content.\n");
    });
    test("profile reuse refuses unrecorded extra root content", () => {
      core("extra-profile-root", { profiles: true });
      const profile = path.join(path.dirname(destination("extra-profile-root")), profileNames[0]);
      const extra = path.join(profile, "private", "notes.md");
      write(extra, "Personal profile notes.\n");
      assert.throws(() => core("extra-profile-root", { profiles: true }), /different files/);
      assert.equal(fs.readFileSync(extra, "utf8"), "Personal profile notes.\n");
    });
    if (process.platform !== "win32") test("copy reuse requires exact contents without extra symlinks", () => {
      core("extra-symlink");
      const target = destination("extra-symlink");
      const extra = path.join(target, "personal-link");
      fs.symlinkSync("SKILL.md", extra, "file");
      assert.throws(() => core("extra-symlink"), /different files/);
      assert.equal(fs.lstatSync(extra).isSymbolicLink(), true);
    });
    if (process.platform !== "win32") test("a failed symlink-core replacement restores through the durable journal", () => {
      const target = destination("symlink-core-recovery");
      installPackage({ destination: target, coreOnly: true, mode: "symlink" });
      assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
      const symlink = fs.symlinkSync;
      let injected = false;
      fs.symlinkSync = (from, to, type) => {
        if (!injected && to === target) {
          injected = true;
          throw new Error("synthetic symlink activation failure");
        }
        return symlink(from, to, type);
      };
      try {
        assert.throws(() => installPackage({ destination: target, coreOnly: true, mode: "symlink", force: true }), /synthetic symlink activation failure/);
      } finally { fs.symlinkSync = symlink; }
      assert.equal(injected, true);
      assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
      assert.equal(fs.realpathSync(target), fs.realpathSync(source));
      assert.equal(fs.existsSync(path.join(path.dirname(target), ".proofpilot-transaction.json")), false);
      assert.deepEqual(installPackage({ destination: target, coreOnly: true, mode: "symlink" }).reused, ["proofpilot"]);
    });
    test("exclusive symlink publication preserves a late foreign file and the original backup", () => {
      for (const originalExists of [false, true]) {
        const label = `exclusive-symlink-foreign-${originalExists}`, target = destination(label), root = path.dirname(target);
        let original;
        if (originalExists) {
          core(label);
          fs.appendFileSync(path.join(target, "SKILL.md"), "\nOriginal customization must survive a publication collision.\n");
          original = fs.readFileSync(path.join(target, "SKILL.md"));
        }
        const symlink = fs.symlinkSync;
        let inserted = false;
        fs.symlinkSync = (from, to, type) => {
          if (to === target) {
            inserted = true;
            fs.writeFileSync(target, "Foreign editor save must survive symlink publication.\n", { flag: "wx" });
          }
          return symlink(from, to, type);
        };
        try { assert.throws(() => installPackage({ destination: target, coreOnly: true, mode: "symlink", force: originalExists }), /EEXIST/); }
        finally { fs.symlinkSync = symlink; }
        assert.equal(inserted, true);
        assert.equal(fs.lstatSync(target).isFile(), true);
        assert.equal(fs.readFileSync(target, "utf8"), "Foreign editor save must survive symlink publication.\n");
        const journalFile = path.join(root, ".proofpilot-transaction.json"), journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
        assert.equal(journal.actions[0].staged_identity.type, "symlink");
        assert.equal(journal.actions[0].original_exists, originalExists);
        if (originalExists) assert.deepEqual(fs.readFileSync(path.join(journal.actions[0].backup, "SKILL.md")), original);
        else assert.equal(journal.actions[0].backup, null);
        assert.throws(() => recoverPendingInstallation(root), /active_path_ownership_changed/);
        assert.equal(fs.readFileSync(target, "utf8"), "Foreign editor save must survive symlink publication.\n");
        fs.unlinkSync(target);
        assert.equal(recoverPendingInstallation(root).committed, false);
        assert.equal(fs.existsSync(journalFile), false);
        if (originalExists) assert.deepEqual(fs.readFileSync(path.join(target, "SKILL.md")), original);
        else assert.equal(fs.existsSync(target), false);
      }
    });
    test("unsupported exclusive symlink publication refuses safely and leaves copy mode usable", () => {
      const target = destination("exclusive-symlink-unsupported"), symlink = fs.symlinkSync;
      let injected = false;
      fs.symlinkSync = (from, to, type) => {
        if (to === target) {
          injected = true;
          throw Object.assign(new Error("Synthetic symlink capability ENOTSUP"), { code: "ENOTSUP" });
        }
        return symlink(from, to, type);
      };
      try { assert.throws(() => installPackage({ destination: target, coreOnly: true, mode: "symlink" }), /Exclusive symbolic-link publication is unavailable; use copy mode/); }
      finally { fs.symlinkSync = symlink; }
      assert.equal(injected, true);
      assert.equal(fs.existsSync(target), false);
      assert.equal(fs.existsSync(path.join(path.dirname(target), ".proofpilot-transaction.json")), false);
      assert.deepEqual(core("exclusive-symlink-unsupported").installed, ["proofpilot"]);
    });
    if (process.platform !== "win32") test("SIGKILL after exclusive symlink ownership persistence recovers the journal-bound inode", () => {
      const target = destination("exclusive-symlink-killed"), root = path.dirname(target);
      const worker = path.join(temporary, "exclusive-symlink-killed.mjs");
      write(worker, `import fs from "node:fs"; import { installPackage } from ${JSON.stringify(new URL("./install-package.js", import.meta.url).href)};\n` +
        `const target=process.argv[2], unlink=fs.unlinkSync; fs.unlinkSync=location=>{if(String(location).includes(".proofpilot-core-staging-") && fs.lstatSync(location).isSymbolicLink())process.kill(process.pid,"SIGKILL");return unlink(location);};installPackage({destination:target,coreOnly:true,mode:"symlink"});\n`);
      const child = spawnSync(process.execPath, [worker, target], { encoding: "utf8", timeout: 30000 });
      assert.equal(child.signal, "SIGKILL", child.stderr);
      const journalFile = path.join(root, ".proofpilot-transaction.json"), journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
      assert.deepEqual(pathIdentity(target), journal.actions[0].staged_identity);
      assert.equal(fs.readlinkSync(target), source);
      assert.equal(recoverPendingInstallation(root).committed, false);
      assert.equal(fs.existsSync(target), false);
      assert.equal(fs.existsSync(journalFile), false);
    });
    if (process.platform !== "win32") test("SIGKILL before exclusive symlink ownership persistence preserves the unconfirmed link", () => {
      const target = destination("exclusive-symlink-unconfirmed"), root = path.dirname(target);
      const worker = path.join(temporary, "exclusive-symlink-unconfirmed.mjs");
      write(worker, `import fs from "node:fs"; import { installPackage } from ${JSON.stringify(new URL("./install-package.js", import.meta.url).href)};\n` +
        `const target=process.argv[2], symlink=fs.symlinkSync; fs.symlinkSync=(from,to,type)=>{const result=symlink(from,to,type);if(to===target)process.kill(process.pid,"SIGKILL");return result;};installPackage({destination:target,coreOnly:true,mode:"symlink"});\n`);
      const child = spawnSync(process.execPath, [worker, target], { encoding: "utf8", timeout: 30000 });
      assert.equal(child.signal, "SIGKILL", child.stderr);
      const journalFile = path.join(root, ".proofpilot-transaction.json"), journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
      assert.notDeepEqual(pathIdentity(target), journal.actions[0].staged_identity);
      const identity = pathIdentity(target), linkTarget = fs.readlinkSync(target);
      assert.throws(() => recoverPendingInstallation(root), /active_path_ownership_changed/);
      assert.deepEqual(pathIdentity(target), identity);
      assert.equal(fs.readlinkSync(target), linkTarget);
      assert.equal(fs.existsSync(journalFile), true);
    });
    if (process.platform !== "win32") test("force rejects a FIFO skill entry without blocking", () => {
      const target = destination("fifo-force");
      fs.mkdirSync(target, { recursive: true });
      assert.equal(spawnSync("mkfifo", [path.join(target, "SKILL.md")]).status, 0);
      assert.throws(() => core("fifo-force", { force: true }), /unowned existing path/);
      assert.equal(fs.lstatSync(path.join(target, "SKILL.md")).isFIFO(), true);
    });
    if (process.platform !== "win32") test("a FIFO bundle state is rejected without blocking", () => {
      const root = path.join(temporary, "fifo-state", "skills");
      fs.mkdirSync(root, { recursive: true });
      assert.equal(spawnSync("mkfifo", [path.join(root, ".proofpilot-bundle.json")]).status, 0);
      const result = cli("install", "--target", "codex", "--dir", path.join(root, "proofpilot"), "--core-only");
      assert.equal(result.signal, null);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /bundle state.*incompatible|incompatible special file/);
    });
    if (process.platform !== "win32") test("journal-unsafe destination names fail before activation", () => {
      const root = path.join(temporary, "backslash-destination", "skills");
      const unsafe = path.join(root, "proof\\pilot");
      assert.throws(() => installPackage({ destination: unsafe, coreOnly: true }), /journal-safe/);
      assert.equal(fs.existsSync(unsafe), false);
      assert.equal(fs.existsSync(path.join(root, ".proofpilot-transaction.json")), false);
      assert.equal(installPackage({ destination: path.join(root, "proofpilot"), coreOnly: true }).installed.includes("proofpilot"), true);
    });
    if (process.platform !== "win32") test("a symlinked SKILL.md still marks a dependency root as a skill directory", () => {
      const profile = path.join(temporary, "symlink-skill-root", "profile");
      fs.mkdirSync(profile, { recursive: true });
      fs.symlinkSync(path.join(source, "SKILL.md"), path.join(profile, "SKILL.md"));
      assert.throws(() => getDependencyStatus(profile, { helperVersion: () => true }), /dependency root is a skill directory/);
      assert.throws(() => installPackage({ destination: path.join(profile, "proofpilot"), coreOnly: true }), /dependency root is a skill directory/);
      assert.equal(fs.existsSync(path.join(profile, "proofpilot")), false);
    });
    test("reserved destinations fail before helper calls or downloads", () => {
      const root = path.join(temporary, "reserved", "skills");
      for (const name of ["solana-dev", "data", "proofpilot-idea-discovery", "SKILL_ROUTER.md", "Solana-Dev", "Data", "PROOFPILOT-MVP-PLANNER", "ſolana-dev", "SKILL_ROUTER.md", ".proofpilot-staging-custom"]) {
        assert.throws(() => installPackage({ destination: path.join(root, name) }, {
          sourceProvider: () => { throw new Error("Unexpected source download"); }, helperVersion: () => { throw new Error("Unexpected helper call"); }
        }), /reserved/);
      }
      assert.equal(fs.existsSync(root), false);
    });
    test("public CLIs reject ambiguous paths, skill directories and secret-shaped unknown commands", () => {
      const literalTilde = path.join(clone, "~");
      const tildeInstall = cli("install", "--target", "codex", "--dir", "~/.codex/skills/proofpilot", "--core-only");
      assert.equal(tildeInstall.status, 1);
      assert.match(tildeInstall.stderr, /absolute path/);
      assert.equal(fs.existsSync(literalTilde), false);

      for (const value of ["relative/skills", "~/.codex/skills"]) {
        const result = cli("dependencies", "--root", value, "--status");
        assert.equal(result.status, 1);
        assert.match(result.stderr, /absolute skill-root path/);
      }
      const profileCwd = path.join(temporary, "relative-profile-target");
      fs.mkdirSync(profileCwd);
      const relativeProfile = spawnSync(process.execPath, [path.join(clone, "scripts/install-skills.js"), "--target", "claude", "--core-only"],
        { cwd: profileCwd, encoding: "utf8" });
      assert.equal(relativeProfile.status, 1);
      assert.match(relativeProfile.stderr, /absolute path/);
      assert.deepEqual(fs.readdirSync(profileCwd), []);

      const runtimeHome = path.join(temporary, "runtime-config");
      const runtimeRoot = path.join(runtimeHome, "skills");
      const rootAsSkill = spawnSync(process.execPath, [path.join(clone, "scripts/cli.js"), "install", "--target", "codex", "--dir", runtimeRoot, "--core-only"],
        { cwd: clone, env: { ...process.env, CODEX_HOME: runtimeHome }, encoding: "utf8" });
      assert.equal(rootAsSkill.status, 1);
      assert.match(rootAsSkill.stderr, /runtime skill root/);
      assert.equal(fs.existsSync(runtimeRoot), false);

      const relativeHome = spawnSync(process.execPath, [path.join(clone, "scripts/cli.js"), "install", "--target", "codex", "--core-only"],
        { cwd: profileCwd, env: { ...process.env, CODEX_HOME: "relative-codex" }, encoding: "utf8" });
      assert.equal(relativeHome.status, 1);
      assert.match(relativeHome.stderr, /CODEX_HOME must be an absolute path/);
      assert.equal(fs.existsSync(path.join(profileCwd, "relative-codex")), false);

      const nestedRoot = path.join(temporary, "skill-root-confusion", "skills");
      core("skill-root-confusion");
      const nested = cli("dependencies", "--root", path.join(nestedRoot, "proofpilot"), "--status");
      assert.equal(nested.status, 1);
      assert.match(nested.stderr, /skill directory/);

      const secret = "ghp_SYNTHETIC_UNKNOWN_COMMAND_SECRET";
      const unknown = cli(secret);
      assert.equal(unknown.status, 1);
      assert.doesNotMatch(unknown.stderr, new RegExp(secret));
    });
    test("runtime configuration directories and physical aliases cannot become skill roots", () => {
      const runtimeHome = path.join(temporary, "guarded-home");
      const dotfiles = path.join(runtimeHome, "dotfiles", "codex");
      const codexConfig = path.join(runtimeHome, ".codex");
      fs.mkdirSync(dotfiles, { recursive: true, mode: 0o700 });
      fs.symlinkSync(dotfiles, codexConfig, "dir");
      const environment = { ...process.env, HOME: runtimeHome, CODEX_HOME: codexConfig };
      const invocations = [
        [path.join(clone, "scripts/cli.js"), "install", "--target", "codex", "--dir", path.join(dotfiles, "skills"), "--core-only"],
        [path.join(clone, "scripts/cli.js"), "install", "--target", "codex", "--dir", path.join(dotfiles, "proofpilot"), "--core-only"],
        [path.join(clone, "scripts/cli.js"), "install", "--target", "codex", "--dir", path.join(runtimeHome, "proofpilot"), "--core-only"],
        [path.join(clone, "scripts/install-skills.js"), "--target", path.join(runtimeHome, ".claude"), "--core-only", "--copy"],
        [path.join(clone, "scripts/cli.js"), "dependencies", "--root", runtimeHome, "--status"]
      ];
      for (const args of invocations) {
        const result = spawnSync(process.execPath, args, { cwd: clone, env: environment, encoding: "utf8", timeout: 10000 });
        assert.equal(result.signal, null);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /configuration directory|home directory/);
      }
      assert.deepEqual(fs.readdirSync(dotfiles), []);
      assert.equal(fs.existsSync(path.join(runtimeHome, "proofpilot")), false);
      assert.equal(fs.existsSync(path.join(runtimeHome, ".claude")), false);
    });
    test("runtime directories at every depth and project-level configuration roots are rejected", () => {
      const project = path.join(temporary, "project-runtime-guards");
      for (const runtime of [".codex", ".claude", ".agents"]) {
        const configuration = path.join(project, runtime);
        for (let depth = 0; depth <= 4; depth++) {
          const root = path.join(configuration, ...Array.from({ length: depth }, (_, i) => `level-${i}`));
          fs.mkdirSync(root, { recursive: true, mode: 0o700 });
          assert.throws(() => getDependencyStatus(root, { helperVersion: () => false }), /configuration directory/);
          assert.throws(() => installPackage({ destination: path.join(root, "proofpilot"), coreOnly: true }), /configuration directory/);
          assert.equal(fs.existsSync(path.join(root, ".proofpilot-bundle.json")), false);
          assert.equal(fs.existsSync(path.join(root, "proofpilot")), false);
        }
        const ambiguous = cli("install", "--target", "codex", "--dir", path.join(configuration, "skills"), "--core-only");
        assert.equal(ambiguous.status, 1, ambiguous.stderr);
        assert.match(ambiguous.stderr, /runtime skill root|configuration directory/);
        const legitimate = cli("install", "--target", "codex", "--dir", path.join(configuration, "skills/proofpilot"), "--core-only");
        assert.equal(legitimate.status, 0, legitimate.stderr);
      }
    });
    test("reserved entrypoint destination names are rejected before any root mutation", () => {
      for (const name of ["SKILL.md", "skill.md", "Skill.Md"]) {
        const root = path.join(temporary, `reserved-name-${name}`, "skills");
        assert.throws(() => installPackage({ destination: path.join(root, name), coreOnly: true }), /reserved SKILL.md/);
        assert.equal(fs.existsSync(root), false);
      }
    });
    test("core installation falls back to HOME when the UID has no passwd entry", () => {
      const home = path.join(temporary, "no-passwd-home");
      fs.mkdirSync(home, { mode: 0o700 });
      const preload = path.join(temporary, "no-passwd-preload.cjs");
      write(preload, `const os = require("node:os"); os.userInfo = () => { const error = new Error("synthetic passwd lookup failure"); error.code = "ENOENT"; throw error; };\n`);
      const codexHome = path.join(home, ".codex");
      const result = spawnSync(process.execPath, ["--require", preload, path.join(clone, "scripts/cli.js"),
        "install", "--target", "codex", "--core-only"], {
        cwd: clone, env: { ...process.env, HOME: home, CODEX_HOME: codexHome }, encoding: "utf8", timeout: 15000
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(path.join(codexHome, "skills", "proofpilot", "SKILL.md")), true);
    });
    test("offline/update conflict is rejected by APIs and both CLIs", () => {
      const root = path.join(temporary, "flags", "skills");
      assert.throws(() => installPackage({ destination: path.join(root, "proofpilot"), offline: true, updateDependencies: true }), /mutually exclusive/);
      assert.throws(() => installDependencies(root, { offline: true, update: true }), /mutually exclusive/);
      const main = cli("install", "--target", "codex", "--dir", path.join(root, "proofpilot"), "--offline", "--update-dependencies");
      const profiles = spawnSync(process.execPath, [path.join(clone, "scripts/install-skills.js"), "--target", root, "--offline", "--update-dependencies"], { encoding: "utf8" });
      for (const result of [main, profiles]) { assert.equal(result.status, 1); assert.match(result.stderr, /mutually exclusive/); }
      assert.equal(fs.existsSync(root), false);
    });
    test("copy request refuses symlinks and force converts with backups", () => {
      const linked = core("mode", { mode: "symlink", profiles: true });
      assert.equal(linked.mode, "symlink");
      assert.throws(() => core("mode", { mode: "copy", profiles: true }), /installation mode/);
      assert.equal(fs.lstatSync(destination("mode")).isSymbolicLink(), true);
      const copied = core("mode", { mode: "copy", profiles: true, force: true });
      assert.equal(copied.mode, "copy");
      assert.equal(copied.backups.length, 6);
      assert.equal(fs.lstatSync(destination("mode")).isSymbolicLink(), false);
      for (const name of profileNames) assert.equal(fs.lstatSync(path.join(path.dirname(destination("mode")), name, "references")).isSymbolicLink(), false);
    });
    test("copy mode never reuses a symlinked profile root", () => {
      core("profile-root-link", { mode: "copy", profiles: true });
      const root = path.dirname(destination("profile-root-link"));
      const profile = path.join(root, profileNames[0]);
      const identical = path.join(temporary, "identical-profile-copy");
      fs.cpSync(profile, identical, { recursive: true });
      fs.rmSync(profile, { recursive: true });
      fs.symlinkSync(identical, profile, "dir");
      assert.throws(() => core("profile-root-link", { mode: "copy", profiles: true }), /installation mode/);
      assert.equal(fs.lstatSync(profile).isSymbolicLink(), true);
    });
    test("copy mode never reuses a hard-linked profile entry", () => {
      core("profile-hard-link", { mode: "copy", profiles: true });
      const file = path.join(path.dirname(destination("profile-hard-link")), profileNames[0], "SKILL.md");
      fs.rmSync(file);
      const fixture = path.join(temporary, "private-hard-link-skill.md");
      fs.copyFileSync(path.join(repository, "skills", profileNames[0], "SKILL.md"), fixture);
      fs.linkSync(fixture, file);
      assert.throws(() => core("profile-hard-link", { mode: "copy", profiles: true }), /installation mode/);
    });
    test("symlink reuse requires its expected source target", () => {
      core("wrong-target", { mode: "symlink", profiles: true });
      const refs = path.join(path.dirname(destination("wrong-target")), profileNames[0], "references");
      const alternative = path.join(temporary, "identical-unrelated-references");
      fs.cpSync(path.join(source, "references"), alternative, { recursive: true });
      fs.unlinkSync(refs); fs.symlinkSync(alternative, refs, "dir");
      assert.throws(() => core("wrong-target", { mode: "symlink", profiles: true }), /different files/);
      assert.equal(fs.realpathSync(refs), fs.realpathSync(alternative));
    });
    test("ordinary OS and npm metadata does not force core or profile replacement", () => {
      for (const mode of ["copy", "symlink"]) {
        const name = `metadata-${mode}`;
        core(name, { mode, profiles: true });
        const profile = path.join(path.dirname(destination(name)), profileNames[0]);
        for (const metadata of [".DS_Store", "._SKILL.md", ".npmrc", "editor.orig"]) write(path.join(profile, metadata), "metadata\n");
        if (mode === "copy") write(path.join(destination(name), "references", ".DS_Store"), "metadata\n");
        assert.equal(core(name, { mode }).reused.length, 6);
        fs.rmSync(path.join(profile, ".DS_Store"));
        fs.symlinkSync(path.join(source, "SKILL.md"), path.join(profile, ".DS_Store"));
        assert.throws(() => core(name, { mode }), /different files/);
      }
    });
    test("omitting --profiles preserves existing profiles and respects deliberate deletion", () => {
      core("deleted-profile", { profiles: true });
      const root = path.dirname(destination("deleted-profile"));
      fs.rmSync(path.join(root, profileNames[0]), { recursive: true });
      assert.equal(core("deleted-profile").profiles, 4);
      assert.equal(fs.existsSync(path.join(root, profileNames[0])), false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".proofpilot-bundle.json"))).core_entries[profileNames[0]], undefined);
      assert.equal(core("deleted-profile", { profiles: true }).profiles, 5);
      assert.equal(fs.existsSync(path.join(root, profileNames[0])), true);
    });
    test("inode-owned development links can be replaced after their source checkout moved", () => {
      const name = "dangling-owned-links";
      const installed = spawnSync(process.execPath, [path.join(clone, "scripts/install-skills.js"), "--target", path.dirname(destination(name)), "--core-only"], { encoding: "utf8" });
      assert.equal(installed.status, 0, installed.stderr);
      fs.renameSync(path.join(clone, "skills"), path.join(clone, "moved-skills"));
      try {
        const repaired = core(name, { force: true });
        assert.equal(repaired.backups.length, 6);
        assert.equal(repaired.installed.length, 6);
      } finally { fs.renameSync(path.join(clone, "moved-skills"), path.join(clone, "skills")); }
    });
    test("failed staging preserves the working installation before backups", () => {
      core("stage-failure");
      const active = path.join(destination("stage-failure"), "SKILL.md");
      fs.appendFileSync(active, "\nKeep the current customized installation.\n");
      const before = fs.readFileSync(active);
      const copy = fs.cpSync;
      fs.cpSync = (from, to, options) => { if (from === source) throw new Error("Synthetic ENOSPC during staging"); return copy(from, to, options); };
      try { assert.throws(() => core("stage-failure", { force: true }), /Synthetic ENOSPC/); }
      finally { fs.cpSync = copy; }
      assert.deepEqual(fs.readFileSync(active), before);
      assert.equal(fs.existsSync(path.join(temporary, "stage-failure/.proofpilot-backups")), false);
    });
    test("activation failure restores all previously active core/profile entries", () => {
      core("activation-failure", { profiles: true });
      const root = fs.realpathSync(path.dirname(destination("activation-failure")));
      const entries = ["proofpilot", ...profileNames];
      const previous = entries.map(name => {
        const file = path.join(root, name, "SKILL.md"); fs.appendFileSync(file, `\nKeep customized ${name}.\n`);
        return { file, bytes: fs.readFileSync(file) };
      });
      const rename = fs.renameSync;
      let failed = false;
      fs.renameSync = (from, to) => {
        if (!failed && from.includes(".proofpilot-core-staging-") && to === path.join(root, profileNames[1])) { failed = true; throw new Error("Synthetic activation failure"); }
        return rename(from, to);
      };
      try { assert.throws(() => core("activation-failure", { profiles: true, force: true }), /Synthetic activation failure/); }
      finally { fs.renameSync = rename; }
      assert.equal(failed, true);
      for (const item of previous) assert.deepEqual(fs.readFileSync(item.file), item.bytes);
    });
    test("failed restoration reports the surviving exact backup path", () => {
      core("recovery-failure");
      const active = path.join(destination("recovery-failure"), "SKILL.md");
      fs.appendFileSync(active, "\nPreserve in a disclosed recovery path.\n");
      const before = fs.readFileSync(active);
      const rename = fs.renameSync;
      let message = "";
      let restoreFailed = false;
      fs.renameSync = (from, to) => {
        if (to === destination("recovery-failure") && (from.includes(".proofpilot-core-staging-") || path.basename(from).startsWith(".proofpilot-copy-"))) {
          if (path.basename(from).startsWith(".proofpilot-copy-")) restoreFailed = true;
          throw new Error("Synthetic activation/recovery failure");
        }
        return rename(from, to);
      };
      try { core("recovery-failure", { force: true }); assert.fail("Expected controlled recovery failure"); }
      catch (error) { message = error.message; }
      finally { fs.renameSync = rename; }
      assert.equal(restoreFailed, true, "The failure fixture must block the prepared restore publication");
      assert.match(message, /Preserved backup\/recovery paths:/);
      const recovery = JSON.parse(message.slice(message.indexOf("paths: ") + 7));
      assert.equal(recovery[0].destination, destination("recovery-failure"));
      assert.deepEqual(fs.readFileSync(path.join(recovery[0].backup, "SKILL.md")), before);
      const root = path.dirname(destination("recovery-failure"));
      assert.equal(fs.existsSync(path.join(root, ".proofpilot-transaction.json")), true);
      assert.equal(recoverPendingInstallation(root).committed, false);
      assert.deepEqual(fs.readFileSync(active), before);
      assert.deepEqual(fs.readFileSync(path.join(recovery[0].backup, "SKILL.md")), before);
      assert.equal(fs.existsSync(path.join(root, ".proofpilot-transaction.json")), false);
    });
    test("post-core failure prunes the complete transaction-created parent chain", () => {
      const top = path.join(temporary, "nested-parent-cleanup");
      const target = path.join(top, "one", "two", "skills", "proofpilot");
      const state = path.join(path.dirname(target), ".proofpilot-bundle.json");
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (to === state && path.basename(from).startsWith(".proofpilot-state-")) throw new Error("Synthetic post-core state failure");
        return rename(from, to);
      };
      try {
        assert.throws(() => installPackage({ destination: target, coreOnly: true }), /Synthetic post-core state failure/);
      } finally { fs.renameSync = rename; }
      assert.equal(fs.existsSync(top), false);
    });
    test("data ancestor symlink refuses all installation writes and downloads", () => {
      const root = path.join(temporary, "escape", "skills");
      const outside = path.join(temporary, "outside-data");
      fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(root, "data"), "dir");
      assert.throws(() => installDependencies(root, {
        sourceProvider: () => { throw new Error("Unexpected download"); }, helperVersion: () => { throw new Error("Unexpected helper"); }
      }), /symbolic link/);
      assert.deepEqual(fs.readdirSync(outside), []);
      assert.equal(fs.existsSync(path.join(root, "brand-design")), false);
    });
    test("required resource paths cannot traverse outside the skill", () => {
      const invalid = loadDependencyManifest();
      invalid.sources[0].skills[0].required_files = ["../outside.md"];
      const file = path.join(temporary, "invalid-required-files.json"); write(file, JSON.stringify(invalid));
      assert.throws(() => loadDependencyManifest(file), /Invalid/);
    });
    test("offline helper inventory ignores caller package, npmrc, bins and preload", () => {
      const project = path.join(temporary, "caller-project");
      const cache = path.join(temporary, "empty-npm-cache"); fs.mkdirSync(cache);
      const marker = path.join(temporary, "caller-code-ran");
      const preloaded = path.join(temporary, "caller-preload-ran");
      write(path.join(project, "package.json"), JSON.stringify({ private: true, dependencies: { "@colosseum-org/copilot-connect": "0.2.2" } }));
      write(path.join(project, ".npmrc"), "registry=http://127.0.0.1:1\n");
      const packageDir = path.join(project, "node_modules/@colosseum-org/copilot-connect");
      write(path.join(packageDir, "package.json"), JSON.stringify({ name: "@colosseum-org/copilot-connect", version: "0.2.2", bin: { "copilot-connect": "shadow.cjs" } }));
      write(path.join(packageDir, "shadow.cjs"), `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "package-shadow"); console.log("0.2.2");\n`);
      fs.chmodSync(path.join(packageDir, "shadow.cjs"), 0o700);
      const bins = path.join(project, "node_modules/.bin"); fs.mkdirSync(bins);
      fs.symlinkSync("../@colosseum-org/copilot-connect/shadow.cjs", path.join(bins, "copilot-connect"));
      write(path.join(bins, "npx"), `#!/bin/sh\nprintf 'caller-bin' > '${marker.replaceAll("'", "'\\''")}'\nprintf '0.2.2\\n'\n`); fs.chmodSync(path.join(bins, "npx"), 0o700);
      const preload = path.join(project, "preload.cjs"); write(preload, `require("node:fs").writeFileSync(${JSON.stringify(preloaded)}, "preloaded");\n`);
      const previous = process.cwd();
      try {
        process.chdir(project);
        const status = getDependencyStatus(path.join(temporary, "inventory"), { helperCache: cache, env: {
          PATH: `${bins}${path.delimiter}${process.env.PATH}`, NODE_OPTIONS: `--require=${preload}`, NODE_PATH: project,
          INIT_CWD: project, npm_config_registry: "http://127.0.0.1:1", npm_config_userconfig: path.join(project, ".npmrc")
        } });
        assert.equal(status.connection_helper.available_locally, false);
      } finally { process.chdir(previous); }
      assert.equal(fs.existsSync(marker), false);
      assert.equal(fs.existsSync(preloaded), false);
      assert.equal(fs.readFileSync(path.join(project, ".npmrc"), "utf8"), "registry=http://127.0.0.1:1\n");
    });
    test("dependencies CLI requires an explicit root", () => {
      const result = cli("dependencies", "--status");
      assert.equal(result.status, 1);
      assert.match(result.stderr, /requires --root/);
      const help = cli("dependencies", "--help");
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, /--root/);
    });
    if (process.platform !== "win32") test("forced core replacement persists prepared contents and backup names before committing", () => {
      const name = "durable-core-order", active = destination(name), root = path.dirname(active);
      core(name);
      fs.appendFileSync(path.join(active, "SKILL.md"), "\nDurable user customization.\n");
      tracePersistence(events => {
        const result = core(name, { force: true });
        const activation = events.findIndex(event => event.op === "rename" && event.to === active);
        const prepared = events[activation].from;
        const beforeActivation = events.slice(0, activation);
        const assertTreePersisted = (file, staged) => {
          const stat = fs.lstatSync(file);
          if (stat.isSymbolicLink()) return -1;
          const synced = beforeActivation.findIndex(event => event.op === "sync" && event.file === staged);
          assert.ok(synced >= 0, `Unpersisted prepared path: ${staged}`);
          if (stat.isDirectory()) for (const child of fs.readdirSync(file)) {
            assert.ok(assertTreePersisted(path.join(file, child), path.join(staged, child)) < synced, "Prepared children must persist before their directory.");
          }
          return synced;
        };
        assertTreePersisted(active, prepared);
        const backup = events.findIndex(event => event.op === "rename" && event.from === active && event.to === result.backups[0]);
        for (let parent = path.dirname(result.backups[0]); ; parent = path.dirname(parent)) {
          assert.ok(events.slice(0, backup).some(event => event.op === "sync" && event.file === parent), `Unpersisted backup ancestor: ${parent}`);
          if (parent === path.dirname(root)) break;
        }
        const state = events.findIndex(event => event.op === "rename" && event.to === path.join(root, ".proofpilot-bundle.json"));
        const afterBackup = events.slice(backup + 1, activation);
        const backupSync = afterBackup.findIndex(event => event.op === "sync" && event.file === path.dirname(result.backups[0]));
        const removalSync = afterBackup.findIndex(event => event.op === "sync" && event.file === root);
        assert.ok(backupSync >= 0 && removalSync > backupSync, "Backup publication must persist before original disappearance.");
        for (const parent of [root, path.dirname(prepared)]) assert.ok(events.slice(activation + 1, state).some(event => event.op === "sync" && event.file === parent));
        assert.match(fs.readFileSync(path.join(result.backups[0], "SKILL.md"), "utf8"), /Durable user customization/);
      });
    });
    test("prepared-file storage errors preserve the active customized core", () => {
      const name = "durable-core-file-error", active = destination(name);
      core(name); fs.appendFileSync(path.join(active, "SKILL.md"), "\nKeep custom core bytes.\n");
      const bytes = fs.readFileSync(path.join(active, "SKILL.md"));
      let injected = false;
      assert.throws(() => tracePersistence(() => core(name, { force: true }), file => {
        if (!injected && file?.includes(".proofpilot-core-staging-") && file.endsWith(`${path.sep}SKILL.md`)) {
          injected = true; throw Object.assign(new Error("Prepared file storage EIO"), { code: "EIO" });
        }
      }), /Prepared file storage EIO/);
      assert.equal(injected, true);
      assert.deepEqual(fs.readFileSync(path.join(active, "SKILL.md")), bytes);
      assert.equal(fs.existsSync(path.join(path.dirname(active), ".proofpilot-transaction.json")), false);
    });
    if (process.platform !== "win32") test("unsupported directory persistence retains the explicit platform fallback", () => {
      for (const code of ["EINVAL", "ENOTSUP", "EBADF"]) {
        const name = `directory-persistence-${code.toLowerCase()}`;
        let unsupported = 0;
        tracePersistence(() => core(name), file => {
          if (file && fs.lstatSync(file).isDirectory()) {
            unsupported++; throw Object.assign(new Error(`Unsupported directory sync ${code}`), { code });
          }
        });
        assert.ok(unsupported > 0);
        assert.equal(fs.existsSync(path.join(destination(name), "SKILL.md")), true);
      }
    });
    if (process.platform !== "win32") test("backup publication storage errors recover original core bytes without reporting success", () => {
      const name = "durable-core-backup-error", active = destination(name);
      core(name); fs.appendFileSync(path.join(active, "SKILL.md"), "\nKeep backup publication bytes.\n");
      const bytes = fs.readFileSync(path.join(active, "SKILL.md"));
      let injected = false;
      assert.throws(() => tracePersistence(() => core(name, { force: true }), (file, events) => {
        const publication = events.find(event => event.op === "rename" && event.from === active && String(event.to).includes(".proofpilot-backups"));
        if (!injected && publication && file === path.dirname(publication.to)) {
          injected = true; throw Object.assign(new Error("Backup publication storage EIO"), { code: "EIO" });
        }
      }), /Backup publication storage EIO/);
      assert.equal(injected, true);
      assert.deepEqual(fs.readFileSync(path.join(active, "SKILL.md")), bytes);
      assert.equal(fs.existsSync(path.join(path.dirname(active), ".proofpilot-transaction.json")), false);
    });
    return { cases };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) console.log(`Installation safety tests passed: ${runInstallSafetyTests().cases} cases.`);
