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
  "data/source-playbooks.json",
  "data/judgment-policy.json",
  "data/accelerator-programs.json",
  "data/accelerator-rubrics.json",
  "data/presentation-decks.json",
  "data/presentation-rubrics.json",
  "data/rubrics.json",
  "data/source-catalog.json",
  "references/source-orchestration.md",
  "references/solana-new.md",
  "references/honest-evaluation.md",
  "references/accelerators.md",
  "references/presentations.md",
  "scripts/discover-sources.js",
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
  "data/source-playbooks.json",
  "data/judgment-policy.json",
  "data/accelerator-programs.json",
  "data/accelerator-rubrics.json",
  "data/presentation-decks.json",
  "data/presentation-rubrics.json",
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

const judgmentPolicy = JSON.parse(fs.readFileSync(path.join(root, "data/judgment-policy.json"), "utf8"));
if (!Array.isArray(judgmentPolicy.non_negotiables) || judgmentPolicy.non_negotiables.length < 5) {
  throw new Error("data/judgment-policy.json must include non_negotiables");
}

const lenses = JSON.parse(fs.readFileSync(path.join(root, "data/track-lenses.json"), "utf8"));
if (!Array.isArray(lenses.lenses)) {
  throw new Error("data/track-lenses.json must include lenses");
}

const sourceCatalog = JSON.parse(fs.readFileSync(path.join(root, "data/source-catalog.json"), "utf8"));
const sourcePlaybooks = JSON.parse(fs.readFileSync(path.join(root, "data/source-playbooks.json"), "utf8"));
if (!Array.isArray(sourceCatalog.sources)) {
  throw new Error("data/source-catalog.json must include sources");
}

const acceleratorPrograms = JSON.parse(fs.readFileSync(path.join(root, "data/accelerator-programs.json"), "utf8"));
if (!Array.isArray(acceleratorPrograms.programs) || acceleratorPrograms.programs.length < 5) {
  throw new Error("data/accelerator-programs.json must include accelerator programs");
}

const acceleratorRubrics = JSON.parse(fs.readFileSync(path.join(root, "data/accelerator-rubrics.json"), "utf8"));
if (!Array.isArray(acceleratorRubrics.accelerator_readiness_rubric?.dimensions) || acceleratorRubrics.accelerator_readiness_rubric.dimensions.length < 8) {
  throw new Error("data/accelerator-rubrics.json must include accelerator readiness dimensions");
}

const presentationDecks = JSON.parse(fs.readFileSync(path.join(root, "data/presentation-decks.json"), "utf8"));
if (!Array.isArray(presentationDecks.deck_types) || presentationDecks.deck_types.length < 4) {
  throw new Error("data/presentation-decks.json must include deck types");
}

const presentationRubrics = JSON.parse(fs.readFileSync(path.join(root, "data/presentation-rubrics.json"), "utf8"));
if (!Array.isArray(presentationRubrics.presentation_rubric?.dimensions) || presentationRubrics.presentation_rubric.dimensions.length < 8) {
  throw new Error("data/presentation-rubrics.json must include presentation rubric dimensions");
}

const requiredDeckIds = ["hackathon_demo_deck", "investor_seed_deck", "angel_intro_deck", "accelerator_deck"];
const deckIds = new Set(presentationDecks.deck_types.map((deck) => deck.id));
for (const deckId of requiredDeckIds) {
  if (!deckIds.has(deckId)) {
    throw new Error(`data/presentation-decks.json is missing deck type: ${deckId}`);
  }
}

const requiredProgramIds = ["yc", "techstars", "500_global", "antler", "entrepreneur_first", "sequoia_arc"];
const programIds = new Set(acceleratorPrograms.programs.map((program) => program.id));
for (const programId of requiredProgramIds) {
  if (!programIds.has(programId)) {
    throw new Error(`data/accelerator-programs.json is missing program: ${programId}`);
  }
}
if (!Array.isArray(sourcePlaybooks.playbooks)) {
  throw new Error("data/source-playbooks.json must include playbooks");
}

const sourceIds = new Set(sourceCatalog.sources.map((source) => source.id));
const playbookIds = new Set(sourcePlaybooks.playbooks.map((playbook) => playbook.id));
for (const sourceId of sourceIds) {
  if (!playbookIds.has(sourceId)) {
    throw new Error(`data/source-playbooks.json is missing playbook for source: ${sourceId}`);
  }
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
