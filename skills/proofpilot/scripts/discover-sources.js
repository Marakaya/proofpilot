#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveColosseumCredential } from "./setup.js";

const home = os.homedir();

const skillRoots = [
  process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "skills") : path.join(home, ".codex", "skills"),
  path.join(home, ".agents", "skills"),
  path.join(home, ".claude", "skills")
];

const solanaNewSkills = [
  "navigate-skills",
  "solana-beginner",
  "find-next-crypto-idea",
  "validate-idea",
  "competitive-landscape",
  "defillama-research",
  "colosseum-copilot",
  "scaffold-project",
  "build-with-claude",
  "virtual-solana-incubator",
  "build-defi-protocol",
  "build-data-pipeline",
  "build-mobile",
  "launch-token",
  "review-and-iterate",
  "product-review",
  "roast-my-product",
  "cso",
  "debug-program",
  "deploy-to-mainnet",
  "create-pitch-deck",
  "submit-to-hackathon"
];

const sharedDataChecks = [
  ["solana_knowledge", "data/solana-knowledge"],
  ["ideas", "data/ideas"],
  ["guides", "data/guides"],
  ["colosseum", "data/colosseum"],
  ["defi", "data/defi"],
  ["specs", "data/specs"]
];

function exists(filePath) {
  return fs.existsSync(filePath);
}

function listFiles(dir) {
  if (!exists(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((entry) => {
    const full = path.join(dir, entry);
    return fs.statSync(full).isFile();
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findSkill(skillName) {
  for (const root of skillRoots) {
    const skillFile = path.join(root, skillName, "SKILL.md");
    if (exists(skillFile)) {
      return { root, skill_file: skillFile };
    }
  }
  return null;
}

function findSharedData() {
  const found = {};
  for (const root of skillRoots) {
    for (const [id, relPath] of sharedDataChecks) {
      const full = path.join(root, relPath);
      if (exists(full) && !found[id]) {
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

function readCredentialStatus() {
  return {
    colosseum_copilot_pat_configured: resolveColosseumCredential().configured,
    github_token_configured: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
    kaggle_configured: kaggleConfigured(),
    hugging_face_token_configured: Boolean(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN),
    openai_key_configured: Boolean(process.env.OPENAI_API_KEY),
    anthropic_key_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini_key_configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
  };
}

const installedSkills = {};
for (const skillName of solanaNewSkills) {
  const found = findSkill(skillName);
  if (found) {
    installedSkills[skillName] = found;
  }
}

const output = {
  skill_roots_checked: skillRoots,
  solana_new: {
    installed_skills: installedSkills,
    shared_data: findSharedData(),
    notes: [
      "Colosseum is the required ProofPilot research foundation; use local solana.new skills/data as complementary technical guidance. Credential presence is not verified access.",
      "If legacy data/catalogs/*.json exists in a future install, treat it as an extra source, not a hard dependency."
    ]
  },
  credentials: readCredentialStatus()
};

console.log(JSON.stringify(output, null, 2));
