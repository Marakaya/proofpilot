import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const requiredFiles = [
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/workflow.md",
  "docs/runtime.md",
  "docs/credential-model.md",
  "docs/included-tools.md",
  "data/tracks.json",
  "data/tool-registry.json",
  "data/credential-matrix.json",
  "data/track-lenses.json",
  "data/rubrics.json",
  "data/source-catalog.json",
  "skills/proofpilot/SKILL.md",
  "skills/proofpilot-idea-discovery/SKILL.md",
  "skills/proofpilot-venture-validation/SKILL.md",
  "skills/proofpilot-mvp-planner/SKILL.md",
  "skills/proofpilot-readiness-review/SKILL.md",
  "skills/proofpilot-submission-builder/SKILL.md"
];

for (const file of requiredFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

const jsonFiles = [
  "data/tracks.json",
  "data/tool-registry.json",
  "data/credential-matrix.json",
  "data/track-lenses.json",
  "data/rubrics.json",
  "data/source-catalog.json",
  "schemas/proofpilot.schema.json"
];

for (const file of jsonFiles) {
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

const tracks = JSON.parse(fs.readFileSync(path.join(root, "data/tracks.json"), "utf8"));
if (!Array.isArray(tracks.tracks) || tracks.tracks.length < 5) {
  throw new Error("data/tracks.json must include at least five tracks");
}

const tools = JSON.parse(fs.readFileSync(path.join(root, "data/tool-registry.json"), "utf8"));
if (!Array.isArray(tools.tools) || tools.tools.length < 10) {
  throw new Error("data/tool-registry.json must include at least ten tools");
}

const credentials = JSON.parse(fs.readFileSync(path.join(root, "data/credential-matrix.json"), "utf8"));
if (!Array.isArray(credentials.credential_classes) || credentials.credential_classes.length < 4) {
  throw new Error("data/credential-matrix.json must include credential classes");
}

const lenses = JSON.parse(fs.readFileSync(path.join(root, "data/track-lenses.json"), "utf8"));
if (!Array.isArray(lenses.lenses)) {
  throw new Error("data/track-lenses.json must include lenses");
}

const trackIds = new Set(tracks.tracks.map((track) => track.id));
const lensIds = new Set(lenses.lenses.map((lens) => lens.id));
for (const trackId of trackIds) {
  if (!lensIds.has(trackId)) {
    throw new Error(`data/track-lenses.json is missing lens for track: ${trackId}`);
  }
}

const skillDirs = [
  "proofpilot",
  "proofpilot-idea-discovery",
  "proofpilot-venture-validation",
  "proofpilot-mvp-planner",
  "proofpilot-readiness-review",
  "proofpilot-submission-builder"
];

for (const skillDir of skillDirs) {
  const skillText = fs.readFileSync(path.join(root, "skills", skillDir, "SKILL.md"), "utf8");
  const nameMatch = skillText.match(/^name:\s*([a-z0-9-]+)$/m);
  if (!nameMatch || nameMatch[1] !== skillDir) {
    throw new Error(`Skill frontmatter name must match folder: ${skillDir}`);
  }
}

console.log("ProofPilot validation passed");
