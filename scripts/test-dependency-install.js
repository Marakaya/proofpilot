import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { installPackage, profileNames } from "./install-package.js";
import { acquireDependencyInstallLock, addTransactionAction, backupInstalledPath, loadDependencyManifest, getDependencyStatus, installDependencies, legacyCorePathAliases, markCoreOnly, readSkillMetadata, recoverPendingInstallation, runDependencyCli, startTransactionActivation, startTransactionBackup, trustedGitExecutable } from "../skills/proofpilot/scripts/install-dependencies.js";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = loadDependencyManifest();
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const skillText = (id, version = "2.0.0") => `---\nname: ${id}\ndescription: Synthetic test guidance for ${id}.\nmetadata:\n  version: ${version}\n---\n\n# ${id}\n`;
const markOwned = (root, source, skill, token = "a".repeat(64)) => {
  write(path.join(root, skill.id, ".proofpilot-managed.json"), `${JSON.stringify({
    version: 1, bundle_id: manifest.bundle_id, skill_id: skill.id, repo: source.repo, ref: source.ref, token
  })}\n`);
  return token;
};

export function runDependencyInstallTests({ testNamePattern } = {}) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-dependency-tests-")));
  let cases = 0;
  const test = (name, run) => {
    if (testNamePattern && !testNamePattern.test(name)) return;
    try { run(); cases++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  };
  try {
    const sources = path.join(temporary, "sources");
    for (const source of manifest.sources) {
      const root = path.join(sources, source.id);
      for (const skill of source.skills) {
        for (const file of skill.required_files) write(path.join(root, skill.path, file), `Synthetic required resource ${file}\n`);
        write(path.join(root, skill.path, "SKILL.md"), skillText(skill.id));
      }
      for (const asset of source.assets) {
        if (asset.required_files) for (const file of asset.required_files) write(path.join(root, asset.path, file), file.endsWith(".json") ? "{\"fixture\":true}\n" : `Fixture ${file}\n`);
        else write(path.join(root, asset.path), "Shared fixture\n");
      }
      if (source.license_path) write(path.join(root, source.license_path), "MIT fixture copyright preserved\n");
      write(path.join(root, "install.sh"), `#!/bin/sh\ntouch '${path.join(temporary, "unwanted-setup")}'\n`);
    }
    const solana = path.join(sources, "solana-new");
    write(path.join(solana, "skills/build/scaffold-project/SKILL.md"), skillText("scaffold-project") + "[Security](../../data/guides/security-checklist.md)\n[Router](../../SKILL_ROUTER.md)\n\n```bash\ncat ../../data/guides/security-checklist.md\n```\n");
    write(path.join(solana, "skills/launch/create-pitch-deck/references/source.md"), "[Security](../../../data/guides/security-checklist.md)\n[Tone](../../tone-guide.md)\n");
    write(path.join(solana, "skills/SKILL_ROUTER.md"), "[Scaffold](build/scaffold-project/SKILL.md)\n[Colosseum](idea/colosseum-copilot/SKILL.md)\n");
    const rawV1Api = '{\n  "openapi": "3.1.1",\n  "servers": [{ "url": "https://copilot.colosseum.com/api/v1" }],\n  "info": { "version": "1.0.0" }\n}\n';
    write(path.join(solana, "skills/data/colosseum/copilot-api.json"), rawV1Api);
    const calls = [];
    const sourceProvider = source => { calls.push(source.id); return path.join(sources, source.id); };
    let helperCached = false;
    let onlineHelperChecks = 0;
    const helperVersion = (selected, online) => {
      assert.equal(selected.connection_helper.package, "@colosseum-org/copilot-connect@0.2.2");
      if (online) { helperCached = true; onlineHelperChecks++; }
      return helperCached;
    };
    const options = { manifest, sourceProvider, helperVersion };
    const root = path.join(temporary, "full", "skills");
    const destination = path.join(root, "proofpilot");

    test("skill metadata accepts only balanced name scalars and whitespace-separated YAML comments", () => {
      const metadata = path.join(temporary, "metadata-comment", "SKILL.md");
      for (const name of ["proofpilot # note", '"proofpilot" # note', "'proofpilot'\t# note"]) {
        write(metadata, skillText("proofpilot").replace("name: proofpilot", `name: ${name}`).replaceAll("\n", "\r\n"));
        assert.equal(readSkillMetadata(metadata).name, "proofpilot");
      }
      for (const name of ['"proofpilot\' # note', "'proofpilot\" # note", '"proofpilot # note"', "proofpilot#note", "proofpilot\nname: other-skill"]) {
        write(metadata, skillText("proofpilot").replace("name: proofpilot", `name: ${name}`));
        assert.equal(readSkillMetadata(metadata).name, undefined);
      }
      write(metadata, "---\ndescription: No name in the frontmatter.\n---\nname: proofpilot # body only\n");
      assert.equal(readSkillMetadata(metadata).name, undefined);
    });
    test("locked set covers all support workflows", () => {
      const names = manifest.sources.flatMap(source => source.skills.map(skill => skill.id));
      assert.equal(names.length, 36);
      for (const id of ["solana-dev", "colosseum-copilot", "ethglobal-skills", "openai-docs", "scaffold-project", "debug-program", "deploy-to-mainnet", "brand-design", "design-taste", "frontend-design-guidelines", "create-pitch-deck", "submit-to-hackathon"]) assert.ok(names.includes(id));
      assert.equal(manifest.sources[0].skills.some(skill => skill.id === "colosseum-copilot"), false);
    });
    test("custom Claude configuration permits only its exact skill root and validates overrides before mutation", () => {
      const original = process.env.CLAUDE_CONFIG_DIR;
      const originalHome = process.env.CLAUDE_HOME;
      const configuration = path.join(temporary, "custom-claude-configuration");
      try {
        process.env.CLAUDE_CONFIG_DIR = configuration;
        for (const target of [configuration, path.join(configuration, "other"), path.join(configuration, "skills", "nested")]) {
          assert.throws(() => markCoreOnly(target), /exact skills directory/);
          assert.equal(fs.existsSync(target), false);
        }
        markCoreOnly(path.join(configuration, "skills"));
        assert.equal(fs.existsSync(path.join(configuration, "skills", ".proofpilot-bundle.json")), true);
        for (const invalid of ["relative-config", "~/configuration"]) {
          process.env.CLAUDE_CONFIG_DIR = invalid;
          const target = path.join(temporary, "invalid-claude-override", invalid.replaceAll("/", "-"), "skills");
          assert.throws(() => markCoreOnly(target), /CLAUDE_CONFIG_DIR must be an absolute/);
          assert.equal(fs.existsSync(target), false);
        }
        process.env.CLAUDE_CONFIG_DIR = "";
        process.env.CLAUDE_HOME = path.join(temporary, "legacy-custom-claude-configuration");
        assert.throws(() => markCoreOnly(process.env.CLAUDE_HOME), /exact skills directory/);
        markCoreOnly(path.join(process.env.CLAUDE_HOME, "skills"));
        process.env.CLAUDE_HOME = "relative-legacy-config";
        assert.throws(() => markCoreOnly(path.join(temporary, "legacy-invalid-override", "skills")), /CLAUDE_HOME must be an absolute/);
        process.env.CLAUDE_CONFIG_DIR = path.join(temporary, "both-official-claude-configuration");
        process.env.CLAUDE_HOME = path.join(temporary, "both-legacy-claude-configuration");
        for (const configuration of [process.env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_HOME]) {
          assert.throws(() => markCoreOnly(configuration), /exact skills directory/);
          assert.throws(() => markCoreOnly(path.join(configuration, "skills", "nested", ".agents", "skills")), /exact skills directory/);
          assert.equal(fs.existsSync(configuration), false);
          markCoreOnly(path.join(configuration, "skills"));
          assert.equal(fs.existsSync(path.join(configuration, "skills", ".proofpilot-bundle.json")), true);
        }
        process.env.CLAUDE_HOME = "relative-inactive-legacy-config";
        assert.throws(() => markCoreOnly(path.join(temporary, "invalid-both-overrides", "skills")), /CLAUDE_HOME must be an absolute/);
      } finally {
        if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = original;
        if (originalHome === undefined) delete process.env.CLAUDE_HOME; else process.env.CLAUDE_HOME = originalHome;
      }
    });
    test("default main installation includes the full bundle", () => {
      const result = installPackage({ destination }, options);
      assert.equal(result.dependencies.complete, true);
      assert.equal(result.dependencies.installed.length, 36);
      assert.equal(fs.existsSync(path.join(destination, "SKILL.md")), true);
      assert.deepEqual(calls.sort(), manifest.sources.map(source => source.id).sort());
      assert.equal(onlineHelperChecks, 1);
      assert.equal(fs.existsSync(path.join(temporary, "unwanted-setup")), false);
      assert.ok(fs.readFileSync(path.join(root, "solana-dev/UPSTREAM-LICENSE.txt"), "utf8").includes("copyright"));
      assert.ok(fs.existsSync(path.join(root, "data/licenses/solana-new-LICENSE.txt")));
      assert.ok(fs.existsSync(path.join(root, "openai-docs/LICENSE.txt")));
      assert.ok(fs.existsSync(path.join(root, ".proofpilot-upstream/SKILL_ROUTER.md.txt")));
      assert.equal(fs.readFileSync(path.join(root, "data/colosseum/.proofpilot-upstream/copilot-api.json.txt"), "utf8"), rawV1Api);
      assert.equal(fs.readFileSync(path.join(root, "scaffold-project/.proofpilot-upstream/SKILL.md.txt"), "utf8"),
        fs.readFileSync(path.join(solana, "skills/build/scaffold-project/SKILL.md"), "utf8"));
      const state = JSON.parse(fs.readFileSync(path.join(root, ".proofpilot-bundle.json"), "utf8"));
      assert.equal(Object.keys(state.provenance).length, 36);
      assert.ok(Object.values(state.provenance).every(item => /^sha256v3:[0-9a-f]{64}$/.test(item.content_hash)));
      assert.ok(Object.values(state.provenance).every(item => /^sha256v3:[0-9a-f]{64}$/.test(item.source_content_hash) && item.content_basis === "locked_source"));
      assert.ok(Object.values(state.provenance).every(item => /^[0-9a-f]{64}$/.test(item.management_token)));
      assert.equal(state.core_entries.proofpilot.path, "proofpilot");
      assert.equal(state.core_entries.proofpilot.mode, "copy");
      assert.equal(state.core_entries.proofpilot.path_identity.type, "directory");
      assert.ok(Object.values(state.asset_provenance).every(item => item.path_identity?.type === "directory" || item.path_identity?.type === "file"));
      assert.match(state.asset_provenance["SKILL_ROUTER.md"].policy_sidecar_hash, /^sha256v2:[0-9a-f]{64}$/);
    });
    test("core changes require explicit replacement and survive in a backup", () => {
      const file = path.join(destination, "SKILL.md");
      fs.appendFileSync(file, "\nCustom core instructions.\n");
      const changed = fs.readFileSync(file);
      assert.throws(() => installPackage({ destination }, options), /different files/);
      const replaced = installPackage({ destination, force: true }, options);
      assert.equal(replaced.backups.length, 1);
      assert.deepEqual(fs.readFileSync(path.join(replaced.backups[0], "SKILL.md")), changed);
      assert.notDeepEqual(fs.readFileSync(file), changed);
    });
    test("flattened references still resolve", () => {
      const entry = fs.readFileSync(path.join(root, "scaffold-project/SKILL.md"), "utf8");
      assert.ok(entry.includes("](../data/guides/security-checklist.md)"));
      assert.ok(entry.includes("cat ../data/guides/security-checklist.md"));
      const nested = fs.readFileSync(path.join(root, "create-pitch-deck/references/source.md"), "utf8");
      assert.ok(nested.includes("](../../data/guides/security-checklist.md)"));
      assert.ok(nested.includes("](../../tone-guide.md)"));
      const router = fs.readFileSync(path.join(root, "SKILL_ROUTER.md"), "utf8");
      assert.ok(router.includes("](scaffold-project/SKILL.md)"));
      assert.ok(router.includes("](colosseum-copilot/SKILL.md)"));
    });
    test("owned raw Solana guidance relocates router links during policy migration", () => {
      const file = path.join(root, "scaffold-project/SKILL.md");
      fs.writeFileSync(file, skillText("scaffold-project") + "[Router](../../SKILL_ROUTER.md)\n");
      const result = installDependencies(root, { ...options, sourceProvider: () => { throw new Error("Unexpected source fetch"); } });
      assert.equal(result.complete, true);
      const migrated = fs.readFileSync(file, "utf8");
      assert.ok(migrated.includes("](../SKILL_ROUTER.md)"));
      assert.ok(!migrated.includes("](../../SKILL_ROUTER.md)"));
    });
    test("repeat installation preserves customizations and needs no downloads", () => {
      const file = path.join(root, "brand-design/SKILL.md");
      fs.appendFileSync(file, "\nUser customization survives.\n");
      const before = fs.readFileSync(file);
      const result = installPackage({ destination }, { ...options, sourceProvider: () => { throw new Error("Unexpected download"); } });
      assert.equal(result.dependencies.reused.length, 36);
      assert.equal(result.dependencies.installed.length, 0);
      assert.deepEqual(fs.readFileSync(file), before);
      assert.equal(result.dependencies.backups.length, 0);
      assert.equal(onlineHelperChecks, 1);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".proofpilot-bundle.json"), "utf8")).provenance["brand-design"].content_basis, "modified_after_install");
    });
    test("ownership marker metadata does not masquerade as user content changes", () => {
      const markerFile = path.join(root, "design-taste", ".proofpilot-managed.json");
      const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
      marker.bundle_id = `${marker.bundle_id}-previous`;
      fs.writeFileSync(markerFile, `${JSON.stringify(marker, null, 2)}\n`);
      const repeated = installDependencies(root, { ...options,
        sourceProvider: () => { throw new Error("Marker metadata migration must not fetch sources."); } });
      assert.equal(repeated.complete, true);
      const state = JSON.parse(fs.readFileSync(path.join(root, ".proofpilot-bundle.json"), "utf8"));
      assert.equal(state.provenance["design-taste"].content_basis, "locked_source");
      assert.match(state.provenance["design-taste"].content_hash, /^sha256v3:/);
    });
    test("asset ownership rejects a same-shaped foreign replacement and preserves it", () => {
      const asset = path.join(root, "data/guides");
      const held = path.join(temporary, "held-guides");
      fs.renameSync(asset, held);
      fs.cpSync(held, asset, { recursive: true });
      write(path.join(asset, "foreign-sentinel.txt"), "foreign replacement\n");
      try {
        assert.equal(getDependencyStatus(root, options).assets.find(item => item.path === "data/guides").status, "incompatible");
        assert.throws(() => installDependencies(root, options), /not owned/);
        assert.equal(fs.readFileSync(path.join(asset, "foreign-sentinel.txt"), "utf8"), "foreign replacement\n");
      } finally {
        fs.rmSync(asset, { recursive: true, force: true });
        fs.renameSync(held, asset);
      }
    });
    test("an exact copied asset remains owned and refreshes its path identity", () => {
      const asset = path.join(root, "data/guides");
      const held = path.join(temporary, "held-exact-guides");
      const beforeIdentity = fs.lstatSync(asset).ino;
      fs.renameSync(asset, held);
      fs.cpSync(held, asset, { recursive: true, preserveTimestamps: true });
      try {
        assert.notEqual(fs.lstatSync(asset).ino, beforeIdentity);
        assert.equal(getDependencyStatus(root, options).assets.find(item => item.path === "data/guides").status, "installed");
        const repeated = installDependencies(root, { ...options,
          sourceProvider: () => { throw new Error("An exact copied owned asset must not be downloaded."); } });
        assert.equal(repeated.complete, true);
        const state = JSON.parse(fs.readFileSync(path.join(root, ".proofpilot-bundle.json"), "utf8"));
        assert.equal(state.asset_provenance["data/guides"].path_identity.ino, fs.lstatSync(asset, { bigint: true }).ino.toString());
      } finally { fs.rmSync(held, { recursive: true, force: true }); }
    });
    test("repairing a missing file-asset sidecar preserves active customizations", () => {
      const router = path.join(root, "SKILL_ROUTER.md");
      const sidecar = path.join(root, ".proofpilot-upstream", "SKILL_ROUTER.md.txt");
      fs.appendFileSync(router, "\nUser router customization survives.\n");
      fs.rmSync(sidecar);
      const repaired = installDependencies(root, options);
      assert.equal(repaired.complete, true);
      assert.match(fs.readFileSync(router, "utf8"), /User router customization survives/);
      assert.deepEqual(fs.readFileSync(sidecar), fs.readFileSync(path.join(solana, "skills/SKILL_ROUTER.md")));
    });
    test("an owned asset replaced during preparation is preserved and aborts activation", () => {
      const asset = path.join(root, "data/ideas");
      const held = path.join(temporary, "held-ideas");
      const missingRelative = manifest.sources[0].assets.find(item => item.destination === "data/ideas").required_files[0];
      const missing = path.join(asset, missingRelative);
      fs.rmSync(missing);
      let injected = false;
      const racingHelper = (_selected, online) => {
        if (online && !injected) {
          injected = true;
          fs.renameSync(asset, held);
          fs.mkdirSync(asset);
          write(path.join(asset, "foreign-sentinel.txt"), "late replacement\n");
        }
        return online;
      };
      try {
        assert.throws(() => installDependencies(root, { ...options, helperVersion: racingHelper }), /not owned|appeared or changed/);
        assert.equal(fs.readFileSync(path.join(asset, "foreign-sentinel.txt"), "utf8"), "late replacement\n");
      } finally {
        fs.rmSync(asset, { recursive: true, force: true });
        fs.renameSync(held, asset);
        write(missing, fs.readFileSync(path.join(solana, "skills/data/ideas", missingRelative)));
      }
    });
    test("core-only state preserves a complete support bundle and provenance", () => {
      const before = JSON.parse(fs.readFileSync(path.join(root, ".proofpilot-bundle.json"), "utf8"));
      let coreHook = 0;
      markCoreOnly(root, { afterLockAcquired: () => { coreHook++; return "core-hook"; } });
      const marked = JSON.parse(fs.readFileSync(path.join(root, ".proofpilot-bundle.json"), "utf8"));
      assert.equal(coreHook, 1);
      assert.equal(marked.mode, "core_only");
      assert.equal(marked.requested_install_mode, "core_only");
      assert.deepEqual(marked.provenance, before.provenance);
      let offlineHook = 0;
      const result = installDependencies(root, { ...options, offline: true, afterDependenciesActivated: () => { offlineHook++; return "offline-hook"; } });
      assert.equal(offlineHook, 1);
      assert.equal(result.activation_result, "offline-hook");
      assert.equal(result.mode, "full");
      const normalized = JSON.parse(fs.readFileSync(path.join(root, ".proofpilot-bundle.json"), "utf8"));
      assert.equal(normalized.requested_install_mode, "full");
      assert.equal(Object.keys(normalized.provenance).length, 36);
    });
    test("a failing core-only activation hook leaves prior state untouched", () => {
      const stateFile = path.join(root, ".proofpilot-bundle.json");
      const before = fs.readFileSync(stateFile);
      assert.throws(() => markCoreOnly(root, { afterLockAcquired: () => { throw new Error("synthetic core activation failure"); } }), /synthetic/);
      assert.deepEqual(fs.readFileSync(stateFile), before);
    });
    test("an owned dependency with a deleted SKILL.md is repaired from its locked source", () => {
      const skill = path.join(root, "brand-design/SKILL.md");
      fs.rmSync(skill);
      const requested = [];
      const result = installDependencies(root, { ...options, sourceProvider: source => {
        requested.push(source.id); return path.join(sources, source.id);
      } });
      assert.equal(result.complete, true);
      assert.deepEqual(requested, ["solana-new"]);
      assert.equal(readSkillMetadata(skill).name, "brand-design");
    });
    test("partial data is repaired without replacing existing guides", () => {
      const guide = path.join(root, "data/guides/security-checklist.md");
      fs.writeFileSync(guide, "Customized guide.\n");
      const asset = manifest.sources[0].assets.find(asset => asset.destination === "data/ideas");
      const missing = path.join(root, asset.destination, asset.required_files[0]);
      fs.rmSync(missing);
      fs.rmSync(path.join(root, "debug-program"), { recursive: true });
      const requested = [];
      const result = installDependencies(root, { ...options, sourceProvider: source => { requested.push(source.id); return path.join(sources, source.id); } });
      assert.equal(result.complete, true);
      assert.deepEqual(result.installed, ["debug-program"]);
      assert.deepEqual(requested, ["solana-new"]);
      assert.equal(fs.existsSync(missing), true);
      assert.equal(fs.readFileSync(guide, "utf8"), "Customized guide.\n");
    });
    test("a missing upstream license is backfilled before complete status", () => {
      const license = path.join(root, "solana-dev/UPSTREAM-LICENSE.txt");
      fs.rmSync(license);
      assert.equal(getDependencyStatus(root, options).skills.find(item => item.id === "solana-dev").status, "incomplete");
      const requested = [];
      const result = installDependencies(root, { ...options, sourceProvider: source => {
        requested.push(source.id); return path.join(sources, source.id);
      } });
      assert.equal(result.complete, true);
      assert.deepEqual(requested, ["solana-dev"]);
      assert.ok(fs.readFileSync(license, "utf8").includes("copyright"));
    });
    test("offline mode refuses an incomplete set without writes", () => {
      const noDownload = { ...options, sourceProvider: () => { throw new Error("Network forbidden"); } };
      assert.equal(installDependencies(root, { ...noDownload, offline: true }).complete, true);
      const empty = path.join(temporary, "offline-empty");
      assert.throws(() => installDependencies(empty, { ...noDownload, offline: true }), /incomplete/);
      assert.equal(fs.existsSync(empty), false);
    });
    if (typeof process.getuid === "function") test("new full trees remain private and reusable under permissive umasks", () => {
      const assertPrivateTree = location => {
        const stat = fs.lstatSync(location);
        if (!stat.isSymbolicLink()) assert.equal(stat.mode & 0o022, 0, `Writable installed path: ${location}`);
        if (stat.isDirectory()) for (const name of fs.readdirSync(location)) assertPrivateTree(path.join(location, name));
      };
      for (const mask of [0o002, 0o000]) {
        const umaskRoot = path.join(temporary, `umask-full-${mask.toString(8)}`, "skills");
        const previous = process.umask(mask);
        try {
          assert.equal(installDependencies(umaskRoot, options).complete, true);
          assertPrivateTree(umaskRoot);
          assert.equal(installDependencies(umaskRoot, { ...options,
            sourceProvider: () => { throw new Error("A repeated umask install must not fetch sources."); } }).complete, true);
        } finally { process.umask(previous); }
      }
    });
    test("package offline mode activates a missing core inside the durable transaction", () => {
      const offlineRoot = path.join(temporary, "offline-package", "skills");
      installDependencies(offlineRoot, options);
      const offlineDestination = path.join(offlineRoot, "proofpilot");
      const result = installPackage({ destination: offlineDestination, offline: true, profiles: true }, {
        ...options,
        sourceProvider: () => { throw new Error("Offline package installation attempted a source fetch"); }
      });
      assert.equal(result.dependencies.complete, true);
      assert.deepEqual(result.installed.sort(), ["proofpilot", ...profileNames].sort());
      assert.equal(result.profiles, 5);
      assert.equal(fs.existsSync(path.join(offlineDestination, "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(offlineRoot, ".proofpilot-transaction.json")), false);
      const state = JSON.parse(fs.readFileSync(path.join(offlineRoot, ".proofpilot-bundle.json"), "utf8"));
      assert.equal(state.core_entries.proofpilot.path, "proofpilot");
      assert.equal(Object.keys(state.core_entries).length, 6);
    });
    test("network failure preserves existing files and leaves core uninstalled", () => {
      const failed = path.join(temporary, "failed", "skills");
      write(path.join(failed, "personal/SKILL.md"), "Unrelated skill.\n");
      assert.throws(() => installPackage({ destination: path.join(failed, "proofpilot") }, { ...options, sourceProvider: () => { throw new Error("Synthetic network failure"); } }), /network failure/);
      assert.equal(fs.readFileSync(path.join(failed, "personal/SKILL.md"), "utf8"), "Unrelated skill.\n");
      assert.equal(fs.existsSync(path.join(failed, "proofpilot")), false);
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-bundle.json")), false);
    });
    test("a core target that appears after lock acquisition is preserved and aborts the transaction", () => {
      const failed = path.join(temporary, "late-core-collision", "skills");
      const core = path.join(failed, "proofpilot");
      let injected = false;
      assert.throws(() => installPackage({ destination: core }, { ...options, sourceProvider: source => {
        if (!injected) {
          injected = true;
          write(path.join(core, "external.txt"), "created by a non-cooperating process\n");
        }
        return path.join(sources, source.id);
      } }), /changed while waiting|appeared before activation|root appeared or changed/);
      assert.equal(fs.readFileSync(path.join(core, "external.txt"), "utf8"), "created by a non-cooperating process\n");
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-bundle.json")), false);
      assert.equal(fs.existsSync(path.join(failed, "brand-design")), false);
    });
    test("an existing skill root swapped during preparation is preserved and aborts activation", () => {
      const failed = path.join(temporary, "root-swap", "skills");
      const held = path.join(temporary, "root-swap-held");
      write(path.join(failed, "personal/keep.txt"), "original root\n");
      let injected = false;
      assert.throws(() => installDependencies(failed, { ...options, sourceProvider: source => {
        if (!injected) {
          injected = true;
          fs.renameSync(failed, held);
          write(path.join(failed, "external.txt"), "replacement root\n");
        }
        return path.join(sources, source.id);
      } }), /root changed|root ancestry changed/);
      assert.equal(fs.readFileSync(path.join(failed, "external.txt"), "utf8"), "replacement root\n");
      assert.equal(fs.readFileSync(path.join(held, "personal/keep.txt"), "utf8"), "original root\n");
    });
    test("core rollback never deletes a replacement with a different inode", () => {
      const failed = path.join(temporary, "core-rollback-ownership", "skills");
      const core = path.join(failed, "proofpilot");
      const state = path.join(failed, ".proofpilot-bundle.json");
      const link = fs.linkSync;
      let replaced = false;
      // The state commit is an exclusive link from its private holding path.
      fs.linkSync = (from, to) => {
        if (!replaced && to === state && path.basename(path.dirname(from)).startsWith(".proofpilot-commit-state-")) {
          replaced = true;
          fs.rmSync(core, { recursive: true, force: true });
          write(path.join(core, "external.txt"), "replacement owned by another process\n");
          throw new Error("synthetic state commit failure");
        }
        return link(from, to);
      };
      try {
        assert.throws(() => installPackage({ destination: core }, options), /active_path_ownership_changed/);
      } finally { fs.linkSync = link; }
      assert.equal(replaced, true);
      assert.equal(fs.readFileSync(path.join(core, "external.txt"), "utf8"), "replacement owned by another process\n");
      assert.equal(fs.existsSync(state), false);
      assert.equal(fs.existsSync(path.join(failed, "brand-design")), false);
    });
    test("activation failure rolls dependencies and transaction-created parents back", () => {
      const failed = path.join(temporary, "rollback-residue", "nested", "skills");
      assert.throws(() => installDependencies(failed, { ...options, afterDependenciesActivated: () => {
        throw new Error("synthetic activation failure");
      } }), /synthetic activation failure/);
      assert.equal(fs.existsSync(path.join(temporary, "rollback-residue")), false);
    });
    test("destination-filesystem staging failures are recovered by the durable journal", () => {
      const failed = path.join(temporary, "staging-journal", "skills");
      const copy = fs.cpSync;
      let injected = false;
      fs.cpSync = (from, to, copyOptions) => {
        if (!injected && String(to).includes(".proofpilot-staging-")) {
          injected = true;
          throw new Error("synthetic destination staging failure");
        }
        return copy(from, to, copyOptions);
      };
      try { assert.throws(() => installDependencies(failed, options), /synthetic destination staging failure/); }
      finally { fs.cpSync = copy; }
      assert.equal(injected, true);
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-transaction.json")), false);
      assert.equal(fs.existsSync(failed) && fs.readdirSync(failed).some(name => name.startsWith(".proofpilot-staging-")), false);
    });
    if (process.platform !== "win32") test("a killed activation is recovered from the durable transaction journal", () => {
      const failed = path.join(temporary, "killed-transaction", "skills");
      const worker = path.join(temporary, "kill-transaction-worker.mjs");
      const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
      write(worker, `import path from "node:path";\nimport { installDependencies } from ${JSON.stringify(moduleUrl)};\n` +
        `const [root, sources, manifestText] = process.argv.slice(2);\n` +
        `installDependencies(root, { manifest: JSON.parse(manifestText), helperVersion: () => true, ` +
        `sourceProvider: source => path.join(sources, source.id), afterDependenciesActivated: () => process.kill(process.pid, "SIGKILL") });\n`);
      const killed = spawnSync(process.execPath, [worker, failed, sources, JSON.stringify(manifest)], { encoding: "utf8" });
      assert.equal(killed.signal, "SIGKILL");
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-transaction.json")), true);
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-bundle.json")), false);
      fs.chmodSync(failed, 0o777);
      assert.throws(() => recoverPendingInstallation(failed), /owned by the current user|not writable by other users/);
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-transaction.json")), true);
      fs.chmodSync(failed, 0o755);
      const marker = "User edit made after the interrupted activation.\n";
      fs.appendFileSync(path.join(failed, "brand-design/SKILL.md"), marker);
      const pending = getDependencyStatus(failed, { manifest, helperVersion: () => true });
      assert.equal(pending.pending_transaction, true);
      assert.equal(pending.complete, false);
      assert.equal(pending.mode, "recovery_required");
      const recovered = installDependencies(failed, { manifest, helperVersion: () => true, sourceProvider });
      assert.equal(recovered.complete, true);
      assert.ok(recovered.backups.some(backup => fs.existsSync(path.join(backup, "SKILL.md")) &&
        fs.readFileSync(path.join(backup, "SKILL.md"), "utf8").includes(marker.trim())));
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-transaction.json")), false);
      assert.equal(fs.readdirSync(failed).some(name => name.startsWith(".proofpilot-staging-")), false);
    });
    if (process.platform !== "win32") test("a kill after the durable state commit keeps the committed installation", () => {
      const failed = path.join(temporary, "killed-after-state", "skills");
      const worker = path.join(temporary, "kill-after-state-worker.mjs");
      const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
      write(worker, `import path from "node:path";\nimport { installDependencies } from ${JSON.stringify(moduleUrl)};\n` +
        `const [root, sources, manifestText] = process.argv.slice(2);\n` +
        `installDependencies(root, { manifest: JSON.parse(manifestText), helperVersion: () => true, ` +
        `sourceProvider: source => path.join(sources, source.id), afterStateWrite: () => process.kill(process.pid, "SIGKILL") });\n`);
      const killed = spawnSync(process.execPath, [worker, failed, sources, JSON.stringify(manifest)], { encoding: "utf8" });
      assert.equal(killed.signal, "SIGKILL");
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-transaction.json")), true);
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-bundle.json")), true);
      const beforeIdentity = fs.lstatSync(path.join(failed, "brand-design")).ino;
      fs.appendFileSync(path.join(failed, "brand-design/SKILL.md"), "\nEdit after durable commit survives recovery.\n");
      assert.equal(getDependencyStatus(failed, { manifest, helperVersion: () => true }).complete, false);
      const journalRecovery = recoverPendingInstallation(failed);
      assert.equal(journalRecovery.committed, true);
      assert.match(fs.readFileSync(path.join(failed, "brand-design/SKILL.md"), "utf8"), /Edit after durable commit survives recovery/);
      const recovered = installDependencies(failed, { manifest, helperVersion: () => true,
        sourceProvider: () => { throw new Error("A committed recovery must not download sources."); } });
      assert.equal(recovered.complete, true);
      assert.equal(fs.existsSync(path.join(failed, ".proofpilot-transaction.json")), false);
      assert.equal(fs.lstatSync(path.join(failed, "brand-design")).ino, beforeIdentity);
    });
    test("a replayed pre-commit journal cannot roll back a later installation", () => {
      const replayRoot = path.join(temporary, "replayed-journal", "skills");
      let oldJournal;
      installDependencies(replayRoot, { ...options, afterStateWrite: ({ root }) => {
        oldJournal = fs.readFileSync(path.join(root, ".proofpilot-transaction.json"));
      } });
      const customized = path.join(replayRoot, "brand-design", "SKILL.md");
      fs.appendFileSync(customized, "\nCustomization after the captured transaction.\n");
      installDependencies(replayRoot, options);
      fs.writeFileSync(path.join(replayRoot, ".proofpilot-transaction.json"), oldJournal, { mode: 0o600 });
      assert.throws(() => recoverPendingInstallation(replayRoot), /state no longer matches the transaction's starting state/);
      assert.match(fs.readFileSync(customized, "utf8"), /Customization after the captured transaction/);
      assert.equal(fs.existsSync(path.join(replayRoot, ".proofpilot-transaction.json")), true);
    });
    test("a post-commit callback error finalizes as success", () => {
      const committed = path.join(temporary, "post-commit-error", "skills");
      const result = installDependencies(committed, { ...options,
        afterStateWrite: () => { throw new Error("synthetic post-commit observer failure"); } });
      assert.equal(result.complete, true);
      assert.deepEqual(result.warnings, ["The committed installation was finalized after a post-commit error."]);
      assert.equal(fs.existsSync(path.join(committed, ".proofpilot-transaction.json")), false);
      assert.equal(getDependencyStatus(committed, options).complete, true);
    });
    test("rollback preserves a path whose inode changed after activation", () => {
      const failed = path.join(temporary, "rollback-ownership", "skills");
      let replacement;
      assert.throws(() => installDependencies(failed, { ...options, afterDependenciesActivated: ({ plans }) => {
        replacement = plans.find(plan => plan.item.id)?.destination;
        fs.rmSync(replacement, { recursive: true, force: true });
        write(path.join(replacement, "external.txt"), "replacement owned by another transaction\n");
        throw new Error("synthetic concurrent replacement");
      } }), /active_path_ownership_changed/);
      assert.equal(fs.readFileSync(path.join(replacement, "external.txt"), "utf8"), "replacement owned by another transaction\n");
    });
    test("helper failure cannot claim installation success", () => {
      const failed = path.join(temporary, "helper-failed", "skills");
      assert.throws(() => installPackage({ destination: path.join(failed, "proofpilot") }, { ...options, helperVersion: () => false }), /connection helper/);
      assert.equal(fs.existsSync(failed), false);
    });
    test("an absent trusted npm prerequisite remains actionable during helper preparation", () => {
      const failed = path.join(temporary, "helper-npm-unavailable", "skills");
      const cache = path.join(temporary, "helper-npm-unavailable-cache");
      fs.mkdirSync(cache, { mode: 0o700 });
      const realpath = fs.realpathSync, subprocess = childProcess.spawnSync;
      const subprocesses = [];
      fs.realpathSync = (file, ...args) => {
        if (path.basename(String(file)) === "npm-cli.js") throw Object.assign(new Error("Synthetic absent npm"), { code: "ENOENT" });
        return realpath(file, ...args);
      };
      childProcess.spawnSync = (command, args) => {
        subprocesses.push({ command, args });
        return { status: 1, stdout: "", stderr: "ENOTCACHED: synthetic offline lookup\n" };
      };
      syncBuiltinESMExports();
      try {
        assert.throws(() => installDependencies(failed, { manifest, sourceProvider, helperCache: cache }), error =>
          /Could not prepare the official connection helper/.test(error.message) &&
          /preparing it needs the npm CLI installed with the running Node.js/.test(error.message) &&
          /Install or repair npm for this Node.js, then retry/.test(error.message));
        const helperChecks = subprocesses.filter(call => call.command === process.execPath);
        assert.ok(helperChecks.length > 0, "The synthetic offline availability lookup must be exercised.");
        assert.ok(helperChecks.every(({ args }) => args.some(arg => typeof arg === "string" && arg.includes("ENOTCACHED"))),
          "Only synthetic offline lookups may run; the missing prerequisite must stop online preparation.");
      } finally {
        fs.realpathSync = realpath;
        childProcess.spawnSync = subprocess;
        syncBuiltinESMExports();
      }
      assert.equal(fs.existsSync(failed), false);
      assert.deepEqual(fs.readdirSync(cache), []);
    });
    test("damaged managed helper cache stops installation with its path and recovery step and stays untouched", () => {
      const cache = path.join(temporary, "damaged-helper-cache");
      const helperRoot = path.join(cache, "_proofpilot_helpers", "copilot-connect-0.2.2");
      const packageRoot = path.join(helperRoot, "node_modules", "@colosseum-org", "copilot-connect");
      const marker = path.join(temporary, "damaged-installer-helper-ran");
      fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true, mode: 0o700 });
      fs.chmodSync(cache, 0o700);
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
        name: "@colosseum-org/copilot-connect", version: "0.2.2", bin: { "copilot-connect": "src/cli.js" }
      }), { mode: 0o600 });
      fs.writeFileSync(path.join(packageRoot, "src", "cli.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`, { mode: 0o600 });
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
      const target = path.join(temporary, "damaged-helper-install", "skills");
      fs.mkdirSync(target, { recursive: true });
      const noDownload = () => { throw new Error("A rejected helper cache must stop before source downloads"); };
      const pathText = JSON.stringify(helperRoot);
      for (const update of [false, true, false]) {
        const status = getDependencyStatus(target, { manifest, helperCache: cache });
        assert.equal(status.complete, false);
        assert.equal(status.connection_helper.available_locally, false);
        assert.equal(status.connection_helper.cache_untrusted, true);
        assert.equal(status.connection_helper.cache_path, helperRoot);
        assert.ok(path.isAbsolute(status.connection_helper.cache_path));
        assert.match(status.connection_helper.recovery, /move the whole directory aside.*explicitly retry helper preparation/);
        assert.throws(() => installDependencies(target, { manifest, helperCache: cache, sourceProvider: noDownload, update }), error =>
          error.message.startsWith("Could not prepare the official connection helper. The managed connection-helper cache at ") &&
          error.message.includes(pathText) && /Preserve it: confirm that this directory belongs to your account/.test(error.message) &&
          /No download, account login or upstream setup was run\.$/.test(error.message));
        assert.equal(fs.existsSync(marker), false, "The damaged helper bytes executed");
        assert.deepEqual(tree(), before, "Installer refusal removed, repaired or changed the damaged cache");
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-bundle.json")), false);
        assert.equal(manifest.sources.some(source => source.skills.some(skill => fs.existsSync(path.join(target, skill.id)))), false);
      }
      fs.renameSync(helperRoot, `${helperRoot}.quarantine`);
      const quarantined = getDependencyStatus(target, { manifest, helperCache: cache });
      assert.equal(quarantined.connection_helper.available_locally, false);
      assert.equal(quarantined.connection_helper.cache_untrusted, undefined, "An operator-quarantined cache is absent and may be prepared again");
      assert.ok(fs.existsSync(path.join(`${helperRoot}.quarantine`, "node_modules", "@colosseum-org", "copilot-connect", "src", "cli.js")));
      assert.equal(fs.existsSync(marker), false);
    });
    test("V1 connection skill upgrades automatically with a preserved backup", () => {
      const oldRoot = path.join(temporary, "old-colosseum", "skills");
      const oldFile = path.join(oldRoot, "colosseum-copilot/SKILL.md");
      write(oldFile, skillText("colosseum-copilot", "1.2.1") + "Private customization.\n");
      const source = manifest.sources.find(source => source.id === "colosseum-copilot");
      const skill = source.skills.find(skill => skill.id === "colosseum-copilot");
      const token = markOwned(oldRoot, source, skill);
      write(path.join(oldRoot, ".proofpilot-bundle.json"), JSON.stringify({ provenance: {
        "colosseum-copilot": { repo: source.repo, ref: source.ref, management_token: token }
      }, bundle_id: manifest.bundle_id }));
      const before = fs.readFileSync(oldFile);
      assert.equal(getDependencyStatus(oldRoot, options).complete, false);
      const result = installDependencies(oldRoot, options);
      assert.equal(result.complete, true);
      assert.equal(result.backups.length, 1);
      assert.deepEqual(fs.readFileSync(path.join(result.backups[0], "SKILL.md")), before);
      assert.equal(result.backups[0].startsWith(oldRoot + path.sep), false);
    });
    test("a new bundle and pinned ref upgrade owned skills while reused customized skills remain owned", () => {
      const upgradeRoot = path.join(temporary, "release-upgrade", "skills");
      const previousManifest = structuredClone(manifest);
      previousManifest.bundle_id = `${manifest.bundle_id}-previous`;
      previousManifest.sources.find(source => source.id === "colosseum-copilot").ref = "1".repeat(40);
      installDependencies(upgradeRoot, { manifest: previousManifest, helperVersion: () => true, sourceProvider });
      const changingSkill = path.join(upgradeRoot, "colosseum-copilot", "SKILL.md");
      fs.appendFileSync(changingSkill, "\nPrevious-release customization.\n");
      const upgraded = installDependencies(upgradeRoot, { manifest, helperVersion: () => true, sourceProvider });
      assert.equal(upgraded.complete, true);
      assert.ok(upgraded.backups.some(backup => fs.existsSync(path.join(backup, "SKILL.md")) &&
        fs.readFileSync(path.join(backup, "SKILL.md"), "utf8").includes("Previous-release customization.")));
      const state = JSON.parse(fs.readFileSync(path.join(upgradeRoot, ".proofpilot-bundle.json"), "utf8"));
      assert.equal(state.bundle_id, manifest.bundle_id);
      assert.equal(state.provenance["colosseum-copilot"].ref,
        manifest.sources.find(source => source.id === "colosseum-copilot").ref);

      const reused = path.join(upgradeRoot, "brand-design", "SKILL.md");
      fs.appendFileSync(reused, "\nCustomization after the bundle-id migration.\n");
      const repeated = installDependencies(upgradeRoot, { manifest, helperVersion: () => true,
        sourceProvider: () => { throw new Error("A reused owned skill must not be downloaded again."); } });
      assert.equal(repeated.complete, true);
      assert.match(fs.readFileSync(reused, "utf8"), /Customization after the bundle-id migration/);
    });
    test("a symlink dependency collision is never replaced automatically", () => {
      const oldRoot = path.join(temporary, "symlink", "skills");
      const shared = path.join(temporary, "shared-colosseum");
      write(path.join(shared, "SKILL.md"), skillText("colosseum-copilot", "1.2.1"));
      fs.mkdirSync(oldRoot, { recursive: true });
      fs.symlinkSync(shared, path.join(oldRoot, "colosseum-copilot"), "dir");
      const before = fs.readFileSync(path.join(shared, "SKILL.md"));
      assert.throws(() => installDependencies(oldRoot, { ...options, update: true }), /collision/);
      assert.deepEqual(fs.readFileSync(path.join(shared, "SKILL.md")), before);
      assert.equal(fs.lstatSync(path.join(oldRoot, "colosseum-copilot")).isSymbolicLink(), true);
    });
    test("an unrelated folder cannot be replaced implicitly", () => {
      const collision = path.join(temporary, "skill-collision", "skills");
      write(path.join(collision, "solana-dev/SKILL.md"), skillText("unrelated"));
      assert.throws(() => installDependencies(collision, options), /incompatible/);
      assert.equal(fs.existsSync(path.join(collision, "brand-design")), false);
      assert.ok(fs.readFileSync(path.join(collision, "solana-dev/SKILL.md"), "utf8").includes("name: unrelated"));
    });
    test("a compatible same-name personal skill is not adopted, even by update", () => {
      const collision = path.join(temporary, "same-name-personal", "skills");
      const source = manifest.sources.flatMap(source => source.skills.map(skill => ({ source, skill }))).find(item => item.skill.id === "learn");
      for (const file of source.skill.required_files) write(path.join(collision, "learn", file),
        file === "SKILL.md" ? skillText("learn") + "Personal private workflow.\n" : `Personal ${file}\n`);
      const before = fs.readFileSync(path.join(collision, "learn/SKILL.md"));
      let providerCalls = 0;
      assert.throws(() => installDependencies(collision, { ...options, update: true, sourceProvider: () => {
        providerCalls++; throw new Error("must not fetch");
      } }), /not owned/);
      assert.equal(providerCalls, 0);
      assert.deepEqual(fs.readFileSync(path.join(collision, "learn/SKILL.md")), before);
    });
    test("stale provenance cannot adopt a replacement same-name personal skill", () => {
      const collision = path.join(temporary, "stale-provenance", "skills");
      const selected = manifest.sources.flatMap(source => source.skills.map(skill => ({ source, skill }))).find(item => item.skill.id === "learn");
      for (const file of selected.skill.required_files) write(path.join(collision, "learn", file),
        file === "SKILL.md" ? skillText("learn") + "Replacement personal workflow.\n" : `Replacement ${file}\n`);
      write(path.join(collision, ".proofpilot-bundle.json"), JSON.stringify({ bundle_id: manifest.bundle_id, provenance: {
        learn: { repo: selected.source.repo, ref: selected.source.ref, content_hash: `sha256:${"0".repeat(64)}` }
      } }));
      assert.equal(getDependencyStatus(collision, { ...options, helperVersion: () => true }).skills.find(item => item.id === "learn").owned, false);
      let providerCalls = 0;
      assert.throws(() => installDependencies(collision, { ...options, update: true, sourceProvider: () => {
        providerCalls++; throw new Error("must not fetch");
      } }), /not owned/);
      assert.equal(providerCalls, 0);
      assert.ok(fs.readFileSync(path.join(collision, "learn/SKILL.md"), "utf8").includes("Replacement personal workflow"));
    });
    test("asset collisions stop before any support skill changes", () => {
      const collision = path.join(temporary, "collision", "skills");
      write(path.join(collision, "data/guides"), "Unrelated file.\n");
      let providerCalls = 0;
      assert.throws(() => installDependencies(collision, { ...options, sourceProvider: () => {
        providerCalls++; throw new Error("must not fetch");
      } }), /incompatible/);
      assert.equal(providerCalls, 0);
      assert.equal(fs.readFileSync(path.join(collision, "data/guides"), "utf8"), "Unrelated file.\n");
      assert.equal(fs.existsSync(path.join(collision, "brand-design")), false);
    });
    test("source symlinks cannot escape staging", () => {
      const link = path.join(solana, "skills/build/debug-program/escape");
      fs.symlinkSync(path.join(temporary, "full"), link, "dir");
      try { assert.throws(() => installDependencies(path.join(temporary, "unsafe"), options), /symbolic link/); }
      finally { fs.unlinkSync(link); }
    });
    test("reserved ProofPilot service files from a source checkout are rejected before writes", () => {
      for (const [index, relative] of [".proofpilot-managed.json", ".ProofPilot-Managed.json", ".ProofPilot-Upstream/SKILL.md.txt", "Upstream-License.txt"].entries()) {
        const reserved = path.join(solana, "skills/build/debug-program", relative);
        write(reserved, "{}\n");
        const target = path.join(temporary, `reserved-source-${index}`, "skills");
        try { assert.throws(() => installDependencies(target, options), /reserved ProofPilot service path/); }
        finally { fs.rmSync(path.join(solana, "skills/build/debug-program", relative.split("/")[0]), { recursive: true, force: true }); }
        assert.equal(fs.existsSync(target), false);
      }
    });
    test("manifest destinations collide under Unicode case folding", () => {
      const ambiguous = structuredClone(manifest);
      ambiguous.sources[0].assets.push(
        { path: "skills/data/guides", destination: "data/straße", required_files: ["security-checklist.md"] },
        { path: "skills/data/guides", destination: "data/strasse", required_files: ["security-checklist.md"] }
      );
      const target = path.join(temporary, "unicode-manifest", "skills");
      assert.throws(() => installDependencies(target, { ...options, manifest: ambiguous }), /duplicate|Overlapping/);
      assert.equal(fs.existsSync(target), false);
    });
    test("invalid state is reported and blocks mutation before any source fetch", () => {
      const target = path.join(temporary, "invalid-state", "skills");
      write(path.join(target, ".proofpilot-bundle.json"), "{not-json\n");
      const status = getDependencyStatus(target, { ...options, helperVersion: () => true });
      assert.equal(status.state_status, "invalid");
      assert.equal(status.requested_install_mode, "unknown");
      let calls = 0;
      assert.throws(() => installDependencies(target, { ...options, sourceProvider: () => { calls++; throw new Error("must not fetch"); } }), /invalid JSON/);
      assert.equal(calls, 0);
    });
    if (process.platform !== "win32") test("FIFO collisions never block metadata reads or get replaced", () => {
      const collision = path.join(temporary, "fifo-collision", "skills");
      const source = manifest.sources.find(source => source.skills.some(skill => skill.id === "learn"));
      const skillDirectory = path.join(collision, "learn");
      fs.mkdirSync(skillDirectory, { recursive: true });
      assert.equal(spawnSync("mkfifo", [path.join(skillDirectory, "SKILL.md")]).status, 0);
      write(path.join(collision, ".proofpilot-bundle.json"), JSON.stringify({ provenance: {
        learn: { repo: source.repo, ref: source.ref }
      } }));
      assert.equal(getDependencyStatus(collision, { ...options, helperVersion: () => true }).skills.find(item => item.id === "learn").status, "incompatible");
      let providerCalls = 0;
      assert.throws(() => installDependencies(collision, { ...options, sourceProvider: () => {
        providerCalls++; throw new Error("must not fetch");
      } }), /special file/);
      assert.equal(providerCalls, 0);
      assert.equal(fs.lstatSync(path.join(skillDirectory, "SKILL.md")).isFIFO(), true);

      const assetRoot = path.join(temporary, "fifo-asset", "skills");
      const asset = path.join(assetRoot, "data/catalogs/clonable-repos.json");
      fs.mkdirSync(path.dirname(asset), { recursive: true });
      assert.equal(spawnSync("mkfifo", [asset]).status, 0);
      assert.throws(() => installDependencies(assetRoot, { ...options, update: true, sourceProvider: () => {
        providerCalls++; throw new Error("must not fetch");
      } }), /collision/);
      assert.equal(providerCalls, 0);
      assert.equal(fs.lstatSync(asset).isFIFO(), true);
    });
    test("core-only mode performs no helper calls or downloads", () => {
      const only = path.join(temporary, "core-only", "skills");
      const result = installPackage({ destination: path.join(only, "proofpilot"), coreOnly: true }, { sourceProvider: () => { throw new Error("Must not fetch"); }, helperVersion: () => { throw new Error("Must not invoke helper"); } });
      assert.equal(result.dependencies, null);
      assert.equal(JSON.parse(fs.readFileSync(path.join(only, ".proofpilot-bundle.json"))).mode, "core_only");
      assert.equal(fs.existsSync(path.join(only, "solana-dev")), false);
    });
    test("core force ownership is bound to the exact recorded destination", () => {
      const ownedRoot = path.join(temporary, "exact-core-owner", "skills");
      const owned = path.join(ownedRoot, "proofpilot");
      installPackage({ destination: owned, coreOnly: true });
      const personal = path.join(ownedRoot, "personal-copy");
      write(path.join(personal, "SKILL.md"), skillText("proofpilot") + "Personal sentinel.\n");
      assert.throws(() => installPackage({ destination: personal, coreOnly: true, force: true }), /recorded ProofPilot core|unowned existing path/);
      assert.ok(fs.readFileSync(path.join(personal, "SKILL.md"), "utf8").includes("Personal sentinel"));
    });
    test("profile helpers resolve the installed sibling root", () => {
      const profileRoot = path.join(temporary, "profiles", "skills");
      const result = installPackage({ destination: path.join(profileRoot, "proofpilot"), profiles: true, mode: "symlink" }, options);
      assert.equal(result.profiles, 5);
      assert.equal(result.dependencies.skills.length, 36);
      let output = "";
      assert.equal(runDependencyCli(["--status"], { ...options, entrypoint: path.join(profileRoot, "proofpilot-mvp-planner/scripts/install-dependencies.js"), stdout: { write: value => { output += value; } } }), 0);
      assert.equal(JSON.parse(output).root, profileRoot);
      assert.equal(JSON.parse(output).complete, true);
    });
    test("the copied helper rejects an unmanaged _npx cache outside the source repository", () => {
      const helperHome = path.join(temporary, "copied-helper-home");
      const localAppData = path.join(helperHome, "AppData", "Local");
      const cache = process.platform === "win32" ? path.join(localAppData, "npm-cache") : path.join(helperHome, ".npm");
      const helper = path.join(cache, "_npx", "exact", "node_modules", "@colosseum-org", "copilot-connect");
      const marker = path.join(helperHome, "unmanaged-helper-ran");
      write(path.join(helper, "package.json"), JSON.stringify({
        name: "@colosseum-org/copilot-connect", version: "0.2.2", type: "module", bin: { "copilot-connect": "cli.js" }
      }));
      write(path.join(helper, "cli.js"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
      const preload = new URL("./test-isolation.js", import.meta.url).href;
      fs.mkdirSync(helperHome, { recursive: true, mode: 0o700 });
      fs.chmodSync(helperHome, 0o700);
      const result = spawnSync(process.execPath, ["--import", preload, path.join(destination, "scripts/install-dependencies.js"), "--status"], {
        cwd: os.tmpdir(), env: { PATH: path.dirname(process.execPath), HOME: helperHome, USERPROFILE: helperHome, LOCALAPPDATA: localAppData,
          PROOFPILOT_TEST_HOME: helperHome }, encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(marker), false, "An unmanaged helper under the caller-selected npm cache executed");
      assert.equal(typeof JSON.parse(result.stdout).connection_helper.available_locally, "boolean");
      assert.equal(JSON.parse(result.stdout).root, root);
    });
    test("invalid arguments cannot launch installation or echo credentials", () => {
      for (const args of [["--token", "synthetic-do-not-echo"], ["--root"], ["--status", "--update"], ["--update", "--update"]]) {
        let output = "";
        assert.equal(runDependencyCli(args, { sourceProvider: () => { throw new Error("Must not fetch"); }, stdout: { write: value => { output += value; } }, stderr: { write: value => { output += value; } } }), 1);
        assert.ok(!output.includes("synthetic-do-not-echo"));
      }
    });
    test("the root lock excludes a concurrent installer process", () => {
      const lockedRoot = path.join(temporary, "concurrent-lock", "skills");
      const release = acquireDependencyInstallLock(lockedRoot);
      try {
        const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
        const script = `import { installDependencies } from ${JSON.stringify(moduleUrl)};\n` +
          `try { installDependencies(${JSON.stringify(lockedRoot)}, { offline: true }); process.exitCode = 9; }\n` +
          `catch (error) { if (!/already in progress/.test(error.message)) throw error; }\n`;
        const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", timeout: 10000 });
        assert.equal(child.status, 0, child.stderr);
      } finally { release(); }
      const acquiredAfterRelease = acquireDependencyInstallLock(lockedRoot);
      acquiredAfterRelease();
    });
    test("the root lock is atomically published and stale owners are recovered", () => {
      const lockedRoot = path.join(temporary, "atomic-lock", "skills");
      const lockBase = path.join(fs.realpathSync(os.userInfo().homedir), ".proofpilot", "install-locks");
      const before = new Set(fs.existsSync(lockBase) ? fs.readdirSync(lockBase) : []);
      const release = acquireDependencyInstallLock(lockedRoot);
      const created = fs.readdirSync(lockBase).filter(name => !before.has(name));
      assert.equal(created.length, 1);
      const lock = path.join(lockBase, created[0]);
      assert.equal(fs.lstatSync(lock).isFile(), true);
      const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
      assert.equal(owner.pid, process.pid);
      assert.match(owner.token, /^[0-9a-f]{48}$/);
      release();
      assert.equal(fs.existsSync(lock), false);
      fs.writeFileSync(lock, `${JSON.stringify({ ...owner, pid: 2147483647, token: "f".repeat(48) })}\n`, { mode: 0o600 });
      const recovered = acquireDependencyInstallLock(lockedRoot);
      recovered();
      assert.equal(fs.existsSync(lock), false);
    });
    test("two stale-lock reclaimers cannot both acquire the root lock", () => {
      const lockedRoot = path.join(temporary, "stale-lock-race", "skills");
      const lockBase = path.join(fs.realpathSync(os.userInfo().homedir), ".proofpilot", "install-locks");
      const before = new Set(fs.existsSync(lockBase) ? fs.readdirSync(lockBase) : []);
      const initialRelease = acquireDependencyInstallLock(lockedRoot);
      const lock = path.join(lockBase, fs.readdirSync(lockBase).find(name => !before.has(name)));
      const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
      initialRelease();
      fs.writeFileSync(lock, `${JSON.stringify({ ...owner, pid: 2147483647, token: "e".repeat(48) })}\n`, { mode: 0o600 });
      const rename = fs.renameSync;
      let raced = false;
      let releaseA;
      let releaseB;
      let errorA;
      let errorB;
      fs.renameSync = (from, to) => {
        if (!raced && from === lock && String(to).includes(".stale-")) {
          raced = true;
          fs.renameSync = rename;
          try { releaseA = acquireDependencyInstallLock(lockedRoot); }
          catch (error) { errorA = error; }
        }
        return rename(from, to);
      };
      try {
        try { releaseB = acquireDependencyInstallLock(lockedRoot); }
        catch (error) { errorB = error; }
        assert.equal(raced, true);
        assert.equal(Number(Boolean(releaseA)) + Number(Boolean(releaseB)), 1, "Exactly one installer may hold the root lock.");
        assert.match((errorA || errorB)?.message || "", /already in progress/);
        assert.throws(() => acquireDependencyInstallLock(lockedRoot), /already in progress/);
      } finally {
        fs.renameSync = rename;
        releaseB?.(); releaseA?.();
      }
    });
    if (process.platform !== "win32") test("crashed stale-lock reclaimers leave recoverable ownership records", () => {
      const lockedRoot = path.join(temporary, "stale-lock-reclaimer-crash", "skills");
      const lockBase = path.join(fs.realpathSync(os.userInfo().homedir), ".proofpilot", "install-locks");
      const before = new Set(fs.existsSync(lockBase) ? fs.readdirSync(lockBase) : []);
      const initialRelease = acquireDependencyInstallLock(lockedRoot);
      const lock = path.join(lockBase, fs.readdirSync(lockBase).find(name => !before.has(name)));
      const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
      initialRelease();
      fs.writeFileSync(lock, `${JSON.stringify({ ...owner, pid: 2147483647, token: "d".repeat(48) })}\n`, { mode: 0o600 });
      const script = `import fs from "node:fs"; import os from "node:os";\n` +
        `const home = ${JSON.stringify(os.userInfo().homedir)};\n` +
        `const userInfo = os.userInfo; os.homedir = () => home; os.userInfo = options => ({ ...userInfo(options), homedir: home });\n` +
        `const { acquireDependencyInstallLock } = await import(${JSON.stringify(path.join(repository, "skills/proofpilot/scripts/install-dependencies.js"))});\n` +
        `fs.renameSync = () => process.kill(process.pid, "SIGKILL");\n` +
        `acquireDependencyInstallLock(${JSON.stringify(lockedRoot)});\n`;
      for (let crash = 0; crash < 2; crash++) {
        const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", timeout: 15000 });
        assert.equal(child.signal, "SIGKILL", child.stderr);
      }
      const release = acquireDependencyInstallLock(lockedRoot);
      try { assert.throws(() => acquireDependencyInstallLock(lockedRoot), /already in progress/); }
      finally { release(); }
      assert.equal(fs.existsSync(lock), false);
      assert.deepEqual(fs.readdirSync(lockBase).filter(name => !before.has(name)), []);
    });
    test("one lock key remains active when a previously absent root is created", () => {
      const lockedRoot = path.join(temporary, "lock-root-created", "skills");
      const release = acquireDependencyInstallLock(lockedRoot);
      try {
        fs.mkdirSync(lockedRoot, { recursive: true });
        assert.throws(() => acquireDependencyInstallLock(lockedRoot), /already in progress/);
      } finally { release(); }
      const acquiredAfterRelease = acquireDependencyInstallLock(lockedRoot);
      acquiredAfterRelease();
    });
    test("project-local Git shims are never selected for pinned downloads", () => {
      const fakeDirectory = path.join(temporary, "project/node_modules/.bin");
      const fake = path.join(fakeDirectory, process.platform === "win32" ? "git.exe" : "git");
      write(fake, "fake git\n");
      fs.chmodSync(fake, 0o755);
      const selected = trustedGitExecutable(`${fakeDirectory}${path.delimiter}${path.dirname(process.execPath)}`);
      assert.notEqual(selected, fs.realpathSync(fake));
      assert.equal(path.isAbsolute(selected), true);
    });
    test("Windows Git accepts native read-write modes while POSIX retains execute-bit and path checks", () => {
      const worker = path.join(temporary, "git-platform-modes.mjs");
      const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
      write(worker, `import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path";\n` +
        `import { trustedGitExecutable } from ${JSON.stringify(moduleUrl)};\n` +
        `const root=process.argv[2], realpath=fs.realpathSync, lstat=fs.lstatSync, modes=new Map();\n` +
        `const file=(relative,mode)=>{const location=path.join(root,relative); fs.mkdirSync(path.dirname(location),{recursive:true}); fs.writeFileSync(location,"Git fixture"); modes.set(location,mode); return location;};\n` +
        `const windows=file("windows/git.exe",0o666), posix=file("posix/git",0o666), executable=file("executable/git",0o755); file("batch/git.bat",0o666); file("node_modules/.bin/git.exe",0o666); fs.mkdirSync(path.join(root,"directory/git.exe"),{recursive:true});\n` +
        `fs.realpathSync=location=>{if(["/usr/bin/git","/usr/local/bin/git","/opt/homebrew/bin/git"].includes(location) || location===path.join(root,"broken-link/git.exe"))throw Object.assign(new Error("Unresolvable candidate fixture"),{code:"ENOENT"}); return realpath(location);};\n` +
        `fs.lstatSync=(location,...args)=>{const stat=lstat(location,...args); if(modes.has(location))stat.mode=(stat.mode & ~0o777)|modes.get(location); return stat;};\n` +
        `Object.defineProperty(process,"getuid",{value:undefined}); const platform=value=>Object.defineProperty(process,"platform",{value});\n` +
        `platform("win32"); assert.equal(trustedGitExecutable(path.dirname(windows)),windows);\n` +
        `for(const relative of ["batch","directory","broken-link","node_modules/.bin"])assert.throws(()=>trustedGitExecutable(path.join(root,relative)),/trusted absolute Git/); assert.throws(()=>trustedGitExecutable("relative/bin"),/trusted absolute Git/);\n` +
        `platform("linux"); assert.throws(()=>trustedGitExecutable(path.dirname(posix)),/trusted absolute Git/); assert.equal(trustedGitExecutable(path.dirname(executable)),executable);\n`);
      const child = spawnSync(process.execPath, [worker, path.join(temporary, "git-platform-fixtures")], { encoding: "utf8", timeout: 30000 });
      assert.equal(child.status, 0, child.stderr);
    });
    test("locked Git trees with case or Unicode alias paths are rejected before writes", () => {
      const repo = path.join(temporary, "alias-upstream");
      fs.mkdirSync(repo);
      const gitExecutable = trustedGitExecutable();
      const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
      const git = (args, input) => {
        const result = spawnSync(gitExecutable, ["-c", "user.name=ProofPilot Test", "-c", "user.email=test@proofpilot.invalid", ...args],
          { cwd: repo, env: gitEnv, input, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      git(["init", "-q"]);
      const add = (file, text) => {
        const blob = git(["hash-object", "-w", "--stdin"], text);
        git(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`]);
      };
      add("skills/build/debug-program/SKILL.md", skillText("debug-program") + "REVIEWED\n");
      add("\u017Fkills/build/debug-program/SKILL.md", skillText("debug-program") + "HIDDEN\n");
      const ref = git(["commit-tree", git(["write-tree"]), "-m", "alias"]);
      git(["reset", "-q", "--hard", ref]);
      const aliasManifest = { version: 1, bundle_id: "alias-source-test",
        connection_helper: { package: "@colosseum-org/copilot-connect@0.2.2", version: "0.2.2" },
        sources: [{ id: "alias-source", repo: "example/alias", ref,
          skills: [{ id: "debug-program", path: "skills/build/debug-program", required_files: ["SKILL.md"] }], assets: [] }] };
      const target = path.join(temporary, "alias-target", "skills");
      assert.throws(() => installDependencies(target, { manifest: aliasManifest, helperVersion: () => true, sourceProvider: () => repo }),
        /colliding case or Unicode paths/);
      assert.equal(fs.existsSync(target), false);
    });
    if (["darwin", "win32"].includes(process.platform)) test("case aliases share one pre-creation root lock", () => {
      const first = path.join(temporary, "case-lock", "NewSkills");
      const alias = path.join(temporary, "case-lock", "newskills");
      const release = acquireDependencyInstallLock(first);
      try { assert.throws(() => acquireDependencyInstallLock(alias), /already in progress/); }
      finally { release(); }
    });
    test("manifest traversal cannot write outside the skill root", () => {
      const unsafe = structuredClone(manifest);
      unsafe.sources[0].skills[0].path = "../outside";
      const file = path.join(temporary, "unsafe-manifest.json");
      write(file, JSON.stringify(unsafe));
      assert.throws(() => loadDependencyManifest(file), /Invalid/);
    });
    test("atomic editor saves retain single-file asset ownership and customized content", () => {
      const editorRoot = path.join(temporary, "atomic-assets", "skills");
      installDependencies(editorRoot, options);
      for (const relative of ["SKILL_ROUTER.md", "data/catalogs/solana-skills.json"]) {
        const file = path.join(editorRoot, relative);
        const value = fs.readFileSync(file, "utf8");
        const changed = relative.endsWith(".md") ? `${value}\n| QA | \`my-qa-skill\` | personal guidance |\n` : JSON.stringify({ previousContent: value, userCustomization: true });
        write(`${file}.editor-save`, changed);
        fs.renameSync(`${file}.editor-save`, file);
      }
      assert.ok(getDependencyStatus(editorRoot, options).assets.filter(item => ["SKILL_ROUTER.md", "data/catalogs/solana-skills.json"].includes(item.path)).every(item => item.owned));
      assert.equal(installDependencies(editorRoot, { ...options, sourceProvider: () => { throw new Error("Unexpected source download"); } }).complete, true);
      assert.match(fs.readFileSync(path.join(editorRoot, "SKILL_ROUTER.md"), "utf8"), /my-qa-skill/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(editorRoot, "data/catalogs/solana-skills.json"))).userCustomization, true);
    });
    const preservingManifest = structuredClone(manifest);
    const preservingSource = preservingManifest.sources.find(source => source.id === "solana-new");
    preservingManifest.sources = [{ ...preservingSource, skills: preservingSource.skills.filter(skill => skill.id === "brand-design"),
      assets: preservingSource.assets.filter(asset => ["data/guides", "SKILL_ROUTER.md"].includes(asset.destination)) }];
    const preservingOptions = { ...options, manifest: preservingManifest, helperVersion: () => true };
    const stateWith = (file, fields) => `${JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), ...fields }, null, 2)}\n`;
    test("unsupported hard links refuse core state commits before capturing the active state", () => {
      for (const code of ["EPERM", "ENOTSUP"]) {
        const target = path.join(temporary, `unsupported-state-link-${code}`, "skills");
        markCoreOnly(target);
        const stateFile = path.join(target, ".proofpilot-bundle.json"), original = fs.readFileSync(stateFile);
        const inode = fs.lstatSync(stateFile, { bigint: true }).ino, link = fs.linkSync;
        let refused = false;
        fs.linkSync = (from, to) => {
          if (String(to).startsWith(`${target}${path.sep}`)) {
            refused = true;
            throw Object.assign(new Error(`Synthetic unsupported state publication: ${code}`), { code });
          }
          return link(from, to);
        };
        try { assert.throws(() => markCoreOnly(target), /Synthetic unsupported state publication/); }
        finally { fs.linkSync = link; }
        assert.equal(refused, true);
        assert.deepEqual(fs.readFileSync(stateFile), original);
        assert.equal(fs.lstatSync(stateFile, { bigint: true }).ino, inode);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        assert.equal(fs.readdirSync(target).some(name => name.startsWith(".proofpilot-commit-state-")), false);
        markCoreOnly(target);
      }
    });
    test("unsupported rollback state hard links leave directory originals active and permit recovery", () => {
      for (const code of ["EPERM", "ENOTSUP"]) {
        const target = path.join(temporary, `unsupported-rollback-state-link-${code}`, "skills");
        installDependencies(target, preservingOptions);
        const directory = path.join(target, "data/guides"), custom = path.join(directory, "personal-notes.md");
        const missing = path.join(directory, "deploy-runbook.md"), stateFile = path.join(target, ".proofpilot-bundle.json");
        write(custom, "Custom content remains active through unsupported rollback-state publication.\n");
        fs.rmSync(missing);
        const original = fs.readFileSync(stateFile), customBytes = fs.readFileSync(custom);
        const inode = fs.lstatSync(stateFile, { bigint: true }).ino, link = fs.linkSync;
        let refused = false;
        fs.linkSync = (from, to) => {
          if (String(to).startsWith(`${target}${path.sep}`)) {
            refused = true;
            throw Object.assign(new Error(`Synthetic unsupported rollback state publication: ${code}`), { code });
          }
          return link(from, to);
        };
        try { assert.throws(() => installDependencies(target, { ...preservingOptions,
          beforeStateWrite: () => { throw new Error("Synthetic failure after directory activation"); } }),
          /Synthetic failure after directory activation.*Synthetic unsupported rollback state publication/); }
        finally { fs.linkSync = link; }
        assert.equal(refused, true);
        assert.deepEqual(fs.readFileSync(stateFile), original);
        assert.equal(fs.lstatSync(stateFile, { bigint: true }).ino, inode);
        assert.deepEqual(fs.readFileSync(custom), customBytes);
        assert.equal(fs.existsSync(missing), false);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), true,
          "The restored directory identity still needs acknowledgment; keep its recoverable journal.");
        for (const name of fs.readdirSync(target).filter(name => name.startsWith(".proofpilot-rollback-state-"))) {
          assert.equal(fs.existsSync(path.join(target, name, "original.json")), false, "Unsupported links must not strand active state in a holding path.");
        }
        assert.equal(recoverPendingInstallation(target).recovered, true);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        assert.equal(fs.readdirSync(target).some(name => name.startsWith(".proofpilot-rollback-state-")), false);
        assert.deepEqual(fs.readFileSync(custom), customBytes);
        assert.equal(installDependencies(target, preservingOptions).complete, true);
        assert.deepEqual(fs.readFileSync(custom), customBytes);
      }
    });
    test("core-only commits report unique state edits made through captured file descriptors", () => {
      for (const api of ["markCoreOnly", "installPackage"]) {
        const target = path.join(temporary, `captured-state-fd-${api}`, "skills"), stateFile = path.join(target, ".proofpilot-bundle.json");
        const destination = path.join(target, "proofpilot");
        const install = () => api === "markCoreOnly" ? markCoreOnly(target) : installPackage({ destination, coreOnly: true });
        install();
        const unique = Buffer.from(stateWith(stateFile, { personal_metadata: { keep: "Unique editor bytes written through the captured descriptor" } }));
        const descriptor = fs.openSync(stateFile, "r+"), link = fs.linkSync;
        let wrote = false;
        fs.linkSync = (from, to) => {
          if (!wrote && to === stateFile && path.basename(path.dirname(from)).startsWith(".proofpilot-commit-state-")) {
            wrote = true;
            fs.ftruncateSync(descriptor, 0);
            fs.writeFileSync(descriptor, unique);
            fs.fsyncSync(descriptor);
          }
          return link(from, to);
        };
        let result;
        try { result = install(); }
        finally { fs.linkSync = link; fs.closeSync(descriptor); }
        assert.equal(wrote, true, "The write must land after the capture check, before active state publication.");
        assert.notDeepEqual(fs.readFileSync(stateFile), unique);
        const preserved = result.backups.filter(file => file.endsWith(`${path.sep}original.json`) &&
          path.basename(path.dirname(file)).startsWith(".proofpilot-commit-state-"));
        assert.equal(preserved.length, 1, `${api}: unique captured bytes must be reported to the caller.`);
        assert.deepEqual(fs.readFileSync(preserved[0]), unique);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      }
    });
    test("core-only commits never replace in-place or atomic state saves made during installation", () => {
      for (const save of ["inPlace", "atomic"]) {
        const target = path.join(temporary, `state-save-core-${save}`, "skills"), stateFile = path.join(target, ".proofpilot-bundle.json");
        markCoreOnly(target);
        let edited;
        assert.throws(() => markCoreOnly(target, { beforeStateWrite: () => {
          edited = stateWith(stateFile, { personal_metadata: { keep: `Editor ${save} save survives` } });
          if (save === "inPlace") fs.writeFileSync(stateFile, edited);
          else { fs.writeFileSync(`${stateFile}.editor-save`, edited); fs.renameSync(`${stateFile}.editor-save`, stateFile); }
        } }), /concurrent_state_save/);
        assert.equal(fs.readFileSync(stateFile, "utf8"), edited);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        assert.equal(fs.readdirSync(target).some(name => name.startsWith(".proofpilot-commit-state-")), false);
        markCoreOnly(target);
        assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")).personal_metadata, { keep: `Editor ${save} save survives` });
      }
    });
    test("a full repair rolls back without replacing a state save made before its commit", () => {
      const target = path.join(temporary, "state-save-full", "skills"), stateFile = path.join(target, ".proofpilot-bundle.json");
      installDependencies(target, preservingOptions);
      const missing = path.join(target, "brand-design/references/contrast-rules.md");
      fs.rmSync(missing);
      let edited;
      assert.throws(() => installDependencies(target, { ...preservingOptions, beforeStateWrite: () => {
        edited = stateWith(stateFile, { personal_metadata: { keep: "Full-install editor save survives" } });
        fs.writeFileSync(`${stateFile}.editor-save`, edited);
        fs.renameSync(`${stateFile}.editor-save`, stateFile);
      } }), /concurrent_state_save/);
      assert.equal(fs.readFileSync(stateFile, "utf8"), edited);
      assert.equal(fs.existsSync(missing), false, "The uncommitted repair must be rolled back.");
      assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      const repaired = installDependencies(target, preservingOptions);
      assert.equal(repaired.complete, true);
      assert.equal(fs.existsSync(missing), true);
      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")).personal_metadata, { keep: "Full-install editor save survives" });
    });
    test("a concurrent state editor save stays byte-exact when directory restoration needs ownership reconciliation", () => {
      const target = path.join(temporary, "directory-restore-concurrent-state", "skills");
      installDependencies(target, preservingOptions);
      const directory = path.join(target, "data/guides"), custom = path.join(directory, "personal-notes.md");
      const missing = path.join(directory, "deploy-runbook.md"), stateFile = path.join(target, ".proofpilot-bundle.json");
      const journalFile = path.join(target, ".proofpilot-transaction.json");
      write(custom, "Latest active custom guidance must survive directory restoration.\n");
      const latestCustom = fs.readFileSync(custom), stateBefore = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      fs.rmSync(missing);
      const editedState = Buffer.from(`${JSON.stringify({ ...stateBefore,
        personal_metadata: { keep: "Exactly preserve this editor's state bytes and formatting" } }, null, "\t")}\r\n`);
      assert.throws(() => installDependencies(target, { ...preservingOptions, beforeStateWrite: () => {
        fs.writeFileSync(`${stateFile}.editor-save`, editedState);
        fs.renameSync(`${stateFile}.editor-save`, stateFile);
      } }), /concurrent state save prevents refreshing restored directory ownership.*exact saved state bytes.*pending journal.*Reconcile/);
      assert.deepEqual(fs.readFileSync(stateFile), editedState);
      assert.deepEqual(fs.readFileSync(custom), latestCustom);
      assert.equal(fs.existsSync(missing), false, "The directory restoration must have happened before conservative refusal.");
      assert.equal(fs.existsSync(journalFile), true);
      const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
      const action = journal.actions.find(action => action.destination === "data/guides");
      assert.deepEqual(action.original_identity, stateBefore.asset_provenance["data/guides"].path_identity);
      const active = fs.lstatSync(directory, { bigint: true });
      assert.deepEqual(action.restored_identity, { dev: String(active.dev), ino: String(active.ino), type: "directory" });
      assert.notDeepEqual(action.restored_identity, action.original_identity);
      let fetched = 0;
      assert.throws(() => installDependencies(target, { ...preservingOptions, sourceProvider: () => {
        fetched++; throw new Error("Pending ownership reconciliation must stop before preparation.");
      } }), /concurrent state save prevents refreshing restored directory ownership.*Reconcile/);
      assert.equal(fetched, 0);
      assert.deepEqual(fs.readFileSync(stateFile), editedState);
      assert.deepEqual(fs.readFileSync(custom), latestCustom);
      assert.equal(fs.existsSync(journalFile), true);
    });
    test("state saves racing the commit capture or its exclusive publication stay active", () => {
      const held = location => path.basename(path.dirname(location)).startsWith(".proofpilot-commit-state-");
      for (const mode of ["inPlace", "atomic", "competing"]) {
        const target = path.join(temporary, `state-commit-race-${mode}`, "skills"), stateFile = path.join(target, ".proofpilot-bundle.json");
        markCoreOnly(target);
        const prior = fs.readFileSync(stateFile);
        const saved = stateWith(stateFile, { personal_metadata: { keep: `Racing ${mode} save survives` } });
        const rename = fs.renameSync, link = fs.linkSync;
        let raced = false;
        fs.renameSync = (from, to) => {
          if (!raced && mode !== "competing" && from === stateFile && path.basename(to) === "original.json" && held(to)) {
            raced = true;
            if (mode === "inPlace") fs.writeFileSync(stateFile, saved);
            else { fs.writeFileSync(`${stateFile}.editor-save`, saved); rename(`${stateFile}.editor-save`, stateFile); }
          }
          return rename(from, to);
        };
        fs.linkSync = (from, to) => {
          if (!raced && mode === "competing" && to === stateFile && held(from)) {
            raced = true;
            fs.writeFileSync(stateFile, saved, { flag: "wx" });
          }
          return link(from, to);
        };
        let message = "";
        try { assert.throws(() => markCoreOnly(target), error => { message = error.message; return /concurrent_state_save/.test(message); }); }
        finally { fs.renameSync = rename; fs.linkSync = link; }
        assert.equal(raced, true);
        assert.equal(fs.readFileSync(stateFile, "utf8"), saved);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        const holding = fs.readdirSync(target).filter(name => name.startsWith(".proofpilot-commit-state-"));
        if (mode === "competing") {
          // The competing writer never saw the captured prior state; it stays preserved and reported.
          assert.equal(holding.length, 1);
          assert.deepEqual(fs.readdirSync(path.join(target, holding[0])), ["original.json"]);
          assert.deepEqual(fs.readFileSync(path.join(target, holding[0], "original.json")), prior);
          assert.ok(message.includes(JSON.stringify(path.join(target, holding[0], "original.json"))));
        } else assert.deepEqual(holding, []);
        markCoreOnly(target);
        assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")).personal_metadata, { keep: `Racing ${mode} save survives` });
      }
    });
    test("a state file created by another writer during a fresh installation stays active", () => {
      const created = `${JSON.stringify({ personal_metadata: { keep: "State from another writer survives" } }, null, 2)}\n`;
      const fullTarget = path.join(temporary, "state-appears-full", "skills"), fullState = path.join(fullTarget, ".proofpilot-bundle.json");
      assert.throws(() => installDependencies(fullTarget, { ...preservingOptions,
        beforeStateWrite: () => fs.writeFileSync(fullState, created, { flag: "wx" }) }), /concurrent_state_save/);
      assert.equal(fs.readFileSync(fullState, "utf8"), created);
      assert.equal(fs.existsSync(path.join(fullTarget, "brand-design")), false);
      assert.equal(fs.existsSync(path.join(fullTarget, "SKILL_ROUTER.md")), false);
      assert.equal(fs.existsSync(path.join(fullTarget, ".proofpilot-transaction.json")), false);
      const coreTarget = path.join(temporary, "state-appears-core", "skills"), coreState = path.join(coreTarget, ".proofpilot-bundle.json");
      const link = fs.linkSync;
      let raced = false;
      fs.linkSync = (from, to) => {
        if (!raced && to === coreState && path.basename(path.dirname(from)).startsWith(".proofpilot-commit-state-")) {
          raced = true;
          fs.writeFileSync(coreState, created, { flag: "wx" });
        }
        return link(from, to);
      };
      try { assert.throws(() => markCoreOnly(coreTarget), /concurrent_state_save/); }
      finally { fs.linkSync = link; }
      assert.equal(raced, true);
      assert.equal(fs.readFileSync(coreState, "utf8"), created);
      assert.equal(fs.existsSync(path.join(coreTarget, ".proofpilot-transaction.json")), false);
      assert.equal(fs.readdirSync(coreTarget).some(name => name.startsWith(".proofpilot-commit-state-")), false);
    });
    test("a state save between the installer's read and its transaction start stops before any change", () => {
      const target = path.join(temporary, "state-save-before-begin", "skills"), stateFile = path.join(target, ".proofpilot-bundle.json");
      installDependencies(target, preservingOptions);
      const missing = path.join(target, "brand-design/references/contrast-rules.md");
      fs.rmSync(missing);
      let edited;
      assert.throws(() => installDependencies(target, { ...preservingOptions, afterLockAcquired: () => {
        edited = stateWith(stateFile, { personal_metadata: { keep: "Save before the transaction survives" } });
        fs.writeFileSync(stateFile, edited);
      } }), /changed after this installation read it/);
      assert.equal(fs.readFileSync(stateFile, "utf8"), edited);
      assert.equal(fs.existsSync(missing), false);
      assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      assert.equal(installDependencies(target, preservingOptions).complete, true);
      assert.equal(fs.existsSync(missing), true);
      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")).personal_metadata, { keep: "Save before the transaction survives" });
    });
    test("preserving repairs never replace same-inode custom edits or children added after staging", () => {
      for (const { name, installed, missing, edited } of [
        { name: "skill-file", installed: "brand-design", missing: "brand-design/references/contrast-rules.md", edited: "brand-design/references/palette-recipes.md" },
        { name: "skill-child", installed: "brand-design", missing: "brand-design/references/contrast-rules.md", edited: "brand-design/custom-notes.md" },
        { name: "directory-asset", installed: "data/guides", missing: "data/guides/deploy-runbook.md", edited: "data/guides/security-checklist.md" },
        { name: "file-asset", installed: "SKILL_ROUTER.md", missing: ".proofpilot-upstream/SKILL_ROUTER.md.txt", edited: "SKILL_ROUTER.md" }
      ]) {
        const target = path.join(temporary, `late-preserved-edit-${name}`, "skills");
        installDependencies(target, preservingOptions);
        const active = path.join(target, installed), missingFile = path.join(target, missing), editedFile = path.join(target, edited);
        fs.rmSync(missingFile);
        const identity = fs.lstatSync(active, { bigint: true }).ino;
        let cached = false;
        // Helper preparation runs after every preserving plan staged the custom bytes.
        const lateEdit = (_selected, online) => {
          if (online && !cached) { fs.appendFileSync(editedFile, "Late custom guidance survives.\n"); cached = true; }
          return cached;
        };
        assert.throws(() => installDependencies(target, { ...preservingOptions, helperVersion: lateEdit }), /changed after it was staged for a preserving repair/);
        assert.equal(cached, true);
        assert.equal(fs.lstatSync(active, { bigint: true }).ino, identity, `${name}: the changed original was moved`);
        assert.match(fs.readFileSync(editedFile, "utf8"), /Late custom guidance survives/);
        assert.equal(fs.existsSync(missingFile), false);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        // Control: the next ordinary repair stages the newest bytes and completes.
        const repaired = installDependencies(target, preservingOptions);
        assert.equal(repaired.complete, true);
        assert.match(fs.readFileSync(editedFile, "utf8"), /Late custom guidance survives/);
        assert.equal(fs.existsSync(missingFile), true);
      }
    });
    test("a custom edit landing during activation aborts before its original is backed up", () => {
      const target = path.join(temporary, "late-preserved-edit-activation", "skills");
      installDependencies(target, preservingOptions);
      const brand = path.join(target, "brand-design"), guides = path.join(target, "data/guides"), edited = path.join(guides, "security-checklist.md");
      fs.rmSync(path.join(brand, "references/contrast-rules.md"));
      fs.rmSync(path.join(guides, "deploy-runbook.md"));
      const brandBytes = fs.readFileSync(path.join(brand, "SKILL.md")), guidesIdentity = fs.lstatSync(guides, { bigint: true }).ino;
      const rename = fs.renameSync;
      let raced = false;
      fs.renameSync = (from, to) => {
        const result = rename(from, to);
        if (!raced && to === brand && String(from).includes(".proofpilot-staging-")) {
          raced = true;
          fs.appendFileSync(edited, "Edit during activation survives.\n");
        }
        return result;
      };
      try { assert.throws(() => installDependencies(target, preservingOptions), /changed after it was staged for a preserving repair/); }
      finally { fs.renameSync = rename; }
      assert.equal(raced, true);
      assert.equal(fs.lstatSync(guides, { bigint: true }).ino, guidesIdentity);
      assert.match(fs.readFileSync(edited, "utf8"), /Edit during activation survives/);
      assert.equal(fs.existsSync(path.join(guides, "deploy-runbook.md")), false);
      assert.equal(fs.existsSync(path.join(brand, "references/contrast-rules.md")), false, "The activated earlier plan must roll back.");
      assert.deepEqual(fs.readFileSync(path.join(brand, "SKILL.md")), brandBytes);
      assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      assert.equal(installDependencies(target, preservingOptions).complete, true);
      assert.match(fs.readFileSync(edited, "utf8"), /Edit during activation survives/);
    });
    test("a preserving edit during activation journal publication stays active and can be repaired on retry", () => {
      const target = path.join(temporary, "preserving-journal-capture-edit", "skills");
      installDependencies(target, preservingOptions);
      const active = path.join(target, "brand-design"), edited = path.join(active, "references/palette-recipes.md");
      const missing = path.join(active, "references/contrast-rules.md"), stateFile = path.join(target, ".proofpilot-bundle.json");
      fs.rmSync(missing);
      const stateBefore = fs.readFileSync(stateFile), identity = fs.lstatSync(active, { bigint: true }).ino;
      const rename = fs.renameSync;
      let raced = false, latest;
      fs.renameSync = (from, to) => {
        const result = rename(from, to);
        if (!raced && to === path.join(target, ".proofpilot-transaction.json")) {
          const journal = JSON.parse(fs.readFileSync(to, "utf8"));
          if (journal.actions.some(action => action.destination === "brand-design" && action.activation_started)) {
            raced = true;
            fs.appendFileSync(edited, "Latest journal-boundary custom edit survives.\n");
            latest = fs.readFileSync(edited);
          }
        }
        return result;
      };
      try { assert.throws(() => installDependencies(target, preservingOptions), /changed after it was staged for a preserving repair/); }
      finally { fs.renameSync = rename; }
      assert.equal(raced, true, "The activation-journal publication boundary must be reached.");
      assert.deepEqual(fs.readFileSync(edited), latest);
      assert.equal(fs.lstatSync(active, { bigint: true }).ino, identity);
      assert.deepEqual(fs.readFileSync(stateFile), stateBefore);
      assert.equal(fs.existsSync(missing), false);
      assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      assert.equal(installDependencies(target, preservingOptions).complete, true);
      assert.deepEqual(fs.readFileSync(edited), latest);
      assert.equal(fs.existsSync(missing), true);
    });
    test("preserving repairs restore the newest content and modes captured at the actual backup boundary", () => {
      const items = [
        { name: "skill", installed: "brand-design", missing: "brand-design/references/contrast-rules.md", edited: "brand-design/references/palette-recipes.md" },
        { name: "directory-asset", installed: "data/guides", missing: "data/guides/deploy-runbook.md", edited: "data/guides/security-checklist.md" },
        { name: "file-asset", installed: "SKILL_ROUTER.md", missing: ".proofpilot-upstream/SKILL_ROUTER.md.txt", edited: "SKILL_ROUTER.md" }
      ];
      for (const mode of ["content", ...(typeof process.getuid === "function" ? ["permissions"] : [])]) for (const item of items) {
        const target = path.join(temporary, `preserving-backup-capture-${item.name}-${mode}`, "skills");
        installDependencies(target, preservingOptions);
        const active = path.join(target, item.installed), missing = path.join(target, item.missing), edited = path.join(target, item.edited);
        const stateFile = path.join(target, ".proofpilot-bundle.json"), stateBefore = fs.readFileSync(stateFile);
        fs.rmSync(missing);
        const rename = fs.renameSync;
        let raced = false, latest, latestMode;
        fs.renameSync = (from, to) => {
          if (!raced && from === active && (path.basename(to).startsWith(".proofpilot-move-") ||
            String(to).includes(`${path.sep}.proofpilot-backups${path.sep}transaction-`))) {
            raced = true;
            if (mode === "content") fs.appendFileSync(edited, "Latest capture-boundary custom edit survives.\n");
            else fs.chmodSync(edited, 0o600);
            latest = fs.readFileSync(edited);
            latestMode = fs.lstatSync(edited).mode & 0o777;
          }
          return rename(from, to);
        };
        try { assert.throws(() => installDependencies(target, preservingOptions), /changed while its preserving backup was captured/); }
        finally { fs.renameSync = rename; }
        assert.equal(raced, true, `${item.name}/${mode}: the actual original capture boundary must be reached.`);
        assert.deepEqual(fs.readFileSync(edited), latest, `${item.name}/${mode}: newest bytes must be active.`);
        if (mode === "permissions") assert.equal(fs.lstatSync(edited).mode & 0o777, latestMode);
        const stateAfter = JSON.parse(fs.readFileSync(stateFile, "utf8")), previousState = JSON.parse(stateBefore);
        if (item.name === "directory-asset") {
          previousState.asset_provenance[item.installed].path_identity = stateAfter.asset_provenance[item.installed].path_identity;
          assert.deepEqual(stateAfter.asset_provenance[item.installed].path_identity, {
            dev: String(fs.lstatSync(active, { bigint: true }).dev), ino: String(fs.lstatSync(active, { bigint: true }).ino), type: "directory"
          });
        }
        assert.deepEqual(stateAfter, previousState, "Only the proven restored directory identity may change in state.");
        assert.equal(fs.existsSync(missing), false);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        const repaired = installDependencies(target, preservingOptions);
        assert.equal(repaired.complete, true);
        assert.deepEqual(fs.readFileSync(edited), latest);
        if (mode === "permissions") assert.equal(fs.lstatSync(edited).mode & 0o777, latestMode);
        assert.equal(fs.existsSync(missing), true);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      }
    });
    test("explicit update replacement stays separate from preserving-repair content binding", () => {
      const target = path.join(temporary, "late-edit-explicit-update", "skills");
      installDependencies(target, preservingOptions);
      const edited = path.join(target, "brand-design/references/palette-recipes.md");
      let cached = false;
      const lateEdit = (_selected, online) => {
        if (online && !cached) { fs.appendFileSync(edited, "Edit replaced only by explicit update.\n"); cached = true; }
        return cached;
      };
      const updated = installDependencies(target, { ...preservingOptions, update: true, helperVersion: lateEdit });
      assert.equal(updated.complete, true);
      assert.equal(cached, true);
      assert.doesNotMatch(fs.readFileSync(edited, "utf8"), /Edit replaced only by explicit update/);
      assert.ok(updated.backups.some(backup => fs.existsSync(path.join(backup, "references/palette-recipes.md")) &&
        /Edit replaced only by explicit update/.test(fs.readFileSync(path.join(backup, "references/palette-recipes.md"), "utf8"))));
    });
    if (typeof process.getuid === "function") test("drifted support permissions are reported and repaired by preserving replacements", () => {
      const target = path.join(temporary, "permission-drift", "skills");
      installDependencies(target, preservingOptions);
      const noFetch = { ...preservingOptions, sourceProvider: () => { throw new Error("A permission repair must not download sources."); } };
      // Safe control: a private owned tree is reused without replacement or backups.
      const control = installDependencies(target, noFetch);
      assert.equal(control.complete, true);
      assert.deepEqual(control.reused, ["brand-design"]);
      assert.deepEqual(control.backups, []);
      const drifted = [["brand-design/references/palette-recipes.md", 0o666], ["brand-design/references", 0o777],
        ["data/guides/security-checklist.md", 0o664], ["SKILL_ROUTER.md", 0o666], [".proofpilot-upstream/SKILL_ROUTER.md.txt", 0o646]]
        .map(([relative, mode]) => [path.join(target, relative), mode]);
      const bytes = new Map(drifted.filter(([file]) => fs.lstatSync(file).isFile()).map(([file]) => [file, fs.readFileSync(file)]));
      for (const [file, mode] of drifted) fs.chmodSync(file, mode);
      const status = getDependencyStatus(target, preservingOptions);
      assert.equal(status.complete, false);
      for (const item of [...status.skills, ...status.assets]) {
        assert.equal(item.status, "incomplete", item.id ?? item.path);
        assert.equal(item.permission_repair_required, true, item.id ?? item.path);
      }
      const repaired = installDependencies(target, noFetch);
      assert.equal(repaired.complete, true);
      assert.deepEqual(repaired.updated, ["brand-design"]);
      assert.ok(repaired.backups.length >= 3);
      for (const [file] of drifted) assert.equal(fs.lstatSync(file).mode & 0o022, 0, `Writable reused path: ${file}`);
      for (const [file, value] of bytes) assert.deepEqual(fs.readFileSync(file), value);
      const after = getDependencyStatus(target, preservingOptions);
      assert.equal(after.complete, true);
      assert.ok([...after.skills, ...after.assets].every(item => item.permission_repair_required === false));
      // Entries owned by another account are never blessed or replaced automatically.
      const foreign = [path.join(target, "brand-design/references/typography-preview.md"), path.join(target, ".proofpilot-upstream/SKILL_ROUTER.md.txt")];
      const lstat = fs.lstatSync;
      fs.lstatSync = (file, ...args) => {
        const stat = lstat(file, ...args);
        if (foreign.includes(String(file)) && !args[0]?.bigint) stat.uid = process.getuid() + 1;
        return stat;
      };
      let fetched = 0;
      try {
        const foreignStatus = getDependencyStatus(target, preservingOptions);
        assert.equal(foreignStatus.skills.find(item => item.id === "brand-design").status, "incompatible");
        assert.equal(foreignStatus.assets.find(item => item.path === "SKILL_ROUTER.md").status, "incompatible");
        assert.throws(() => installDependencies(target, { ...preservingOptions, sourceProvider: () => { fetched++; throw new Error("must not fetch"); } }),
          /owned by another account/);
      } finally { fs.lstatSync = lstat; }
      assert.equal(fetched, 0);
      assert.equal(getDependencyStatus(target, preservingOptions).complete, true);
    });
    if (process.platform !== "win32") {
      test("nested support activation persists its destination before the bundle state commits", () => {
        const target = path.join(temporary, "durable-nested-asset", "skills");
        const selected = structuredClone(manifest);
        selected.sources = [{ ...selected.sources[0], skills: [], assets: selected.sources[0].assets.filter(asset => asset.destination === "data/catalogs/solana-skills.json") }];
        const selectedOptions = { ...options, manifest: selected, helperVersion: () => true };
        installDependencies(target, selectedOptions);
        const active = path.join(target, "data/catalogs/solana-skills.json");
        const original = { open: fs.openSync, close: fs.closeSync, sync: fs.fsyncSync, rename: fs.renameSync, link: fs.linkSync };
        const paths = new Map(), events = [];
        fs.openSync = (file, ...args) => { const fd = original.open(file, ...args); paths.set(fd, String(file)); return fd; };
        fs.closeSync = fd => { paths.delete(fd); return original.close(fd); };
        fs.fsyncSync = fd => { const result = original.sync(fd); events.push({ op: "sync", file: paths.get(fd) }); return result; };
        fs.renameSync = (from, to) => { const result = original.rename(from, to); events.push({ op: "rename", from, to }); return result; };
        fs.linkSync = (from, to) => { const result = original.link(from, to); events.push({ op: "link", from, to }); return result; };
        try { assert.equal(installDependencies(target, { ...selectedOptions, update: true }).complete, true); }
        finally { fs.openSync = original.open; fs.closeSync = original.close; fs.fsyncSync = original.sync; fs.renameSync = original.rename; fs.linkSync = original.link; }
        const activation = events.findIndex(event => event.op === "link" && event.to === active);
        const state = events.findIndex(event => event.op === "link" && event.to === path.join(target, ".proofpilot-bundle.json"));
        assert.ok(activation >= 0 && state > activation);
        assert.ok(events.slice(0, activation).some(event => event.op === "sync" && event.file === events[activation].from), "Prepared asset bytes must persist before activation.");
        for (const parent of [path.dirname(active), path.dirname(events[activation].from)]) {
          assert.ok(events.slice(activation + 1, state).some(event => event.op === "sync" && event.file === parent), `Unpersisted activation parent: ${parent}`);
        }
      });
      test("an editor save appearing at regular-file publication survives an interrupted update", () => {
        const target = path.join(temporary, "exclusive-file-publication", "skills");
        const selected = structuredClone(manifest);
        selected.sources = [{ ...selected.sources[0], skills: [], assets: selected.sources[0].assets.filter(asset => asset.destination === "SKILL_ROUTER.md") }];
        const selectedOptions = { ...options, manifest: selected, helperVersion: () => true };
        installDependencies(target, selectedOptions);
        const active = path.join(target, "SKILL_ROUTER.md"), originalBytes = fs.readFileSync(active);
        const link = fs.linkSync;
        let inserted = false;
        fs.linkSync = (from, to) => {
          if (to === active && String(from).includes(".proofpilot-staging-")) {
            inserted = true;
            fs.writeFileSync(active, "Foreign editor save at publication must survive.\n", { flag: "wx" });
          }
          return link(from, to);
        };
        try { assert.throws(() => installDependencies(target, { ...selectedOptions, update: true }), /EEXIST|active_path_ownership_changed/); }
        finally { fs.linkSync = link; }
        assert.equal(inserted, true);
        assert.equal(fs.readFileSync(active, "utf8"), "Foreign editor save at publication must survive.\n");
        const journal = JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8"));
        const action = journal.actions.find(action => action.destination === "SKILL_ROUTER.md");
        assert.deepEqual(fs.readFileSync(action.backup), originalBytes);
      });
      test("unsupported exclusive regular-file publication fails without an overwrite fallback", () => {
        const target = path.join(temporary, "unsupported-file-publication", "skills");
        const selected = structuredClone(manifest);
        selected.sources = [{ ...selected.sources[0], skills: [], assets: selected.sources[0].assets.filter(asset => asset.destination === "SKILL_ROUTER.md") }];
        const selectedOptions = { ...options, manifest: selected, helperVersion: () => true };
        installDependencies(target, selectedOptions);
        const active = path.join(target, "SKILL_ROUTER.md"), originalBytes = fs.readFileSync(active), link = fs.linkSync;
        fs.linkSync = (from, to) => {
          if (to === active && String(from).includes(".proofpilot-staging-")) throw Object.assign(new Error("Exclusive publication unsupported"), { code: "EPERM" });
          return link(from, to);
        };
        try { assert.throws(() => installDependencies(target, { ...selectedOptions, update: true }), /Exclusive publication unsupported/); }
        finally { fs.linkSync = link; }
        assert.deepEqual(fs.readFileSync(active), originalBytes);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      });
      const interruptRestore = (target, { killAtRename = false, backupExdev = false, journalFailure = 0, killDuringPreparation = false, restoreCopyFailure = false, largeCopyKill = false } = {}) => {
        fs.mkdirSync(target, { recursive: true });
        const worker = path.join(temporary, `kill-restored-${path.basename(path.dirname(target))}.mjs`);
        const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
        write(worker, `import fs from "node:fs"; import path from "node:path";\n` +
          `import { markCoreOnly, addTransactionAction, startTransactionBackup, startTransactionActivation, backupInstalledPath } from ${JSON.stringify(moduleUrl)};\n` +
          `const root=process.argv[2], destination=path.join(root,"shared.txt"), staged=path.join(root,".proofpilot-stage-fixture.txt"), journal=path.join(root,".proofpilot-transaction.json");\n` +
          `fs.writeFileSync(destination,"Original user bytes survive repeated recovery.\\n"+(${largeCopyKill}?"source-payload-".repeat(16000):"")); fs.writeFileSync(staged,"Replacement.\\n");\n` +
          `const stat=fs.lstatSync(destination,{bigint:true}), identity={dev:String(stat.dev),ino:String(stat.ino),type:"file"};\n` +
          `const rename=fs.renameSync, link=fs.linkSync, open=fs.openSync, close=fs.closeSync, sync=fs.fsyncSync, write=fs.writeSync, paths=new Map(); let restoredPublished=false, journaledAfterRestore=false, preparedJournal=false;\n` +
          `fs.openSync=(file,...args)=>{const fd=open(file,...args);paths.set(fd,String(file));return fd;}; fs.closeSync=fd=>{paths.delete(fd);return close(fd);};\n` +
          `fs.renameSync=(from,to)=>{const recordsRestore=to===journal && JSON.parse(fs.readFileSync(from,"utf8")).actions.some(action=>action.restored_identity);\n` +
          `if(recordsRestore && ${journalFailure}===1)throw Object.assign(new Error("Prepared restore journal write failed"),{code:"EXDEV"});\n` +
          `if(${backupExdev} && String(to).includes(".proofpilot-backups") && !path.basename(from).startsWith(".proofpilot-copy-"))throw Object.assign(new Error("Backup EXDEV fixture"),{code:"EXDEV"});\n` +
          `const result=rename(from,to); if(to===destination && path.basename(from).startsWith(".proofpilot-copy-")){restoredPublished=true; if(${killAtRename})process.kill(process.pid,"SIGKILL");}\n` +
          `if(recordsRestore){if(restoredPublished)journaledAfterRestore=true; else {preparedJournal=true; if(${killDuringPreparation})process.kill(process.pid,"SIGKILL");}} return result;};\n` +
          `fs.linkSync=(from,to)=>{const result=link(from,to); if(to===destination && path.basename(from).startsWith(".proofpilot-copy-")){restoredPublished=true; if(${killAtRename})process.kill(process.pid,"SIGKILL");}return result;};\n` +
          `fs.writeSync=(fd,...args)=>{const restoring=path.basename(paths.get(fd)??"").startsWith(".proofpilot-copy-"); if(${restoreCopyFailure} && restoring)throw Object.assign(new Error("Restore copy disk full"),{code:"ENOSPC"});const result=write(fd,...args);if(${largeCopyKill} && restoring)process.kill(process.pid,"SIGKILL");return result;};\n` +
          `fs.fsyncSync=fd=>{const result=sync(fd); if(paths.get(fd)===root){if(preparedJournal && !restoredPublished && ${journalFailure}===2)throw Object.assign(new Error("Prepared restore journal write failed"),{code:"EIO"}); if(journaledAfterRestore)process.kill(process.pid,"SIGKILL");} return result;};\n` +
          `try { markCoreOnly(root,{afterLockAcquired:({transaction})=>{const action=addTransactionAction(transaction,{destination,staging:staged,initialExists:true,initialIdentity:identity,kind:"support"}); startTransactionActivation(transaction,action); startTransactionBackup(transaction,action); backupInstalledPath(destination,root,{backupPath:action.backup,quarantinePath:path.join(root,action.backup_quarantine)}); rename(staged,destination); throw new Error("Injected pre-commit failure");}}); } catch(error) { if(${restoreCopyFailure} ? !error.message.includes("Restore copy disk full") : (!${journalFailure} || !error.message.includes("Prepared restore journal write failed")))throw error; }\n`);
        const child = spawnSync(process.execPath, [worker, target], { encoding: "utf8", timeout: 30000 });
        if (journalFailure || restoreCopyFailure) assert.equal(child.status, 0, child.stderr);
        else assert.equal(child.signal, "SIGKILL", child.stderr);
        const journal = JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8"));
        if (!journalFailure && !restoreCopyFailure && !largeCopyKill) {
          assert.ok(journal.actions[0].restored_identity);
          assert.notDeepEqual(journal.actions[0].restored_identity, journal.actions[0].original_identity);
        }
        return path.join(target, "shared.txt");
      };
      test("recovery retries after copied restore publication preserve original bytes and clear the journal", () => {
        const target = path.join(temporary, "restored-recovery-retry", "skills");
        const active = interruptRestore(target);
        const original = fs.readFileSync(active);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.deepEqual(fs.readFileSync(active), original);
        assert.match(original.toString(), /Original user bytes/);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      });
      test("a foreign replacement after restored-identity publication still refuses rollback", () => {
        const target = path.join(temporary, "restored-recovery-foreign", "skills");
        const active = interruptRestore(target);
        fs.renameSync(active, path.join(target, "preserved-original.txt"));
        fs.writeFileSync(active, "Foreign replacement must survive.\n");
        const foreign = fs.readFileSync(active);
        assert.throws(() => recoverPendingInstallation(target), /active_path_ownership_changed/);
        assert.deepEqual(fs.readFileSync(active), foreign);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), true);
      });
      test("SIGKILL immediately after copied restore publication preserves customized bytes on retry", () => {
        const target = path.join(temporary, "restored-before-callback", "skills");
        const active = interruptRestore(target, { killAtRename: true });
        const journalPath = path.join(target, ".proofpilot-transaction.json");
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
        const original = fs.readFileSync(active);
        assert.deepEqual(fs.readFileSync(journal.actions[0].backup), original);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.deepEqual(fs.readFileSync(active), original);
        assert.match(original.toString(), /Original user bytes/);
        assert.equal(fs.existsSync(journalPath), false);
        assert.equal(recoverPendingInstallation(target).recovered, false);
      });
      test("SIGKILL immediately after restoring an EXDEV-created backup remains recoverable", () => {
        const target = path.join(temporary, "restored-direct-before-callback", "skills");
        const active = interruptRestore(target, { killAtRename: true, backupExdev: true });
        const journal = JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8"));
        const original = fs.readFileSync(active);
        assert.deepEqual(fs.readFileSync(journal.actions[0].backup), original);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.deepEqual(fs.readFileSync(active), original);
        assert.deepEqual(fs.readFileSync(journal.actions[0].backup), original);
        assert.match(original.toString(), /Original user bytes/);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      });
      test("a same-content foreign inode after restore publication cannot inherit recovery ownership", () => {
        const target = path.join(temporary, "restored-same-content-foreign", "skills");
        const active = interruptRestore(target, { killAtRename: true });
        const preserved = path.join(target, "preserved-original.txt");
        fs.renameSync(active, preserved);
        fs.copyFileSync(preserved, active);
        const foreign = fs.readFileSync(active);
        assert.notEqual(fs.lstatSync(active, { bigint: true }).ino, fs.lstatSync(preserved, { bigint: true }).ino);
        assert.throws(() => recoverPendingInstallation(target), /active_path_ownership_changed/);
        assert.deepEqual(fs.readFileSync(active), foreign);
        assert.deepEqual(fs.readFileSync(preserved), foreign);
        const journalPath = path.join(target, ".proofpilot-transaction.json");
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
        assert.deepEqual(fs.readFileSync(journal.actions[0].backup), foreign);
      });
      test("failed prepared restore journal writes preserve backup bytes and can retry", () => {
        for (const journalFailure of [1, 2]) {
          const target = path.join(temporary, `restored-journal-failure-${journalFailure}`, "skills");
          const active = interruptRestore(target, { journalFailure });
          const journalPath = path.join(target, ".proofpilot-transaction.json");
          const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
          const original = fs.readFileSync(journal.actions[0].backup);
          assert.equal(fs.readFileSync(active, "utf8"), "Replacement.\n", "A failed preparation must leave the active replacement available.");
          assert.equal(Boolean(journal.actions[0].restored_identity), journalFailure === 2);
          assert.match(original.toString(), /Original user bytes/);
          assert.equal(recoverPendingInstallation(target).committed, false);
          assert.deepEqual(fs.readFileSync(active), original);
          assert.equal(fs.existsSync(journalPath), false);
        }
      });
      test("restore ENOSPC leaves active bytes, complete backup and durable intent available for retry", () => {
        const target = path.join(temporary, "restore-copy-enospc", "skills");
        const active = interruptRestore(target, { restoreCopyFailure: true });
        const journalPath = path.join(target, ".proofpilot-transaction.json");
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")), action = journal.actions[0];
        assert.equal(fs.readFileSync(active, "utf8"), "Replacement.\n");
        assert.match(fs.readFileSync(action.backup, "utf8"), /Original user bytes/);
        assert.ok(action.restore_temporary_identity);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.match(fs.readFileSync(active, "utf8"), /Original user bytes/);
        assert.equal(fs.existsSync(journalPath), false);
        assert.equal(fs.readdirSync(target).some(name => name.startsWith(".proofpilot-copy-")), false);
        assert.match(fs.readFileSync(action.backup, "utf8"), /Original user bytes/);
      });
      test("SIGKILL after durable restore preparation reuses owned copy without removing active bytes early", () => {
        const target = path.join(temporary, "restore-preparation-killed", "skills");
        const active = interruptRestore(target, { killDuringPreparation: true });
        const journal = JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8")), action = journal.actions[0];
        const prepared = path.join(target, action.restore_temporary);
        assert.equal(fs.readFileSync(active, "utf8"), "Replacement.\n");
        assert.deepEqual(fs.readFileSync(prepared), fs.readFileSync(action.backup));
        assert.equal(String(fs.lstatSync(prepared, { bigint: true }).ino), action.restored_identity.ino);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.match(fs.readFileSync(active, "utf8"), /Original user bytes/);
        assert.equal(fs.existsSync(prepared), false);
        assert.equal(fs.readdirSync(target).some(name => name.startsWith(".proofpilot-copy-")), false);
      });
      test("an editor save appearing during exclusive file restore publication survives recovery failure", () => {
        const target = path.join(temporary, "restore-exclusive-file-publication", "skills");
        const active = interruptRestore(target, { killDuringPreparation: true }), link = fs.linkSync;
        let inserted = false;
        fs.linkSync = (from, to) => {
          if (to === active && path.basename(from).startsWith(".proofpilot-copy-")) {
            inserted = true;
            fs.writeFileSync(active, "Foreign editor save during restore must survive.\n", { flag: "wx" });
          }
          return link(from, to);
        };
        try { assert.throws(() => recoverPendingInstallation(target), /EEXIST/); }
        finally { fs.linkSync = link; }
        assert.equal(inserted, true);
        assert.equal(fs.readFileSync(active, "utf8"), "Foreign editor save during restore must survive.\n");
        const journalPath = path.join(target, ".proofpilot-transaction.json"), action = JSON.parse(fs.readFileSync(journalPath, "utf8")).actions[0];
        assert.match(fs.readFileSync(action.backup, "utf8"), /Original user bytes/);
        assert.deepEqual(fs.readFileSync(path.join(target, action.restore_temporary)), fs.readFileSync(action.backup));
        assert.equal(fs.existsSync(journalPath), true);
      });
      test("SIGKILL between restored-file link and temporary unlink preserves later active edits", () => {
        const target = path.join(temporary, "restore-file-link-alias-edited", "skills");
        const active = interruptRestore(target, { killAtRename: true });
        const journalPath = path.join(target, ".proofpilot-transaction.json"), action = JSON.parse(fs.readFileSync(journalPath, "utf8")).actions[0];
        const prepared = path.join(target, action.restore_temporary);
        assert.equal(fs.lstatSync(active).nlink, 2);
        assert.equal(String(fs.lstatSync(prepared, { bigint: true }).ino), String(fs.lstatSync(active, { bigint: true }).ino));
        fs.appendFileSync(active, "User edit through the restored active name.\n");
        const bytes = fs.readFileSync(active);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.deepEqual(fs.readFileSync(active), bytes);
        assert.equal(fs.lstatSync(active).nlink, 1);
        assert.equal(fs.existsSync(prepared), false);
        assert.equal(fs.existsSync(journalPath), false);
      });
      test("SIGKILL after the first root-file restore write retries an owned source prefix", () => {
        const target = path.join(temporary, "root-file-prefix-restore-killed", "skills");
        const active = interruptRestore(target, { largeCopyKill: true });
        const action = JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8")).actions[0];
        const prepared = path.join(target, action.restore_temporary), original = fs.readFileSync(action.backup);
        assert.equal(fs.statSync(prepared).size, 64 * 1024);
        assert.deepEqual(fs.readFileSync(prepared), original.subarray(0, 64 * 1024));
        assert.equal(fs.readFileSync(active, "utf8"), "Replacement.\n");
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.deepEqual(fs.readFileSync(active), original);
        assert.equal(fs.existsSync(prepared), false);
      });
      test("foreign or edited prepared restore copies survive and keep recovery blocked", () => {
        for (const mode of ["foreign", "edited"]) {
          const target = path.join(temporary, `restore-temporary-${mode}`, "skills");
          const active = interruptRestore(target, { killDuringPreparation: true });
          const journalPath = path.join(target, ".proofpilot-transaction.json");
          const action = JSON.parse(fs.readFileSync(journalPath, "utf8")).actions[0], prepared = path.join(target, action.restore_temporary);
          if (mode === "foreign") {
            fs.renameSync(prepared, `${prepared}.preserved`);
            fs.copyFileSync(`${prepared}.preserved`, prepared);
          } else fs.appendFileSync(prepared, "User edit in prepared restore.\n");
          const bytes = fs.readFileSync(prepared);
          assert.throws(() => recoverPendingInstallation(target), mode === "foreign" ? /restore_temporary_ownership_changed/ : /restore_temporary_changed/);
          assert.deepEqual(fs.readFileSync(prepared), bytes);
          assert.equal(fs.readFileSync(active, "utf8"), "Replacement.\n");
          assert.equal(fs.existsSync(journalPath), true);
        }
      });
      test("malformed restore paths and link type maps are rejected before touching active or temporary contents", () => {
        for (const invalid of ["path", "map-path", "map-type", "map-array"]) {
          const target = path.join(temporary, `restore-journal-invalid-${invalid}`, "skills");
          const active = interruptRestore(target, { killDuringPreparation: true });
          const journalPath = path.join(target, ".proofpilot-transaction.json");
          const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")), prepared = path.join(target, journal.actions[0].restore_temporary);
          if (invalid === "path") journal.actions[0].restore_temporary = "../foreign";
          else journal.actions[0].symlink_types = invalid === "map-path" ? { "../foreign": "dir" } : invalid === "map-type" ? { "": "junction" } : ["dir"];
          fs.writeFileSync(journalPath, JSON.stringify(journal));
          const activeBytes = fs.readFileSync(active), preparedBytes = fs.readFileSync(prepared);
          assert.throws(() => recoverPendingInstallation(target), /restore temporary path is invalid|symbolic-link type map is invalid/);
          assert.deepEqual(fs.readFileSync(active), activeBytes);
          assert.deepEqual(fs.readFileSync(prepared), preparedBytes);
        }
      });
      const interruptDirectoryRestore = (target, partialFile = false) => {
        fs.mkdirSync(target, { recursive: true });
        const worker = path.join(temporary, `kill-directory-restore-${path.basename(path.dirname(target))}.mjs`);
        const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
        write(worker, `import fs from "node:fs"; import path from "node:path";\n` +
          `import { markCoreOnly, addTransactionAction, startTransactionBackup, startTransactionActivation, backupInstalledPath } from ${JSON.stringify(moduleUrl)};\n` +
          `const root=process.argv[2], destination=path.join(root,"guidance"), staged=path.join(root,".proofpilot-stage-directory-fixture");\n` +
          `fs.mkdirSync(destination); fs.writeFileSync(path.join(destination,"first.txt"),"Original first customized bytes.\\n"); fs.writeFileSync(path.join(destination,"second.txt"),"Original second customized bytes.\\n"); fs.mkdirSync(staged); fs.writeFileSync(path.join(staged,"replacement.txt"),"Active replacement remains available.\\n");\n` +
          `const stat=fs.lstatSync(destination,{bigint:true}), identity={dev:String(stat.dev),ino:String(stat.ino),type:"directory"}, copy=fs.copyFileSync;\n` +
          `fs.copyFileSync=(from,to,flags)=>{if(${partialFile} && String(to).includes(".proofpilot-copy-")){fs.writeFileSync(to,fs.readFileSync(from).subarray(0,12),{flag:"wx",mode:0o600});process.kill(process.pid,"SIGKILL");} const result=copy(from,to,flags); if(String(to).includes(".proofpilot-copy-"))process.kill(process.pid,"SIGKILL"); return result;};\n` +
          `markCoreOnly(root,{afterLockAcquired:({transaction})=>{const action=addTransactionAction(transaction,{destination,staging:staged,initialExists:true,initialIdentity:identity,kind:"support"}); startTransactionActivation(transaction,action); startTransactionBackup(transaction,action); backupInstalledPath(destination,root,{backupPath:action.backup,quarantinePath:path.join(root,action.backup_quarantine)}); fs.renameSync(staged,destination); throw new Error("Injected failure before directory restore");}});\n`);
        const child = spawnSync(process.execPath, [worker, target], { encoding: "utf8", timeout: 30000 });
        assert.equal(child.signal, "SIGKILL", child.stderr);
        return JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8")).actions[0];
      };
      test("SIGKILL during directory restore cleans only the journal-owned unchanged partial copy", () => {
        const target = path.join(temporary, "partial-restore-directory", "skills"), action = interruptDirectoryRestore(target);
        const active = path.join(target, action.destination), prepared = path.join(target, action.restore_temporary);
        assert.equal(fs.readdirSync(prepared).length, 1);
        assert.match(fs.readFileSync(path.join(active, "replacement.txt"), "utf8"), /Active replacement/);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.match(fs.readFileSync(path.join(active, "first.txt"), "utf8"), /Original first customized/);
        assert.match(fs.readFileSync(path.join(active, "second.txt"), "utf8"), /Original second customized/);
        assert.equal(fs.existsSync(prepared), false);
        assert.equal(fs.readdirSync(target).some(name => name.startsWith(".proofpilot-copy-")), false);
      });
      test("SIGKILL with a partial nested-file prefix remains recoverable without temporary leaks", () => {
        const target = path.join(temporary, "nested-file-prefix-restore-killed", "skills"), action = interruptDirectoryRestore(target, true);
        const prepared = path.join(target, action.restore_temporary);
        const name = fs.readdirSync(prepared)[0];
        assert.equal(fs.statSync(path.join(prepared, name)).size, 12);
        assert.deepEqual(fs.readFileSync(path.join(prepared, name)), fs.readFileSync(path.join(action.backup, name)).subarray(0, 12));
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.equal(fs.existsSync(prepared), false);
        assert.deepEqual(fs.readFileSync(path.join(target, action.destination, name)), fs.readFileSync(path.join(action.backup, name)));
      });
      test("edited or additional contents in a partial restore are preserved with the active replacement", () => {
        for (const mode of ["edit", "extra", "link"]) {
          const target = path.join(temporary, `partial-restore-${mode}`, "skills"), action = interruptDirectoryRestore(target);
          const prepared = path.join(target, action.restore_temporary), child = path.join(prepared, fs.readdirSync(prepared)[0]);
          if (mode === "edit") fs.appendFileSync(child, "User edit during interrupted preparation.\n");
          else if (mode === "extra") fs.writeFileSync(path.join(prepared, "personal.txt"), "Foreign extra file.\n");
          else { fs.unlinkSync(child); fs.symlinkSync(action.backup, child, "dir"); }
          const activeBytes = fs.readFileSync(path.join(target, action.destination, "replacement.txt"));
          assert.throws(() => recoverPendingInstallation(target), /restore_temporary_changed/);
          assert.equal(fs.existsSync(prepared), true);
          assert.deepEqual(fs.readFileSync(path.join(target, action.destination, "replacement.txt")), activeBytes);
          if (mode === "link") assert.equal(fs.lstatSync(child).isSymbolicLink(), true);
        }
      });
      const interruptRollbackState = (target, mode = "afterPublish") => {
        const worker = path.join(temporary, `kill-rollback-state-${path.basename(path.dirname(target))}.mjs`);
        const moduleUrl = new URL("./install-package.js", import.meta.url).href;
        write(worker, `import fs from "node:fs"; import path from "node:path"; import { installPackage } from ${JSON.stringify(moduleUrl)};\n` +
          `const root=process.argv[2], destination=path.join(root,"proofpilot"), statePath=path.join(root,".proofpilot-bundle.json");\n` +
          `installPackage({destination,coreOnly:true}); fs.appendFileSync(path.join(destination,"SKILL.md"),"\\nCustomized original survives rollback state.\\n"); const state=JSON.parse(fs.readFileSync(statePath,"utf8")); state.personal_metadata={keep:"All prior state fields"}; fs.writeFileSync(statePath,JSON.stringify(state)); const rename=fs.renameSync, link=fs.linkSync, mode=${JSON.stringify(mode)};\n` +
          `const foreignBytes=()=>JSON.stringify({...state,foreign_metadata:"Late foreign state save must survive"});\n` +
          `fs.renameSync=(from,to)=>{const capture=from===statePath && path.basename(to)==="original.json" && path.basename(path.dirname(to)).startsWith(".proofpilot-rollback-state-"); if(capture){if(mode==="beforeCapture")process.kill(process.pid,"SIGKILL"); if(mode==="inPlace")fs.writeFileSync(statePath,foreignBytes()); if(mode==="atomic"){fs.writeFileSync(statePath+".editor-save",foreignBytes());rename(statePath+".editor-save",statePath);}} const result=rename(from,to); if(capture){if(mode==="afterCapture")process.kill(process.pid,"SIGKILL");if(mode==="afterCaptureForeign"){fs.writeFileSync(to,foreignBytes());process.kill(process.pid,"SIGKILL");}} return result;};\n` +
          `fs.linkSync=(from,to)=>{const publish=to===statePath && path.basename(from)==="prepared.json";if(publish){if(mode==="beforePublish")process.kill(process.pid,"SIGKILL");if(mode==="competing")fs.writeFileSync(statePath,foreignBytes(),{flag:"wx"});} const result=link(from,to);if(mode==="afterPreparedPublication" && path.basename(to)==="prepared.json" && path.basename(path.dirname(to)).startsWith(".proofpilot-rollback-state-"))process.kill(process.pid,"SIGKILL");if(publish && ["afterPublish","afterPublishWithIntent"].includes(mode))process.kill(process.pid,"SIGKILL");return result;};\n` +
          `let error;try{installPackage({destination,coreOnly:true,force:true},{afterCoreActivated:({transaction})=>{if(mode==="afterPublishWithIntent"){transaction.expected_state_hash="sha256:"+"f".repeat(64);fs.writeFileSync(path.join(root,".proofpilot-transaction.json"),JSON.stringify(transaction));}throw new Error("Injected core precommit failure");}});}catch(caught){error=caught.message;}console.log(JSON.stringify({error}));\n`);
        const child = spawnSync(process.execPath, [worker, target], { encoding: "utf8", timeout: 30000 });
        if (["inPlace", "atomic", "competing"].includes(mode)) {
          assert.equal(child.status, 0, child.stderr);
          assert.match(JSON.parse(child.stdout).error, /rollback_state_capture_changed|EEXIST/);
        } else assert.equal(child.signal, "SIGKILL", child.stderr);
        return JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8"));
      };
      test("SIGKILL after rollback state publication acknowledges restored core ownership without committing the install", () => {
        const target = path.join(temporary, "rollback-state-killed", "skills"), journal = interruptRollbackState(target);
        assert.match(journal.rollback_state_hash, /^sha256:[a-f0-9]{64}$/);
        assert.equal(journal.expected_state_hash, null);
        const core = path.join(target, "proofpilot"), stateFile = path.join(target, ".proofpilot-bundle.json");
        const before = JSON.parse(fs.readFileSync(stateFile, "utf8")), bytes = fs.readFileSync(path.join(core, "SKILL.md"));
        assert.equal(before.core_entries.proofpilot.path_identity.ino, String(fs.lstatSync(core, { bigint: true }).ino));
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.deepEqual(fs.readFileSync(path.join(core, "SKILL.md")), bytes);
        assert.match(bytes.toString(), /Customized original survives/);
        assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), before);
        assert.deepEqual(before.personal_metadata, { keep: "All prior state fields" });
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        assert.equal(installPackage({ destination: core, coreOnly: true, force: true }).installed.length, 1);
      });
      test("unrelated state edits after rollback state publication still refuse replay", () => {
        const target = path.join(temporary, "rollback-state-foreign", "skills");
        interruptRollbackState(target);
        const stateFile = path.join(target, ".proofpilot-bundle.json"), state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        state.personal_metadata.keep = "Foreign state edit must survive";
        fs.writeFileSync(stateFile, JSON.stringify(state));
        const bytes = fs.readFileSync(stateFile), coreBytes = fs.readFileSync(path.join(target, "proofpilot/SKILL.md"));
        assert.throws(() => recoverPendingInstallation(target), /state no longer matches/);
        assert.deepEqual(fs.readFileSync(stateFile), bytes);
        assert.deepEqual(fs.readFileSync(path.join(target, "proofpilot/SKILL.md")), coreBytes);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), true);
      });
      test("SIGKILL before capture, after capture and before rollback-state publication retries only the captured original", () => {
        for (const mode of ["beforeCapture", "afterCapture", "afterPreparedPublication", "beforePublish"]) {
          const target = path.join(temporary, `rollback-state-crash-${mode}`, "skills"), journal = interruptRollbackState(target, mode);
          const stateFile = path.join(target, ".proofpilot-bundle.json"), holding = path.join(target, journal.rollback_state_capture.path);
          assert.equal(fs.existsSync(stateFile), ["beforeCapture", "afterPreparedPublication"].includes(mode));
          const coreBytes = fs.readFileSync(path.join(target, "proofpilot/SKILL.md"));
          assert.equal(recoverPendingInstallation(target).committed, false);
          const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
          assert.deepEqual(state.personal_metadata, { keep: "All prior state fields" });
          assert.equal(state.core_entries.proofpilot.path_identity.ino, String(fs.lstatSync(path.join(target, "proofpilot"), { bigint: true }).ino));
          assert.deepEqual(fs.readFileSync(path.join(target, "proofpilot/SKILL.md")), coreBytes);
          assert.equal(fs.existsSync(holding), false);
          assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        }
      });
      test("late in-place and atomic state saves at rollback capture are restored and keep the journal pending", () => {
        for (const mode of ["inPlace", "atomic"]) {
          const target = path.join(temporary, `rollback-state-save-${mode}`, "skills");
          interruptRollbackState(target, mode);
          const stateFile = path.join(target, ".proofpilot-bundle.json"), bytes = fs.readFileSync(stateFile);
          assert.equal(JSON.parse(bytes).foreign_metadata, "Late foreign state save must survive");
          assert.throws(() => recoverPendingInstallation(target), /state no longer matches/);
          assert.deepEqual(fs.readFileSync(stateFile), bytes);
          assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), true);
          assert.match(fs.readFileSync(path.join(target, "proofpilot/SKILL.md"), "utf8"), /Customized original survives/);
        }
      });
      test("a competing state file at exclusive rollback publication survives with the captured prior state", () => {
        const target = path.join(temporary, "rollback-state-publication-competing", "skills"), journal = interruptRollbackState(target, "competing");
        const stateFile = path.join(target, ".proofpilot-bundle.json"), bytes = fs.readFileSync(stateFile);
        const holding = path.join(target, journal.rollback_state_capture.path), prior = fs.readFileSync(path.join(holding, "original.json"));
        assert.equal(JSON.parse(bytes).foreign_metadata, "Late foreign state save must survive");
        assert.equal(JSON.parse(prior).foreign_metadata, undefined);
        assert.throws(() => recoverPendingInstallation(target), /state no longer matches/);
        assert.deepEqual(fs.readFileSync(stateFile), bytes);
        assert.deepEqual(fs.readFileSync(path.join(holding, "original.json")), prior);
      });
      test("foreign edits of a captured state after SIGKILL are preserved without establishing accepted rollback state", () => {
        const target = path.join(temporary, "rollback-state-captured-foreign", "skills"), journal = interruptRollbackState(target, "afterCaptureForeign");
        const holding = path.join(target, journal.rollback_state_capture.path), capturedBytes = fs.readFileSync(path.join(holding, "original.json"));
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-bundle.json")), false);
        assert.throws(() => recoverPendingInstallation(target), /rollback_state_capture_changed/);
        assert.deepEqual(fs.readFileSync(path.join(target, ".proofpilot-bundle.json")), capturedBytes);
        assert.equal(JSON.parse(capturedBytes).foreign_metadata, "Late foreign state save must survive");
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), true);
      });
      test("a foreign replacement of the state holding directory is preserved and cannot supply rollback state", () => {
        const target = path.join(temporary, "rollback-state-holding-foreign", "skills"), journal = interruptRollbackState(target, "afterCapture");
        const holding = path.join(target, journal.rollback_state_capture.path);
        fs.renameSync(holding, `${holding}.preserved`);
        write(path.join(holding, "foreign.txt"), "Foreign holding-directory replacement survives.\n");
        const capturedBytes = fs.readFileSync(path.join(`${holding}.preserved`, "original.json"));
        assert.throws(() => recoverPendingInstallation(target), /rollback_state_quarantine_ownership_changed/);
        assert.equal(fs.readFileSync(path.join(holding, "foreign.txt"), "utf8"), "Foreign holding-directory replacement survives.\n");
        assert.deepEqual(fs.readFileSync(path.join(`${holding}.preserved`, "original.json")), capturedBytes);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-bundle.json")), false);
      });
      test("malformed state holding paths are rejected before restoring an absent active state", () => {
        const target = path.join(temporary, "rollback-state-holding-invalid", "skills"), journal = interruptRollbackState(target, "afterCapture");
        const holding = path.join(target, journal.rollback_state_capture.path), capturedBytes = fs.readFileSync(path.join(holding, "original.json"));
        journal.rollback_state_capture.path = "../foreign";
        fs.writeFileSync(path.join(target, ".proofpilot-transaction.json"), JSON.stringify(journal));
        assert.throws(() => recoverPendingInstallation(target), /rollback state capture is invalid/);
        assert.deepEqual(fs.readFileSync(path.join(holding, "original.json")), capturedBytes);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-bundle.json")), false);
      });
      test("a missing active state in a legacy journal cannot bypass its original state hash", () => {
        const target = path.join(temporary, "rollback-state-legacy-missing", "skills"), journal = interruptRollbackState(target, "beforeCapture");
        delete journal.rollback_state_capture;
        delete journal.rollback_state_hash;
        fs.unlinkSync(path.join(target, ".proofpilot-bundle.json"));
        fs.writeFileSync(path.join(target, ".proofpilot-transaction.json"), JSON.stringify(journal));
        const coreBytes = fs.readFileSync(path.join(target, "proofpilot/SKILL.md"));
        assert.throws(() => recoverPendingInstallation(target), /state no longer matches/);
        assert.deepEqual(fs.readFileSync(path.join(target, "proofpilot/SKILL.md")), coreBytes);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-bundle.json")), false);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), true);
      });
      test("rollback state publication remains a rollback when a prior install commit intent was recorded", () => {
        const target = path.join(temporary, "rollback-state-existing-commit-intent", "skills"), journal = interruptRollbackState(target, "afterPublishWithIntent");
        assert.match(journal.expected_state_hash, /^sha256:[a-f0-9]{64}$/);
        assert.notEqual(journal.expected_state_hash, journal.rollback_state_hash);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      });
      const killDuringUpdate = (target, { repair = false, exdev = false } = {}) => {
        const worker = path.join(temporary, `kill-update-${path.basename(path.dirname(target))}.mjs`);
        const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
        write(worker, `import fs from "node:fs"; import path from "node:path";\nimport { installDependencies } from ${JSON.stringify(moduleUrl)};\n` +
          `const [root, sources, manifestText] = process.argv.slice(2); const rename = fs.renameSync; const copy = fs.copyFileSync;\n` +
          `fs.renameSync = (from, to) => { if (${exdev} && String(to).includes(".proofpilot-backups") && !path.basename(from).startsWith(".proofpilot-copy-")) throw Object.assign(new Error("EXDEV fixture"), { code: "EXDEV" }); const result = rename(from, to); if (!${exdev} && String(from).includes(".proofpilot-staging-") && path.dirname(to) === root && path.basename(to) === "brand-design") process.kill(process.pid, "SIGKILL"); return result; };\n` +
          `fs.copyFileSync = (from, to, flags) => { if (${exdev} && String(to).includes(".proofpilot-copy-")) process.kill(process.pid, "SIGKILL"); return copy(from, to, flags); };\n` +
          `installDependencies(root, { update: ${!repair}, manifest: JSON.parse(manifestText), helperVersion: () => true, sourceProvider: source => path.join(sources, source.id) });\n`);
        const child = spawnSync(process.execPath, [worker, target, sources, JSON.stringify(manifest)], { encoding: "utf8", timeout: 60000 });
        assert.equal(child.signal, "SIGKILL", child.stderr);
        return JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8"));
      };
      test("recovery preserves edits and deletion of originals the interrupted update never moved", () => {
        const target = path.join(temporary, "untouched-update", "skills");
        installDependencies(target, options);
        const journal = killDuringUpdate(target);
        const untouched = journal.actions.filter(action => action.original_exists && !action.backup_started && fs.existsSync(path.join(target, action.destination, "SKILL.md")));
        const edited = path.join(target, untouched[0].destination, "SKILL.md");
        fs.appendFileSync(edited, "\nUser edit after interruption.\n");
        const deleted = path.join(target, untouched[1].destination);
        fs.rmSync(deleted, { recursive: true });
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.match(fs.readFileSync(edited, "utf8"), /User edit after interruption/);
        assert.equal(fs.existsSync(deleted), false);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        assert.equal(installDependencies(target, options).complete, true);
      });
      test("atomic editor saves of never-backed-up assets survive recovery and subsequent installation", () => {
        const target = path.join(temporary, "untouched-atomic-update", "skills");
        installDependencies(target, options);
        const journal = killDuringUpdate(target);
        const untouched = journal.actions.find(action => action.destination === "SKILL_ROUTER.md" && action.original_exists && action.backup_started === false);
        assert.ok(untouched);
        const active = path.join(target, untouched.destination);
        const edited = `${fs.readFileSync(active, "utf8")}\nUser atomic editor save after interruption.\n`;
        write(`${active}.editor-save`, edited);
        fs.renameSync(`${active}.editor-save`, active);
        assert.notEqual(String(fs.lstatSync(active, { bigint: true }).ino), untouched.original_identity.ino);
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.equal(fs.readFileSync(active, "utf8"), edited);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        assert.equal(installDependencies(target, options).complete, true);
        assert.equal(fs.readFileSync(active, "utf8"), edited);
      });
      const makeFixtureWritable = location => {
        if (!fs.existsSync(location) || !fs.lstatSync(location).isDirectory()) return;
        fs.chmodSync(location, 0o700);
        for (const name of fs.readdirSync(location)) makeFixtureWritable(path.join(location, name));
      };
      const partialQuarantine = (target, mode) => {
        fs.mkdirSync(target, { recursive: true });
        const worker = path.join(temporary, `partial-quarantine-${path.basename(path.dirname(target))}.mjs`);
        const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
        write(worker, `import fs from "node:fs"; import path from "node:path";\n` +
          `import { markCoreOnly, addTransactionAction, startTransactionBackup, startTransactionActivation, backupInstalledPath } from ${JSON.stringify(moduleUrl)};\n` +
          `const root=process.argv[2], destination=path.join(root,"guidance"), staged=path.join(root,".proofpilot-stage-fixture");\n` +
          `fs.mkdirSync(path.join(destination,"read-only"),{recursive:true}); fs.writeFileSync(path.join(destination,"SKILL.md"),"Original customized guidance.\\n"); fs.writeFileSync(path.join(destination,"removed.txt"),"Complete backup retains this.\\n"); fs.writeFileSync(path.join(destination,"read-only","kept.txt"),"Original protected child.\\n"); fs.chmodSync(path.join(destination,"read-only"),0o555); fs.mkdirSync(staged); fs.writeFileSync(path.join(staged,"SKILL.md"),"Replacement.\\n");\n` +
          `const stat=fs.lstatSync(destination,{bigint:true}), identity={dev:String(stat.dev),ino:String(stat.ino),type:"directory"}, rename=fs.renameSync, remove=fs.rmSync; let action, quarantine, caught;\n` +
          `fs.renameSync=(from,to)=>{if(String(to).includes(".proofpilot-backups") && !path.basename(from).startsWith(".proofpilot-copy-"))throw Object.assign(new Error("Backup EXDEV fixture"),{code:"EXDEV"}); return rename(from,to);};\n` +
          `fs.rmSync=(location,options)=>{if(location===quarantine && ${JSON.stringify(mode)}!=="native"){remove(path.join(location,"removed.txt"),{force:true}); if(${JSON.stringify(mode)}==="crash")process.kill(process.pid,"SIGKILL"); if(${JSON.stringify(mode)}==="committed")return; throw Object.assign(new Error("Partial quarantine removal fixture"),{code:"EACCES"});} return remove(location,options);};\n` +
          `try { markCoreOnly(root,{afterLockAcquired:({transaction})=>{action=addTransactionAction(transaction,{destination,staging:staged,initialExists:true,initialIdentity:identity,kind:"support"}); quarantine=path.join(root,action.backup_quarantine); startTransactionActivation(transaction,action); startTransactionBackup(transaction,action); backupInstalledPath(destination,root,{backupPath:action.backup,quarantinePath:quarantine}); rename(staged,destination);},afterStateWrite:()=>{if(${JSON.stringify(mode)}==="committed")process.kill(process.pid,"SIGKILL");}}); } catch(error) {caught=error.message;}\n` +
          `console.log(JSON.stringify({error:caught,action}));\n`);
        const child = spawnSync(process.execPath, [worker, target], { encoding: "utf8", timeout: 30000 });
        let action, error;
        if (["crash", "committed"].includes(mode)) {
          assert.equal(child.signal, "SIGKILL", child.stderr);
          action = JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8")).actions[0];
        } else {
          assert.equal(child.status, 0, child.stderr);
          ({ action, error } = JSON.parse(child.stdout));
          assert.match(error, /quarantine could not be completely removed/);
        }
        return { active: path.join(target, "guidance"), backup: action.backup, quarantine: path.join(target, action.backup_quarantine), error };
      };
      test("incomplete quarantine cleanup reports preserved bytes and restores a read-only original", () => {
        const target = path.join(temporary, "partial-quarantine-error", "skills");
        try {
          const fixture = partialQuarantine(target, typeof process.getuid === "function" && process.getuid() !== 0 ? "native" : "error");
          assert.ok(fixture.error.includes(fixture.quarantine));
          assert.match(fs.readFileSync(path.join(fixture.active, "SKILL.md"), "utf8"), /Original customized guidance/);
          assert.match(fs.readFileSync(path.join(fixture.active, "read-only/kept.txt"), "utf8"), /Original protected child/);
          assert.match(fs.readFileSync(path.join(fixture.backup, "removed.txt"), "utf8"), /Complete backup retains/);
          assert.equal(fs.existsSync(fixture.quarantine), true);
          assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
          assert.equal(recoverPendingInstallation(target).recovered, false);
        } finally { makeFixtureWritable(path.dirname(target)); }
      });
      test("SIGKILL during quarantine cleanup preserves later edits and restores the verified complete backup", () => {
        const target = path.join(temporary, "partial-quarantine-crash", "skills");
        try {
          const fixture = partialQuarantine(target, "crash");
          const edited = path.join(fixture.quarantine, "read-only/kept.txt");
          fs.appendFileSync(edited, "Later user edit in the partial holding copy.\n");
          const bytes = fs.readFileSync(edited);
          const recovered = recoverPendingInstallation(target);
          assert.equal(recovered.committed, false);
          assert.ok(recovered.backups.includes(fixture.quarantine));
          assert.ok(recovered.backups.includes(fixture.backup));
          assert.deepEqual(fs.readFileSync(edited), bytes);
          assert.match(fs.readFileSync(path.join(fixture.active, "removed.txt"), "utf8"), /Complete backup retains/);
          assert.match(fs.readFileSync(path.join(fixture.active, "read-only/kept.txt"), "utf8"), /^Original protected child\.\n$/);
          assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
          assert.equal(recoverPendingInstallation(target).recovered, false);
        } finally { makeFixtureWritable(path.dirname(target)); }
      });
      test("a foreign replacement of a partial quarantine still refuses recovery", () => {
        const target = path.join(temporary, "partial-quarantine-foreign", "skills");
        try {
          const fixture = partialQuarantine(target, "crash");
          fs.renameSync(fixture.quarantine, `${fixture.quarantine}.preserved`);
          write(path.join(fixture.quarantine, "foreign.txt"), "Foreign quarantine replacement survives.\n");
          const bytes = fs.readFileSync(path.join(fixture.quarantine, "foreign.txt"));
          assert.throws(() => recoverPendingInstallation(target), /original_quarantine_changed/);
          assert.deepEqual(fs.readFileSync(path.join(fixture.quarantine, "foreign.txt")), bytes);
          assert.equal(fs.existsSync(fixture.active), false);
          assert.equal(fs.existsSync(path.join(fixture.backup, "SKILL.md")), true);
          assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), true);
        } finally { makeFixtureWritable(path.dirname(target)); }
      });
      test("a changed complete backup cannot restore a partial quarantine", () => {
        const target = path.join(temporary, "partial-quarantine-changed-backup", "skills");
        try {
          const fixture = partialQuarantine(target, "crash");
          fs.appendFileSync(path.join(fixture.backup, "SKILL.md"), "Changed complete backup.\n");
          const bytes = fs.readFileSync(path.join(fixture.quarantine, "read-only/kept.txt"));
          assert.throws(() => recoverPendingInstallation(target), /backup_missing_or_changed/);
          assert.deepEqual(fs.readFileSync(path.join(fixture.quarantine, "read-only/kept.txt")), bytes);
          assert.equal(fs.existsSync(fixture.active), false);
          assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), true);
        } finally { makeFixtureWritable(path.dirname(target)); }
      });
      test("committed legacy journals report a remaining quarantine and preserve active data", () => {
        const target = path.join(temporary, "partial-quarantine-committed", "skills");
        try {
          const fixture = partialQuarantine(target, "committed");
          const bytes = fs.readFileSync(path.join(fixture.active, "SKILL.md"));
          const recovered = recoverPendingInstallation(target);
          assert.equal(recovered.committed, true);
          assert.ok(recovered.backups.includes(fixture.quarantine));
          assert.ok(recovered.backups.includes(fixture.backup));
          assert.deepEqual(fs.readFileSync(path.join(fixture.active, "SKILL.md")), bytes);
          assert.equal(fs.existsSync(fixture.quarantine), true);
          assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        } finally { makeFixtureWritable(path.dirname(target)); }
      });
      test("recovery checks missing backups before changing the active customized copy", () => {
        const target = path.join(temporary, "missing-update-backup", "skills");
        installDependencies(target, options);
        const journal = killDuringUpdate(target);
        const activated = journal.actions.find(action => action.destination === "brand-design");
        const active = path.join(target, "brand-design", "SKILL.md");
        fs.appendFileSync(active, "\nOnly remaining user customization.\n");
        const bytes = fs.readFileSync(active);
        fs.rmSync(activated.backup, { recursive: true });
        assert.throws(() => recoverPendingInstallation(target), error => /backup_missing_or_changed/.test(error.message) && error.message.includes(".proofpilot-transaction.json"));
        assert.deepEqual(fs.readFileSync(active), bytes);
      });
      test("a crash during EXDEV backup copying restores the journaled original quarantine", () => {
        const target = path.join(temporary, "exdev-crash", "skills");
        installDependencies(target, options);
        const original = path.join(target, "animation-reverse-engineering", "SKILL.md");
        fs.appendFileSync(original, "\nCross-filesystem original survives.\n");
        const journal = killDuringUpdate(target, { exdev: true });
        assert.ok(journal.actions.some(action => action.backup_quarantine && fs.existsSync(path.join(target, action.backup_quarantine))));
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.match(fs.readFileSync(original, "utf8"), /Cross-filesystem original survives/);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        assert.equal(installDependencies(target, options).complete, true);
      });
      test("recovery preserves a foreign entry the interrupted fresh install never activated", () => {
        const target = path.join(temporary, "new-foreign-after-crash", "skills");
        const journal = killDuringUpdate(target);
        const untouched = journal.actions.find(action => !action.original_exists && !action.activation_started && action.destination === "video-craft");
        assert.ok(untouched);
        const personal = path.join(target, untouched.destination, "personal.md");
        write(personal, "Personal guidance created after interruption.\n");
        assert.equal(recoverPendingInstallation(target).committed, false);
        assert.match(fs.readFileSync(personal, "utf8"), /Personal guidance/);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      });
      test("an installed dependency CLI recovers core-only state before its own files disappear", () => {
        const target = path.join(temporary, "self-removing-cli", "skills");
        const worker = path.join(temporary, "kill-core-only-cli.mjs");
        const moduleUrl = new URL("./install-package.js", import.meta.url).href;
        write(worker, `import { installPackage } from ${JSON.stringify(moduleUrl)};\ninstallPackage({ destination: ${JSON.stringify(path.join(target, "proofpilot"))}, coreOnly: true }, { afterCoreActivated: () => process.kill(process.pid, "SIGKILL") });\n`);
        const child = spawnSync(process.execPath, [worker], { encoding: "utf8", timeout: 30000 });
        assert.equal(child.signal, "SIGKILL", child.stderr);
        assert.equal(getDependencyStatus(target, options).mode, "core_only");
        const recovered = spawnSync(process.execPath, [path.join(target, "proofpilot/scripts/install-dependencies.js")], { encoding: "utf8", timeout: 30000 });
        assert.equal(recovered.status, 0, recovered.stderr);
        const data = JSON.parse(recovered.stdout);
        assert.equal(data.mode, "core_only");
        assert.equal(data.requested_install_mode, "core_only");
        assert.equal(data.recovery.recovered, true);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
        assert.equal(fs.existsSync(path.join(target, "proofpilot")), false);
      });
      const interruptStateCommit = (target, mode) => {
        const worker = path.join(temporary, `kill-state-commit-${mode}.mjs`);
        const moduleUrl = new URL("../skills/proofpilot/scripts/install-dependencies.js", import.meta.url).href;
        write(worker, `import fs from "node:fs"; import path from "node:path"; import { markCoreOnly } from ${JSON.stringify(moduleUrl)};\n` +
          `const root=process.argv[2], statePath=path.join(root,".proofpilot-bundle.json"), mode=${JSON.stringify(mode)};\n` +
          `markCoreOnly(root); const state=JSON.parse(fs.readFileSync(statePath,"utf8")); state.personal_metadata={keep:"Prior state fields survive"}; fs.writeFileSync(statePath,JSON.stringify(state));\n` +
          `const rename=fs.renameSync, link=fs.linkSync, held=location=>path.basename(path.dirname(location)).startsWith(".proofpilot-commit-state-");\n` +
          `fs.renameSync=(from,to)=>{const result=rename(from,to); if(mode.startsWith("afterCapture") && from===statePath && path.basename(to)==="original.json" && held(to)){if(mode==="afterCaptureConcurrent")fs.writeFileSync(to,JSON.stringify({...state,foreign_metadata:"Save captured with the old name survives"})); process.kill(process.pid,"SIGKILL");} return result;};\n` +
          `fs.linkSync=(from,to)=>{const result=link(from,to); if(mode==="afterPublish" && to===statePath && held(from))process.kill(process.pid,"SIGKILL"); return result;};\n` +
          `markCoreOnly(root);\n`);
        const child = spawnSync(process.execPath, [worker, target], { encoding: "utf8", timeout: 30000 });
        assert.equal(child.signal, "SIGKILL", child.stderr);
        return JSON.parse(fs.readFileSync(path.join(target, ".proofpilot-transaction.json"), "utf8"));
      };
      test("SIGKILL inside the state commit recovers exactly one active state and clears its holding path", () => {
        for (const mode of ["afterCapture", "afterCaptureConcurrent", "afterPublish"]) {
          const target = path.join(temporary, `state-commit-crash-${mode}`, "skills"), journal = interruptStateCommit(target, mode);
          const stateFile = path.join(target, ".proofpilot-bundle.json"), holding = path.join(target, journal.commit_state_capture.path);
          assert.equal(fs.existsSync(stateFile), mode === "afterPublish");
          assert.equal(fs.existsSync(path.join(holding, "prepared.json")), true);
          assert.equal(getDependencyStatus(target, options).pending_transaction, true);
          assert.equal(recoverPendingInstallation(target).committed, mode === "afterPublish");
          const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
          assert.deepEqual(state.personal_metadata, { keep: "Prior state fields survive" });
          assert.equal(state.foreign_metadata, mode === "afterCaptureConcurrent" ? "Save captured with the old name survives" : undefined);
          assert.equal(fs.existsSync(holding), false);
          assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
          markCoreOnly(target);
          assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")).personal_metadata, { keep: "Prior state fields survive" });
        }
      });
      test("rollback refreshes only inode-proven legacy normalized core records to exact physical paths", () => {
        assert.deepEqual(legacyCorePathAliases("ｐｒｏｏｆｐｉｌｏｔ"), ["ｐｒｏｏｆｐｉｌｏｔ", "proofpilot"]);
        assert.deepEqual(legacyCorePathAliases("custom-straße"), ["custom-straße", "custom-strasse"]);
        const target = path.join(temporary, "legacy-core-aliases", "skills"), stateFile = path.join(target, ".proofpilot-bundle.json");
        const cores = ["ｐｒｏｏｆｐｉｌｏｔ", "custom-straße"];
        const identity = location => { const stat = fs.lstatSync(location, { bigint: true }); return { dev: String(stat.dev), ino: String(stat.ino), type: "directory" }; };
        for (const name of cores) write(path.join(target, name, "SKILL.md"), skillText("proofpilot") + `Physical ${name} core survives rollback.\n`);
        const originals = Object.fromEntries(cores.map(name => [name, identity(path.join(target, name))]));
        const bytes = Object.fromEntries(cores.map(name => [name, fs.readFileSync(path.join(target, name, "SKILL.md"))]));
        // Same legacy key, but no pre-rollback inode proof: it must stay untouched.
        const decoy = { path: "proofpilot", mode: "copy", path_identity: { ...originals["ｐｒｏｏｆｐｉｌｏｔ"], ino: "1" } };
        write(stateFile, `${JSON.stringify({ bundle_id: manifest.bundle_id, mode: "core_only", personal_metadata: { keep: "Prior state fields survive" }, core_entries: {
          proofpilot: { path: "proofpilot", mode: "copy", path_identity: originals["ｐｒｏｏｆｐｉｌｏｔ"] },
          custom: { path: "custom-strasse", mode: "copy", path_identity: originals["custom-straße"] },
          decoy
        } }, null, 2)}\n`);
        assert.throws(() => markCoreOnly(target, { afterLockAcquired: ({ transaction }) => {
          for (const [index, name] of cores.entries()) {
            const destination = path.join(target, name), staged = path.join(target, `.proofpilot-stage-core-${index}`);
            write(path.join(staged, "SKILL.md"), skillText("proofpilot") + "Replacement core.\n");
            const action = addTransactionAction(transaction, { destination, staging: staged, initialExists: true, initialIdentity: originals[name], kind: "core" });
            startTransactionActivation(transaction, action);
            startTransactionBackup(transaction, action);
            backupInstalledPath(destination, target, { backupPath: action.backup, quarantinePath: path.join(target, action.backup_quarantine) });
            fs.renameSync(staged, destination);
          }
          throw new Error("Injected core precommit failure");
        } }), /Injected core precommit failure/);
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        assert.equal(state.core_entries.proofpilot.path, "ｐｒｏｏｆｐｉｌｏｔ");
        assert.deepEqual(state.core_entries.proofpilot.path_identity, identity(path.join(target, "ｐｒｏｏｆｐｉｌｏｔ")));
        assert.equal(state.core_entries.custom.path, "custom-straße");
        assert.deepEqual(state.core_entries.custom.path_identity, identity(path.join(target, "custom-straße")));
        assert.deepEqual(state.core_entries.decoy, decoy);
        assert.deepEqual(state.personal_metadata, { keep: "Prior state fields survive" });
        for (const name of cores) assert.deepEqual(fs.readFileSync(path.join(target, name, "SKILL.md")), bytes[name]);
        assert.equal(fs.existsSync(path.join(target, ".proofpilot-transaction.json")), false);
      });
    }
    return { cases, supportSkills: 36 };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  console.log(`Full support bundle tests passed: ${runDependencyInstallTests().cases} cases.`);
}
