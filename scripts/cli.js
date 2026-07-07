#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tracks = JSON.parse(fs.readFileSync(path.join(root, "data", "tracks.json"), "utf8"));
const rubric = JSON.parse(fs.readFileSync(path.join(root, "data", "rubrics.json"), "utf8"));

console.log("ProofPilot");
console.log("Open-source AI guide for idea discovery, validation, MVP planning, and launch readiness.");
console.log("");
console.log("Default tracks:");
for (const track of tracks.tracks) {
  console.log(`- ${track.id}: ${track.label}`);
}
console.log("");
console.log("Core readiness dimensions:");
for (const dimension of rubric.readiness_rubric.dimensions) {
  console.log(`- ${dimension.id}: ${dimension.label}`);
}
console.log("");
console.log("Install into Codex with: npm run install:skills");
console.log("Inspect local source packs with: node scripts/discover-sources.js");
console.log("Start with skills/proofpilot/SKILL.md in portable/manual runtimes.");
