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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-skills-"));

try {
  const install = spawnSync(process.execPath, [installScript, "--target", tmpRoot], {
    cwd: root,
    encoding: "utf8"
  });

  if (install.status !== 0) {
    throw new Error(`install-skills.js failed:\n${install.stderr}\n${install.stdout}`);
  }

  for (const skillName of skillNames) {
    const skillDir = path.join(tmpRoot, skillName);
    const skillFile = path.join(skillDir, "SKILL.md");
    const tracksFile = path.join(skillDir, "data", "tracks.json");
    const lensesFile = path.join(skillDir, "data", "track-lenses.json");
    const playbooksFile = path.join(skillDir, "data", "source-playbooks.json");
    const judgmentFile = path.join(skillDir, "data", "judgment-policy.json");
    const acceleratorProgramsFile = path.join(skillDir, "data", "accelerator-programs.json");
    const presentationDecksFile = path.join(skillDir, "data", "presentation-decks.json");
    const presentationRubricsFile = path.join(skillDir, "data", "presentation-rubrics.json");
    const honestEvaluationFile = path.join(skillDir, "references", "honest-evaluation.md");
    const acceleratorsFile = path.join(skillDir, "references", "accelerators.md");
    const presentationsFile = path.join(skillDir, "references", "presentations.md");
    const orchestrationFile = path.join(skillDir, "references", "source-orchestration.md");
    const discoverScript = path.join(skillDir, "scripts", "discover-sources.js");
    const workflowFile = path.join(skillDir, "docs", "workflow.md");

    for (const required of [skillFile, tracksFile, lensesFile, playbooksFile, judgmentFile, acceleratorProgramsFile, presentationDecksFile, presentationRubricsFile, honestEvaluationFile, acceleratorsFile, presentationsFile, orchestrationFile, discoverScript, workflowFile]) {
      if (!fs.existsSync(required)) {
        throw new Error(`Installed skill is missing required path: ${required}`);
      }
    }

    const skillText = fs.readFileSync(skillFile, "utf8");
    const nameMatch = skillText.match(/^name:\s*([a-z0-9-]+)$/m);
    const descriptionMatch = skillText.match(/^description:\s*(.+)$/m);
    if (!nameMatch || nameMatch[1] !== skillName) {
      throw new Error(`Skill frontmatter name must match folder: ${skillName}`);
    }
    if (!descriptionMatch || descriptionMatch[1].trim().length < 40) {
      throw new Error(`Skill description is too short: ${skillName}`);
    }
  }

  console.log("ProofPilot install validation passed");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
