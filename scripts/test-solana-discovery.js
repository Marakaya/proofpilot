import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installDependencies, loadDependencyManifest } from "../skills/proofpilot/scripts/install-dependencies.js";

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), "..");
const cli = path.join(root, "scripts", "cli.js");
const installer = path.join(root, "scripts", "install-skills.js");
const isolation = pathToFileURL(path.join(root, "scripts", "test-isolation.js")).href;

export function runSolanaDiscoveryTests() {
  const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-solana-discovery-")));
  let cases = 0;
  try {
    const isolatedHome = path.join(temporaryRoot, "home");
    const project = path.join(temporaryRoot, "project");
    const target = path.join(temporaryRoot, "custom skills");
    const configDir = path.join(temporaryRoot, "config");
    const binDir = path.join(temporaryRoot, "bin");
    const networkMarker = path.join(temporaryRoot, "network-attempt");
    for (const directory of [isolatedHome, project, binDir]) fs.mkdirSync(directory, { mode: 0o700 });
    for (const directory of [".codex", ".agents", ".claude", ".config", ".kaggle"]) {
      fs.mkdirSync(path.join(isolatedHome, directory), { mode: 0o700 });
    }
    const preload = path.join(temporaryRoot, "isolate.cjs");
    fs.writeFileSync(preload, [
      'const denied = () => { throw new Error("Unexpected network call in capability discovery"); };',
      'globalThis.fetch = denied;',
      'require("node:http").request = require("node:http").get = denied;',
      'require("node:https").request = require("node:https").get = denied;',
      'require("node:net").Socket.prototype.connect = denied;'
    ].join("\n"));
    fs.writeFileSync(path.join(binDir, "curl"), `#!/bin/sh\n: > '${networkMarker.replaceAll("'", "'\\''")}'\nexit 95\n`, { mode: 0o700 });
    const env = { PATH: binDir, HOME: isolatedHome, USERPROFILE: isolatedHome,
      CODEX_HOME: path.join(isolatedHome, ".codex"), CLAUDE_HOME: path.join(isolatedHome, ".claude"),
      XDG_CONFIG_HOME: path.join(isolatedHome, ".config"), PROOFPILOT_TEST_HOME: isolatedHome,
      NODE_OPTIONS: `--import=${isolation} --require ${JSON.stringify(preload)}`, PROOFPILOT_CONFIG_DIR: configDir };
    const run = (script, args = [], expectedStatus = 0, cwd = project) => {
      const result = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8", timeout: 15000 });
      assert.ifError(result.error);
      assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
      return result;
    };
    const discovery = (directory, args = ["--capabilities"]) =>
      JSON.parse(run(path.join(directory, "scripts", "discover-sources.js"), args).stdout);
    const developmentSkill = (output, name) => output.solana_development.skills.find(item => item.id === name);
    const addSkill = (directory, name) => {
      const destination = path.join(directory, name, "SKILL.md");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, `---\nname: ${name}\ndescription: Synthetic discovery fixture only\n---\n`);
      return destination;
    };

    const destination = path.join(target, "proofpilot");
    const installed = run(cli, ["install", "--target", "codex", "--dir", destination, "--core-only"]);
    const fresh = discovery(destination);
    assert.ok(fresh.solana_development, "Fresh installation does not describe Solana development support");
    assert.equal(fresh.solana_development.guidance_bundled, true);
    assert.equal(fresh.solana_development.implementations_bundled, false);
    assert.ok(developmentSkill(fresh, "solana-dev"), "Official development skill is absent from discovery");
    assert.ok(fresh.solana_development.skills.every(item => item.status === "not_found" && item.skill_file === null),
      "A fresh ProofPilot installation must not claim separate development skills are installed");
    assert.deepEqual(fresh.solana_new.installed_skills, {});
    assert.equal(Object.hasOwn(fresh, "credentials"), false, "Capability-only inventory must not inspect credentials");
    assert.equal(fs.existsSync(configDir), false, "Inventory started onboarding or wrote setup state");
    assert.ok(installed.stdout.includes("--capabilities"), "Installer omits its offline capability check");
    cases++;

    const siblingSkill = addSkill(target, "solana-dev");
    const withSibling = discovery(destination);
    assert.equal(developmentSkill(withSibling, "solana-dev").status, "installed");
    assert.equal(developmentSkill(withSibling, "solana-dev").skill_file, siblingSkill,
      "Discovery missed a sibling in a custom installation root");
    assert.equal(withSibling.solana_new.installed_skills["solana-dev"], undefined,
      "The official developer skill must not be mislabeled as a solana.new journey skill");
    cases++;

    const projectSkill = addSkill(path.join(project, ".agents", "skills"), "solana-dev");
    assert.equal(developmentSkill(discovery(destination), "solana-dev").skill_file, projectSkill,
      "Project-local skill should take precedence over a global/sibling copy");
    cases++;

    const explicitRoot = path.join(temporaryRoot, "explicit skills");
    const explicitSkill = addSkill(explicitRoot, "solana-dev");
    assert.equal(developmentSkill(discovery(destination, ["--root", explicitRoot, "--capabilities"]), "solana-dev").skill_file, explicitSkill,
      "An explicit --root is checked before project-local roots");
    const emptyExplicitRoot = path.join(temporaryRoot, "empty explicit skills");
    fs.mkdirSync(emptyExplicitRoot);
    assert.equal(developmentSkill(discovery(destination, ["--root", emptyExplicitRoot, "--capabilities"]), "solana-dev").skill_file, projectSkill,
      "Project-local roots remain the fallback when the explicit --root lacks a skill");
    cases++;

    const globalRoot = path.join(isolatedHome, ".codex", "skills");
    const globalSkill = addSkill(globalRoot, "review-and-iterate");
    const defaultOutput = discovery(destination, []);
    assert.equal(developmentSkill(defaultOutput, "review-and-iterate").skill_file, globalSkill);
    assert.equal(defaultOutput.solana_new.installed_skills["review-and-iterate"].skill_file, globalSkill,
      "Legacy discovery consumers must retain the installed journey skill map");
    const { colosseum_copilot_connection_stored: connectionStored, colosseum_copilot_connection_status: connectionStatus,
      colosseum_copilot_connection_reason: connectionReason, ...optionalCredentials } = defaultOutput.credentials;
    assert.equal(connectionStored, null, "A home without a prepared helper cannot establish connection presence");
    assert.equal(connectionStatus, "helper_missing");
    assert.equal(typeof connectionReason, "string");
    assert.ok(Object.values(optionalCredentials).every(value => typeof value === "boolean"));
    cases++;

    const relocatedClaude = path.join(temporaryRoot, "relocated Claude config");
    const legacyClaude = path.join(temporaryRoot, "legacy Claude config");
    const relocatedSkill = addSkill(path.join(relocatedClaude, "skills"), "debug-program");
    const legacySkill = addSkill(path.join(legacyClaude, "skills"), "debug-program");
    env.CLAUDE_CONFIG_DIR = relocatedClaude; env.CLAUDE_HOME = legacyClaude;
    assert.equal(developmentSkill(discovery(destination), "debug-program").skill_file, relocatedSkill);
    cases++;
    for (const value of ["relative-config", "~/claude"]) {
      env.CLAUDE_CONFIG_DIR = value;
      const refused = run(path.join(destination, "scripts", "discover-sources.js"), ["--capabilities"], 1);
      assert.match(refused.stderr, /absolute path/);
      cases++;
    }
    delete env.CLAUDE_CONFIG_DIR;
    assert.equal(developmentSkill(discovery(destination), "debug-program").skill_file, legacySkill);
    delete env.CLAUDE_HOME;
    cases++;

    // CODEX_HOME follows the same absolute-override rule: a relative or ~ value
    // would otherwise select a different inventory root for each caller directory.
    const otherProject = path.join(temporaryRoot, "other project");
    fs.mkdirSync(otherProject);
    const relocatedCodex = path.join(temporaryRoot, "relocated Codex home");
    const relocatedCodexSkill = addSkill(path.join(relocatedCodex, "skills"), "deploy-to-mainnet");
    env.CODEX_HOME = relocatedCodex;
    for (const cwd of [project, otherProject]) {
      const relocatedOutput = JSON.parse(run(path.join(destination, "scripts", "discover-sources.js"), ["--capabilities"], 0, cwd).stdout);
      assert.equal(developmentSkill(relocatedOutput, "deploy-to-mainnet").skill_file, relocatedCodexSkill,
        "An absolute CODEX_HOME must select the same skill root from every working directory");
      assert.ok(relocatedOutput.skill_roots_checked.includes(path.join(relocatedCodex, "skills")));
      assert.equal(relocatedOutput.skill_roots_checked.includes(globalRoot), false, "An explicit CODEX_HOME replaces the default Codex root");
      assert.ok(relocatedOutput.skill_roots_checked.every(entry => path.isAbsolute(entry)), "Inventory roots must be absolute");
    }
    cases++;
    for (const value of ["relative-codex", "~/.codex", "~"]) {
      env.CODEX_HOME = value;
      for (const cwd of [project, otherProject]) {
        // A same-named directory beside the caller must not become an inventory root.
        addSkill(path.join(cwd, value, "skills"), "deploy-to-mainnet");
        for (const args of [["--capabilities"], []]) {
          const refused = run(path.join(destination, "scripts", "discover-sources.js"), args, 1, cwd);
          assert.match(refused.stderr, /CODEX_HOME must be an absolute path/);
          assert.equal(refused.stdout, "", "A rejected CODEX_HOME must not produce a partial inventory");
        }
      }
      assert.match(run(cli, ["capabilities"], 1).stderr, /CODEX_HOME must be an absolute path/);
      cases++;
    }
    env.CODEX_HOME = "";
    const defaultCodex = discovery(destination);
    assert.equal(developmentSkill(defaultCodex, "review-and-iterate").skill_file, globalSkill,
      "An empty CODEX_HOME keeps the documented ~/.codex/skills default");
    assert.ok(defaultCodex.skill_roots_checked.includes(globalRoot));
    env.CODEX_HOME = path.join(isolatedHome, ".codex");
    cases++;

    const cliOutput = JSON.parse(run(cli, ["capabilities"]).stdout);
    assert.equal(developmentSkill(cliOutput, "solana-dev").skill_file, projectSkill);
    assert.equal(Object.hasOwn(cliOutput, "credentials"), false);
    run(path.join(destination, "scripts", "discover-sources.js"), ["--unknown-option"], 1);
    cases++;

    for (const copy of [false, true]) {
      const profileRoot = path.join(temporaryRoot, copy ? "copied profiles" : "linked profiles");
      const result = run(installer, ["--target", profileRoot, "--core-only", ...(copy ? ["--copy"] : [])]);
      assert.ok(result.stdout.includes("--capabilities"));
      const profileSkill = addSkill(profileRoot, "scaffold-project");
      for (const name of ["proofpilot", "proofpilot-mvp-planner", "proofpilot-readiness-review"]) {
        const output = discovery(path.join(profileRoot, name));
        assert.equal(developmentSkill(output, "scaffold-project").skill_file, profileSkill,
          "Profile discovery missed skills beside the invoked copied/symlinked profile");
      }
      cases++;
    }

    // Use the real dependency installer with local synthetic locked sources so
    // preserved originals and managed state have the production layout.
    const manifest = loadDependencyManifest();
    const sources = path.join(temporaryRoot, "local sources");
    const write = (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    for (const source of manifest.sources) {
      const sourceRoot = path.join(sources, source.id);
      for (const skill of source.skills) {
        for (const file of skill.required_files) write(path.join(sourceRoot, skill.path, file), `Synthetic resource ${file}\n`);
        write(path.join(sourceRoot, skill.path, "SKILL.md"),
          `---\nname: ${skill.id}\ndescription: Synthetic support fixture\nmetadata:\n  version: 2.0.0\n---\n\n# ${skill.id}\n`);
      }
      for (const asset of source.assets) {
        if (asset.required_files) {
          for (const file of asset.required_files) write(path.join(sourceRoot, asset.path, file),
            file.endsWith(".json") ? '{"fixture":true}\n' : `# Synthetic ${file}\n`);
        } else write(path.join(sourceRoot, asset.path), "Synthetic support resource\n");
      }
      if (source.license_path) write(path.join(sourceRoot, source.license_path), "Synthetic fixture license\n");
    }
    const knowledgeFile = "01-what-and-why-solana.md";
    write(path.join(sources, "solana-new", "skills/data/solana-knowledge", knowledgeFile),
      "[Security](~/.claude/skills/data/guides/security-checklist.md)\n");
    write(path.join(sources, "solana-new", "skills/data/colosseum/copilot-api.json"),
      '{"openapi":"3.1.1","servers":[{"url":"https://copilot.colosseum.com/api/v1"}]}\n');
    const fullRoot = path.join(temporaryRoot, "managed full skills");
    const installedBundle = installDependencies(fullRoot, { manifest,
      sourceProvider: source => path.join(sources, source.id), helperVersion: () => true });
    assert.equal(installedBundle.complete, true);
    const fullDiscovery = () => discovery(destination, ["--root", fullRoot, "--capabilities"]);
    const complete = fullDiscovery();
    assert.equal(complete.support_bundle.installation_mode, "full");
    assert.equal(complete.support_bundle.guidance_complete, true);
    assert.deepEqual(complete.path_issues, []);
    for (const id of ["solana_knowledge", "colosseum"]) {
      const data = complete.solana_new.shared_data[id];
      assert.ok(fs.lstatSync(path.join(data.path, ".proofpilot-upstream")).isDirectory());
      assert.equal(data.files.includes(".proofpilot-upstream"), false);
    }
    assert.ok(complete.solana_new.shared_data.solana_knowledge.files.includes(knowledgeFile));
    assert.ok(complete.solana_new.shared_data.colosseum.files.includes("copilot-api.json"));
    cases++;

    const knowledge = path.join(fullRoot, "data/solana-knowledge");
    const sidecar = path.join(knowledge, ".proofpilot-upstream");
    const original = path.join(sidecar, `${knowledgeFile}.txt`);
    const savedSidecar = path.join(temporaryRoot, "saved valid sidecar");
    fs.cpSync(sidecar, savedSidecar, { recursive: true });
    const resetSidecar = () => {
      fs.rmSync(sidecar, { recursive: true, force: true });
      fs.cpSync(savedSidecar, sidecar, { recursive: true });
    };
    const invalidMetadata = (prepare, issuePath, status) => {
      resetSidecar();
      prepare();
      const output = fullDiscovery();
      assert.ok(output.path_issues.some(issue => issue.path === issuePath && issue.status === status),
        `Missing ${status} diagnostic for ${issuePath}: ${JSON.stringify(output.path_issues)}`);
      assert.ok(output.solana_new.shared_data.solana_knowledge.files.includes(knowledgeFile));
      cases++;
    };
    write(path.join(sidecar, ".DS_Store"), "Synthetic ordinary OS metadata\n");
    assert.deepEqual(fullDiscovery().path_issues, []);
    cases++;
    invalidMetadata(() => { fs.rmSync(sidecar, { recursive: true }); write(sidecar, "Wrong reserved-path type\n"); }, sidecar, "not_directory");
    invalidMetadata(() => { fs.rmSync(sidecar, { recursive: true }); fs.symlinkSync(savedSidecar, sidecar); }, sidecar, "symlink");
    invalidMetadata(() => { fs.rmSync(original); fs.symlinkSync(path.join(knowledge, knowledgeFile), original); }, original, "symlink");
    const malformedBackup = path.join(sidecar, "unexpected.md");
    invalidMetadata(() => write(malformedBackup, "Not a preserved .txt original\n"), malformedBackup, "invalid_metadata");
    const orphanBackup = path.join(sidecar, "missing-content.md.txt");
    invalidMetadata(() => write(orphanBackup, "No corresponding installed content\n"), orphanBackup, "invalid_metadata");
    invalidMetadata(() => write(original, Buffer.from([0xff, 0xfe])), original, "invalid_metadata");
    invalidMetadata(() => { fs.rmSync(sidecar, { recursive: true }); fs.mkdirSync(sidecar); }, sidecar, "invalid_metadata");
    invalidMetadata(() => { fs.rmSync(original); fs.mkdirSync(original); }, original, "invalid_metadata");

    resetSidecar();
    const unreadablePreload = path.join(temporaryRoot, "unreadable-sidecar.cjs");
    write(unreadablePreload, [
      'const fs = require("node:fs"); const open = fs.openSync;',
      `fs.openSync = (file, ...args) => { if (file === ${JSON.stringify(original)}) { const error = new Error("Synthetic EACCES"); error.code = "EACCES"; throw error; } return open(file, ...args); };`,
      'require("node:module").syncBuiltinESMExports();'
    ].join("\n"));
    const normalPreloads = env.NODE_OPTIONS;
    try {
      env.NODE_OPTIONS += ` --require ${JSON.stringify(unreadablePreload)}`;
      const unreadable = fullDiscovery();
      assert.ok(unreadable.path_issues.some(issue => issue.path === original && issue.status === "unreadable"));
      cases++;
    } finally { env.NODE_OPTIONS = normalPreloads; }
    resetSidecar();

    const unexpectedDirectories = [".notes", ".proofpilot-extra"].map(name => path.join(knowledge, name));
    for (const directory of unexpectedDirectories) fs.mkdirSync(directory);
    write(path.join(knowledge, ".ordinary-hidden-file"), "Synthetic available content\n");
    const unexpected = fullDiscovery();
    for (const directory of unexpectedDirectories) {
      assert.ok(unexpected.path_issues.some(issue => issue.path === directory && issue.status === "not_file"));
    }
    assert.ok(unexpected.solana_new.shared_data.solana_knowledge.files.includes(".ordinary-hidden-file"));
    for (const directory of unexpectedDirectories) fs.rmSync(directory, { recursive: true });
    cases++;

    const invalidShared = path.join(target, "data/guides");
    fs.mkdirSync(path.dirname(invalidShared), { recursive: true });
    fs.writeFileSync(invalidShared, "Synthetic file instead of guidance directory.\n");
    const invalidSkill = path.join(project, ".agents/skills/brand-design/SKILL.md");
    fs.mkdirSync(invalidSkill, { recursive: true });
    const brokenShared = path.join(target, "data/ideas");
    fs.symlinkSync(path.join(temporaryRoot, "absent-guidance"), brokenShared);
    const collisions = discovery(destination);
    assert.equal(collisions.solana_new.shared_data.guides, undefined);
    assert.equal(collisions.solana_new.shared_data.ideas, undefined);
    assert.equal(collisions.support_bundle.skills.find(item => item.id === "brand-design").status, "not_found");
    assert.ok(collisions.path_issues.some(item => item.path === invalidShared && item.status === "not_directory"));
    assert.ok(collisions.path_issues.some(item => item.path === invalidSkill && item.status === "not_file"));
    assert.ok(collisions.path_issues.some(item => item.path === brokenShared && item.status === "broken_symlink"));
    cases++;

    assert.equal(fs.existsSync(networkMarker), false, "Offline capability discovery attempted an account API call");
    assert.equal(fs.existsSync(configDir), false, "Offline capability discovery changed setup state");
    return { cases };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(filename)) {
  const summary = runSolanaDiscoveryTests();
  console.log(`Solana capability discovery passed: ${summary.cases} isolated scenarios; no account/network setup.`);
}
