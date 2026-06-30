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
  "data/rubrics.json",
  "data/source-catalog.json",
  "skills/proofpilot/SKILL.md",
  "skills/idea-discovery/SKILL.md",
  "skills/venture-validation/SKILL.md",
  "skills/mvp-planner/SKILL.md",
  "skills/readiness-review/SKILL.md",
  "skills/submission-builder/SKILL.md"
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

console.log("ProofPilot validation passed");
