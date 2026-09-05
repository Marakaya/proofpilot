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
    // Installed scripts must work even when the host project defaults to CommonJS.
    fs.writeFileSync(path.join(temporaryRoot, "package.json"), JSON.stringify({ type: "commonjs" }));
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
        "references/event-assessment.md",
        "references/event-intake.md",
        "references/event-profiles.json",
        "scripts/event-score.js",
        "references/accelerator-programs.json",
        "references/presentation-decks.json",
        "references/honest-evaluation.md",
        "references/decisions.md",
        "references/quality.md",
        "references/quality-review.md",
        "scripts/quality.js",
        "scripts/package.json",
        "references/product-market-fit.md",
        "references/ai-product-validation.md",
        "scripts/validate-response.js",
        "scripts/discover-sources.js"
      ];
      for (const relativePath of requiredPaths) {
        if (!fs.existsSync(path.join(skillDir, relativePath))) {
          throw new Error(`Installed profile is missing ${skillName}/${relativePath}`);
        }
      }

      const qualityHelp = spawnSync(process.execPath, [path.join(skillDir, "scripts", "quality.js"), "--help"], { cwd: os.tmpdir(), encoding: "utf8" });
      if (qualityHelp.status !== 0 || !Array.isArray(JSON.parse(qualityHelp.stdout).criteria)) {
        throw new Error(`Installed quality helper cannot run independently: ${skillName}`);
      }

      const eventList = spawnSync(process.execPath, [path.join(skillDir, "scripts", "event-score.js"), "list"], { cwd: os.tmpdir(), encoding: "utf8" });
      if (eventList.status !== 0) {
        throw new Error(`Installed event helper cannot run independently: ${skillName}: ${eventList.stderr}`);
      }
      JSON.parse(eventList.stdout);

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
