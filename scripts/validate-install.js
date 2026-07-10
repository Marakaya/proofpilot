#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const installScript = path.join(root, "scripts", "install-skills.js");
const skillNames = [
  "proofpilot",
  "proofpilot-idea-discovery",
  "proofpilot-venture-validation",
  "proofpilot-mvp-planner",
  "proofpilot-readiness-review",
  "proofpilot-submission-builder"
];

function validateMode(modeArgs) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-profiles-"));
  try {
    const install = spawnSync(
      process.execPath,
      [installScript, "--target", temporaryRoot, ...modeArgs],
      { cwd: root, encoding: "utf8" }
    );
    if (install.status !== 0) {
      throw new Error(`install-skills.js failed:\n${install.stderr}\n${install.stdout}`);
    }

    for (const skillName of skillNames) {
      const skillDir = path.join(temporaryRoot, skillName);
      const requiredPaths = [
        "SKILL.md",
        "references/taxonomy.json",
        "references/source-registry.json",
        "references/tool-registry.json",
        "references/rubrics.json",
        "references/accelerator-programs.json",
        "references/presentation-decks.json",
        "references/honest-evaluation.md",
        "scripts/discover-sources.js"
      ];
      for (const relativePath of requiredPaths) {
        if (!fs.existsSync(path.join(skillDir, relativePath))) {
          throw new Error(`Installed profile is missing ${skillName}/${relativePath}`);
        }
      }

      const skillText = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
      const nameMatch = skillText.match(/^name:\s*([a-z0-9-]+)$/m);
      const descriptionMatch = skillText.match(/^description:\s*(.+)$/m);
      if (!nameMatch || nameMatch[1] !== skillName) {
        throw new Error(`Skill frontmatter name must match folder: ${skillName}`);
      }
      if (!descriptionMatch || descriptionMatch[1].trim().length < 40) {
        throw new Error(`Skill description is too short: ${skillName}`);
      }
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

validateMode([]);
validateMode(["--copy"]);
console.log("ProofPilot optional profile installation passed in symlink and copy modes");
