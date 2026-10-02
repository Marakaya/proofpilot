#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isUtf8 } from "node:buffer";
import { fileURLToPath } from "node:url";
import { getSetupStatus } from "./setup.js";
import { loadDependencyManifest, readSkillMetadata } from "./install-dependencies.js";
import { isInstallMetadata } from "./install-metadata.js";

const dependencyManifest = loadDependencyManifest();

const args = process.argv.slice(2);
let capabilitiesOnly = false;
let explicitRoot = null;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--capabilities" && !capabilitiesOnly) capabilitiesOnly = true;
  else if (args[index] === "--root" && explicitRoot === null && args[index + 1] && !args[index + 1].startsWith("--")) {
    const requested = args[++index];
    if (requested.startsWith("~") || !path.isAbsolute(requested)) {
      console.error("--root must be an absolute skill-root path."); process.exit(1);
    }
    explicitRoot = path.normalize(requested);
  } else {
    console.error("Usage: discover-sources.js [--root <absolute-skill-root>] [--capabilities]");
    process.exit(1);
  }
}
const home = os.homedir();
const claudeHome = process.env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_HOME || path.join(home, ".claude");
if (claudeHome.startsWith("~") || !path.isAbsolute(claudeHome)) {
  console.error("CLAUDE_CONFIG_DIR / CLAUDE_HOME must be an absolute path."); process.exit(1);
}
// A relative or shell-style ~ value would name a different root for every caller working directory.
const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
if (codexHome.startsWith("~") || !path.isAbsolute(codexHome)) {
  console.error("CODEX_HOME must be an absolute path; shell-style ~ and relative paths are not accepted. Set it to an absolute Codex home directory or unset it to use the default.");
  process.exit(1);
}

// Keep the invoked location as well as the module location: profile helpers may
// be symlinks, and their adjacent skills live beside the installed profile.
const helperLocations = [process.argv[1], fileURLToPath(import.meta.url)].filter(Boolean);
const skillRoots = [...new Set([
  ...(explicitRoot ? [explicitRoot] : []),
  ...[".agents", ".codex", ".claude"].map(directory => path.join(process.cwd(), directory, "skills")),
  ...helperLocations.map(file => path.resolve(path.dirname(file), "../..")),
  path.join(codexHome, "skills"),
  path.join(home, ".agents", "skills"),
  path.join(claudeHome, "skills")
])];

const developmentSkills = [
  { id: "solana-dev", purpose: "Solana programs, SDKs, clients and local tests", source_pack: "Solana developer skill" },
  { id: "scaffold-project", purpose: "Solana project scaffolding", source_pack: "solana.new" },
  { id: "review-and-iterate", purpose: "Code and production-readiness review", source_pack: "solana.new" },
  { id: "debug-program", purpose: "Solana program debugging", source_pack: "solana.new" },
  { id: "deploy-to-mainnet", purpose: "Deployment guidance after authorization", source_pack: "solana.new" }
];

const solanaNewSkills = [...dependencyManifest.sources.find(source => source.id === "solana-new").skills.map(skill => skill.id), "colosseum-copilot"];
const supportSkills = dependencyManifest.sources.flatMap(source => source.skills.map(skill => ({ ...skill, source_pack: source.id })));

const sharedDataChecks = [
  ["solana_knowledge", "data/solana-knowledge"],
  ["ideas", "data/ideas"],
  ["guides", "data/guides"],
  ["colosseum", "data/colosseum"],
  ["defi", "data/defi"],
  ["specs", "data/specs"]
];
const pathIssues = [];
function notePathIssue(location, status) {
  if (!pathIssues.some(item => item.path === location && item.status === status)) pathIssues.push({ path: location, status });
}
function hasType(location, type) {
  try {
    const stat = fs.statSync(location);
    const matches = type === "directory" ? stat.isDirectory() : stat.isFile();
    if (!matches) notePathIssue(location, `not_${type}`);
    return matches;
  } catch (error) {
    if (error.code !== "ENOENT") notePathIssue(location, "unreadable");
    else {
      try { if (fs.lstatSync(location).isSymbolicLink()) notePathIssue(location, "broken_symlink"); } catch { /* Expected missing path. */ }
    }
    return false;
  }
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

// The installer preserves changed originals as <content path>.txt under this
// exact directory. Validate its shape rather than hiding arbitrary dot paths.
function inspectUpstreamMetadata(directory) {
  const sidecar = path.join(directory, ".proofpilot-upstream");
  let preservedFiles = 0;
  const inspect = (location, contentPath, root = false) => {
    let descriptor;
    try {
      const stat = fs.lstatSync(location);
      if (stat.isSymbolicLink()) { notePathIssue(location, "symlink"); return; }
      if (root && !stat.isDirectory()) { notePathIssue(location, "not_directory"); return; }
      if (stat.isDirectory()) {
        if (!root) {
          const contentStat = fs.lstatSync(contentPath);
          if (!contentStat.isDirectory() || contentStat.isSymbolicLink()) {
            notePathIssue(location, "invalid_metadata"); return;
          }
        }
        const entries = fs.readdirSync(location);
        if (!entries.length) notePathIssue(location, "invalid_metadata");
        for (const entry of entries) inspect(path.join(location, entry), path.join(contentPath, entry));
        return;
      }
      if (!stat.isFile()) { notePathIssue(location, "not_file"); return; }
      if (isInstallMetadata(location)) return;
      if (!location.endsWith(".txt")) { notePathIssue(location, "invalid_metadata"); return; }
      const contentStat = fs.lstatSync(contentPath.slice(0, -4));
      if (!contentStat.isFile() || contentStat.isSymbolicLink()) {
        notePathIssue(location, "invalid_metadata"); return;
      }
      descriptor = fs.openSync(location, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
        notePathIssue(location, "invalid_metadata"); return;
      }
      if (!isUtf8(fs.readFileSync(descriptor))) { notePathIssue(location, "invalid_metadata"); return; }
      preservedFiles++;
    } catch (error) {
      notePathIssue(location, error.code === "ENOENT" ? "invalid_metadata" : "unreadable");
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  };
  inspect(sidecar, directory, true);
  if (!preservedFiles && !pathIssues.some(item => item.path === sidecar || item.path.startsWith(`${sidecar}${path.sep}`))) {
    notePathIssue(sidecar, "invalid_metadata");
  }
}

function listFiles(dir) {
  if (!hasType(dir, "directory")) return [];
  try { return fs.readdirSync(dir).filter(entry => {
    if (entry === ".proofpilot-upstream") { inspectUpstreamMetadata(dir); return false; }
    return hasType(path.join(dir, entry), "file");
  }); }
  catch { notePathIssue(dir, "unreadable"); return []; }
}

function readJson(filePath) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } catch {
    return null;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function findSkill(skillName) {
  for (const root of skillRoots) {
    for (const directory of [root, path.join(root, ".system"), path.join(root, ".curated")]) {
      const skillFile = path.join(directory, skillName, "SKILL.md");
      if (!hasType(skillFile, "file")) continue;
      if (skillName === "colosseum-copilot") {
        const metadata = readSkillMetadata(skillFile);
        if (!metadata.version || Number(metadata.version.split(".")[0]) < 2) continue;
      }
      return { root: directory, skill_file: skillFile };
    }
  }
  return null;
}

function findSharedData() {
  const found = {};
  for (const root of skillRoots) {
    for (const [id, relPath] of sharedDataChecks) {
      const full = path.join(root, relPath);
      if (hasType(full, "directory") && !found[id]) {
        found[id] = {
          path: full,
          files: listFiles(full)
        };
      }
    }
  }
  return found;
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readCredentialText(filePath) {
  const maximumBytes = 64 * 1024;
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximumBytes) {
      return null;
    }
    // Bound the read even if the file grows after fstat; never read a pipe or device.
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    return length > maximumBytes ? null : buffer.subarray(0, length).toString("utf8");
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function kaggleConfigured() {
  // Presence hints only: do not introspect a token or load an OAuth session.
  // Token paths follow Kaggle/kaggle-sdk-python's kagglesdk/kaggle_env.py.
  const token = process.env.KAGGLE_API_TOKEN;
  if (nonemptyString(token)) {
    if (!exists(token) || nonemptyString(readCredentialText(token))) return true;
  } else if (["access_token", "access_token.txt"].some(name =>
    nonemptyString(readCredentialText(path.join(home, ".kaggle", name))))) {
    return true;
  }

  // KAGGLE_CONFIG_DIR and the Linux fallback apply to legacy kaggle.json,
  // not to the token paths above (Kaggle CLI's kaggle_api_extended.py).
  let configDirectory = process.env.KAGGLE_CONFIG_DIR;
  if (!configDirectory) {
    configDirectory = path.join(home, ".kaggle");
    if (process.platform === "linux" && !exists(configDirectory)) {
      configDirectory = path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "kaggle");
    }
  }
  let legacy = {};
  try {
    const value = JSON.parse(readCredentialText(path.join(configDirectory, "kaggle.json")) || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) legacy = value;
  } catch {
    // Invalid, missing, or unreadable credentials are not configured; emit no contents.
  }
  return nonemptyString(process.env.KAGGLE_USERNAME ?? legacy.username) &&
    nonemptyString(process.env.KAGGLE_KEY ?? legacy.key);
}

// setup.js remains the primary status. Presence is definite only when the helper
// reported stored credentials or a not-logged-in state; helper trust/availability
// failures and unparsed replies stay unknown (null) with setup's status and reason.
function colosseumConnectionStatus() {
  const { configured, status, reason } = getSetupStatus().colosseum;
  return {
    colosseum_copilot_connection_stored: configured === true ? true : status === "missing" ? false : null,
    colosseum_copilot_connection_status: status,
    colosseum_copilot_connection_reason: reason
  };
}

function readCredentialStatus() {
  return {
    ...colosseumConnectionStatus(),
    github_token_configured: nonemptyString(process.env.GITHUB_TOKEN) || nonemptyString(process.env.GH_TOKEN),
    kaggle_configured: kaggleConfigured(),
    hugging_face_token_configured: nonemptyString(process.env.HF_TOKEN) || nonemptyString(process.env.HUGGINGFACE_TOKEN),
    openai_key_configured: nonemptyString(process.env.OPENAI_API_KEY),
    anthropic_key_configured: nonemptyString(process.env.ANTHROPIC_API_KEY),
    gemini_key_configured: nonemptyString(process.env.GEMINI_API_KEY) || nonemptyString(process.env.GOOGLE_API_KEY)
  };
}

const installedSkills = {};
for (const skillName of solanaNewSkills) {
  const found = findSkill(skillName);
  if (found) {
    installedSkills[skillName] = found;
  }
}

const supportInventory = supportSkills.map(skill => {
  const found = findSkill(skill.id);
  return { id: skill.id, source_pack: skill.source_pack, status: found ? "installed" : "not_found", skill_file: found?.skill_file ?? null };
});
const supportAssets = dependencyManifest.sources.flatMap(source => source.assets.map(asset => {
  const root = skillRoots.find(root => (asset.required_files ?? [""]).every(file => {
    try { return fs.statSync(path.join(root, asset.destination, file)).isFile(); } catch { return false; }
  }));
  return { path: asset.destination, status: root ? "installed" : "not_found", location: root ? path.join(root, asset.destination) : null };
}));
const installationRoot = explicitRoot ?? path.resolve(path.dirname(helperLocations[0]), "../..");
const installationState = readJson(path.join(installationRoot, ".proofpilot-bundle.json"));

const output = {
  support_bundle: {
    bundle_id: dependencyManifest.bundle_id,
    installed_by_default: true,
    installation_mode: installationState?.requested_install_mode ?? installationState?.mode ?? "unknown",
    guidance_complete: supportInventory.every(item => item.status === "installed") && supportAssets.every(item => item.status === "installed"),
    skills: supportInventory,
    shared_guidance: supportAssets,
    notes: ["File inventory only; helper availability, account access and development toolchains are not checked.", "Repository installers install the full bundle. Standalone skill copies use the portable dependency helper on first use unless core-only was selected."]
  },
  skill_roots_checked: skillRoots,
  solana_development: {
    guidance_bundled: true,
    implementations_bundled: false,
    developer_skills_installed_by_default: true,
    skills: developmentSkills.map(skill => {
      const found = findSkill(skill.id);
      return { ...skill, status: found ? "installed" : "not_found", skill_file: found?.skill_file ?? null };
    }),
    notes: [
      "ProofPilot installers add the separate developer skills listed here by default; a core-only copy can omit them.",
      "Installed means a SKILL.md was found; it does not verify tools, dependencies or runtime access.",
      "If no developer skill is found, continue requested local implementation with the host agent and current official documentation. Do not stop at a venture plan."
    ]
  },
  solana_new: {
    installed_skills: installedSkills,
    shared_data: findSharedData(),
    notes: [
      "Colosseum is the required ProofPilot research foundation; use local solana.new skills/data as complementary technical guidance. Credential presence is not verified access.",
      "The default bundle includes data/catalogs/*.json. Protocol-specific candidates listed there are installed only when the project needs them."
    ]
  }
};
if (!capabilitiesOnly) output.credentials = readCredentialStatus();
output.path_issues = pathIssues;

console.log(JSON.stringify(output, null, 2));
