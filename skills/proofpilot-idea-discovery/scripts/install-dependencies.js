#!/usr/bin/env node

// Install the locked support bundle without running upstream setup or skills.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { isUtf8 } from "node:buffer";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHelperInvocation } from "./connection-helper.js";
import { adaptSupportBundle, inspectSupportPolicy, stageExistingSupportBundle, supportPolicySidecarPath } from "./support-policy.js";
import { readSkillName } from "./install-metadata.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const stateName = ".proofpilot-bundle.json";
const transactionName = ".proofpilot-transaction.json";
const ownershipMarkerName = ".proofpilot-managed.json";
const identifier = /^[a-z0-9][a-z0-9-]{0,63}$/;
const foldPortableName = value => value.normalize("NFKC").toLowerCase().replaceAll("ß", "ss");
const relativePath = value => typeof value === "string" && value.length > 0 && !value.includes("\\") &&
  !path.posix.isAbsolute(value) && value.split("/").every(part => part && ![".", ".."].includes(part));

export function loadDependencyManifest(file = path.join(here, "../references/skill-dependencies.json")) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  return validateDependencyManifest(manifest);
}
function validateDependencyManifest(manifest) {
  const fold = foldPortableName;
  const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const reservedTopLevel = new Set(["proofpilot", "proofpilot-idea-discovery", "proofpilot-venture-validation",
    "proofpilot-mvp-planner", "proofpilot-readiness-review", "proofpilot-submission-builder", fold(stateName)]);
  const names = new Set();
  const sourceIds = new Set();
  const destinations = new Set();
  if (manifest.version !== 1 || !Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error("Invalid dependency manifest.");
  for (const source of manifest.sources) {
    if (!identifier.test(source.id) || sourceIds.has(source.id) || !repositoryName.test(source.repo) ||
        !/^[0-9a-f]{40}$/.test(source.ref) || !Array.isArray(source.skills) || !Array.isArray(source.assets) ||
        (source.license_path && !relativePath(source.license_path))) throw new Error("Invalid locked dependency source.");
    sourceIds.add(source.id);
    for (const skill of source.skills) {
      if (!identifier.test(skill.id) || names.has(skill.id) || !relativePath(skill.path) ||
          (skill.minimum_version && !/^\d+\.\d+\.\d+$/.test(skill.minimum_version)) ||
          (skill.ownership_predecessors && (!Array.isArray(skill.ownership_predecessors) ||
            !skill.ownership_predecessors.length || !skill.ownership_predecessors.every(repositoryName.test.bind(repositoryName)))) ||
          !Array.isArray(skill.required_files) || !skill.required_files.length || !skill.required_files.every(relativePath) ||
          (skill.adapted_required_files && (!Array.isArray(skill.adapted_required_files) || !skill.adapted_required_files.every(relativePath)))) throw new Error("Invalid or duplicate dependency skill.");
      const folded = fold(skill.id);
      if (reservedTopLevel.has(folded) || folded.startsWith(".proofpilot")) throw new Error("Reserved dependency destination.");
      names.add(skill.id);
    }
    for (const skill of source.replaced_skills ?? []) {
      if (!identifier.test(skill.id) || !relativePath(skill.path)) throw new Error("Invalid replaced skill mapping.");
    }
    for (const asset of source.assets) {
      if (!relativePath(asset.path) || !relativePath(asset.destination) || fold(asset.destination) === fold(stateName) || destinations.has(fold(asset.destination)) ||
          (asset.required_files && (!Array.isArray(asset.required_files) || !asset.required_files.length || !asset.required_files.every(relativePath)))) {
        throw new Error("Invalid or duplicate dependency asset.");
      }
      const top = fold(asset.destination.split("/")[0]);
      if (reservedTopLevel.has(top) || top.startsWith(".proofpilot")) throw new Error("Reserved dependency destination.");
      destinations.add(fold(asset.destination));
    }
  }
  const allDestinations = [...names, ...destinations].map(fold);
  for (let index = 0; index < allDestinations.length; index++) for (const other of allDestinations.slice(index + 1)) {
    if (pathsOverlap(path.resolve("/manifest-root", allDestinations[index]), path.resolve("/manifest-root", other))) throw new Error("Overlapping dependency destinations.");
  }
  if (manifest.connection_helper?.package !== "@colosseum-org/copilot-connect@0.2.2" || manifest.connection_helper.version !== "0.2.2") {
    throw new Error("Unsupported connection helper.");
  }
  return manifest;
}

export function readSkillMetadata(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return {};
    const text = fs.readFileSync(file, "utf8");
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
    return {
      name: readSkillName(text),
      description: frontmatter.match(/^description:\s*.+/m)?.[0],
      version: frontmatter.match(/^\s*version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m)?.[1]
    };
  } catch { return {}; }
}
function atLeast(version, minimum) {
  if (!minimum) return true;
  if (!version) return false;
  const left = version.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}
function exists(file) { try { fs.lstatSync(file); return true; } catch { return false; } }
function isFile(file) { try { return fs.statSync(file).isFile(); } catch { return false; } }
function isRegularFile(file) { try { return fs.lstatSync(file).isFile(); } catch { return false; } }
function pathIdentity(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  return { dev: stat.dev.toString(), ino: stat.ino.toString(), type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "special" };
}
function hasIdentity(file, identity) {
  if (!identity || typeof identity !== "object" || !["directory", "file", "symlink", "special"].includes(identity.type) ||
      typeof identity.dev !== "string" || typeof identity.ino !== "string") return false;
  try {
    const current = pathIdentity(file);
    return current.dev === identity.dev && current.ino === identity.ino && current.type === identity.type;
  } catch { return false; }
}
function sameCanonicalPath(left, right) {
  const normalize = value => ["darwin", "win32"].includes(process.platform) ? value.normalize("NFKC").toLowerCase().replaceAll("ß", "ss") : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}
function hashInstalledPath(location) {
  const digest = crypto.createHash("sha256");
  const walk = (file, relative) => {
    const stat = fs.lstatSync(file);
    const normalized = relative.split(path.sep).join("/");
    if (stat.isDirectory()) {
      digest.update(`d ${Buffer.byteLength(normalized)}:${normalized}\n`);
      for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), path.join(relative, name));
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(file);
      digest.update(`f ${Buffer.byteLength(normalized)}:${normalized} ${stat.mode & 0o777} ${bytes.length} ${crypto.createHash("sha256").update(bytes).digest("hex")}\n`);
    } else throw new Error(`Installed support path contains an unsupported special file: ${file}`);
  };
  walk(location, "");
  return `sha256v2:${digest.digest("hex")}`;
}
function hashManagedSkillPath(location) {
  const digest = crypto.createHash("sha256");
  const walk = (file, relative) => {
    const stat = fs.lstatSync(file);
    const normalized = relative.split(path.sep).join("/");
    if (stat.isDirectory()) {
      digest.update(`d ${Buffer.byteLength(normalized)}:${normalized}\n`);
      for (const name of fs.readdirSync(file).sort()) {
        if (!relative && name === ownershipMarkerName) continue;
        walk(path.join(file, name), path.join(relative, name));
      }
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(file);
      digest.update(`f ${Buffer.byteLength(normalized)}:${normalized} ${stat.mode & 0o777} ${bytes.length} ${crypto.createHash("sha256").update(bytes).digest("hex")}\n`);
    } else throw new Error(`Installed support path contains an unsupported special file: ${file}`);
  };
  walk(location, "");
  return `sha256v3:${digest.digest("hex")}`;
}
function recoveryFingerprint(location) {
  const digest = crypto.createHash("sha256");
  const walk = (file, relative) => {
    const stat = fs.lstatSync(file);
    const normalized = relative.split(path.sep).join("/");
    if (stat.isDirectory()) {
      digest.update(`d ${Buffer.byteLength(normalized)}:${normalized} ${stat.mode & 0o777}\n`);
      for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), path.join(relative, name));
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(file);
      digest.update(`f ${Buffer.byteLength(normalized)}:${normalized} ${stat.mode & 0o777} ${bytes.length} ${crypto.createHash("sha256").update(bytes).digest("hex")}\n`);
    } else if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(file);
      digest.update(`l ${Buffer.byteLength(normalized)}:${normalized} ${Buffer.byteLength(target)}:${target}\n`);
    } else throw new Error(`A transaction path contains an unsupported special file: ${file}`);
  };
  walk(location, "");
  return `sha256-recovery-v1:${digest.digest("hex")}`;
}
function contentFingerprint(location) {
  try { return recoveryFingerprint(location); } catch { return null; }
}
export function hardenPreparedTree(location) {
  const walk = file => {
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) walk(path.join(file, name));
      fs.chmodSync(file, (stat.mode & 0o777) & ~0o022);
    } else if (stat.isFile()) fs.chmodSync(file, (stat.mode & 0o777) & ~0o022);
    else if (!stat.isSymbolicLink()) throw new Error(`A prepared installation tree contains an unsupported special file: ${file}`);
  };
  walk(location);
}
/** POSIX managed copies stay owned by this account (or root) and closed to group/other writes; links are never followed. */
export function inspectTreePermissions(location) {
  const result = { foreignOwned: [], writable: [] };
  if (typeof process.getuid !== "function") return result;
  const uid = process.getuid();
  const walk = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return;
    if (![0, uid].includes(stat.uid)) result.foreignOwned.push(file);
    if ((stat.mode & 0o022) !== 0) result.writable.push(file);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) walk(path.join(file, name));
  };
  walk(location);
  return result;
}
export function canonicalInstallPath(location, { replaceFinalLink = false } = {}) {
  const resolved = path.resolve(location);
  if (replaceFinalLink && exists(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    return path.join(canonicalInstallPath(path.dirname(resolved)), path.basename(resolved));
  }
  let cursor = resolved;
  const tail = [];
  while (!exists(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("Could not resolve the installation path.");
    tail.unshift(path.basename(cursor)); cursor = parent;
  }
  return path.join(fs.realpathSync(cursor), ...tail);
}
function foldedPathParts(parts) {
  return ["darwin", "win32"].includes(process.platform) ?
    parts.map(part => part.normalize("NFKC").toLowerCase().replaceAll("ß", "ss")) : parts;
}
function physicalPathDescriptor(location) {
  let cursor = path.resolve(location);
  const tail = [];
  while (!exists(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("Could not resolve the physical installation path.");
    tail.unshift(path.basename(cursor));
    cursor = parent;
  }
  const stat = fs.statSync(cursor, { bigint: true });
  return { dev: stat.dev.toString(), ino: stat.ino.toString(), tail: foldedPathParts(tail) };
}
function physicalPathKey(location) {
  const descriptor = physicalPathDescriptor(location);
  return `${descriptor.dev}:${descriptor.ino}/${descriptor.tail.join("/")}`;
}
function samePhysicalPath(left, right) {
  try { return physicalPathKey(left) === physicalPathKey(right); }
  catch { return false; }
}
function physicalPathContains(parent, child) {
  try {
    if (samePhysicalPath(parent, child)) return true;
    if (exists(parent)) {
      const parentStat = fs.statSync(parent, { bigint: true });
      for (let cursor = path.resolve(child); ;) {
        if (exists(cursor)) {
          const stat = fs.statSync(cursor, { bigint: true });
          if (stat.dev === parentStat.dev && stat.ino === parentStat.ino) return true;
        }
        const next = path.dirname(cursor);
        if (next === cursor) break;
        cursor = next;
      }
    }
    const base = physicalPathDescriptor(parent);
    const candidate = physicalPathDescriptor(child);
    return base.dev === candidate.dev && base.ino === candidate.ino && base.tail.length < candidate.tail.length &&
      base.tail.every((part, index) => candidate.tail[index] === part);
  } catch { return false; }
}
export function pathsOverlap(left, right) {
  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  return inside(left, right) || inside(right, left);
}
function canonicalRepository() {
  const candidate = path.resolve(here, "../../..");
  return isFile(path.join(candidate, "scripts/install-package.js")) &&
    readSkillMetadata(path.join(candidate, "skills/proofpilot/SKILL.md")).name === "proofpilot" ? fs.realpathSync(candidate) : null;
}
export function assertInstallDestination(root, destination, { replaceFinalLink = false } = {}) {
  root = path.resolve(root); destination = path.resolve(destination);
  const relative = path.relative(root, destination);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Installation destination escapes the selected skill root.");
  if (exists(root) && !fs.statSync(root).isDirectory()) throw new Error("The skill root is not a directory.");
  let current = root;
  const parts = relative ? relative.split(path.sep) : [];
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    if (!exists(current)) continue;
    const final = index === parts.length - 1;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() && !(final && replaceFinalLink)) throw new Error(`An installation parent is an incompatible symbolic link: ${current}`);
    if (!final && !stat.isDirectory()) throw new Error(`An installation parent is incompatible: ${current}`);
  }
}
function assertDependencyRoot(root) {
  if (root === path.parse(root).root) throw new Error("A filesystem root cannot be a skill directory.");
  if (exists(path.join(root, "SKILL.md"))) throw new Error("The dependency root is a skill directory; pass its parent skill root instead.");
  const homes = [...new Set([os.homedir(), (() => { try { return os.userInfo().homedir; } catch { return null; } })()]
    .filter(value => typeof value === "string" && path.isAbsolute(value)).map(value => path.resolve(value)))];
  if (homes.some(home => samePhysicalPath(root, home))) {
    throw new Error("The account home directory cannot be used as a skill root.");
  }
  const configurationRoots = [...new Set(homes.flatMap(home => [path.join(home, ".codex"), path.join(home, ".claude"), path.join(home, ".agents")]))];
  if (typeof process.env.CODEX_HOME === "string" && path.isAbsolute(process.env.CODEX_HOME)) {
    configurationRoots.push(path.resolve(process.env.CODEX_HOME));
  }
  for (const name of ["CLAUDE_CONFIG_DIR", "CLAUDE_HOME"]) {
    const configuration = process.env[name];
    if (!configuration) continue;
    if (configuration.startsWith("~") || !path.isAbsolute(configuration)) {
      throw new Error(`${name} must be an absolute configuration path; shell-style ~ and relative paths are not accepted.`);
    }
    const resolved = path.resolve(configuration);
    if (physicalPathContains(resolved, root) && !samePhysicalPath(root, path.join(resolved, "skills"))) {
      throw new Error("A runtime configuration directory cannot be used as a skill root; select its exact skills directory.");
    }
    configurationRoots.push(resolved);
  }
  const runtimeNames = new Set([".codex", ".claude", ".agents"]);
  for (let cursor = canonicalInstallPath(root); ; cursor = path.dirname(cursor)) {
    if (runtimeNames.has(foldPortableName(path.basename(cursor)))) configurationRoots.push(cursor);
    if (cursor === path.dirname(cursor)) break;
  }
  const runtimeSkillRoots = configurationRoots.map(configuration => path.join(configuration, "skills"));
  for (const configuration of configurationRoots) {
    if (physicalPathContains(configuration, root) && !runtimeSkillRoots.some(allowed => samePhysicalPath(root, allowed))) {
      throw new Error("A runtime configuration directory cannot be used as a skill root; select its exact skills directory.");
    }
  }
  const source = canonicalRepository();
  if (source) {
    const same = (left, right) => {
      try {
        const a = fs.statSync(left); const b = fs.statSync(right);
        return a.dev === b.dev && a.ino === b.ino;
      } catch { return false; }
    };
    const physicalAncestor = (parent, child) => {
      for (let cursor = path.resolve(child); ; cursor = path.dirname(cursor)) {
        if (exists(cursor) && same(parent, cursor)) return true;
        if (cursor === path.dirname(cursor)) return false;
      }
    };
    const canonical = canonicalInstallPath(root);
    if (pathsOverlap(canonical, source) || physicalAncestor(source, root) || (exists(root) && physicalAncestor(root, source))) {
      throw new Error("Choose a skill root outside the canonical source repository.");
    }
  }
}
function requiredFile(location, relative) {
  try {
    if (!fs.lstatSync(location).isDirectory()) return false;
    assertInstallDestination(location, path.join(location, relative));
    let current = location;
    const parts = relative.split("/");
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!fs.readdirSync(current).includes(part)) return false;
      current = path.join(current, part);
      if (index < parts.length - 1 && !fs.lstatSync(current).isDirectory()) return false;
    }
    return fs.lstatSync(current).isFile();
  } catch { return false; }
}
function readState(root) {
  try {
    const file = path.join(root, stateName);
    if (!exists(file)) return { state: {}, status: "missing" };
    if (!fs.lstatSync(file).isFile()) return { state: {}, status: "invalid" };
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state && typeof state === "object" && !Array.isArray(state) ? { state, status: "valid" } : { state: {}, status: "invalid" };
  } catch { return { state: {}, status: "invalid" }; }
}
function readStateSnapshot(root) {
  const file = path.join(root, stateName);
  if (!exists(file)) return { state: {}, hash: null };
  const identity = pathIdentity(file);
  if (identity.type !== "file" || fs.lstatSync(file).size > 1024 * 1024) throw new Error(`The ProofPilot bundle state is incompatible: ${file}`);
  const bytes = fs.readFileSync(file);
  // The transaction later requires these exact bytes, never a later save.
  if (bytes.length > 1024 * 1024 || !hasIdentity(file, identity)) throw new Error(`The ProofPilot bundle state changed while it was being read: ${file}`);
  let state;
  try { state = JSON.parse(bytes.toString("utf8")); } catch { /* Reported below. */ }
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error(`The ProofPilot bundle state is invalid JSON: ${file}`);
  return { state, hash: stateDigest(bytes) };
}
function readOwnershipMarker(location) {
  try {
    const file = path.join(location, ownershipMarkerName);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4096) return null;
    const marker = JSON.parse(fs.readFileSync(file, "utf8"));
    return marker?.version === 1 && marker.bundle_id && marker.skill_id && marker.repo && marker.ref &&
      /^[0-9a-f]{64}$/.test(marker.token) ? marker : null;
  } catch { return null; }
}
function ownedSkill(state, source, skill, location) {
  const record = state.provenance?.[skill.id];
  const allowedRepositories = new Set([source.repo, ...(skill.ownership_predecessors ?? [])]);
  if (!allowedRepositories.has(record?.repo)) return false;
  const marker = readOwnershipMarker(location);
  if (marker && /^[0-9a-f]{64}$/.test(record.management_token ?? "") && marker.token === record.management_token &&
      marker.skill_id === skill.id && marker.repo === record.repo && marker.ref === record.ref) return true;
  // One safe migration path for the immediately preceding state format: accept
  // only an exact content digest, never repo/ref metadata by itself.
  if (record.management_token || !/^sha256v2:[0-9a-f]{64}$/.test(record.content_hash ?? "")) return false;
  try { return hashInstalledPath(location) === record.content_hash; }
  catch { return false; }
}
function ownedAsset(state, source, asset, location) {
  const record = state.asset_provenance?.[asset.destination];
  if (record?.repo !== source.repo) return false;
  if (!asset.required_files && record.management_token) {
    const marker = readAssetOwner(location);
    return isRegularFile(location) && marker?.token === record.management_token && marker.asset === asset.destination &&
      marker.repo === record.repo && marker.ref === record.ref;
  }
  const sidecar = supportPolicySidecarPath(location);
  const exactContentMatches = () => {
    if (!/^sha256v2:[0-9a-f]{64}$/.test(record.content_hash ?? "") || hashInstalledPath(location) !== record.content_hash) return false;
    if (record.policy_sidecar_hash) return /^sha256v2:[0-9a-f]{64}$/.test(record.policy_sidecar_hash) &&
      exists(sidecar) && hashInstalledPath(sidecar) === record.policy_sidecar_hash;
    return !exists(sidecar);
  };
  if (record.path_identity) {
    if (hasIdentity(location, record.path_identity)) {
      if (record.policy_sidecar_path_identity) {
        if (!exists(sidecar) || hasIdentity(sidecar, record.policy_sidecar_path_identity)) return true;
      } else if (!exists(sidecar)) return true;
    }
    try {
      if (exactContentMatches()) return true;
      // An atomic editor save replaces the file inode, leaving its immutable
      // upstream original as the ownership anchor for the preceding format.
      return !asset.required_files && isRegularFile(location) && Boolean(record.policy_sidecar_path_identity) &&
        hasIdentity(sidecar, record.policy_sidecar_path_identity) &&
        /^sha256v2:[0-9a-f]{64}$/.test(record.policy_sidecar_hash ?? "") && hashInstalledPath(sidecar) === record.policy_sidecar_hash;
    } catch { return false; }
  }
  // Safe migration from the immediately preceding state format requires exact
  // bytes for both the asset and its detached upstream-original sidecar.
  if (!/^sha256v2:[0-9a-f]{64}$/.test(record.content_hash ?? "")) return false;
  try {
    return exactContentMatches();
  } catch { return false; }
}
function assetOwnerPath(location) {
  return path.join(path.dirname(location), ".proofpilot-owners", `${path.basename(location)}.json`);
}
function readAssetOwner(location) {
  try {
    const file = assetOwnerPath(location);
    assertInstallDestination(path.dirname(location), file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4096) return null;
    const marker = JSON.parse(fs.readFileSync(file, "utf8"));
    return marker?.version === 1 && /^[0-9a-f]{64}$/.test(marker.token ?? "") ? marker : null;
  } catch { return null; }
}
function ensureOwnershipMarker(location, manifest, source, skill) {
  for (const name of fs.readdirSync(location)) {
    const folded = foldPortableName(name);
    if (folded === ownershipMarkerName && name !== ownershipMarkerName) {
      throw new Error(`Dependency source contains a reserved ProofPilot service path: ${path.join(location, name)}`);
    }
  }
  const existing = readOwnershipMarker(location);
  const token = existing && existing.bundle_id === manifest.bundle_id && existing.skill_id === skill.id &&
    existing.repo === source.repo && existing.ref === source.ref ? existing.token : crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(path.join(location, ownershipMarkerName), `${JSON.stringify({
    version: 1, bundle_id: manifest.bundle_id, skill_id: skill.id, repo: source.repo, ref: source.ref, token
  }, null, 2)}\n`, { mode: 0o600 });
  return token;
}
function assertRegularTree(location) {
  const walk = file => {
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) walk(path.join(file, name));
    else if (!stat.isFile()) throw new Error(`An existing support path contains an unsupported special file: ${file}`);
  };
  walk(location);
}
function assertAccountOwnedTree(location) {
  const [foreign] = inspectTreePermissions(location).foreignOwned;
  if (foreign) throw new Error(`An existing support path contains an entry owned by another account: ${foreign}. Inspect it and move it aside before installing.`);
}
function managedAssetPaths(destination, expectsDirectory) {
  return expectsDirectory ? [destination] : [destination, supportPolicySidecarPath(destination), assetOwnerPath(destination)].filter(exists);
}
function preflightExistingDestinations(root, manifest, state) {
  const problems = [];
  for (const source of manifest.sources) for (const kind of ["skills", "assets"]) for (const item of source[kind]) {
    try { preflightSingleDestination(root, { ...manifest, sources: [{ ...source, skills: [], assets: [], [kind]: [item] }] }, state); }
    catch (error) { problems.push(error.message); }
  }
  if (problems.length) throw new Error([...new Set(problems)].join("\n"));
}
function preflightSingleDestination(root, manifest, state) {
  const stateFile = path.join(root, stateName);
  if (exists(stateFile) && !isRegularFile(stateFile)) throw new Error(`The ProofPilot bundle state is an incompatible special file: ${stateFile}`);
  for (const source of manifest.sources) {
    for (const skill of source.skills) {
      const destination = path.join(root, skill.id);
      if (!exists(destination)) continue;
      const stat = fs.lstatSync(destination);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`An existing dependency path is an incompatible collision: ${destination}`);
      assertRegularTree(destination);
      assertAccountOwnedTree(destination);
      if (!ownedSkill(state, source, skill, destination)) {
        throw new Error(`An existing dependency is an incompatible collision because it is not owned by this ProofPilot installation: ${destination}. Move it aside before installing; --update does not adopt foreign skills.`);
      }
    }
    for (const asset of source.assets) {
      const destination = path.join(root, asset.destination);
      const expectsDirectory = Array.isArray(asset.required_files);
      if (!expectsDirectory) {
        assertInstallDestination(root, supportPolicySidecarPath(destination));
        const ownerPath = assetOwnerPath(destination);
        assertInstallDestination(root, ownerPath);
        if (exists(ownerPath)) {
          const marker = readAssetOwner(destination);
          const record = state.asset_provenance?.[asset.destination];
          if (!marker || marker.token !== record?.management_token || marker.asset !== asset.destination || marker.repo !== source.repo || marker.ref !== record.ref) {
            throw new Error(`An unowned support-asset ownership marker is an incompatible collision: ${ownerPath}`);
          }
        }
      }
      if (!exists(destination)) {
        if (!expectsDirectory && exists(supportPolicySidecarPath(destination))) {
          const sidecar = supportPolicySidecarPath(destination);
          const record = state.asset_provenance?.[asset.destination];
          const ownedOrphan = record?.repo === source.repo && record?.policy_sidecar_hash &&
            /^sha256v2:[0-9a-f]{64}$/.test(record.policy_sidecar_hash) && isRegularFile(sidecar) &&
            hashInstalledPath(sidecar) === record.policy_sidecar_hash;
          if (!ownedOrphan) throw new Error(`An orphaned support-policy sidecar collides with a new support asset: ${sidecar}`);
        }
        continue;
      }
      const stat = fs.lstatSync(destination);
      if (stat.isSymbolicLink() || (expectsDirectory ? !stat.isDirectory() : !stat.isFile())) {
        throw new Error(`An existing support asset is an incompatible collision: ${destination}`);
      }
      if (expectsDirectory) assertRegularTree(destination);
      else {
        const sidecar = supportPolicySidecarPath(destination);
        if (exists(sidecar) && !isRegularFile(sidecar)) throw new Error(`An existing support-policy sidecar is an incompatible collision: ${sidecar}`);
      }
      for (const location of managedAssetPaths(destination, expectsDirectory)) assertAccountOwnedTree(location);
      if (!ownedAsset(state, source, asset, destination)) {
        throw new Error(`An existing support asset is an incompatible collision because it is not owned by this ProofPilot installation: ${destination}. Move it aside before installing; --update does not adopt foreign guidance.`);
      }
    }
  }
}
function helperVersion(manifest, online = false, options = {}) {
  const invocation = createHelperInvocation(["--version"], { online, env: options.env, cache: options.helperCache });
  try {
    if (invocation.helperCacheIssue) {
      // Not a plain "unavailable": the operator must move the rejected tree aside.
      throw Object.assign(new Error(invocation.helperCacheIssue.diagnostic), { code: "EHELPERCACHE", helperCache: invocation.helperCacheIssue.path });
    }
    if (invocation.helperPrerequisiteIssue) {
      throw Object.assign(new Error(invocation.helperPrerequisiteIssue.diagnostic), { code: "EHELPERNPM" });
    }
    const result = spawnSync(invocation.command, invocation.args, { cwd: invocation.cwd, env: invocation.env,
      encoding: "utf8", timeout: online ? 115000 : 45000, maxBuffer: 128 * 1024, windowsHide: true, shell: invocation.shell });
    return result.status === 0 && typeof result.stdout === "string" && result.stdout.trim() === manifest.connection_helper.version;
  } finally { invocation.cleanup(); }
}

/** Local files and a cached helper version only; no account or network request. */
export function getDependencyStatus(root, options = {}) {
  root = canonicalInstallPath(root);
  assertDependencyRoot(root);
  const manifest = options.manifest ? validateDependencyManifest(options.manifest) : loadDependencyManifest();
  const stateRead = options.stateOverride ? { state: options.stateOverride, status: "valid" } : readState(root);
  const state = stateRead.state;
  const skills = manifest.sources.flatMap(source => source.skills.map(skill => {
    const location = path.join(root, skill.id);
    const skillFile = path.join(root, skill.id, "SKILL.md");
    const metadata = readSkillMetadata(skillFile);
    const missing_source_files = skill.required_files.filter(file => !requiredFile(location, file));
    if (source.license_path && !requiredFile(location, "UPSTREAM-LICENSE.txt")) missing_source_files.push("UPSTREAM-LICENSE.txt");
    const missing_files = [...new Set([...missing_source_files, ...(skill.adapted_required_files ?? []).filter(file => !requiredFile(location, file))])];
    const compatible = metadata.name === skill.id && metadata.description && atLeast(metadata.version, skill.minimum_version);
    const owned = exists(location) && ownedSkill(state, source, skill, location);
    const ownershipRecord = state.provenance?.[skill.id];
    const ownershipMarker = owned ? readOwnershipMarker(location) : null;
    const source_update_required = owned && (ownershipRecord?.repo !== source.repo || ownershipRecord?.ref !== source.ref);
    const ownership_migration_required = owned && (!ownershipMarker || !ownershipRecord?.management_token ||
      ownershipMarker.token !== ownershipRecord.management_token || ownershipMarker.repo !== ownershipRecord.repo ||
      ownershipMarker.ref !== ownershipRecord.ref || ownershipMarker.skill_id !== skill.id);
    let safeTree = false;
    let writableEntries = false;
    try {
      if (exists(location) && fs.lstatSync(location).isDirectory() && !fs.lstatSync(location).isSymbolicLink()) {
        assertRegularTree(location);
        const permissions = inspectTreePermissions(location);
        safeTree = !permissions.foreignOwned.length;
        writableEntries = permissions.writable.length > 0;
      }
    } catch { /* Report the path as incompatible below. */ }
    const policy = compatible && owned && safeTree ? inspectSupportPolicy({ location, root, sourceId: source.id, skillId: skill.id, manifest }) : null;
    const source_repair_required = owned && (!compatible || missing_source_files.length > 0 || source_update_required);
    // Drifted descendant modes are never reused; a preserving replacement hardens them.
    const permission_repair_required = owned && safeTree && writableEntries;
    const status = !exists(location) ? "missing" : !owned || !safeTree ? "incompatible" :
      source_repair_required || ownership_migration_required || permission_repair_required || missing_files.length || !policy?.complete ? "incomplete" : "installed";
    return { id: skill.id, status, owned, skill_file: compatible ? skillFile : null, missing_files, missing_source_files,
      source_repair_required, source_update_required, ownership_migration_required, permission_repair_required, policy };
  }));
  const assets = manifest.sources.flatMap(source => source.assets.map(asset => {
    const destination = path.join(root, asset.destination);
    const expectsDirectory = Array.isArray(asset.required_files);
    let safeType = false;
    let writableEntries = false;
    try {
      const stat = fs.lstatSync(destination);
      safeType = !stat.isSymbolicLink() && (expectsDirectory ? stat.isDirectory() : stat.isFile());
      if (safeType && expectsDirectory) assertRegularTree(destination);
      if (safeType) {
        const permissions = managedAssetPaths(destination, expectsDirectory).map(inspectTreePermissions);
        safeType = permissions.every(item => !item.foreignOwned.length);
        writableEntries = permissions.some(item => item.writable.length > 0);
      }
    } catch { safeType = false; }
    const files = asset.required_files ?? [""];
    const missing = files.filter(file => file ? !requiredFile(destination, file) : (() => { try { assertInstallDestination(root, destination); return !fs.lstatSync(destination).isFile(); } catch { return true; } })());
    const policy = safeType && !missing.length ? inspectSupportPolicy({ location: destination, root, sourceId: source.id, skillId: null, manifest }) : null;
    const owned = safeType && ownedAsset(state, source, asset, destination);
    const record = state.asset_provenance?.[asset.destination];
    const source_update_required = owned && record?.ref !== source.ref;
    const source_repair_required = owned && !expectsDirectory && Boolean(record?.policy_sidecar_hash) && !exists(supportPolicySidecarPath(destination));
    const permission_repair_required = owned && writableEntries;
    return { path: asset.destination, status: exists(destination) && (!safeType || !owned) ? "incompatible" : missing.length ? "missing" :
      policy?.complete && !source_update_required && !source_repair_required && !permission_repair_required ? "installed" : "incomplete", owned, source_update_required,
      source_repair_required, permission_repair_required, missing_files: missing, policy };
  }));
  let helperReady = false;
  let helperCacheIssue = null;
  try { helperReady = (options.helperVersion ?? helperVersion)(manifest, false, options) === true; }
  catch (error) {
    // Local availability remains false; only the rejected-cache diagnostic is kept.
    if (error?.code === "EHELPERCACHE") helperCacheIssue = { cache_path: error.helperCache, recovery: error.message };
  }
  let requested = stateRead.status === "invalid" ? "unknown" : state.requested_install_mode ?? state.mode ?? "full";
  const pending_transaction = !options.ignorePendingTransaction && exists(journalFile(root));
  if (pending_transaction) {
    try { requested = readPendingTransaction(root)?.requested_install_mode ?? requested; } catch { /* An invalid journal still requires recovery. */ }
  }
  const contentComplete = skills.every(item => item.status === "installed") && assets.every(item => item.status === "installed") && helperReady;
  return {
    bundle_id: manifest.bundle_id, root: path.resolve(root),
    mode: pending_transaction ? (requested === "core_only" ? "core_only" : "recovery_required") : contentComplete ? "full" :
      requested === "core_only" ? "core_only" : "incomplete",
    state_status: stateRead.status,
    requested_install_mode: requested,
    pending_transaction,
    complete: !pending_transaction && contentComplete,
    skills, assets, connection_helper: { package: manifest.connection_helper.package, available_locally: helperReady,
      ...(helperCacheIssue ? { cache_untrusted: true, ...helperCacheIssue } : {}) }
  };
}

function assertPrivateDirectory(location, label) {
  const stat = fs.lstatSync(location);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is not a private directory: ${location}`);
  if (typeof process.getuid === "function" && (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0)) {
    throw new Error(`${label} must be owned by the current user and not writable by other users: ${location}`);
  }
}
function assertSafeAncestorChain(location, label) {
  if (typeof process.getuid !== "function") return;
  const uid = process.getuid();
  for (let current = path.resolve(location); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || ![0, uid].includes(stat.uid) || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) {
      throw new Error(`${label} has an unsafe writable or unowned ancestor: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
  }
}
function secureLockBase() {
  let accountHome;
  try { accountHome = os.userInfo().homedir; } catch { /* Containers can omit a passwd entry for the current UID. */ }
  const home = fs.realpathSync(accountHome || os.homedir());
  assertPrivateDirectory(home, "The user home");
  let current = home;
  for (const name of [".proofpilot", "install-locks"]) {
    current = path.join(current, name);
    try { fs.mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    assertPrivateDirectory(current, "The ProofPilot lock directory");
  }
  return current;
}
function assertSafeInstallAnchor(root) {
  let anchor = root;
  while (!exists(anchor)) anchor = path.dirname(anchor);
  assertPrivateDirectory(anchor, "The installation root or its nearest existing parent");
  assertSafeAncestorChain(anchor, "The installation root");
  return anchor;
}
function captureRootGuard(root) {
  const anchor = assertSafeInstallAnchor(root);
  const rootIdentity = exists(root) ? pathIdentity(root) : null;
  if (rootIdentity && rootIdentity.type !== "directory") throw new Error("The skill root is not a directory.");
  return { anchor, anchorIdentity: pathIdentity(anchor), rootIdentity };
}
function assertRootGuard(root, guard, { allowCreatedRoot = false } = {}) {
  if (!hasIdentity(guard.anchor, guard.anchorIdentity)) throw new Error("The installation root ancestry changed while installation was in progress.");
  if (guard.rootIdentity) {
    if (!hasIdentity(root, guard.rootIdentity)) throw new Error("The installation root changed while installation was in progress.");
  } else if (exists(root)) {
    const identity = pathIdentity(root);
    if (!allowCreatedRoot || identity.type !== "directory" || !sameCanonicalPath(canonicalInstallPath(root), root)) {
      throw new Error("The installation root appeared or changed while installation was in progress.");
    }
    guard.rootIdentity = identity;
  }
}
function stableLockIdentity(root) {
  const resolved = path.resolve(root);
  if (typeof process.getuid !== "function") {
    const canonical = canonicalInstallPath(resolved);
    return ["darwin", "win32"].includes(process.platform) ? canonical.normalize("NFKC").toLowerCase().replaceAll("ß", "ss") : canonical;
  }
  let anchor = resolved;
  const tail = [];
  while (!exists(anchor)) {
    tail.unshift(path.basename(anchor));
    anchor = path.dirname(anchor);
  }
  while (true) {
    const parent = path.dirname(anchor);
    if (parent === anchor) break;
    try { assertPrivateDirectory(parent, "The installation lock anchor"); }
    catch { break; }
    tail.unshift(path.basename(anchor));
    anchor = parent;
  }
  const stat = fs.statSync(anchor, { bigint: true });
  return `${stat.dev}:${stat.ino}/${foldedPathParts(tail).join("/")}`;
}
function dependencyLockPath(root) {
  const lockIdentity = stableLockIdentity(root);
  const key = crypto.createHash("sha256").update(lockIdentity).digest("hex").slice(0, 24);
  return path.join(secureLockBase(), `${key}.lock`);
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}
function readLockOwner(lock) {
  const lockStat = fs.lstatSync(lock);
  const ownerFile = lockStat.isDirectory() && !lockStat.isSymbolicLink() ? path.join(lock, "owner.json") : lock;
  const ownerStat = fs.lstatSync(ownerFile);
  if ((!lockStat.isDirectory() && !lockStat.isFile()) || lockStat.isSymbolicLink() ||
      !ownerStat.isFile() || ownerStat.isSymbolicLink() || ownerStat.size > 4096 ||
      (typeof process.getuid === "function" && (ownerStat.uid !== process.getuid() || (ownerStat.mode & 0o022) !== 0))) {
    throw new Error("invalid lock");
  }
  const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.hostname !== "string" || !owner.hostname ||
      !/^[0-9a-f]{48}$/.test(owner.token) || Number.isNaN(Date.parse(owner.started_at))) {
    throw new Error("invalid lock owner");
  }
  return owner;
}
function publishInstallLock(lock, owner) {
  const temporary = `${lock}.claim-${process.pid}-${owner.token}`;
  let handle;
  try {
    handle = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(owner)}\n`);
    fs.fsyncSync(handle);
    fs.closeSync(handle); handle = undefined;
    fs.linkSync(temporary, lock);
    return pathIdentity(lock);
  } finally {
    if (handle !== undefined) try { fs.closeSync(handle); } catch { /* Preserve the publication error. */ }
    try { fs.rmSync(temporary, { force: true }); } catch { /* A private unclaimed file never blocks another installer. */ }
  }
}
function removeInstallLock(lock) {
  const stat = fs.lstatSync(lock);
  if (stat.isDirectory() && !stat.isSymbolicLink()) fs.rmSync(lock, { recursive: true, force: true });
  else fs.unlinkSync(lock);
}
function acquireInstallLockRecord(lock, root, ownerRecord, depth = 0) {
  if (depth > 64) throw new Error(`Too many interrupted ProofPilot lock recoveries for ${path.resolve(root)}.`);
  const token = ownerRecord.token;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const identity = publishInstallLock(lock, ownerRecord);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          if (!hasIdentity(lock, identity)) return;
          const owner = readLockOwner(lock);
          if (owner.token === token) removeInstallLock(lock);
        } catch { /* Never remove a lock whose ownership can no longer be proven. */ }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      let staleIdentity;
      try { owner = readLockOwner(lock); staleIdentity = pathIdentity(lock); }
      catch { throw new Error(`A ProofPilot installation lock exists but cannot be verified: ${lock}`); }
      if (owner.hostname !== os.hostname()) {
        throw new Error(`A ProofPilot installation lock from another host exists for ${path.resolve(root)} (lock: ${lock}, pid: ${owner.pid}, host: ${owner.hostname}, started: ${owner.started_at}); remove that lock only after verifying that host is no longer installing.`);
      }
      const staleBoot = owner.boot_id && ownerRecord.boot_id && owner.boot_id !== ownerRecord.boot_id;
      if (!staleBoot && processAlive(owner.pid)) throw new Error(`Another ProofPilot installation is already in progress for ${path.resolve(root)} (lock: ${lock}, pid: ${owner.pid}, host: ${owner.hostname}, started: ${owner.started_at}).`);
      // Every contender for this dead ownership generation must serialize its
      // recheck and rename. Interrupted recovery records use the same protocol.
      const recoveryKey = crypto.createHash("sha256").update(JSON.stringify({ lock, identity: staleIdentity, token: owner.token })).digest("hex").slice(0, 24);
      const recoveryLock = path.join(path.dirname(lock), `recovery-${recoveryKey}.lock`);
      const releaseRecovery = acquireInstallLockRecord(recoveryLock, root, ownerRecord, depth + 1);
      try {
        if (!hasIdentity(lock, staleIdentity)) continue;
        try {
          const current = readLockOwner(lock);
          if (current.token !== owner.token || current.pid !== owner.pid || current.hostname !== owner.hostname || (!staleBoot && processAlive(current.pid))) continue;
        } catch { continue; }
        const stale = `${lock}.stale-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
        try { fs.renameSync(lock, stale); }
        catch { continue; }
        try { removeInstallLock(stale); }
        catch { throw new Error(`Could not safely remove a stale ProofPilot installation lock: ${stale}`); }
      } finally { releaseRecovery(); }
    }
  }
  throw new Error(`Could not acquire the ProofPilot installation lock for ${path.resolve(root)}.`);
}
function currentBootId() {
  try {
    if (process.platform === "linux") return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (process.platform === "darwin") {
      const executable = "/usr/sbin/sysctl";
      const stat = fs.lstatSync(executable);
      if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022)) return null;
      const result = spawnSync(executable, ["-n", "kern.bootsessionuuid"], { encoding: "utf8", timeout: 1000, env: { PATH: "/usr/bin:/bin" } });
      if (result.status === 0 && /^[a-f0-9-]{36}$/i.test(result.stdout.trim())) return result.stdout.trim();
    }
  } catch { /* Without a reliable boot identity, preserve every live-PID lock. */ }
  return null;
}
export function acquireDependencyInstallLock(root) {
  const ownerRecord = { pid: process.pid, hostname: os.hostname(), token: crypto.randomBytes(24).toString("hex"), started_at: new Date().toISOString(), boot_id: currentBootId() };
  return acquireInstallLockRecord(dependencyLockPath(root), root, ownerRecord);
}

function writeDurableAtomic(destination, bytes, prefix = ".proofpilot-write-", publisher) {
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `${prefix}${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  let handle;
  let directoryHandle;
  try {
    handle = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
    fs.closeSync(handle); handle = undefined;
    if (process.platform !== "win32") directoryHandle = fs.openSync(directory, "r");
    if (publisher) publisher(temporary, destination);
    else fs.renameSync(temporary, destination);
    if (directoryHandle !== undefined) {
      try { fs.fsyncSync(directoryHandle); }
      catch (error) { if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error.code)) throw error; }
    }
  } finally {
    if (handle !== undefined) try { fs.closeSync(handle); } catch { /* Preserve the write error. */ }
    if (directoryHandle !== undefined) try { fs.closeSync(directoryHandle); } catch { /* Preserve the write error. */ }
    try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the write error. */ }
  }
}
function removeDurably(file) {
  let directoryHandle;
  try {
    if (process.platform !== "win32") directoryHandle = fs.openSync(path.dirname(file), "r");
    fs.rmSync(file, { force: true });
    if (directoryHandle !== undefined) {
      try { fs.fsyncSync(directoryHandle); }
      catch (error) { if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error.code)) throw error; }
    }
  } finally {
    if (directoryHandle !== undefined) try { fs.closeSync(directoryHandle); } catch { /* Preserve the removal result. */ }
  }
}

function syncInstallDirectory(directory) {
  if (process.platform === "win32") return;
  const handle = fs.openSync(directory, "r");
  try {
    try { fs.fsyncSync(handle); }
    catch (error) { if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error.code)) throw error; }
  } finally { fs.closeSync(handle); }
}
/** Persist regular contents before publishing their names; never follow links. */
export function syncPreparedTree(location) {
  const stat = fs.lstatSync(location);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(location)) syncPreparedTree(path.join(location, name));
    syncInstallDirectory(location);
  } else if (stat.isFile()) {
    const handle = fs.openSync(location, "r");
    try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  } else throw new Error(`Cannot persist unsupported special file: ${location}`);
}
function syncRenameParents(source, destination) {
  // Persist the new name before the disappearance of the old one.
  syncInstallDirectory(path.dirname(destination));
  if (path.dirname(source) !== path.dirname(destination)) syncInstallDirectory(path.dirname(source));
}
export function renameInstalledPath(source, destination) {
  fs.renameSync(source, destination);
  syncRenameParents(source, destination);
}
export function publishInstalledPath(source, destination, { symlinkType, onPublished } = {}) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    if (symlinkType !== undefined && !["dir", "file"].includes(symlinkType)) throw new Error("Invalid symbolic-link publication type.");
    const target = fs.readlinkSync(source);
    const type = process.platform === "win32" ? symlinkType ?? (fs.statSync(source).isDirectory() ? "dir" : "file") : undefined;
    try { fs.symlinkSync(target, destination, type); }
    catch (error) {
      if (error.code !== "EEXIST") error.message += " Exclusive symbolic-link publication is unavailable; use copy mode on this filesystem.";
      throw error;
    }
    syncInstallDirectory(path.dirname(destination));
    const identity = pathIdentity(destination);
    if (identity.type !== "symlink" || fs.readlinkSync(destination) !== target) {
      throw new Error(`Symbolic-link publication changed; source and destination were left intact: ${destination}`);
    }
    // Native creation is nonreplacing but has a new inode. Persist that ownership
    // before discarding preparation; an earlier interruption stays conservative.
    onPublished?.(identity);
    fs.unlinkSync(source);
    syncInstallDirectory(path.dirname(source));
  } else if (stat.isFile()) {
    // An exclusive hard link publishes the prepared inode without replacing a
    // file saved by another writer after the installer's last check.
    fs.linkSync(source, destination);
    syncInstallDirectory(path.dirname(destination));
    fs.unlinkSync(source);
    syncInstallDirectory(path.dirname(source));
  } else {
    if (exists(destination)) throw new Error(`An installation destination appeared before publication: ${destination}`);
    renameInstalledPath(source, destination);
  }
}

function validateSymlinkTypes(types) {
  if (types === undefined) return;
  if (!types || typeof types !== "object" || Array.isArray(types) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(types)) ||
      Object.entries(types).some(([relative, type]) => !["dir", "file"].includes(type) ||
        (relative !== "" && (!relativePath(relative) || /[:\x00-\x1f]/.test(relative))))) {
    throw new Error("The transaction symbolic-link type map is invalid.");
  }
}
function copyPathDurably(source, destination, { symlinkTypes, onCreated } = {}, relative = "") {
  const stat = fs.lstatSync(source);
  const knownType = Object.prototype.hasOwnProperty.call(symlinkTypes ?? {}, relative) ? symlinkTypes[relative] : undefined;
  if (process.platform === "win32" && knownType && !stat.isSymbolicLink()) {
    throw new Error(`A recorded symbolic-link path is no longer a link: ${source}`);
  }
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination, process.platform === "win32" ? knownType ?? (fs.statSync(source).isDirectory() ? "junction" : "file") : undefined);
    if (onCreated) { syncInstallDirectory(path.dirname(destination)); onCreated(destination); }
    return;
  }
  if (stat.isFile()) {
    if (onCreated) {
      // Hold the exclusively created inode throughout preparation. Its identity
      // reaches the journal before any restore contents are written.
      const output = fs.openSync(destination, "wx", 0o600);
      let input;
      try {
        syncInstallDirectory(path.dirname(destination));
        onCreated(destination);
        input = fs.openSync(source, "r");
        const buffer = Buffer.allocUnsafe(64 * 1024);
        for (let count; (count = fs.readSync(input, buffer, 0, buffer.length, null)) > 0;) {
          for (let offset = 0; offset < count;) offset += fs.writeSync(output, buffer, offset, count - offset);
        }
        fs.fchmodSync(output, stat.mode & 0o777);
        fs.fsyncSync(output);
      } finally { if (input !== undefined) fs.closeSync(input); fs.closeSync(output); }
      return;
    }
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, stat.mode & 0o777);
    const handle = fs.openSync(destination, "r");
    try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    return;
  }
  if (!stat.isDirectory()) throw new Error(`Cannot back up unsupported special file: ${source}`);
  fs.mkdirSync(destination, { mode: 0o700 });
  if (onCreated) { syncInstallDirectory(path.dirname(destination)); onCreated(destination); }
  for (const name of fs.readdirSync(source)) copyPathDurably(path.join(source, name), path.join(destination, name), { symlinkTypes }, relative ? `${relative}/${name}` : name);
  fs.chmodSync(destination, stat.mode & 0o777);
  syncInstallDirectory(destination);
}
function movePathSafely(source, destination, { quarantinePath, copyOnly = false, onPrepared, onPublished, symlinkTypes } = {}) {
  validateSymlinkTypes(symlinkTypes);
  syncPreparedTree(source);
  if (!copyOnly) {
    // Record ownership before publication. Preparation errors must not be
    // mistaken for a rename's EXDEV fallback.
    onPrepared?.(source);
    let renamed = false;
    try {
      fs.renameSync(source, destination); renamed = true;
      syncRenameParents(source, destination);
      onPublished?.(); return;
    } catch (error) {
      if (renamed) {
        error.proofpilotPublishedBackup = destination;
        error.proofpilotSourceStillPresent = exists(source);
        throw error;
      }
      if (error.code !== "EXDEV") throw error;
    }
  }
  const temporary = path.join(path.dirname(destination), `.proofpilot-copy-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  const quarantine = copyOnly ? source : quarantinePath ?? path.join(path.dirname(source), `.proofpilot-move-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  let published = false;
  if (!copyOnly) {
    if (exists(quarantine)) throw new Error(`A transaction quarantine path already exists: ${quarantine}`);
    try { renameInstalledPath(source, quarantine); }
    catch (error) {
      if (!exists(source) && exists(quarantine)) {
        try { renameInstalledPath(quarantine, source); }
        catch { error.proofpilotQuarantine = quarantine; }
      }
      throw error;
    }
  }
  try {
    copyPathDurably(quarantine, temporary, { symlinkTypes });
    onPrepared?.(temporary);
    fs.renameSync(temporary, destination);
    published = true;
    syncRenameParents(temporary, destination);
    onPublished?.();
  } catch (error) {
    if (published) {
      error.proofpilotPublishedBackup = destination;
      error.proofpilotSourceStillPresent = exists(quarantine);
    } else if (!copyOnly && !exists(source) && exists(quarantine)) {
      try { renameInstalledPath(quarantine, source); }
      catch { error.proofpilotQuarantine = quarantine; }
    }
    throw error;
  } finally { try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Preserve the move result. */ } }
  // Rollback copies retain the complete backup even on the same filesystem.
  if (copyOnly) return;
  try { fs.rmSync(quarantine, { recursive: true, force: true }); }
  catch (error) {
    error.proofpilotPublishedBackup = destination;
    error.proofpilotSourceStillPresent = exists(quarantine);
    error.proofpilotQuarantine = quarantine;
    error.message += ` The original quarantine could not be completely removed: ${quarantine}`;
    throw error;
  }
  try { syncInstallDirectory(path.dirname(quarantine)); }
  catch (error) {
    error.proofpilotPublishedBackup = destination;
    error.proofpilotSourceStillPresent = exists(quarantine);
    throw error;
  }
}
function backupBase(root) {
  const outside = path.join(path.dirname(root), ".proofpilot-backups");
  try {
    if (fs.statSync(root).dev !== fs.statSync(path.dirname(root)).dev) return path.join(root, ".proofpilot-backups");
  } catch { /* A new root necessarily shares its nearest existing parent filesystem. */ }
  try {
    if (exists(outside)) {
      assertPrivateDirectory(outside, "The ProofPilot backup directory");
      fs.accessSync(outside, fs.constants.W_OK);
    } else fs.accessSync(path.dirname(root), fs.constants.W_OK);
  } catch { return path.join(root, ".proofpilot-backups"); }
  return outside;
}
function assertBackupAvailable(root) {
  const base = backupBase(root);
  const boundary = base.startsWith(`${root}${path.sep}`) ? root : path.dirname(root);
  assertInstallDestination(boundary, path.join(base, ".proofpilot-write-check"));
  if (!exists(base)) {
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    syncInstallDirectory(base);
    syncInstallDirectory(path.dirname(base));
  }
  assertPrivateDirectory(base, "The ProofPilot backup directory");
  fs.accessSync(base, fs.constants.W_OK);
  return base;
}
export function backupInstalledPath(destination, root = path.dirname(destination), options = {}) {
  const base = assertBackupAvailable(root);
  const backup = options.backupPath ?? path.join(base, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`, path.basename(root), path.relative(root, destination));
  const boundary = base.startsWith(`${root}${path.sep}`) ? root : path.dirname(root);
  const relativeBackup = path.relative(base, backup);
  if (!path.isAbsolute(backup) || !relativeBackup || relativeBackup === ".." || relativeBackup.startsWith(`..${path.sep}`) || path.isAbsolute(relativeBackup)) {
    throw new Error("Invalid transaction backup path.");
  }
  assertInstallDestination(boundary, backup);
  if (exists(backup)) throw new Error(`A transaction backup path already exists: ${backup}`);
  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  // These ancestor entries must survive before the original name is removed.
  for (let directory = path.dirname(backup); ; directory = path.dirname(directory)) {
    syncInstallDirectory(directory);
    if (directory === boundary) break;
  }
  try { movePathSafely(destination, backup, { quarantinePath: options.quarantinePath, symlinkTypes: options.symlinkTypes }); }
  catch (error) {
    if (error.proofpilotPublishedBackup === backup) error.proofpilotBackup = backup;
    throw error;
  }
  return backup;
}
export function restoreInstalledBackup(backup, destination, root = path.dirname(destination)) {
  movePathSafely(backup, destination);
  pruneEmptyParents(path.dirname(backup), backupBase(root));
}

function stateBytes(state) { return `${JSON.stringify(state, null, 2)}\n`; }
function stateDigest(bytes) { return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; }
function installedStateDigest(root) {
  const file = path.join(root, stateName);
  if (!exists(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
    throw new Error(`The ProofPilot bundle state is incompatible: ${file}`);
  }
  return stateDigest(fs.readFileSync(file));
}
function journalFile(root) { return path.join(root, transactionName); }
function journalRelative(root, location) { return path.relative(root, location).split(path.sep).join("/"); }
function journalAbsolute(root, relative) { return path.join(root, ...relative.split("/")); }
function persistTransaction(transaction) {
  writeDurableAtomic(journalFile(transaction.root), `${JSON.stringify(transaction, null, 2)}\n`, ".proofpilot-journal-");
}
function beginInstallTransaction(root, { createdRoot = false, requestedInstallMode = "full", stateSnapshot } = {}) {
  const file = journalFile(root);
  if (exists(file)) throw new Error(`A pending ProofPilot transaction must be recovered before a new installation starts: ${file}`);
  // The fields carried into the new state must be the ones the journal binds.
  const previousStateHash = installedStateDigest(root);
  if (stateSnapshot && previousStateHash !== stateSnapshot.hash) {
    throw new Error(`The ProofPilot bundle state changed after this installation read it; no installed files were changed and the current state was preserved: ${path.join(root, stateName)}. Re-run installation after the edit is complete.`);
  }
  const transaction = {
    version: 1,
    transaction_id: crypto.randomBytes(24).toString("hex"),
    root,
    created_root: createdRoot,
    requested_install_mode: requestedInstallMode,
    started_at: new Date().toISOString(),
    previous_state_hash: previousStateHash,
    expected_state_hash: null,
    actions: [],
    cleanup_paths: []
  };
  persistTransaction(transaction);
  return transaction;
}
function transactionBackupPath(transaction, destination) {
  const base = assertBackupAvailable(transaction.root);
  return path.join(base, `transaction-${transaction.transaction_id}`, `${String(transaction.actions.length).padStart(3, "0")}-${path.basename(destination)}`);
}
export function addTransactionCleanup(transaction, location) {
  assertInstallDestination(transaction.root, location);
  if (!exists(location) || !fs.lstatSync(location).isDirectory()) throw new Error("A transaction cleanup path must be an existing directory.");
  const relative = journalRelative(transaction.root, location);
  if (!relativePath(relative) || !relative.startsWith(".proofpilot-")) throw new Error("A transaction cleanup path is not journal-safe.");
  if (!transaction.cleanup_paths.some(item => item.path === relative)) {
    transaction.cleanup_paths.push({ path: relative, path_identity: pathIdentity(location) });
    persistTransaction(transaction);
  }
}
export function addTransactionAction(transaction, { destination, staging, initialExists, initialIdentity, kind, symlinkTypes }) {
  validateSymlinkTypes(symlinkTypes);
  assertInstallDestination(transaction.root, destination, { replaceFinalLink: true });
  assertInstallDestination(transaction.root, staging, { replaceFinalLink: true });
  const currentExists = exists(destination);
  if (currentExists !== initialExists || (currentExists && !hasIdentity(destination, initialIdentity))) {
    throw new Error(`A transaction target changed before its durable intent was recorded: ${destination}`);
  }
  const relativeDestination = journalRelative(transaction.root, destination);
  if (!relativePath(relativeDestination)) throw new Error("An installation destination is not journal-safe.");
  const action = {
    kind,
    destination: relativeDestination,
    original_exists: initialExists,
    original_identity: initialExists ? initialIdentity : null,
    original_fingerprint: initialExists ? recoveryFingerprint(destination) : null,
    staged_identity: pathIdentity(staging),
    staged_fingerprint: recoveryFingerprint(staging),
    activation_started: false,
    backup_started: false,
    backup_quarantine: initialExists ? journalRelative(transaction.root, path.join(path.dirname(destination), `.proofpilot-move-${transaction.transaction_id}-${transaction.actions.length}`)) : null,
    restore_temporary: initialExists ? journalRelative(transaction.root, path.join(path.dirname(destination), `.proofpilot-copy-${transaction.transaction_id}-${transaction.actions.length}`)) : null,
    ...(symlinkTypes === undefined ? {} : { symlink_types: { ...symlinkTypes } }),
    backup: initialExists ? transactionBackupPath(transaction, destination) : null
  };
  transaction.actions.push(action);
  persistTransaction(transaction);
  return action;
}
export function startTransactionBackup(transaction, action) {
  action.backup_started = true;
  persistTransaction(transaction);
}
export function startTransactionActivation(transaction, action) {
  action.activation_started = true;
  persistTransaction(transaction);
}
export function recordTransactionPublication(transaction, action, identity) {
  const destination = journalAbsolute(transaction.root, action.destination);
  if (!transaction.actions.includes(action) || !action.activation_started || identity.type !== "symlink" ||
      !hasIdentity(destination, identity) || recoveryFingerprint(destination) !== action.staged_fingerprint) {
    throw new Error("Published symbolic-link ownership or content changed before it could be recorded.");
  }
  action.staged_identity = identity;
  persistTransaction(transaction);
}
function transactionPaths(transaction, action) {
  return { destination: journalAbsolute(transaction.root, action.destination), backup: action.backup };
}
function assertStoredBackupPath(root, backup) {
  if (!backup || !path.isAbsolute(backup)) throw new Error("A pending transaction has an invalid backup path.");
  const bases = [path.join(path.dirname(root), ".proofpilot-backups"), path.join(root, ".proofpilot-backups")];
  for (const base of bases) {
    const relative = path.relative(base, backup);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
    if (exists(base)) {
      assertPrivateDirectory(base, "The pending transaction backup directory");
      // A managed installation may itself be a development symlink. The final
      // backup entry can therefore be a symlink, but no parent may be one.
      assertInstallDestination(base, backup, { replaceFinalLink: true });
    }
    return base;
  }
  throw new Error("A pending transaction backup escapes the managed backup directories.");
}
function readPendingTransaction(root) {
  const file = journalFile(root);
  if (!exists(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024 ||
      (typeof process.getuid === "function" && (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0))) {
    throw new Error(`The pending ProofPilot transaction journal is unsafe: ${file}`);
  }
  let transaction;
  try { transaction = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error(`The pending ProofPilot transaction journal is invalid: ${file}`); }
  const hasPreviousStateHash = Object.prototype.hasOwnProperty.call(transaction ?? {}, "previous_state_hash");
  if (transaction?.version !== 1 || !/^[0-9a-f]{48}$/.test(transaction.transaction_id ?? "") ||
      !samePhysicalPath(transaction.root, root) || !Array.isArray(transaction.actions) || !Array.isArray(transaction.cleanup_paths) ||
      (transaction.requested_install_mode !== undefined && !["full", "core_only"].includes(transaction.requested_install_mode)) ||
      (hasPreviousStateHash && transaction.previous_state_hash !== null && !/^sha256:[0-9a-f]{64}$/.test(transaction.previous_state_hash)) ||
      (transaction.rollback_state_hash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(transaction.rollback_state_hash)) ||
      (transaction.concurrent_state_hash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(transaction.concurrent_state_hash)) ||
      (transaction.expected_state_hash !== null && !/^sha256:[0-9a-f]{64}$/.test(transaction.expected_state_hash))) {
    throw new Error(`The pending ProofPilot transaction journal is incompatible: ${file}`);
  }
  const validIdentity = identity => identity && typeof identity === "object" &&
    typeof identity.dev === "string" && typeof identity.ino === "string" && ["directory", "file", "symlink"].includes(identity.type);
  if (transaction.rollback_state_capture !== undefined) {
    const capture = transaction.rollback_state_capture;
    if (!capture || capture.path !== `.proofpilot-rollback-state-${transaction.transaction_id}` ||
        !validIdentity(capture.directory_identity) || capture.directory_identity.type !== "directory" ||
        !validIdentity(capture.state_identity) || capture.state_identity.type !== "file" ||
        !/^sha256:[0-9a-f]{64}$/.test(capture.state_hash ?? "") ||
        (capture.prepared_identity !== undefined && (!validIdentity(capture.prepared_identity) || capture.prepared_identity.type !== "file" ||
          !/^sha256:[0-9a-f]{64}$/.test(capture.prepared_hash ?? ""))) ||
        (capture.prepared_hash !== undefined && capture.prepared_identity === undefined)) {
      throw new Error(`The pending transaction rollback state capture is invalid: ${file}`);
    }
    assertInstallDestination(root, journalAbsolute(root, capture.path));
  }
  if (transaction.commit_state_capture !== undefined) {
    const capture = transaction.commit_state_capture;
    if (!capture || capture.path !== `.proofpilot-commit-state-${transaction.transaction_id}` ||
        !validIdentity(capture.directory_identity) || capture.directory_identity.type !== "directory" ||
        (capture.state_identity !== undefined && (!validIdentity(capture.state_identity) || capture.state_identity.type !== "file")) ||
        (capture.prepared_identity !== undefined && (!validIdentity(capture.prepared_identity) || capture.prepared_identity.type !== "file" ||
          !/^sha256:[0-9a-f]{64}$/.test(capture.prepared_hash ?? ""))) ||
        (capture.prepared_hash !== undefined && capture.prepared_identity === undefined)) {
      throw new Error(`The pending transaction commit state capture is invalid: ${file}`);
    }
    assertInstallDestination(root, journalAbsolute(root, capture.path));
  }
  for (const action of transaction.actions) {
    if (!action || !["support", "core"].includes(action.kind) || !relativePath(action.destination) ||
        typeof action.original_exists !== "boolean" || !validIdentity(action.staged_identity) ||
        !/^sha256-recovery-v1:[0-9a-f]{64}$/.test(action.staged_fingerprint ?? "") ||
        (action.original_exists && (!validIdentity(action.original_identity) || !/^sha256-recovery-v1:[0-9a-f]{64}$/.test(action.original_fingerprint ?? "")))) {
      throw new Error(`The pending ProofPilot transaction journal has an invalid action: ${file}`);
    }
    assertInstallDestination(root, journalAbsolute(root, action.destination), { replaceFinalLink: true });
    if (action.backup_started !== undefined && typeof action.backup_started !== "boolean") throw new Error(`The pending ProofPilot transaction journal has an invalid backup phase: ${file}`);
    if (action.activation_started !== undefined && typeof action.activation_started !== "boolean") throw new Error(`The pending ProofPilot transaction journal has an invalid activation phase: ${file}`);
    if (action.backup_quarantine !== undefined && action.backup_quarantine !== null) {
      const expected = path.posix.join(path.posix.dirname(action.destination), `.proofpilot-move-${transaction.transaction_id}-${transaction.actions.indexOf(action)}`);
      if (action.backup_quarantine !== expected) throw new Error(`The pending transaction quarantine path is invalid: ${file}`);
      assertInstallDestination(root, journalAbsolute(root, action.backup_quarantine), { replaceFinalLink: true });
    }
    if (action.restored_identity !== undefined && !validIdentity(action.restored_identity)) throw new Error(`The pending transaction restored identity is invalid: ${file}`);
    if (action.restore_temporary !== undefined && action.restore_temporary !== null) {
      const expected = path.posix.join(path.posix.dirname(action.destination), `.proofpilot-copy-${transaction.transaction_id}-${transaction.actions.indexOf(action)}`);
      if (!action.original_exists || action.restore_temporary !== expected) throw new Error(`The pending transaction restore temporary path is invalid: ${file}`);
      assertInstallDestination(root, journalAbsolute(root, action.restore_temporary), { replaceFinalLink: true });
    }
    if (action.restore_temporary_identity !== undefined && (!action.restore_temporary || !validIdentity(action.restore_temporary_identity))) {
      throw new Error(`The pending transaction restore temporary identity is invalid: ${file}`);
    }
    if (action.restore_temporary_fingerprint !== undefined && (!action.restore_temporary_identity ||
        !/^sha256-recovery-v1:[0-9a-f]{64}$/.test(action.restore_temporary_fingerprint))) {
      throw new Error(`The pending transaction restore temporary fingerprint is invalid: ${file}`);
    }
    validateSymlinkTypes(action.symlink_types);
    if (action.original_exists) assertStoredBackupPath(transaction.root, action.backup);
    else if (action.backup !== null || action.original_identity !== null || action.original_fingerprint !== null) {
      throw new Error(`The pending ProofPilot transaction journal has inconsistent ownership: ${file}`);
    }
  }
  for (const cleanup of transaction.cleanup_paths) {
    if (!relativePath(cleanup?.path) || !cleanup.path.startsWith(".proofpilot-") || !validIdentity(cleanup.path_identity)) {
      throw new Error(`The pending ProofPilot transaction journal has an invalid cleanup path: ${file}`);
    }
    assertInstallDestination(root, journalAbsolute(root, cleanup.path));
  }
  return transaction;
}
function cleanupTransactionPaths(transaction) {
  for (const cleanup of [...transaction.cleanup_paths].reverse()) {
    const location = journalAbsolute(transaction.root, cleanup.path);
    if (exists(location) && hasIdentity(location, cleanup.path_identity)) {
      try { fs.rmSync(location, { recursive: true, force: true }); } catch { /* Recovery reports active data separately. */ }
    }
  }
}
function clearTransaction(transaction) {
  removeDurably(journalFile(transaction.root));
}
function filePrefixUnchanged(source, temporary, size) {
  const original = fs.openSync(source, "r");
  let prepared;
  try {
    prepared = fs.openSync(temporary, "r");
    const left = Buffer.allocUnsafe(64 * 1024), right = Buffer.allocUnsafe(64 * 1024);
    for (let offset = 0; offset < size;) {
      const count = Math.min(left.length, size - offset);
      if (fs.readSync(original, left, 0, count, offset) !== count || fs.readSync(prepared, right, 0, count, offset) !== count ||
          !left.subarray(0, count).equals(right.subarray(0, count))) return false;
      offset += count;
    }
    return true;
  } finally { fs.closeSync(original); if (prepared !== undefined) fs.closeSync(prepared); }
}
function copiedSubsetUnchanged(source, temporary) {
  const original = fs.lstatSync(source), prepared = fs.lstatSync(temporary);
  if (original.isSymbolicLink()) return prepared.isSymbolicLink() && fs.readlinkSync(source) === fs.readlinkSync(temporary);
  if (original.isFile()) return prepared.isFile() && [0o600, original.mode & 0o777].includes(prepared.mode & 0o777) &&
    prepared.size <= original.size && filePrefixUnchanged(source, temporary, prepared.size);
  if (!original.isDirectory() || !prepared.isDirectory() || ![0o700, original.mode & 0o777].includes(prepared.mode & 0o777)) return false;
  // Interrupted copies contain only source entries or source byte prefixes.
  // Never follow a link or discard additional or differing contents.
  return fs.readdirSync(temporary).every(name => exists(path.join(source, name)) &&
    copiedSubsetUnchanged(path.join(source, name), path.join(temporary, name)));
}
function restoreTemporaryUnchanged(action, backup, temporary) {
  if (!hasIdentity(temporary, action.restore_temporary_identity)) throw new Error("restore_temporary_ownership_changed");
  const fingerprint = recoveryFingerprint(temporary);
  if (fingerprint === action.restore_temporary_fingerprint || fingerprint === action.original_fingerprint) return true;
  if (action.restore_temporary_fingerprint === action.original_fingerprint || !copiedSubsetUnchanged(backup, temporary)) {
    throw new Error("restore_temporary_changed");
  }
  return true;
}
function prepareTransactionRestore(transaction, action, backup, destination, actionIndex) {
  if (!action.restore_temporary) {
    action.restore_temporary = journalRelative(transaction.root, path.join(path.dirname(destination), `.proofpilot-copy-${transaction.transaction_id}-${actionIndex}`));
    persistTransaction(transaction);
  }
  const temporary = journalAbsolute(transaction.root, action.restore_temporary);
  if (exists(temporary)) {
    restoreTemporaryUnchanged(action, backup, temporary);
    if (recoveryFingerprint(temporary) === action.original_fingerprint) {
      action.restored_identity = pathIdentity(temporary);
      action.restore_temporary_fingerprint = action.original_fingerprint;
      persistTransaction(transaction);
      return temporary;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
    syncInstallDirectory(path.dirname(temporary));
  }
  copyPathDurably(backup, temporary, { symlinkTypes: action.symlink_types, onCreated: created => {
    action.restore_temporary_identity = pathIdentity(created);
    action.restore_temporary_fingerprint = recoveryFingerprint(created);
    delete action.restored_identity;
    persistTransaction(transaction);
  } });
  if (recoveryFingerprint(temporary) !== action.original_fingerprint) throw new Error("restore_preparation_verification_failed");
  action.restored_identity = pathIdentity(temporary);
  action.restore_temporary_fingerprint = action.original_fingerprint;
  persistTransaction(transaction);
  return temporary;
}
/** Earlier releases persisted NFKC (and on darwin/win32 case-folded) keys instead of exact core paths. */
export function legacyCorePathAliases(relative) {
  const normalized = relative.normalize("NFKC");
  return [...new Set([relative, normalized, normalized.toLowerCase().replaceAll("ß", "ss")])];
}
function updateRolledBackOwnership(transaction) {
  const file = path.join(transaction.root, stateName);
  if (!exists(file)) return;
  const previousBytes = fs.readFileSync(file), previousHash = stateDigest(previousBytes);
  if (![transaction.previous_state_hash, transaction.rollback_state_hash, transaction.concurrent_state_hash].includes(previousHash)) {
    throw new Error("rollback_state_changed_before_capture; active state and the journal were left unchanged");
  }
  const previousIdentity = pathIdentity(file);
  let state;
  // A preserved concurrent save need not be state JSON; it stays exactly as saved.
  try { state = JSON.parse(previousBytes); } catch { return; }
  if (!state || typeof state !== "object" || Array.isArray(state)) return;
  let changed = false;
  for (const action of transaction.actions) {
    if (!action.original_exists || !action.restored_identity) continue;
    const destination = journalAbsolute(transaction.root, action.destination);
    if (!hasIdentity(destination, action.restored_identity)) continue;
    // A copied directory-asset restore also has a new inode. Refresh only a
    // record proven to have owned this action's original physical directory;
    // otherwise a safe preserving rollback would make the next repair refuse it.
    if (action.kind === "support" && action.original_identity.type === "directory") {
      const record = state.asset_provenance?.[action.destination], identity = record?.path_identity;
      if (identity && identity.dev === action.original_identity.dev && identity.ino === action.original_identity.ino &&
          identity.type === action.original_identity.type) {
        if (![transaction.previous_state_hash, transaction.rollback_state_hash].includes(previousHash)) {
          throw new Error(`A concurrent state save prevents refreshing restored directory ownership: ${file}. The exact saved state bytes and restored content at ${destination} were preserved; pending journal ${journalFile(transaction.root)} was retained. Reconcile the saved asset ownership with this journal's proven restored directory identity before retrying installation.`);
        }
        record.path_identity = pathIdentity(destination);
        changed = true;
      }
    }
    if (action.kind !== "core" || !state.core_entries || typeof state.core_entries !== "object" || Array.isArray(state.core_entries)) continue;
    for (const record of Object.values(state.core_entries)) {
      const identity = record?.path_identity;
      // The pre-rollback inode is the only proof that a legacy normalized key
      // named this physical path; the refreshed record stores the exact path.
      if (!identity || identity.dev !== action.original_identity.dev || identity.ino !== action.original_identity.ino ||
          identity.type !== action.original_identity.type || typeof record.path !== "string" ||
          !legacyCorePathAliases(action.destination).includes(record.path)) continue;
      record.path = action.destination;
      record.path_identity = pathIdentity(destination);
      changed = true;
    }
  }
  if (!changed) return;
  const bytes = stateBytes(state);
  // This state write acknowledges restored ownership; it is never the install
  // commit point. Persist its separate accepted hash before publishing it.
  transaction.rollback_state_hash = stateDigest(bytes);
  persistTransaction(transaction);
  writeDurableAtomic(file, bytes, ".proofpilot-state-", prepared => {
    prepareRollbackStateCapture(transaction, previousIdentity, previousHash);
    const captured = rollbackCapturedFile(transaction);
    const preparedState = path.join(path.dirname(captured), "prepared.json");
    if (exists(preparedState)) removePreparedRollbackState(transaction);
    transaction.rollback_state_capture.prepared_identity = pathIdentity(prepared);
    transaction.rollback_state_capture.prepared_hash = transaction.rollback_state_hash;
    persistTransaction(transaction);
    // Prove exclusive publication works before moving the active state name.
    publishInstalledPath(prepared, preparedState);
    captureRollbackState(transaction, previousIdentity, previousHash);
    try { publishInstalledPath(preparedState, file); }
    catch (error) {
      if (!exists(file) && exists(captured)) {
        try { publishInstalledPath(captured, file); } catch { /* Keep the captured state and pending journal. */ }
      }
      throw error;
    }
    if (installedStateDigest(transaction.root) !== transaction.rollback_state_hash) throw new Error("rollback_state_publication_changed");
  });
}
function rollbackCapturedFile(transaction) {
  return path.join(journalAbsolute(transaction.root, transaction.rollback_state_capture.path), "original.json");
}
function assertRollbackStateDirectory(transaction) {
  const directory = journalAbsolute(transaction.root, transaction.rollback_state_capture.path);
  if (!hasIdentity(directory, transaction.rollback_state_capture.directory_identity)) throw new Error("rollback_state_quarantine_ownership_changed");
  assertPrivateDirectory(directory, "The rollback state holding directory");
  if (fs.readdirSync(directory).some(name => !["original.json", "prepared.json"].includes(name))) throw new Error("rollback_state_quarantine_contents_changed");
  return directory;
}
function capturedStateUnchanged(transaction) {
  const captured = rollbackCapturedFile(transaction), capture = transaction.rollback_state_capture;
  return hasIdentity(captured, capture.state_identity) && stateDigest(fs.readFileSync(captured)) === capture.state_hash;
}
function removePreparedRollbackState(transaction) {
  const capture = transaction.rollback_state_capture, prepared = path.join(journalAbsolute(transaction.root, capture.path), "prepared.json");
  if (!hasIdentity(prepared, capture.prepared_identity) || stateDigest(fs.readFileSync(prepared)) !== capture.prepared_hash) {
    throw new Error("rollback_state_prepared_ownership_or_content_changed");
  }
  removeDurably(prepared);
}
function prepareRollbackStateCapture(transaction, stateIdentity, stateHash) {
  if (!transaction.rollback_state_capture) {
    const relative = `.proofpilot-rollback-state-${transaction.transaction_id}`, directory = journalAbsolute(transaction.root, relative);
    if (exists(directory)) throw new Error("rollback_state_quarantine_path_already_exists");
    fs.mkdirSync(directory, { mode: 0o700 });
    syncInstallDirectory(transaction.root);
    transaction.rollback_state_capture = { path: relative, directory_identity: pathIdentity(directory), state_identity: stateIdentity, state_hash: stateHash };
    persistTransaction(transaction);
  }
  return assertRollbackStateDirectory(transaction);
}
function captureRollbackState(transaction, stateIdentity, stateHash) {
  const file = path.join(transaction.root, stateName);
  prepareRollbackStateCapture(transaction, stateIdentity, stateHash);
  const captured = rollbackCapturedFile(transaction);
  if (exists(captured)) throw new Error("rollback_state_quarantine_already_contains_state");
  renameInstalledPath(file, captured);
  assertRollbackStateDirectory(transaction);
  if (!capturedStateUnchanged(transaction)) {
    if (!exists(file) && fs.lstatSync(captured).isFile()) publishInstalledPath(captured, file);
    throw new Error("rollback_state_capture_changed; captured state preserved and the journal retained");
  }
}
function recoverRollbackStateCapture(transaction) {
  if (!transaction.rollback_state_capture) return null;
  const directory = journalAbsolute(transaction.root, transaction.rollback_state_capture.path), file = path.join(transaction.root, stateName);
  if (!exists(directory)) {
    if (!exists(file)) throw new Error("rollback_state_backup_missing");
    return null;
  }
  assertRollbackStateDirectory(transaction);
  const captured = rollbackCapturedFile(transaction);
  if (exists(captured)) {
    const unchanged = capturedStateUnchanged(transaction);
    if (!exists(file) && fs.lstatSync(captured).isFile()) publishInstalledPath(captured, file);
    if (!unchanged) throw new Error("rollback_state_capture_changed; captured state preserved and the journal retained");
    // A kill while restoring the captured state can leave two names for it.
    if (exists(captured) && hasIdentity(file, transaction.rollback_state_capture.state_identity)) removeDurably(captured);
  } else if (!exists(file)) throw new Error("rollback_state_backup_missing");
  return hasIdentity(file, transaction.rollback_state_capture.state_identity) && installedStateDigest(transaction.root) === transaction.rollback_state_capture.state_hash ?
    transaction.rollback_state_capture.state_hash : null;
}
function cleanupRollbackStateCapture(transaction) {
  if (!transaction.rollback_state_capture) return;
  const directory = journalAbsolute(transaction.root, transaction.rollback_state_capture.path);
  if (!exists(directory)) return;
  assertRollbackStateDirectory(transaction);
  const captured = rollbackCapturedFile(transaction);
  if (exists(captured)) {
    if (!capturedStateUnchanged(transaction)) throw new Error("rollback_state_capture_changed");
    removeDurably(captured);
  }
  if (exists(path.join(directory, "prepared.json"))) removePreparedRollbackState(transaction);
  fs.rmdirSync(directory);
  syncInstallDirectory(transaction.root);
}
function commitStateDirectoryTrusted(transaction) {
  const capture = transaction.commit_state_capture, directory = journalAbsolute(transaction.root, capture.path);
  try {
    if (!hasIdentity(directory, capture.directory_identity)) return false;
    assertPrivateDirectory(directory, "The commit state holding directory");
    return fs.readdirSync(directory).every(name => ["original.json", "prepared.json"].includes(name));
  } catch { return false; }
}
function recoverCommitStateCapture(transaction) {
  if (!transaction.commit_state_capture || !commitStateDirectoryTrusted(transaction)) return;
  const file = path.join(transaction.root, stateName), directory = journalAbsolute(transaction.root, transaction.commit_state_capture.path);
  const captured = path.join(directory, "original.json");
  // The prepared state is held before the old name is captured and is unlinked
  // only after publication, so without it a later deletion is left untouched.
  if (exists(file) || !isRegularFile(captured) || !exists(path.join(directory, "prepared.json"))) return;
  // An interrupted commit left the active state only in its holding path.
  publishInstalledPath(captured, file);
  const hash = installedStateDigest(transaction.root);
  if (![transaction.previous_state_hash, transaction.concurrent_state_hash].includes(hash)) {
    // The capture held another writer's save; roll back while keeping it active.
    transaction.concurrent_state_hash = hash;
    persistTransaction(transaction);
  }
}
function cleanupCommitStateCapture(transaction) {
  const capture = transaction.commit_state_capture;
  if (!capture) return [];
  const directory = journalAbsolute(transaction.root, capture.path);
  if (!exists(directory)) return [];
  if (!commitStateDirectoryTrusted(transaction)) return [directory];
  const active = (() => {
    try { return isRegularFile(path.join(transaction.root, stateName)) ? currentStateBinding(transaction.root) : null; }
    catch { return null; }
  })();
  const preserved = [];
  for (const [name, identity, hash] of [["prepared.json", capture.prepared_identity, capture.prepared_hash],
    ["original.json", capture.state_identity, transaction.previous_state_hash]]) {
    const location = path.join(directory, name);
    if (!exists(location)) continue;
    try {
      // A second name of the active state and the unpublished prepared state hold
      // no unique bytes. The captured original is superseded only by this commit;
      // a state created by another writer leaves it preserved and reported.
      const secondName = Boolean(active) && hasIdentity(location, active.identity);
      const unchanged = Boolean(identity) && hasIdentity(location, identity) && stateDigest(fs.readFileSync(location)) === hash;
      if (secondName || (unchanged && (name === "prepared.json" || (Boolean(active) && active.hash === capture.prepared_hash)))) removeDurably(location);
      else preserved.push(location);
    } catch { preserved.push(location); }
  }
  if (preserved.length) return preserved;
  try { fs.rmdirSync(directory); syncInstallDirectory(transaction.root); }
  catch { return [directory]; }
  return [];
}
function recoverPendingTransactionLocked(root) {
  const transaction = readPendingTransaction(root);
  if (!transaction) return { recovered: false, committed: false, backups: [] };
  const capturedStateHash = recoverRollbackStateCapture(transaction);
  recoverCommitStateCapture(transaction);
  const currentStateHash = installedStateDigest(root);
  // The durable state write is the commit point. Later user edits, atomic saves or
  // deletions must never turn a committed transaction back into a rollback.
  const committed = Boolean(transaction.expected_state_hash && currentStateHash === transaction.expected_state_hash);
  if (committed) {
    const preservedState = cleanupCommitStateCapture(transaction);
    cleanupTransactionPaths(transaction);
    clearTransaction(transaction);
    const backups = [...transaction.actions.flatMap(action => [action.backup,
      action.backup_quarantine && journalAbsolute(root, action.backup_quarantine)]).filter(location => location && exists(location)), ...preservedState];
    return { recovered: true, committed: true, backups };
  }
  const hasPreviousStateHash = Object.prototype.hasOwnProperty.call(transaction, "previous_state_hash");
  // A save that another writer made before the commit stays active; the journal
  // recorded its exact hash when the commit refused to replace it.
  if ((!hasPreviousStateHash && currentStateHash !== null) ||
      (hasPreviousStateHash && currentStateHash !== transaction.previous_state_hash && currentStateHash !== transaction.rollback_state_hash &&
        currentStateHash !== transaction.concurrent_state_hash && (!capturedStateHash || currentStateHash !== capturedStateHash))) {
    throw new Error("ProofPilot cannot safely roll back a pending transaction because the bundle state no longer matches the transaction's starting state. Active data and the journal were left unchanged.");
  }
  const failures = [];
  const preservedBackups = [];
  for (const [reverseIndex, action] of [...transaction.actions].reverse().entries()) {
    const { destination, backup } = transactionPaths(transaction, action);
    const actionIndex = transaction.actions.length - reverseIndex - 1;
    const recovered = path.join(backupBase(root), `transaction-${transaction.transaction_id}`,
      `recovered-${String(actionIndex).padStart(3, "0")}-${path.basename(destination)}`);
    if (exists(recovered)) preservedBackups.push(recovered);
    try {
      const quarantine = action.backup_quarantine ? journalAbsolute(transaction.root, action.backup_quarantine) : null;
      if (quarantine && exists(quarantine)) {
        preservedBackups.push(quarantine);
        if (!hasIdentity(quarantine, action.original_identity)) throw new Error("original_quarantine_changed");
        if (recoveryFingerprint(quarantine) === action.original_fingerprint) {
          if (!exists(destination)) renameInstalledPath(quarantine, destination);
        } else if (!exists(backup) || recoveryFingerprint(backup) !== action.original_fingerprint) {
          throw new Error("original_quarantine_changed; backup_missing_or_changed");
        }
        // A partially removed or later edited holding copy stays untouched;
        // only the complete verified backup can be used to restore it.
      }
      let originalActive = exists(destination) && action.original_exists && (hasIdentity(destination, action.original_identity) || hasIdentity(destination, action.restored_identity));
      // Validate the restore source before removing or moving any active data.
      // An untouched original (including later user edits or deletion) needs no rollback.
      const untouchedDeletion = action.original_exists && !exists(destination) && !exists(backup) && (action.backup_started === false || action.restored_identity);
      if (untouchedDeletion) continue;
      if (action.original_exists && action.backup_started === false && !exists(backup) &&
          !(quarantine && exists(quarantine)) && exists(destination) && !hasIdentity(destination, action.staged_identity)) continue;
      if (!action.original_exists && action.activation_started === false && exists(destination) && !hasIdentity(destination, action.staged_identity)) continue;
      const backupBasePath = action.original_exists ? assertStoredBackupPath(transaction.root, backup) : null;
      if (action.original_exists && !originalActive && (!exists(backup) || recoveryFingerprint(backup) !== action.original_fingerprint)) {
        throw new Error("backup_missing_or_changed; active data left unchanged");
      }
      // Complete and durably identify the restore on the destination filesystem
      // before removing or moving the currently available installation.
      const preparedRestore = action.original_exists && !originalActive ?
        prepareTransactionRestore(transaction, action, backup, destination, actionIndex) : null;
      if (originalActive && action.restore_temporary && exists(journalAbsolute(root, action.restore_temporary))) {
        const temporary = journalAbsolute(root, action.restore_temporary);
        if (!exists(backup) || recoveryFingerprint(backup) !== action.original_fingerprint) throw new Error("backup_missing_or_changed");
        // A kill after exclusive file publication can leave two names for the
        // same restored inode. Removing the temporary name preserves all later
        // edits through the active name, including edits through its alias.
        const sharedActiveFile = action.restore_temporary_identity?.type === "file" &&
          hasIdentity(temporary, action.restore_temporary_identity) && hasIdentity(destination, action.restore_temporary_identity);
        if (!sharedActiveFile) restoreTemporaryUnchanged(action, backup, temporary);
        fs.rmSync(temporary, { recursive: true, force: true });
        syncInstallDirectory(path.dirname(temporary));
      }
      if (exists(destination)) {
        if (hasIdentity(destination, action.staged_identity)) {
          let unchanged = false;
          try { unchanged = recoveryFingerprint(destination) === action.staged_fingerprint; } catch { /* Preserve changed or special content. */ }
          if (unchanged) {
            fs.rmSync(destination, { recursive: true, force: true });
            syncInstallDirectory(path.dirname(destination));
          }
          else {
            if (exists(recovered)) throw new Error("recovered_path_already_exists");
            backupInstalledPath(destination, root, { backupPath: recovered });
            preservedBackups.push(recovered);
          }
        }
        else if (action.original_exists && (hasIdentity(destination, action.original_identity) || hasIdentity(destination, action.restored_identity))) {
          originalActive = true;
        }
        else throw new Error("active_path_ownership_changed");
      }
      if (action.original_exists) {
        if (originalActive) {
          if (exists(backup)) {
            if (recoveryFingerprint(backup) !== action.original_fingerprint) throw new Error("backup_content_changed");
            preservedBackups.push(backup);
          }
        } else {
          if (exists(destination)) throw new Error("active_path_appeared_before_restore_publication");
          publishInstalledPath(preparedRestore, destination, {
            symlinkType: action.symlink_types?.[""],
            onPublished: identity => { action.restored_identity = identity; persistTransaction(transaction); }
          });
          action.restored_identity = pathIdentity(destination);
          persistTransaction(transaction);
          if (recoveryFingerprint(destination) !== action.original_fingerprint) throw new Error("restore_verification_failed");
          if (exists(backup)) preservedBackups.push(backup);
          pruneEmptyParents(path.dirname(backup), backupBasePath);
        }
      } else if (exists(destination)) throw new Error("new_destination_could_not_be_removed");
    } catch (error) {
      failures.push({ destination, backup: backup && exists(backup) ? backup : null, reason: error.message,
        preserved_paths: preservedBackups.filter(exists) });
    }
  }
  cleanupTransactionPaths(transaction);
  if (failures.length) {
    throw new Error(`ProofPilot could not safely recover a pending transaction (${journalFile(transaction.root)}). Preserved backup/recovery paths: ${JSON.stringify(failures)}`);
  }
  preservedBackups.push(...cleanupCommitStateCapture(transaction));
  try {
    updateRolledBackOwnership(transaction);
    cleanupRollbackStateCapture(transaction);
  } catch (error) {
    if (transaction.rollback_state_capture) error.message += ` Preserved rollback state holding path: ${journalAbsolute(root, transaction.rollback_state_capture.path)}; pending journal: ${journalFile(root)}`;
    throw error;
  }
  clearTransaction(transaction);
  if (transaction.created_root) {
    try { fs.rmdirSync(root); } catch { /* Keep a non-empty root and any durable backups. */ }
  }
  return { recovered: true, committed: false, backups: preservedBackups };
}
function prepareTransactionCommit(transaction, state) {
  state.installation_transaction_id = transaction.transaction_id;
  const bytes = stateBytes(state);
  transaction.expected_state_hash = stateDigest(bytes);
  persistTransaction(transaction);
  return bytes;
}
function finishInstallTransaction(transaction, state, afterStateWrite) {
  const bytes = prepareTransactionCommit(transaction, state);
  const preserved = writeBundleState(transaction, bytes);
  afterStateWrite?.({ root: transaction.root, state, transaction });
  clearTransaction(transaction);
  return preserved;
}
export function recoverPendingInstallation(root) {
  root = canonicalInstallPath(root);
  assertDependencyRoot(root);
  const releaseLock = acquireDependencyInstallLock(root);
  try {
    captureRootGuard(root);
    return recoverPendingTransactionLocked(root);
  }
  finally { releaseLock(); }
}

export function trustedGitExecutable(value = process.env.PATH ?? "") {
  const candidates = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git",
    ...String(value).split(path.delimiter).filter(entry => entry && path.isAbsolute(entry) &&
      !entry.replaceAll("\\", "/").toLowerCase().includes("/node_modules/.bin")).map(entry => path.join(entry, process.platform === "win32" ? "git.exe" : "git"))];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const resolved = fs.realpathSync(candidate);
      const stat = fs.lstatSync(resolved);
      if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o111) === 0) ||
          (typeof process.getuid === "function" && ((stat.mode & 0o022) !== 0 || ![0, process.getuid()].includes(stat.uid)))) continue;
      if (typeof process.getuid === "function") {
        let directory = path.dirname(resolved);
        let safe = true;
        while (true) {
          const ancestor = fs.lstatSync(directory);
          if (!ancestor.isDirectory() || (ancestor.mode & 0o022) !== 0 || ![0, process.getuid()].includes(ancestor.uid)) { safe = false; break; }
          const parent = path.dirname(directory);
          if (parent === directory) break;
          directory = parent;
        }
        if (!safe) continue;
      }
      return resolved;
    } catch { /* Try the next absolute candidate. */ }
  }
  throw new Error("Could not find a trusted absolute Git executable.");
}
function lockedGitRunner(checkout, temporaryRoot, { allowHttps = false, sourceId = "unknown" } = {}) {
  const gitExecutable = trustedGitExecutable();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  delete env.SSH_ASKPASS;
  const gitHome = path.join(temporaryRoot, "git-home");
  const gitConfig = path.join(gitHome, "config");
  fs.mkdirSync(gitConfig, { recursive: true, mode: 0o700 });
  Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_ATTR_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: allowHttps ? "https" : "",
    SSH_ASKPASS: "", SSH_ASKPASS_REQUIRE: "never", HOME: gitHome, XDG_CONFIG_HOME: gitConfig, USERPROFILE: gitHome });
  const hooks = path.join(temporaryRoot, "empty-hooks");
  fs.mkdirSync(hooks, { recursive: true, mode: 0o700 });
  const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
  return (args, { binary = false } = {}) => {
    const result = spawnSync(gitExecutable, ["-c", `core.hooksPath=${hooks}`, "-c", "core.autocrlf=false",
      "-c", `core.attributesFile=${nullFile}`, "-c", "credential.helper=", "-c", "core.askPass=", "-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never", ...args], {
      cwd: checkout, env, encoding: binary ? null : "utf8", timeout: 90000, maxBuffer: 16 * 1024 * 1024, windowsHide: true
    });
    if (result.status !== 0) throw new Error(`Could not inspect locked source ${sourceId}; Git access is required. No upstream setup was run.`);
    return result;
  };
}
function verifyLockedSourceCheckout(source, checkout, temporaryRoot) {
  const git = lockedGitRunner(checkout, temporaryRoot, { sourceId: source.id });
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]).stdout.trim().toLowerCase();
  if (head !== source.ref) throw new Error(`Locked source ${source.id} did not resolve to the required commit.`);
  const treeBytes = git(["ls-tree", "-r", "-z", "--name-only", "--full-tree", "HEAD"], { binary: true }).stdout;
  if (!isUtf8(treeBytes)) throw new Error(`Locked source ${source.id} contains a non-UTF-8 Git path.`);
  const seenPrefixes = new Map();
  for (const entry of treeBytes.toString("utf8").split("\0").filter(Boolean)) {
    if (!relativePath(entry)) throw new Error(`Locked source ${source.id} contains an unsupported Git path.`);
    const parts = entry.split("/");
    for (let length = 1; length <= parts.length; length++) {
      const original = parts.slice(0, length).join("/");
      const folded = parts.slice(0, length).map(foldPortableName).join("/");
      const prior = seenPrefixes.get(folded);
      if (prior && prior !== original) throw new Error(`Locked source ${source.id} contains colliding case or Unicode paths.`);
      seenPrefixes.set(folded, original);
    }
  }
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"], { binary: true }).stdout;
  if (status.length) throw new Error(`Locked source ${source.id} working tree does not match the locked commit.`);
}
function downloadSource(source, temporaryRoot, progress) {
  const checkout = path.join(temporaryRoot, "sources", source.id);
  fs.mkdirSync(checkout, { recursive: true, mode: 0o755 });
  const git = lockedGitRunner(checkout, temporaryRoot, { allowHttps: true, sourceId: source.id });
  progress(`Fetching ${source.repo} at ${source.ref.slice(0, 12)}…`);
  git(["init", "--quiet"]);
  git(["fetch", "--quiet", "--depth", "1", `https://github.com/${source.repo}.git`, source.ref]);
  git(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  return checkout;
}

function validateSourcePath(sourceRoot, relative) {
  const location = path.join(sourceRoot, relative);
  assertInstallDestination(sourceRoot, location);
  const walk = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("Dependency source contains an unsupported symbolic link.");
    const name = path.basename(file);
    const foldedName = foldPortableName(name);
    if (file !== location && (foldedName === ownershipMarkerName || foldedName === ".proofpilot-upstream" || foldedName === "upstream-license.txt" || foldedName.startsWith(".proofpilot-"))) {
      throw new Error(`Dependency source contains a reserved ProofPilot service path: ${file}`);
    }
    if (stat.isDirectory()) for (const child of fs.readdirSync(file)) walk(path.join(file, child));
    else if (!stat.isFile()) throw new Error("Dependency source contains an unsupported file.");
  };
  walk(location);
  return location;
}

function filesBelow(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(file));
    else files.push(file);
  }
  return files;
}
function supportMappings(sourceRoot, root, source) {
  return [...[...source.skills, ...(source.replaced_skills ?? [])].map(skill => ({
    from: path.join(sourceRoot, skill.path), to: path.join(root, skill.id)
  })), ...source.assets.map(asset => ({
    from: path.join(sourceRoot, asset.path), to: path.join(root, asset.destination)
  }))].sort((a, b) => b.from.length - a.from.length);
}
function adaptSolanaLinks(staging, sourcePath, destination, mappings) {
  const candidates = fs.statSync(staging).isDirectory() ? filesBelow(staging) : [staging];
  const map = original => {
    const match = mappings.find(item => original === item.from || original.startsWith(`${item.from}${path.sep}`));
    return match ? path.join(match.to, path.relative(match.from, original)) : null;
  };
  for (const file of candidates.filter(file => file.endsWith(".md"))) {
    const relative = fs.statSync(staging).isDirectory() ? path.relative(staging, file) : "";
    const originalDir = path.dirname(path.join(sourcePath, relative));
    const finalDir = path.dirname(path.join(destination, relative));
    let content = fs.readFileSync(file, "utf8");
    content = content.replace(/(\]\()([^\s)]+)(\))/g, (whole, before, href, after) => {
      if (/^(?:[a-z]+:|\/|#)/i.test(href)) return whole;
      const [local, anchor] = href.split("#", 2);
      const mapped = map(path.resolve(originalDir, local));
      return mapped ? `${before}${path.relative(finalDir, mapped).split(path.sep).join("/")}${anchor ? `#${anchor}` : ""}${after}` : whole;
    });
    // Only known bundled targets are rewritten in plain/code paths.
    content = content.replace(/(?<![A-Za-z0-9_./])(?:\.\.\/)+(?:data\/[A-Za-z0-9_.\/-]+|SKILL_ROUTER\.md)/g, whole => {
      const mapped = map(path.resolve(originalDir, whole));
      return mapped ? path.relative(finalDir, mapped).split(path.sep).join("/") : whole;
    });
    if (content !== fs.readFileSync(file, "utf8")) {
      const upstream = fs.statSync(staging).isDirectory()
        ? path.join(staging, ".proofpilot-upstream", `${path.relative(staging, file)}.txt`)
        : supportPolicySidecarPath(staging);
      fs.mkdirSync(path.dirname(upstream), { recursive: true });
      if (!exists(upstream)) fs.writeFileSync(upstream, fs.readFileSync(file), { flag: "wx" });
      fs.writeFileSync(file, content);
    }
  }
}

function ensureDirectoryTracked(directory, created) {
  const missing = [];
  let cursor = directory;
  while (!exists(cursor)) { missing.push(cursor); cursor = path.dirname(cursor); }
  if (!fs.lstatSync(cursor).isDirectory()) throw new Error(`An installation parent is incompatible: ${cursor}`);
  for (const item of missing.reverse()) {
    try {
      fs.mkdirSync(item, { mode: 0o755 }); created.add(item);
      syncInstallDirectory(item);
      syncInstallDirectory(path.dirname(item));
    }
    catch (error) {
      if (error.code !== "EEXIST" || !fs.lstatSync(item).isDirectory()) throw error;
    }
  }
}
function pruneEmptyParents(start, stop) {
  let cursor = start;
  while (cursor !== stop && cursor !== path.dirname(cursor)) {
    try { fs.rmdirSync(cursor); } catch { break; }
    cursor = path.dirname(cursor);
  }
}
function assertPreservedContent(plan) {
  // Root identity alone misses same-inode edits and added children.
  if (plan.preservedFingerprint && contentFingerprint(plan.destination) !== plan.preservedFingerprint) {
    throw new Error(`Existing support content changed after it was staged for a preserving repair; it was left unchanged: ${plan.destination}. Re-run installation to repair it from the newest content.`);
  }
}
function assertCapturedPreservedContent(plan, action, transaction) {
  if (!plan.preservedFingerprint || !action.backup) return;
  if (!hasIdentity(action.backup, action.backupIdentity)) throw new Error("preserving_backup_identity_changed");
  const capturedFingerprint = contentFingerprint(action.backup);
  if (!capturedFingerprint) throw new Error("preserving_backup_content_unreadable");
  if (capturedFingerprint === plan.preservedFingerprint) return;
  // An ordinary save can land after the last live-path check. The actual
  // captured original is now the rollback source; durably bind its newest
  // bytes/modes before refusing to publish the older preserving preparation.
  plan.transactionAction.original_fingerprint = capturedFingerprint;
  persistTransaction(transaction);
  throw new Error(`Existing support content changed while its preserving backup was captured; the newest captured content is restored instead of publishing an older repair: ${plan.destination}. Re-run installation after the edit is complete.`);
}
function buildFullState(root, manifest, previous, plans) {
  const byDestination = new Map(plans.map(plan => [plan.destination, plan]));
  const provenance = {};
  const asset_provenance = {};
  for (const source of manifest.sources) {
    for (const skill of source.skills) {
      const destination = path.join(root, skill.id);
      const plan = byDestination.get(destination);
      const prior = previous.provenance?.[skill.id];
      const content_hash = hashManagedSkillPath(destination);
      const previousContentExact = plan?.previous_content_exact ??
        (/^sha256v2:[0-9a-f]{64}$/.test(prior?.content_hash ?? "") && hashInstalledPath(destination) === prior.content_hash);
      const source_content_hash = plan?.fromSource && !plan.preserveExisting ? content_hash :
        previousContentExact && prior?.content_hash === prior?.source_content_hash ? content_hash : prior?.source_content_hash;
      provenance[skill.id] = {
        repo: source.repo, ref: source.ref, content_hash, ...(source_content_hash ? { source_content_hash } : {}), policy_version: 1,
        management_token: readOwnershipMarker(destination)?.token,
        content_basis: source_content_hash ? (content_hash === source_content_hash ? "locked_source" : "modified_after_install") :
          plan ? "owned_existing_repaired" : "owned_existing"
      };
    }
    for (const asset of source.assets) {
      const destination = path.join(root, asset.destination);
      const plan = byDestination.get(destination);
      const content_hash = hashInstalledPath(destination);
      const prior = previous.asset_provenance?.[asset.destination];
      const source_content_hash = plan?.fromSource && !plan.preserveExisting ? content_hash : prior?.source_content_hash;
      asset_provenance[asset.destination] = {
        repo: source.repo, ref: source.ref, content_hash, ...(source_content_hash ? { source_content_hash } : {}),
        path_identity: pathIdentity(destination), policy_version: 1,
        ...(!asset.required_files && readAssetOwner(destination) ? { management_token: readAssetOwner(destination).token } : {}),
        ...(exists(supportPolicySidecarPath(destination)) ? {
          policy_sidecar_hash: hashInstalledPath(supportPolicySidecarPath(destination)),
          policy_sidecar_path_identity: pathIdentity(supportPolicySidecarPath(destination))
        } : {}),
        content_basis: source_content_hash ? (content_hash === source_content_hash ? "locked_source" : "modified_after_install") :
          plan ? "existing_repaired" : "owned_existing"
      };
    }
  }
  return { ...previous, bundle_id: manifest.bundle_id, mode: "full", support_mode: "full", requested_install_mode: "full",
    completed_at: new Date().toISOString(), provenance, asset_provenance };
}
function withCoreActivation(state, activation) {
  if (!activation?.core_entries || typeof activation.core_entries !== "object" || Array.isArray(activation.core_entries)) return state;
  const core_entries = { ...(state.core_entries && typeof state.core_entries === "object" && !Array.isArray(state.core_entries) ? state.core_entries : {}) };
  for (const name of activation.removed_core_entries ?? []) {
    if (!identifier.test(name)) throw new Error("Core activation returned an invalid removed entry.");
    delete core_entries[name];
  }
  for (const [name, record] of Object.entries(activation.core_entries)) {
    if (!identifier.test(name) || !record || typeof record !== "object" || !relativePath(record.path) ||
        !["copy", "symlink"].includes(record.mode) || !record.path_identity ||
        typeof record.path_identity.dev !== "string" || typeof record.path_identity.ino !== "string" ||
        !["directory", "symlink"].includes(record.path_identity.type)) throw new Error("Core activation returned invalid ownership metadata.");
    core_entries[name] = { path: record.path, mode: record.mode, path_identity: { ...record.path_identity } };
  }
  return { ...state, core_entries };
}

/** Add missing files; back up required version upgrades and explicit replacements. */
export function installDependencies(root, options = {}) {
  root = canonicalInstallPath(root);
  if (options.offline && options.update) throw new Error("--offline and --update-dependencies / --update are mutually exclusive.");
  assertDependencyRoot(root);
  const releaseLock = acquireDependencyInstallLock(root);
  try {
    captureRootGuard(root);
    const recovery = recoverPendingTransactionLocked(root);
    const rootGuard = captureRootGuard(root);
    return installDependenciesLocked(root, { ...options, recovery, rootGuard });
  }
  finally { releaseLock(); }
}

function installDependenciesLocked(root, options) {
  const manifest = options.manifest ? validateDependencyManifest(options.manifest) : loadDependencyManifest();
  const rootWasInitiallyMissing = !options.rootGuard.rootIdentity;
  const progress = options.progress ?? (() => {});
  const versionCheck = options.helperVersion ?? helperVersion;
  const recoveredBackups = options.recovery?.backups ?? [];
  const allItems = manifest.sources.flatMap(source => [...source.skills, ...source.assets]);
  for (const item of allItems) assertInstallDestination(root, path.join(root, item.id ?? item.destination), { replaceFinalLink: true });
  assertInstallDestination(root, path.join(root, stateName));
  const stateSnapshot = readStateSnapshot(root);
  const previous = stateSnapshot.state;
  // This complete collision/ownership pass must finish before helper or source-provider access.
  preflightExistingDestinations(root, manifest, previous);
  options.afterLockAcquired?.({ root, manifest, previous });
  const before = getDependencyStatus(root, { ...options, manifest, helperVersion: versionCheck, stateOverride: previous });
  if (before.connection_helper.cache_untrusted) {
    throw new Error(`Could not prepare the official connection helper. ${before.connection_helper.recovery} No download, account login or upstream setup was run.`);
  }
  if (options.offline) {
    if (!before.complete) throw new Error("The full bundle is incomplete. Run installation with network access; no offline downloads were attempted.");
    const transaction = beginInstallTransaction(root, { createdRoot: rootWasInitiallyMissing, stateSnapshot });
    let completedResult;
    try {
      const activation_result = options.afterDependenciesActivated?.({ plans: [], backups: [], root, manifest, transaction });
      assertRootGuard(root, options.rootGuard);
      const state = withCoreActivation(buildFullState(root, manifest, previous, []), activation_result);
      options.beforeStateWrite?.({ root, state, transaction });
      const finalStatus = getDependencyStatus(root, { ...options, manifest, helperVersion: versionCheck,
        stateOverride: state, ignorePendingTransaction: true });
      completedResult = { ...finalStatus,
        installed: [], updated: [], reused: before.skills.map(item => item.id), backups: [...recoveredBackups], activation_result };
      completedResult.backups.push(...finishInstallTransaction(transaction, state, options.afterStateWrite));
      return completedResult;
    } catch (error) {
      try {
        const recovery = recoverPendingTransactionLocked(root);
        if (recovery.committed && completedResult) {
          return { ...completedResult, backups: [...new Set([...completedResult.backups, ...recovery.backups])],
            warnings: ["The committed installation was finalized after a post-commit error."] };
        }
        error.proofpilotTransactionHandled = true;
        if (recovery.backups.length) error.message += ` Preserved transaction backups: ${JSON.stringify(recovery.backups)}`;
      } catch (recoveryError) {
        error.proofpilotTransactionHandled = true;
        error.message += ` ${recoveryError.message}`;
      }
      throw error;
    }
  }
  const upgrades = new Set(manifest.sources.flatMap(source => source.skills).filter(skill => {
    const metadata = readSkillMetadata(path.join(root, skill.id, "SKILL.md"));
    return skill.minimum_version && metadata.name === skill.id && metadata.description && metadata.version && !atLeast(metadata.version, skill.minimum_version);
  }).map(skill => skill.id));
  if (before.skills.some(item => item.status === "incompatible")) {
    throw new Error(`Existing dependency collisions must be moved aside before installation: ${before.skills.filter(item => item.status === "incompatible").map(item => item.id).join(", ")}`);
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-bundle-"));
  const plans = [];
  const backups = [];
  const reused = [];
  const committed = [];
  const createdDirectories = new Set();
  let activationRoot;
  let transaction;
  let completedResult;
  let succeeded = false;
  try {
    for (const source of manifest.sources) {
      const neededSkills = source.skills.filter(skill => options.update || before.skills.find(item => item.id === skill.id).status !== "installed");
      const neededAssets = source.assets.filter(asset => options.update || before.assets.find(item => item.path === asset.destination).status !== "installed");
      reused.push(...source.skills.filter(skill => !neededSkills.includes(skill)).map(skill => skill.id));
      if (!neededSkills.length && !neededAssets.length) continue;
      const needsSource = item => {
        const current = item.id ? before.skills.find(entry => entry.id === item.id) : before.assets.find(entry => entry.path === item.destination);
        return options.update || upgrades.has(item.id) || current.status === "missing" || current.source_repair_required || current.source_update_required ||
          (item.id ? current.missing_source_files.length > 0 : current.missing_files.length > 0);
      };
      const needsDownload = [...neededSkills, ...neededAssets].some(needsSource);
      const checkout = needsDownload ? (options.sourceProvider ?? downloadSource)(source, temporaryRoot, progress) : null;
      if (checkout && exists(path.join(checkout, ".git"))) verifyLockedSourceCheckout(source, checkout, temporaryRoot);
      const mappingRoot = checkout ?? path.join(temporaryRoot, "virtual-source", source.id);
      const mappings = supportMappings(mappingRoot, root, source);
      for (const item of [...neededSkills, ...neededAssets]) {
        const destination = path.join(root, item.id ?? item.destination);
        const existed = exists(destination);
        const initialIdentity = existed ? pathIdentity(destination) : null;
        const current = item.id ? before.skills.find(entry => entry.id === item.id) : before.assets.find(entry => entry.path === item.destination);
        const preserveExisting = existed && !options.update && !upgrades.has(item.id) && !current.source_update_required;
        const staging = path.join(temporaryRoot, "prepared", item.id ?? item.destination);
        // A preserving plan copies the current custom bytes. Bind it to exactly
        // those bytes so a later in-place edit or added child is never replaced.
        const stagedFromExisting = existed && (!needsSource(item) || preserveExisting);
        const sidecarFromExisting = stagedFromExisting && !item.id && !needsSource(item) && exists(supportPolicySidecarPath(destination));
        const preservedFingerprint = stagedFromExisting ? contentFingerprint(destination) : null;
        const preservedSidecarFingerprint = sidecarFromExisting ? contentFingerprint(supportPolicySidecarPath(destination)) : null;
        if (!needsSource(item)) {
          stageExistingSupportBundle({ location: destination, staging, destination, root, sourceId: source.id, skillId: item.id ?? null, manifest });
          if (!item.id) {
            const existingSidecar = supportPolicySidecarPath(destination);
            const stagedSidecar = supportPolicySidecarPath(staging);
            if (exists(existingSidecar) && !exists(stagedSidecar)) {
              fs.mkdirSync(path.dirname(stagedSidecar), { recursive: true });
              fs.copyFileSync(existingSidecar, stagedSidecar, fs.constants.COPYFILE_EXCL);
            }
          }
          if (source.id === "solana-new") adaptSolanaLinks(staging, path.join(mappingRoot, item.path), destination, mappings);
        } else {
          const original = validateSourcePath(checkout, item.path);
          if (item.id) {
            const metadata = readSkillMetadata(path.join(original, "SKILL.md"));
            if (metadata.name !== item.id || !metadata.description || !atLeast(metadata.version, item.minimum_version) ||
                item.required_files.some(file => !requiredFile(original, file))) throw new Error(`Locked source lacks required files for ${item.id}.`);
          } else if (item.required_files?.some(file => !requiredFile(original, file))) throw new Error("Locked source lacks required shared guidance.");
          fs.mkdirSync(path.dirname(staging), { recursive: true });
          fs.cpSync(original, staging, { recursive: true, errorOnExist: true, force: false });
          if (preserveExisting && fs.lstatSync(destination).isDirectory()) {
            fs.cpSync(destination, staging, { recursive: true, force: true });
            const restore = new Set((item.id ? current.missing_source_files : current.missing_files).filter(file => file !== "UPSTREAM-LICENSE.txt"));
            if (item.id && current.source_repair_required) {
              const existingMetadata = readSkillMetadata(path.join(destination, "SKILL.md"));
              if (existingMetadata.name !== item.id || !existingMetadata.description || !atLeast(existingMetadata.version, item.minimum_version)) restore.add("SKILL.md");
            }
            for (const relative of restore) {
              const target = path.join(staging, relative);
              fs.rmSync(target, { recursive: true, force: true });
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.cpSync(path.join(original, relative), target, { recursive: true, force: false, errorOnExist: true });
            }
          } else if (preserveExisting && fs.lstatSync(destination).isFile()) {
            // Capture the locked upstream bytes in the detached sidecar first,
            // then keep the active file and apply only the required policy rewrite.
            adaptSupportBundle({ staging, destination, root, sourceId: source.id, skillId: item.id ?? null, manifest });
            fs.copyFileSync(destination, staging);
          }
          adaptSupportBundle({ staging, destination, root, sourceId: source.id, skillId: item.id ?? null, manifest });
          if (source.id === "solana-new") adaptSolanaLinks(staging, original, destination, mappings);
          if (source.license_path && fs.statSync(staging).isDirectory()) {
            fs.copyFileSync(validateSourcePath(checkout, source.license_path), path.join(staging, "UPSTREAM-LICENSE.txt"));
          }
        }
        if ((stagedFromExisting && (!preservedFingerprint || contentFingerprint(destination) !== preservedFingerprint)) ||
            (sidecarFromExisting && (!preservedSidecarFingerprint || contentFingerprint(supportPolicySidecarPath(destination)) !== preservedSidecarFingerprint))) {
          throw new Error(`Existing support content changed while it was being staged; it was left unchanged: ${destination}. Re-run installation after the edit is complete.`);
        }
        if (item.id) ensureOwnershipMarker(staging, manifest, source, item);
        if (item.id && [...item.required_files, ...(item.adapted_required_files ?? []), ...(source.license_path ? ["UPSTREAM-LICENSE.txt"] : [])]
          .some(file => !requiredFile(staging, file))) throw new Error(`Prepared ${item.id} lacks required files.`);
        hardenPreparedTree(staging);
        const priorRecord = item.id ? previous.provenance?.[item.id] : previous.asset_provenance?.[item.destination];
        let previous_content_exact = false;
        try { previous_content_exact = existed && /^sha256v2:[0-9a-f]{64}$/.test(priorRecord?.content_hash ?? "") &&
          hashInstalledPath(destination) === priorRecord.content_hash; } catch { /* Preflight already reports unsafe trees. */ }
        plans.push({ item, source, staging, destination, existed, initialIdentity, preserveExisting,
          fromSource: needsSource(item), previous_content_exact, preservedFingerprint });
        if (!item.id && !item.required_files) {
          const markerDestination = assetOwnerPath(destination);
          const markerStaging = assetOwnerPath(staging);
          const token = !options.update && priorRecord?.management_token ? priorRecord.management_token : crypto.randomBytes(32).toString("hex");
          fs.mkdirSync(path.dirname(markerStaging), { recursive: true });
          fs.writeFileSync(markerStaging, `${JSON.stringify({ version: 1, asset: item.destination, repo: source.repo, ref: source.ref, token })}\n`, { mode: 0o600, flag: "wx" });
          plans.push({ item: { auxiliary: "asset_owner", parent_destination: item.destination }, source,
            staging: markerStaging, destination: markerDestination, existed: exists(markerDestination),
            initialIdentity: exists(markerDestination) ? pathIdentity(markerDestination) : null, auxiliary: true });
        }
        if (!item.id && exists(supportPolicySidecarPath(staging))) {
          hardenPreparedTree(supportPolicySidecarPath(staging));
          const sidecarDestination = supportPolicySidecarPath(destination);
          assertInstallDestination(root, sidecarDestination);
          plans.push({ item: { auxiliary: "support_policy_sidecar", parent_destination: item.destination }, source,
            staging: supportPolicySidecarPath(staging), destination: sidecarDestination, existed: exists(sidecarDestination),
            initialIdentity: exists(sidecarDestination) ? pathIdentity(sidecarDestination) : null,
            preserveExisting: false, fromSource: needsSource(item), auxiliary: true, preservedFingerprint: preservedSidecarFingerprint });
        }
      }
    }
    if (!before.connection_helper.available_locally) {
      progress(`Caching ${manifest.connection_helper.package} (version check only)…`);
      let prepared;
      try { prepared = versionCheck(manifest, true, options); }
      catch (error) {
        if (!["EHELPERCACHE", "EHELPERNPM"].includes(error?.code)) throw error;
        throw new Error(`Could not prepare the official connection helper. ${error.message} No account login or upstream setup was run.`);
      }
      if (!prepared) throw new Error("Could not prepare the official connection helper. No account login or upstream setup was run.");
    }
    // All downloads and source validation finish before installed files change.
    preflightExistingDestinations(root, manifest, previous);
    for (const item of allItems) assertInstallDestination(root, path.join(root, item.id ?? item.destination), { replaceFinalLink: true });
    assertRootGuard(root, options.rootGuard);
    for (const plan of plans) {
      const currentExists = exists(plan.destination);
      if (currentExists !== plan.existed || (currentExists && !hasIdentity(plan.destination, plan.initialIdentity))) {
        throw new Error(`A support installation target appeared or changed while installation was in progress: ${plan.destination}`);
      }
      assertPreservedContent(plan);
    }
    ensureDirectoryTracked(root, createdDirectories);
    assertRootGuard(root, options.rootGuard, { allowCreatedRoot: true });
    transaction = beginInstallTransaction(root, { createdRoot: rootWasInitiallyMissing, stateSnapshot });
    if (plans.length) activationRoot = fs.mkdtempSync(path.join(root, ".proofpilot-staging-"));
    if (activationRoot) addTransactionCleanup(transaction, activationRoot);
    // Prepare complete replacements on the destination filesystem before backups.
    for (let index = 0; index < plans.length; index++) {
      const local = path.join(activationRoot, String(index));
      fs.cpSync(plans[index].staging, local, { recursive: true, force: false, errorOnExist: true });
      hardenPreparedTree(local);
      syncPreparedTree(local);
      plans[index].staging = local;
    }
    for (const plan of plans) {
      plan.transactionAction = addTransactionAction(transaction, {
        destination: plan.destination, staging: plan.staging, initialExists: plan.existed,
        initialIdentity: plan.initialIdentity, kind: "support"
      });
    }
    for (const plan of plans) {
      assertRootGuard(root, options.rootGuard);
      const currentExists = exists(plan.destination);
      if (currentExists !== plan.existed || (currentExists && !hasIdentity(plan.destination, plan.initialIdentity))) {
        throw new Error(`A support installation target appeared or changed before activation: ${plan.destination}`);
      }
      assertPreservedContent(plan);
      const action = { destination: plan.destination, backup: null, backupIdentity: null, backupIncomplete: false, activated: false, identity: null };
      committed.push(action);
      startTransactionActivation(transaction, plan.transactionAction);
      if (plan.existed) {
        startTransactionBackup(transaction, plan.transactionAction);
        assertPreservedContent(plan);
        try { action.backup = backupInstalledPath(plan.destination, root, { backupPath: plan.transactionAction.backup,
          quarantinePath: journalAbsolute(root, plan.transactionAction.backup_quarantine) }); }
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
        assertCapturedPreservedContent(plan, action, transaction);
      }
      ensureDirectoryTracked(path.dirname(plan.destination), createdDirectories);
      publishInstalledPath(plan.staging, plan.destination);
      action.activated = true;
      action.identity = pathIdentity(plan.destination);
    }
    let state = buildFullState(root, manifest, previous, plans);
    const after = getDependencyStatus(root, { ...options, manifest, helperVersion: versionCheck,
      stateOverride: state, ignorePendingTransaction: true });
    if (!after.complete) throw new Error("Installation did not produce the complete support bundle.");
    const activation_result = options.afterDependenciesActivated?.({ plans, backups, root, manifest, transaction });
    assertRootGuard(root, options.rootGuard);
    state = withCoreActivation(state, activation_result);
    options.beforeStateWrite?.({ root, state, transaction });
    completedResult = { ...after, mode: "full", installed: plans.filter(plan => plan.item.id && !plan.existed).map(plan => plan.item.id),
      updated: plans.filter(plan => plan.item.id && plan.existed).map(plan => plan.item.id), reused,
      backups: [...recoveredBackups, ...backups], activation_result };
    completedResult.backups.push(...finishInstallTransaction(transaction, state, options.afterStateWrite));
    succeeded = true;
    return completedResult;
  } catch (error) {
    if (transaction) {
      try {
        const recovery = recoverPendingTransactionLocked(root);
        if (recovery.committed && completedResult) {
          succeeded = true;
          return { ...completedResult, backups: [...new Set([...completedResult.backups, ...recovery.backups])],
            warnings: ["The committed installation was finalized after a post-commit error."] };
        }
        error.proofpilotTransactionHandled = true;
        if (recovery.backups.length) error.message += ` Preserved transaction backups: ${JSON.stringify(recovery.backups)}`;
      } catch (recoveryError) {
        error.proofpilotTransactionHandled = true;
        error.message += ` ${recoveryError.message}`;
      }
      throw error;
    }
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
        if (action.backup) movePathSafely(action.backup, action.destination);
        if (action.backup) pruneEmptyParents(path.dirname(action.backup), backupBase(root));
      } catch { recovery.push({ destination: action.destination, backup: action.backup, reason: "rollback_failed" }); }
    }
    if (recovery.length) error.message += ` Preserved backup/recovery paths: ${JSON.stringify(recovery)}`;
    throw error;
  } finally {
    try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch { /* Preserve the transaction result. */ }
    if (activationRoot) try { fs.rmSync(activationRoot, { recursive: true, force: true }); } catch { /* Preserve the transaction result. */ }
    if (!succeeded) for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try { fs.rmdirSync(directory); } catch { /* Preserve non-empty or externally-created directories. */ }
    }
  }
}

function currentStateBinding(root) {
  const file = path.join(root, stateName);
  let identity;
  try { identity = pathIdentity(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const hash = installedStateDigest(root);
  if (hash === null) return null;
  if (!hasIdentity(file, identity)) throw new Error(`The ProofPilot bundle state changed while it was being read: ${file}`);
  return { identity, hash };
}
function refuseConcurrentState(transaction) {
  const file = path.join(transaction.root, stateName);
  try {
    const hash = installedStateDigest(transaction.root);
    // Recovery may then roll back while keeping exactly this active save.
    if (hash && hash !== transaction.previous_state_hash) {
      transaction.concurrent_state_hash = hash;
      persistTransaction(transaction);
    }
  } catch { /* A special or unreadable state stays untouched and keeps recovery conservative. */ }
  throw new Error(`concurrent_state_save: ${file} changed while ProofPilot was installing. The installation was not committed and the active state was preserved; its uncommitted changes are rolled back. Re-run installation after the edit is complete.`);
}
function writeBundleState(transaction, bytes) {
  const root = transaction.root, file = path.join(root, stateName);
  assertInstallDestination(root, file);
  writeDurableAtomic(file, bytes, ".proofpilot-state-", prepared => {
    // Commit only over the exact starting state. The prepared state waits in a
    // private holding path, the old name is captured by one rename, and the
    // exclusive publication never replaces a later save.
    let current;
    try { current = currentStateBinding(root); } catch { refuseConcurrentState(transaction); }
    if (current && current.hash !== transaction.previous_state_hash) refuseConcurrentState(transaction);
    const relative = `.proofpilot-commit-state-${transaction.transaction_id}`, directory = journalAbsolute(root, relative);
    if (exists(directory)) throw new Error("commit_state_holding_path_already_exists");
    fs.mkdirSync(directory, { mode: 0o700 });
    syncInstallDirectory(root);
    transaction.commit_state_capture = { path: relative, directory_identity: pathIdentity(directory),
      ...(current ? { state_identity: current.identity } : {}),
      prepared_identity: pathIdentity(prepared), prepared_hash: transaction.expected_state_hash };
    persistTransaction(transaction);
    const captured = path.join(directory, "original.json"), staged = path.join(directory, "prepared.json");
    // A filesystem that rejects hard links must fail while the old state is
    // still active; recovery must never depend on its first such publication.
    publishInstalledPath(prepared, staged);
    if (current) {
      try { renameInstalledPath(file, captured); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (exists(captured) && (!hasIdentity(captured, current.identity) || stateDigest(fs.readFileSync(captured)) !== transaction.previous_state_hash)) {
        try { if (!exists(file)) publishInstalledPath(captured, file); }
        catch { /* A newer save keeps this one in the reported holding path. */ }
        refuseConcurrentState(transaction);
      }
    }
    try { publishInstalledPath(staged, file); }
    catch (error) {
      if (error.code === "EEXIST") refuseConcurrentState(transaction);
      throw error;
    }
  });
  return cleanupCommitStateCapture(transaction);
}

export function markCoreOnly(root, options = {}) {
  root = canonicalInstallPath(root);
  assertDependencyRoot(root);
  const manifest = options.manifest ? validateDependencyManifest(options.manifest) : loadDependencyManifest();
  assertInstallDestination(root, path.join(root, stateName));
  const releaseLock = acquireDependencyInstallLock(root);
  try {
    captureRootGuard(root);
    recoverPendingTransactionLocked(root);
    const rootGuard = captureRootGuard(root);
    const rootWasInitiallyMissing = !rootGuard.rootIdentity;
    const stateFile = path.join(root, stateName);
    if (exists(stateFile) && !isRegularFile(stateFile)) throw new Error(`The ProofPilot bundle state is an incompatible special file: ${stateFile}`);
    const stateSnapshot = readStateSnapshot(root);
    const previous = stateSnapshot.state;
    ensureDirectoryTracked(root, new Set());
    assertRootGuard(root, rootGuard, { allowCreatedRoot: true });
    const transaction = beginInstallTransaction(root, { createdRoot: rootWasInitiallyMissing, requestedInstallMode: "core_only", stateSnapshot });
    let activation_result;
    const coreResult = paths => ({ ...activation_result,
      backups: [...new Set([...(activation_result?.backups ?? []), ...paths])] });
    try {
      activation_result = options.afterLockAcquired?.({ root, previous, transaction });
      const state = withCoreActivation({ ...previous, bundle_id: manifest.bundle_id,
      mode: "core_only",
      support_mode: previous.support_mode ?? (previous.mode === "full" ? "full" : "not_installed"),
      requested_install_mode: "core_only", core_completed_at: new Date().toISOString() }, activation_result);
      options.beforeStateWrite?.({ root, state, transaction });
      const preserved = finishInstallTransaction(transaction, state, options.afterStateWrite);
      return coreResult(preserved);
    } catch (error) {
      try {
        const recovery = recoverPendingTransactionLocked(root);
        if (recovery.committed) return coreResult(recovery.backups);
        error.proofpilotTransactionHandled = true;
        if (recovery.backups.length) error.message += ` Preserved transaction backups: ${JSON.stringify(recovery.backups)}`;
      } catch (recoveryError) {
        error.proofpilotTransactionHandled = true;
        error.message += ` ${recoveryError.message}`;
      }
      throw error;
    }
  } finally { releaseLock(); }
}

export function runDependencyCli(args = process.argv.slice(2), options = {}) {
  const output = options.stdout ?? process.stdout;
  const errors = options.stderr ?? process.stderr;
  if (args.length === 1 && args[0] === "--help") {
    output.write("Usage: install-dependencies.js [--root <skill-root>] [--status | --update | --offline]\nDefault: install the locked full support bundle next to ProofPilot.\n--status: offline inventory; --update: replace dependencies with backups.\nNo login, telemetry, paid calls, agent software or toolchain installation.\n");
    return 0;
  }
  const entrypoint = options.entrypoint ?? process.argv[1] ?? path.join(here, "install-dependencies.js");
  let root = path.resolve(path.dirname(entrypoint), "../..");
  let action = "install";
  try {
    let rootSeen = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--root" && !rootSeen && args[index + 1] && !args[index + 1].startsWith("--")) {
        const requested = args[++index];
        if (requested.startsWith("~") || !path.isAbsolute(requested)) throw new Error("--root must be an absolute skill-root path; shell-style ~ and relative paths are not accepted.");
        root = path.normalize(requested); rootSeen = true;
      }
      else if (["--status", "--update", "--offline"].includes(args[index]) && action === "install") action = args[index].slice(2);
      else throw new Error("Unsupported bundle arguments. Use --help.");
    }
    // Load the manifest before rollback can remove this installed entrypoint.
    const manifest = options.manifest ?? loadDependencyManifest();
    const pendingTransaction = action !== "status" ? readPendingTransaction(root) : null;
    const pending = Boolean(pendingTransaction);
    const recovery = pending ? recoverPendingInstallation(root) : null;
    const result = action === "status" || pending ? { ...getDependencyStatus(root, { ...options, manifest }), ...(recovery ? { recovery } : {}) } : installDependencies(root, {
      ...options, manifest, update: action === "update", offline: action === "offline", progress: message => errors.write(`${message}\n`)
    });
    if (pending && pendingTransaction.requested_install_mode === "core_only") {
      result.requested_install_mode = "core_only";
      if (!recovery.committed) result.mode = "core_only";
    }
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) { errors.write(`${error.message}\n`); return 1; }
}

if (process.argv[1]) {
  let invoked = path.resolve(process.argv[1]);
  try { invoked = fs.realpathSync(invoked); } catch { /* Not this entrypoint. */ }
  if (invoked === fileURLToPath(import.meta.url)) process.exitCode = runDependencyCli();
}
