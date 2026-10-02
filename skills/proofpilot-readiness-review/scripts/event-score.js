#!/usr/bin/env node
/** Offline score bookkeeping only: this cannot authenticate evidence or certify a judge. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const PROFILE_FILE = fileURLToPath(new URL("../references/event-profiles.json", import.meta.url));
const BASIS = ["observed", "artifact_supported", "team_reported", "unavailable"];
const SOURCE_KINDS = ["submitted", "public", "runtime"];
const HELP = `ProofPilot event-score (offline; Node >=20)
  list
  init <solana_hackathon|learning_workshop|id@version|profile.json> <new-scorecard.json>
  check <scorecard.json>

Init writes a new file only. Complete event/project/reviewer, mode, cutoff,
source policy, artifacts, admission checks and dimensions before check.
Scores use anchored integers 0..4; null means unscored. Unknown scores are never
normalized away. External profiles need explicit weights totaling 100 and
provenance; official is a supplied attribution, not verified by this tool.
The embedded rubric hash detects accidental changes, not a malicious rewrite.
No network access, artifact inspection, ranking or independent review occurs.`;

function need(test, message) { if (!test) throw new Error(message); }
function obj(value, label) { need(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); }
function fields(value, expected, label, optional = []) {
  obj(value, label);
  need(Object.keys(value).every((key) => expected.includes(key) || optional.includes(key)), `${label} contains unknown fields; do not supply manual totals or weights`);
  need(expected.every((key) => Object.hasOwn(value, key)), `${label} requires fields: ${expected.join(", ")}`);
}
function text(value, label) { need(typeof value === "string" && value.trim().length > 0 && !value.startsWith("REPLACE_"), `${label} must be a nonempty completed string`); }
function id(value, label) { need(typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value), `${label} must be a safe identifier`); }
function choice(value, values, label) { need(values.includes(value), `${label} must be one of ${values.join(", ")}`); }
function array(value, label) { need(Array.isArray(value), `${label} must be an array`); }
function unique(items, label) {
  const ids = new Set();
  for (const item of items) { id(item.id, `${label}.id`); need(!ids.has(item.id), `${label}: duplicate ID ${item.id}`); ids.add(item.id); }
  return ids;
}
function instant(value, label) {
  need(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value), `${label} needs a UTC ISO timestamp, e.g. 2026-09-06T12:00:00Z`);
  const parsed = new Date(value);
  need(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19), `${label} must be a real date`);
  return parsed.getTime();
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");
function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch (error) { throw new Error(`Cannot read JSON ${filename}: ${error.message}`); }
}

function validateProfile(profile) {
  fields(profile, ["id", "version", "label", "origin", "source_locator", "provenance", "scale", "dimensions", "admission_checks"], "rubric");
  id(profile.id, "rubric.id");
  for (const key of ["version", "label", "source_locator", "provenance"]) text(profile[key], `rubric.${key}`);
  choice(profile.origin, ["proofpilot", "custom", "official"], "rubric.origin");
  fields(profile.scale, ["min", "max", "step"], "rubric.scale");
  need(profile.scale.min === 0 && profile.scale.max === 4 && profile.scale.step === 1, "Only an explicit integer 0..4 scale is supported; do not silently convert an official scale");
  array(profile.dimensions, "rubric.dimensions");
  need(profile.dimensions.length > 0, "Rubric must have dimensions");
  unique(profile.dimensions, "rubric.dimensions");
  for (const dimension of profile.dimensions) {
    fields(dimension, ["id", "label", "weight", "anchors"], "rubric.dimension");
    text(dimension.label, "dimension.label");
    need(typeof dimension.weight === "number" && Number.isFinite(dimension.weight) && dimension.weight > 0 && dimension.weight <= 100, "Every weight must be finite and greater than 0, at most 100");
    fields(dimension.anchors, ["0", "2", "4"], "dimension.anchors");
    for (const key of ["0", "2", "4"]) text(dimension.anchors[key], `anchor.${key}`);
  }
  need(Math.abs(profile.dimensions.reduce((sum, item) => sum + item.weight, 0) - 100) < 1e-9, "Rubric weights must total exactly 100");
  array(profile.admission_checks, "rubric.admission_checks");
  need(profile.admission_checks.length > 0, "Rubric must define admission checks separately from scores");
  unique(profile.admission_checks, "rubric.admission_checks");
  for (const check of profile.admission_checks) { fields(check, ["id", "label"], "rubric.admission_check"); text(check.label, "admission_check.label"); }
  return profile;
}
function builtins(includeArchived = false) {
  const registry = readJson(PROFILE_FILE);
  fields(registry, ["schema_version", "profiles"], "profile registry", ["archived_profiles"]);
  need(registry.schema_version === 1, "Unsupported profile registry version");
  array(registry.profiles, "registry.profiles");
  unique(registry.profiles, "registry.profiles");
  const archived = registry.archived_profiles ?? [];
  array(archived, "registry.archived_profiles");
  const all = [...registry.profiles, ...archived].map(validateProfile);
  const versions = new Set();
  for (const profile of all) {
    need(profile.origin === "proofpilot", "Packaged presets must retain ProofPilot provenance");
    const key = `${profile.id}@${profile.version}`;
    need(!versions.has(key), `Duplicate packaged rubric version: ${key}`);
    versions.add(key);
  }
  return includeArchived ? all : registry.profiles;
}
function assertPackaged(profile) {
  const all = builtins(true);
  const packaged = all.find((item) => item.id === profile.id && item.version === profile.version);
  if (profile.origin === "proofpilot" || all.some((item) => item.id === profile.id)) {
    need(packaged && digest(profile) === digest(packaged), "Built-in rubric snapshot differs from the packaged preset (including weights/version); create a separately named custom profile for adaptations");
  }
}
function selectProfile(value) {
  const profile = builtins().find((item) => item.id === value) || builtins(true).find((item) => `${item.id}@${item.version}` === value) || validateProfile(readJson(value));
  assertPackaged(profile);
  return profile;
}
function initialize(profile, destination) {
  const card = {
    schema_version: 1,
    event: { id: "REPLACE_EVENT_ID", name: "REPLACE_EVENT_NAME", rules_locator: "REPLACE_PUBLISHED_RULES_OR_ASSIGNMENT" },
    project: { id: "REPLACE_PROJECT_ID", name: "REPLACE_PROJECT_NAME" },
    reviewer: { id: "REPLACE_REVIEWER_ID", kind: "agent", name: "REPLACE_ACTUAL_REVIEWER_OR_MODEL" },
    mode: "coach",
    evidence_cutoff: "REPLACE_UTC_ISO_TIMESTAMP",
    source_policy: { allowed_kinds: ["submitted"], description: "Use submitted materials only; explicitly revise this policy if the event permits public research or runtime checks." },
    rubric_snapshot: profile,
    rubric_sha256: digest(profile),
    artifacts: [],
    admission: profile.admission_checks.map((check) => ({ id: check.id, status: "unknown", rationale: "Pending verification of the published requirement.", evidence_refs: [] })),
    dimensions: profile.dimensions.map((dimension) => ({ id: dimension.id, score: null, basis: "unavailable", confidence: "unknown", rationale: "No evidence reviewed yet.", evidence_refs: [] }))
  };
  fs.writeFileSync(destination, `${JSON.stringify(card, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { scorecard: path.resolve(destination), profile: profile.id, version: profile.version, rubric_sha256: card.rubric_sha256, status: "template_created", mechanical_only: true };
}
function exactIds(items, expected, label) {
  array(items, label);
  const ids = unique(items, label);
  need(ids.size === expected.length && expected.every((item) => ids.has(item.id)), `${label} must contain every rubric ID exactly once, with no extra dimensions/checks`);
}
function evidenceRefs(refs, artifacts, label) {
  array(refs, label);
  need(new Set(refs).size === refs.length, `${label} contains duplicate references`);
  return refs.map((ref) => { need(typeof ref === "string" && artifacts.has(ref), `${label}: unknown artifact ${ref}`); return artifacts.get(ref); });
}
function checkCard(card) {
  fields(card, ["schema_version", "event", "project", "reviewer", "mode", "evidence_cutoff", "source_policy", "rubric_snapshot", "rubric_sha256", "artifacts", "admission", "dimensions"], "scorecard");
  need(card.schema_version === 1, "Unsupported scorecard version");
  fields(card.event, ["id", "name", "rules_locator"], "event");
  fields(card.project, ["id", "name"], "project");
  fields(card.reviewer, ["id", "kind", "name"], "reviewer");
  for (const entity of ["event", "project", "reviewer"]) {
    id(card[entity].id, `${entity}.id`);
    text(card[entity].id, `${entity}.id`);
    text(card[entity].name, `${entity}.name`);
  }
  text(card.event.rules_locator, "event.rules_locator");
  choice(card.reviewer.kind, ["human", "agent"], "reviewer.kind");
  choice(card.mode, ["coach", "evaluator"], "mode");
  const cutoff = instant(card.evidence_cutoff, "evidence_cutoff");
  fields(card.source_policy, ["allowed_kinds", "description"], "source_policy");
  array(card.source_policy.allowed_kinds, "source_policy.allowed_kinds");
  need(card.source_policy.allowed_kinds.length > 0 && new Set(card.source_policy.allowed_kinds).size === card.source_policy.allowed_kinds.length, "allowed_kinds must be nonempty and unique");
  for (const kind of card.source_policy.allowed_kinds) choice(kind, SOURCE_KINDS, "source_policy.allowed_kinds");
  text(card.source_policy.description, "source_policy.description");
  const profile = validateProfile(card.rubric_snapshot);
  need(card.rubric_sha256 === digest(profile), "Rubric snapshot hash mismatch");
  assertPackaged(profile);
  array(card.artifacts, "artifacts");
  unique(card.artifacts, "artifacts");
  for (const artifact of card.artifacts) {
    fields(artifact, ["id", "location", "version", "kind", "available_at", "basis", "scope"], "artifact", ["observed_at"]);
    for (const key of ["location", "version", "scope"]) text(artifact[key], `artifact.${key}`);
    choice(artifact.kind, card.source_policy.allowed_kinds, "artifact.kind (source policy)");
    choice(artifact.basis, BASIS, "artifact.basis");
    // available_at identifies when the cited source version existed. Its later
    // inspection can be recorded separately without admitting post-deadline work.
    const availableAt = instant(artifact.available_at, "artifact.available_at");
    need(availableAt <= cutoff, `Artifact ${artifact.id} is after the evidence cutoff`);
    if (artifact.observed_at !== undefined) need(instant(artifact.observed_at, "artifact.observed_at") >= availableAt, "artifact.observed_at cannot predate availability of the inspected source version");
  }
  const artifacts = new Map(card.artifacts.map((artifact) => [artifact.id, artifact]));
  exactIds(card.admission, profile.admission_checks, "admission");
  for (const check of card.admission) {
    fields(check, ["id", "status", "rationale", "evidence_refs"], "admission check");
    choice(check.status, ["passed", "failed", "unknown"], "admission.status");
    text(check.rationale, "admission.rationale");
    const refs = evidenceRefs(check.evidence_refs, artifacts, "admission.evidence_refs");
    if (check.status !== "unknown") need(refs.length > 0 && refs.some((ref) => ["observed", "artifact_supported"].includes(ref.basis)), `Admission ${check.id} needs inspected supporting evidence for passed/failed`);
  }
  exactIds(card.dimensions, profile.dimensions, "dimensions");
  const weights = new Map(profile.dimensions.map((item) => [item.id, item.weight]));
  let earned = 0;
  let covered = 0;
  const dimensions = card.dimensions.map((dimension) => {
    fields(dimension, ["id", "score", "basis", "confidence", "rationale", "evidence_refs"], "dimension");
    choice(dimension.basis, BASIS, "dimension.basis");
    choice(dimension.confidence, ["high", "medium", "low", "unknown"], "dimension.confidence");
    text(dimension.rationale, "dimension.rationale");
    const refs = evidenceRefs(dimension.evidence_refs, artifacts, "dimension.evidence_refs");
    let points = null;
    if (dimension.score !== null) {
      need(Number.isInteger(dimension.score) && dimension.score >= 0 && dimension.score <= 4, `Dimension ${dimension.id} score must be an integer 0..4 or null`);
      need(["observed", "artifact_supported"].includes(dimension.basis), `Dimension ${dimension.id}: unavailable or team-report-only evidence cannot establish a numeric score`);
      need(dimension.confidence !== "unknown", `Scored dimension ${dimension.id} requires stated confidence`);
      need(refs.length > 0 && refs.some((ref) => ref.basis === dimension.basis), `Dimension ${dimension.id} requires evidence matching its declared basis`);
      points = weights.get(dimension.id) * dimension.score / 4;
      earned += points;
      covered += weights.get(dimension.id);
    } else if (dimension.basis === "team_reported") {
      need(refs.some((ref) => ref.basis === "team_reported"), `Team-reported dimension ${dimension.id} requires the report artifact`);
    } else if (["observed", "artifact_supported"].includes(dimension.basis)) {
      need(refs.some((ref) => ref.basis === dimension.basis), `Unscored dimension ${dimension.id} requires an artifact matching its declared ${dimension.basis} basis`);
    }
    return { id: dimension.id, weight: weights.get(dimension.id), score: dimension.score, points, basis: dimension.basis, confidence: dimension.confidence, rationale: dimension.rationale, evidence_refs: dimension.evidence_refs };
  });
  const complete = card.dimensions.every((item) => item.score !== null);
  const admissionPassed = card.admission.every((item) => item.status === "passed");
  const round = (value) => Math.round(value * 1e8) / 1e8;
  return {
    event_id: card.event.id, project_id: card.project.id, reviewer_id: card.reviewer.id, mode: card.mode,
    profile: { id: profile.id, version: profile.version, origin: profile.origin, source_locator: profile.source_locator, rubric_sha256: card.rubric_sha256 },
    mechanical_only: true, evidence_authenticity_verified: false, independent_review_verified: false,
    earned_points: round(earned), coverage_weight_percent: round(covered),
    possible_points_upper: round(earned + 100 - covered), total: complete ? round(earned) : null,
    provisional: !complete || !admissionPassed || card.mode === "coach",
    mechanically_comparable: complete && admissionPassed && card.mode === "evaluator",
    admission_status: admissionPassed ? "passed" : card.admission.some((item) => item.status === "failed") ? "failed" : "unknown",
    unresolved_dimensions: card.dimensions.filter((item) => item.score === null).map((item) => item.id),
    admission: card.admission, dimensions,
    limitations: [
      "Mechanical consistency only; no source, claim, authorship, official attribution or reviewer independence is authenticated.",
      "The score measures only the cited scope. Observing an answer does not verify demand or real-world outcomes asserted in that answer.",
      "The rubric hash is an integrity checksum, not a signature. Custom profile provenance and equal event policies require organizer review.",
      "Possible points upper is arithmetic remaining capacity, not a predicted score or confidence interval. Partial scores are not normalized or ranked."
    ]
  };
}

export function runEventScore(args) {
  const [command, ...rest] = args;
  if (!command || ["help", "--help", "-h"].includes(command)) return { help: HELP };
  if (command === "list") {
    need(rest.length === 0, "Usage: list");
    return { mechanical_only: true, profiles: builtins().map((profile) => ({ id: profile.id, version: profile.version, label: profile.label, origin: profile.origin, scale: profile.scale, dimensions: profile.dimensions })) };
  }
  if (command === "init") {
    need(rest.length === 2, "Usage: init <profile-id-or-json-path> <new-scorecard.json>");
    return initialize(selectProfile(rest[0]), rest[1]);
  }
  if (command === "check") {
    need(rest.length === 1, "Usage: check <scorecard.json>");
    return checkCard(readJson(rest[0]));
  }
  throw new Error("Unknown event-score command. Use --help.");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = runEventScore(process.argv.slice(2)); process.stdout.write(result.help ? `${result.help}\n` : `${JSON.stringify(result, null, 2)}\n`); }
  catch (error) { process.stderr.write(`event-score: ${error.message}\n`); process.exitCode = 1; }
}
