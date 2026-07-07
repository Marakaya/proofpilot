#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function readCredentialStatus() {
  const config = readJson(path.join(home, ".superstack", "config.json")) || {};
  return {
    colosseum_copilot_pat_configured: Boolean(config.copilotToken || process.env.COLOSSEUM_COPILOT_PAT),
    github_token_configured: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
    kaggle_configured: Boolean(process.env.KAGGLE_USERNAME && process.env.KAGGLE_KEY),
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
      "Use local solana.new skills and shared data first for Solana/web3 tasks.",
      "If legacy data/catalogs/*.json exists in a future install, treat it as an extra source, not a hard dependency."
    ]
  },
  credentials: readCredentialStatus()
};

console.log(JSON.stringify(output, null, 2));
