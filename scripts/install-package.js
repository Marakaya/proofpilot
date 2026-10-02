import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInstallMetadata, readSkillName } from "../skills/proofpilot/scripts/install-metadata.js";
import { installDependencies, markCoreOnly, backupInstalledPath, restoreInstalledBackup, loadDependencyManifest, canonicalInstallPath, pathsOverlap, assertInstallDestination, recoverPendingInstallation, addTransactionAction, addTransactionCleanup, startTransactionBackup, startTransactionActivation, recordTransactionPublication, hardenPreparedTree, syncPreparedTree, publishInstalledPath } from "../skills/proofpilot/scripts/install-dependencies.js";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mainSource = path.join(repository, "skills", "proofpilot");
export const profileNames = ["proofpilot-idea-discovery", "proofpilot-venture-validation", "proofpilot-mvp-planner", "proofpilot-readiness-review", "proofpilot-submission-builder"];
export const defaultSkillRoots = (target = "codex") => ({
  ...(() => {
    const home = os.homedir();
    if (!home || !path.isAbsolute(home) || home.startsWith("~")) throw new Error("The account home directory is unavailable or not absolute.");
    const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
    if (target === "codex" && (!path.isAbsolute(codexHome) || codexHome.startsWith("~"))) throw new Error("CODEX_HOME must be an absolute path.");
    const claudeHome = process.env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_HOME || path.join(home, ".claude");
    if (target === "claude" && (!path.isAbsolute(claudeHome) || claudeHome.startsWith("~"))) throw new Error("CLAUDE_CONFIG_DIR / CLAUDE_HOME must be an absolute path.");
    return {
      codex: path.join(path.isAbsolute(codexHome) ? codexHome : path.join(home, ".codex"), "skills"),
      claude: path.join(path.isAbsolute(claudeHome) ? claudeHome : path.join(home, ".claude"), "skills"),
      agents: path.join(home, ".agents", "skills")
    };
  })()
});
export function requireAbsoluteInstallPath(value, label) {
  if (typeof value !== "string" || !value || value.startsWith("~") || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path; shell-style ~ and relative paths are not accepted.`);
  }
  return path.normalize(value);
}
function exists(file) { try { fs.lstatSync(file); return true; } catch { return false; } }
function sameIdentity(left, right) {
  try {
    const a = fs.statSync(left);
    const b = fs.statSync(right);
    if (a.ino || b.ino) return a.dev === b.dev && a.ino === b.ino;
    const normalize = value => process.platform === "win32" ? value.toLowerCase() : value;
    return normalize(fs.realpathSync.native(left)) === normalize(fs.realpathSync.native(right));
  } catch { return false; }
}
function pathIdentity(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  return {
    dev: stat.dev.toString(), ino: stat.ino.toString(),
    type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "special"
  };
}
function hasIdentity(file, identity) {
  try {
    const current = pathIdentity(file);
    return current.dev === identity.dev && current.ino === identity.ino && current.type === identity.type;
  } catch { return false; }
}
function missingParentChain(location) {
  const missing = [];
  for (let cursor = path.resolve(location); !exists(cursor); cursor = path.dirname(cursor)) {
    missing.push({ path: cursor, identity: null });
  }
  return missing;
}
function captureParentIdentities(entries) {
  for (const entry of entries) {
    try {
      const stat = fs.lstatSync(entry.path);
      if (!entry.identity && stat.isDirectory() && !stat.isSymbolicLink()) entry.identity = pathIdentity(entry.path);
    } catch { /* A path that was not created cannot be owned by this transaction. */ }
  }
}
function pruneCreatedParents(entries) {
  for (const entry of entries) {
    if (!entry.identity || !hasIdentity(entry.path, entry.identity)) continue;
    try { fs.rmdirSync(entry.path); } catch { /* Preserve non-empty, replaced or otherwise active directories. */ }
  }
}
function isPhysicalAncestor(parent, child, { replaceFinalLink = false } = {}) {
  if (!exists(parent)) return false;
  let cursor = path.resolve(child);
  if (replaceFinalLink && exists(cursor) && fs.lstatSync(cursor).isSymbolicLink()) cursor = path.dirname(cursor);
  while (true) {
    if (exists(cursor) && sameIdentity(parent, cursor)) return true;
    const next = path.dirname(cursor);
    if (next === cursor) return false;
    cursor = next;
  }
}
function overlapsSource(sourceRoot, destination) {
  const canonical = canonicalInstallPath(destination, { replaceFinalLink: true });
  if (pathsOverlap(sourceRoot, canonical) || isPhysicalAncestor(sourceRoot, destination, { replaceFinalLink: true })) return true;
  return exists(destination) && !fs.lstatSync(destination).isSymbolicLink() && isPhysicalAncestor(destination, sourceRoot);
}
function entryRootMatchesMode(entry, mode) {
  if (!exists(entry.path)) return true;
  const stat = fs.lstatSync(entry.path);
  const rootModeMatches = mode === "copy" ? stat.isDirectory() && !stat.isSymbolicLink() :
    entry.parts.length === 1 ? stat.isSymbolicLink() : stat.isDirectory() && !stat.isSymbolicLink();
  if (stat.isDirectory() && typeof process.getuid === "function" && (stat.mode & 0o022) !== 0) return false;
  if (!rootModeMatches || entry.parts.length === 1) return rootModeMatches;
  const expected = entry.parts.map(([, relative]) => relative.split(path.sep)[0]).sort();
  const actual = fs.readdirSync(entry.path).filter(name => !isInstallMetadata(path.join(entry.path, name))).sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}
function installedSkillName(destination) {
  try {
    if (!fs.lstatSync(destination).isDirectory() && !fs.lstatSync(destination).isSymbolicLink()) return null;
    const skillFile = path.join(destination, "SKILL.md");
    const link = fs.lstatSync(skillFile);
    const stat = link.isSymbolicLink() ? fs.statSync(skillFile) : link;
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const text = fs.readFileSync(skillFile, "utf8");
    return readSkillName(text) ?? null;
  } catch { return null; }
}
function emptyPhysicalDirectory(destination) {
  try {
    const stat = fs.lstatSync(destination);
    return stat.isDirectory() && !stat.isSymbolicLink() && fs.readdirSync(destination).length === 0;
  } catch { return false; }
}
function destinationKey(root, destination) {
  const relative = path.relative(path.resolve(root), path.resolve(destination));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const normalized = relative.split(path.sep).join("/").normalize("NFKC");
  return ["darwin", "win32"].includes(process.platform) ? normalized.toLowerCase().replaceAll("ß", "ss") : normalized;
}
function rootHasProofPilotState(root, manifest, entry, allowLegacy = false) {
  try {
    const file = path.join(root, ".proofpilot-bundle.json");
    if (!fs.lstatSync(file).isFile()) return false;
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const record = state.core_entries?.[entry.name];
    if (record?.path === destinationKey(root, entry.path) && hasIdentity(entry.path, record.path_identity)) return true;
    return allowLegacy && typeof state.bundle_id === "string" && state.bundle_id.startsWith("proofpilot-support-") &&
      (!record || record.path === destinationKey(root, entry.path)) && ["full", "core_only"].includes(state.mode);
  } catch { return false; }
}
function replaceableOwnedCore(root, manifest, entry, allowLegacy) {
  if (rootHasProofPilotState(root, manifest, entry, false)) {
    if (installedSkillName(entry.path) === entry.name) return true;
    // The state binds the inode. A development link can outlive its checkout.
    if (fs.lstatSync(entry.path).isSymbolicLink()) return true;
    return entry.name !== "proofpilot" && fs.lstatSync(entry.path).isDirectory() &&
      entry.parts.every(([, relative]) => exists(path.join(entry.path, relative)) && fs.lstatSync(path.join(entry.path, relative)).isSymbolicLink()) &&
      fs.readdirSync(entry.path).every(name => entry.parts.some(([, relative]) => relative === name));
  }
  return allowLegacy && rootHasProofPilotState(root, manifest, entry, true) && installedSkillName(entry.path) === entry.name;
}
function matches(source, destination) {
  try {
    const stat = fs.lstatSync(source);
    const installed = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || installed.isSymbolicLink()) return false;
    if (stat.isDirectory()) {
      if (!installed.isDirectory()) return false;
      const sourceNames = fs.readdirSync(source).filter(name => !isInstallMetadata(path.join(source, name))).sort();
      const installedNames = fs.readdirSync(destination).filter(name => !isInstallMetadata(path.join(destination, name))).sort();
      return sourceNames.length === installedNames.length && sourceNames.every((name, index) =>
        name === installedNames[index] && matches(path.join(source, name), path.join(destination, name)));
    }
    if (!stat.isFile() || !installed.isFile() || installed.nlink > 1 || stat.size !== installed.size ||
        (stat.ino && stat.dev === installed.dev && stat.ino === installed.ino)) return false;
    return fs.readFileSync(source).equals(fs.readFileSync(destination));
  } catch { return false; }
}
function matchesLink(source, destination) {
  try { return fs.lstatSync(destination).isSymbolicLink() && fs.realpathSync(destination) === fs.realpathSync(source); }
  catch { return false; }
}
function profileParts(name) {
  return [
    [path.join(repository, "skills", name, "SKILL.md"), "SKILL.md"],
    [path.join(mainSource, "references"), "references"],
    [path.join(mainSource, "scripts"), "scripts"]
  ];
}
export function installPackage(args, options = {}) {
  const requestedMainDestination = path.resolve(requireAbsoluteInstallPath(args.destination, "The main skill destination"));
  if (process.platform !== "win32" && path.basename(requestedMainDestination).includes("\\")) {
    throw new Error("The main skill destination name must be journal-safe and cannot contain a backslash.");
  }
  const skillRoot = canonicalInstallPath(path.dirname(requestedMainDestination));
  const mainDestination = path.join(skillRoot, path.basename(requestedMainDestination));
  const mode = args.mode ?? "copy";
  if (!["copy", "symlink"].includes(mode)) throw new Error("Unsupported installation mode.");
  if (args.offline && args.updateDependencies) throw new Error("--offline and --update-dependencies are mutually exclusive.");
  if (args.coreOnly && (args.offline || args.updateDependencies)) throw new Error("--core-only cannot be combined with dependency modes.");
  if (args.adoptLegacyCore && !args.force) throw new Error("--adopt-legacy-core requires --force so the prior installation is preserved in a backup.");
  if (skillRoot === path.parse(skillRoot).root) throw new Error("Choose a skill directory outside the canonical source and filesystem root.");
  const sourceRoot = fs.realpathSync(repository);
  if (overlapsSource(sourceRoot, mainDestination)) throw new Error("Choose a destination outside the canonical source repository.");
  const foldedMainName = path.basename(mainDestination).normalize("NFKC").toLowerCase().replaceAll("ß", "ss");
  if (foldedMainName === "skill.md") throw new Error("The main skill destination uses the reserved SKILL.md entrypoint name.");
  if (foldedMainName === "skills") throw new Error("The main destination is a runtime skill root or configuration directory; select its ProofPilot skill directory.");
  const manifest = options.manifest ?? loadDependencyManifest();
  const recovered = recoverPendingInstallation(skillRoot);
  const recoveredBackups = recovered.backups ?? [];
  const initiallyMissingParents = missingParentChain(skillRoot);
  let recordedState = {};
  try {
    const stateFile = path.join(skillRoot, ".proofpilot-bundle.json");
    const stateStat = fs.lstatSync(stateFile);
    if (!stateStat.isFile() || stateStat.size > 1024 * 1024) throw new Error("incompatible state");
    recordedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const recorded = recordedState.core_entries?.proofpilot?.path;
    if (typeof recorded === "string") {
      const prior = path.join(skillRoot, recorded);
      if (destinationKey(skillRoot, mainDestination) !== destinationKey(skillRoot, prior) && exists(prior) && installedSkillName(prior) === "proofpilot") {
        throw new Error(`This skill root already has a recorded ProofPilot core at ${prior}; choose that destination or a different skill root.`);
      }
    }
  } catch (error) {
    if (/already has a recorded ProofPilot core/.test(error.message)) throw error;
    recordedState = {};
  }
  const recordedProfiles = profileNames.filter(name => recordedState.core_entries?.[name] && exists(path.join(skillRoot, name)));
  const selectedProfileNames = args.profiles ? profileNames : recordedProfiles;
  const destinations = [{ name: "proofpilot", path: mainDestination, parts: [[mainSource, ""]] },
    ...selectedProfileNames.map(name => ({ name, path: path.join(skillRoot, name), parts: profileParts(name) }))];
  if (exists(skillRoot) && fs.lstatSync(skillRoot).isDirectory()) {
    const expectedByName = new Map(destinations.map(entry => [entry.name, entry.path]));
    for (const name of fs.readdirSync(skillRoot)) {
      const candidate = path.join(skillRoot, name);
      const declared = installedSkillName(candidate);
      const expected = expectedByName.get(declared);
      if (expected && destinationKey(skillRoot, candidate) !== destinationKey(skillRoot, expected)) {
        throw new Error(`This skill root already contains another entry declaring name: ${declared}; move it aside before installing.`);
      }
    }
  }
  const reserved = [...profileNames, ...manifest.sources.flatMap(source => [...source.skills.map(skill => skill.id), ...source.assets.map(asset => asset.destination)]), ".proofpilot-bundle.json"]
    .map(relative => path.join(skillRoot, relative));
  const foldName = value => value.normalize("NFKC").toLowerCase().replaceAll("ß", "ss");
  const reservedNames = new Set(reserved.map(destination => foldName(path.relative(skillRoot, destination).split(path.sep)[0])));
  const mainName = foldName(path.basename(mainDestination));
  if (mainName.startsWith(".proofpilot") || reservedNames.has(mainName) || reserved.some(destination => pathsOverlap(mainDestination, destination))) {
    throw new Error("The main destination overlaps a reserved profile, dependency or shared asset.");
  }
  for (const entry of destinations) {
    // A final development symlink is moved as a link, never traversed for writes.
    if (overlapsSource(sourceRoot, entry.path)) throw new Error("Choose a destination outside the canonical source repository.");
    assertInstallDestination(skillRoot, entry.path, { replaceFinalLink: true });
    const same = entryRootMatchesMode(entry, mode) && entry.parts.every(([source, relative]) => (mode === "symlink" ? matchesLink : matches)(source, path.join(entry.path, relative)));
    entry.initialExists = exists(entry.path);
    entry.initialIdentity = entry.initialExists ? pathIdentity(entry.path) : null;
    entry.initialSame = same;
    if (exists(entry.path) && !args.force && !same) {
      throw new Error(`Existing ${entry.name} has different files or installation mode. Use --force to replace it with a backup.`);
    }
    if (exists(entry.path) && args.force && !same && !emptyPhysicalDirectory(entry.path) &&
        !replaceableOwnedCore(skillRoot, manifest, entry, args.adoptLegacyCore)) {
      const legacy = rootHasProofPilotState(skillRoot, manifest, entry, true) && installedSkillName(entry.path) === entry.name;
      throw new Error(`Refusing to replace unowned existing path for ${entry.name}; ${legacy ? "use --force --adopt-legacy-core to preserve and migrate this legacy installation" : "choose an empty destination or a verified ProofPilot installation"}.`);
    }
  }
  const pending = destinations.filter(entry => args.force || !exists(entry.path));
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-core-"));
  let activationRoot;
  const backups = [...recoveredBackups];
  const committed = [];
  let dependencies = null;
  let activated = false;
  let succeeded = false;
  try {
    for (const entry of pending) {
      entry.staging = path.join(stagingRoot, entry.name);
      if (entry.parts.length > 1) fs.mkdirSync(entry.staging, { mode: 0o755 });
      for (const [source, relative] of entry.parts) {
        const prepared = path.join(entry.staging, relative);
        if (mode === "symlink") fs.symlinkSync(source, prepared, fs.statSync(source).isDirectory() ? "dir" : "file");
        else fs.cpSync(source, prepared, { recursive: true, force: false, errorOnExist: true, filter: file => !isInstallMetadata(file) });
      }
      hardenPreparedTree(entry.staging);
    }
    const validateCoreTargets = () => {
      for (const entry of destinations) {
        if (overlapsSource(sourceRoot, entry.path)) throw new Error("Choose a destination outside the canonical source repository.");
        assertInstallDestination(skillRoot, entry.path, { replaceFinalLink: true });
        const currentExists = exists(entry.path);
        if (currentExists !== entry.initialExists || (currentExists && !hasIdentity(entry.path, entry.initialIdentity))) {
          throw new Error(`Installation target changed while waiting for the ProofPilot lock: ${entry.path}`);
        }
        const same = entryRootMatchesMode(entry, mode) && entry.parts.every(([source, relative]) =>
          (mode === "symlink" ? matchesLink : matches)(source, path.join(entry.path, relative)));
        if (currentExists && !args.force && !same) {
          throw new Error(`Existing ${entry.name} changed while installation was in progress.`);
        }
        if (currentExists && args.force && !same && !emptyPhysicalDirectory(entry.path) &&
            !replaceableOwnedCore(skillRoot, manifest, entry, args.adoptLegacyCore)) {
          throw new Error(`Refusing to replace unowned existing path for ${entry.name}; choose an empty destination or a verified ProofPilot installation.`);
        }
      }
    };
    const activateCore = ({ transaction } = {}) => {
      if (activated) throw new Error("Core activation was requested more than once.");
      if (!transaction) throw new Error("Core activation requires a durable installation transaction.");
      validateCoreTargets();
      try { fs.mkdirSync(skillRoot, { recursive: true, mode: 0o755 }); }
      finally { captureParentIdentities(initiallyMissingParents); }
      if (pending.length) activationRoot = fs.mkdtempSync(path.join(skillRoot, ".proofpilot-core-staging-"));
      if (activationRoot) addTransactionCleanup(transaction, activationRoot);
      for (let index = 0; index < pending.length; index++) {
        const prepared = path.join(activationRoot, String(index));
        fs.cpSync(pending[index].staging, prepared, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
        hardenPreparedTree(prepared);
        syncPreparedTree(prepared);
        pending[index].staging = prepared;
      }
      for (const entry of pending) {
        // Managed development links have a known file/directory kind even
        // after the previous source checkout has disappeared.
        entry.originalSymlinkTypes = recordedState.core_entries?.[entry.name]?.mode === "symlink" ?
          entry.parts.length === 1 ? { "": "dir" } : Object.fromEntries(entry.parts.map(([, relative]) =>
            [relative, relative === "SKILL.md" ? "file" : "dir"])) : undefined;
        entry.transactionAction = addTransactionAction(transaction, {
          destination: entry.path, staging: entry.staging, initialExists: entry.initialExists,
          initialIdentity: entry.initialIdentity, kind: "core", symlinkTypes: entry.originalSymlinkTypes
        });
      }
      for (const entry of pending) {
        const action = { destination: entry.path, backup: null, backupIdentity: null, backupIncomplete: false, activated: false, identity: null };
        committed.push(action);
        startTransactionActivation(transaction, entry.transactionAction);
        if (entry.initialExists) {
          if (!hasIdentity(entry.path, entry.initialIdentity)) throw new Error(`Installation target changed before activation: ${entry.path}`);
          startTransactionBackup(transaction, entry.transactionAction);
          try { action.backup = backupInstalledPath(entry.path, skillRoot, { backupPath: entry.transactionAction.backup,
            quarantinePath: path.join(skillRoot, entry.transactionAction.backup_quarantine), symlinkTypes: entry.originalSymlinkTypes }); }
          catch (error) {
            if (error.proofpilotBackup) {
              action.backup = error.proofpilotBackup; action.backupIncomplete = true; backups.push(action.backup);
              action.backupIdentity = pathIdentity(action.backup);
              error.message += ` A durable backup was published but the active source could not be removed: ${action.backup}`;
            }
            throw error;
          }
          action.backupIdentity = pathIdentity(action.backup);
          backups.push(action.backup);
        } else if (exists(entry.path)) throw new Error(`Installation target appeared before activation: ${entry.path}`);
        publishInstalledPath(entry.staging, entry.path, {
          symlinkType: "dir",
          onPublished: identity => recordTransactionPublication(transaction, entry.transactionAction, identity)
        });
        action.activated = true;
        action.identity = pathIdentity(entry.path);
      }
      activated = true;
      options.afterCoreActivated?.({ root: skillRoot, transaction, destinations });
      return {
        installed: pending.map(entry => entry.name), backups: [...backups],
        removed_core_entries: profileNames.filter(name => !selectedProfileNames.includes(name)),
        core_entries: Object.fromEntries(destinations.map(entry => [entry.name, {
          path: destinationKey(skillRoot, entry.path), mode, path_identity: pathIdentity(entry.path)
        }]))
      };
    };
    if (args.coreOnly) {
      markCoreOnly(skillRoot, { manifest, afterLockAcquired: activateCore });
    } else {
      dependencies = installDependencies(skillRoot, {
        ...options, manifest, update: args.updateDependencies, offline: args.offline,
        afterLockAcquired: validateCoreTargets,
        afterDependenciesActivated: activateCore
      });
    }
    if (!activated) throw new Error("Installation transaction did not activate ProofPilot core.");
    succeeded = true;
    return { destination: mainDestination, profiles: selectedProfileNames.length, mode,
      installed: pending.map(entry => entry.name), reused: destinations.filter(entry => !pending.includes(entry)).map(entry => entry.name), dependencies, backups };
  } catch (error) {
    if (error.proofpilotTransactionHandled) committed.length = 0;
    const recovery = [];
    for (const action of committed.reverse()) {
      try {
        if (action.backupIncomplete) {
          recovery.push({ destination: action.destination, backup: action.backup, reason: "backup_published_source_removal_failed" });
          continue;
        }
        if (action.backup && !hasIdentity(action.backup, action.backupIdentity)) {
          recovery.push({ destination: action.destination, backup: action.backup, reason: "backup_identity_changed" });
          continue;
        }
        if (action.activated) {
          if (!hasIdentity(action.destination, action.identity)) {
            recovery.push({ destination: action.destination, backup: action.backup, reason: "active_path_ownership_changed" });
            continue;
          }
          fs.rmSync(action.destination, { recursive: true, force: true });
        }
        if (action.backup) {
          if (exists(action.destination)) {
            recovery.push({ destination: action.destination, backup: action.backup, reason: "destination_reappeared_before_restore" });
            continue;
          }
          restoreInstalledBackup(action.backup, action.destination, skillRoot);
        }
      } catch { recovery.push({ destination: action.destination, backup: action.backup, reason: "rollback_failed" }); }
    }
    if (recovery.length) error.message += ` Preserved backup/recovery paths: ${JSON.stringify(recovery)}`;
    throw error;
  } finally {
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* Preserve the transaction result. */ }
    if (activationRoot) try { fs.rmSync(activationRoot, { recursive: true, force: true }); } catch { /* Preserve the transaction result. */ }
    if (!succeeded) pruneCreatedParents(initiallyMissingParents);
  }
}

export function printInstallNotice(result) {
  const setupPath = path.join(result.destination, "scripts", "setup.js");
  const quote = value => process.platform === "win32" ? `'${value.replace(/['\u2018\u2019]/g, mark => mark + mark)}'` : `'${value.replaceAll("'", "'\\''")}'`;
  console.log(`Installed ProofPilot${result.profiles ? ` and ${result.profiles} profiles` : ""}: ${result.destination}`);
  if (result.dependencies) {
    console.log(`Full support bundle ready: ${result.dependencies.skills.length} skills and shared guidance. New: ${result.dependencies.installed.length}; updated: ${result.dependencies.updated.length}; reused: ${result.dependencies.reused.length}.`);
  } else console.log("Core-only installation selected; support skills were not installed.");
  const backups = [...result.backups, ...(result.dependencies?.backups ?? [])];
  if (backups.length) {
    console.log(`Replaced files were preserved in ${backups.length} backup path${backups.length === 1 ? "" : "s"}:`);
    for (const backup of backups) console.log(`  ${quote(path.resolve(backup))}`);
  }
  console.log("Next, ask your agent to use ProofPilot to complete initial setup, explain the recommended model level, required Colosseum connection and optional service costs.");
  console.log("Colosseum is ProofPilot's core source. Account sign-in is required; research setup is complete only after V2 evidence access is verified.");
  console.log("For higher-quality recommendations, use models in the SOL or Opus 5 class or higher, where available in your host.");
  console.log("Weaker models may miss important details or draw incorrect conclusions; built-in checks cannot fully compensate for model limitations.");
  console.log("Reuse an official Copilot Connect connection, or sign in through the browser. Manage access at https://colosseum.com/arena/copilot/connections. No PAT input.");
  console.log("Other service connections are optional. Review account terms and paid usage before enabling a service.");
  if (process.platform === "win32") console.log("Run the following commands in PowerShell:");
  console.log(`Offline setup status: node ${quote(setupPath)} --status`);
  console.log(`Connect Colosseum V2: node ${quote(setupPath)} --connect-colosseum`);
  console.log(`Offline support inventory: node ${quote(path.join(result.destination, "scripts", "install-dependencies.js"))} --status`);
  console.log(`Offline capability inventory: node ${quote(path.join(result.destination, "scripts", "discover-sources.js"))} --root ${quote(path.dirname(result.destination))} --capabilities`);
  console.log("Local capability lookup and implementation from an existing specification do not require Colosseum account setup.");
  console.log("Skill installation does not log in, start an agent conversation, run telemetry or install agent software/toolchains.");
}
