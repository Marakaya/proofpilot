#!/usr/bin/env node
/** Offline bookkeeping and deterministic checks. Reviews and source truth remain human/model judgments. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const QUALITY_CRITERIA = Object.freeze([
  "fact_fidelity", "arithmetic", "evidence_support", "constraints",
  "verdict", "next_step", "task_scope", "action_bounds"
]);
const MAX_DRAFTS = 3;
const TOLERANCE = 1e-8;
const PENDING_MODEL = "REPLACE_WITH_ACTUAL_REVIEWER_MODEL";
const PENDING_NOTE = "Pending review; replace with a specific evidence-based note.";
const PENDING_RESOLUTION = "Pending resolution; explain the fix or dispute.";
const LEGACY_POLICY = { version: 1, max_drafts: MAX_DRAFTS, arithmetic_tolerance: TOLERANCE, criteria: QUALITY_CRITERIA };
const POLICY = { ...LEGACY_POLICY, version: 2 };
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TERMINAL = new Set(["accepted", "needs_review", "exhausted"]);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function object(value, label) { requireThat(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); }
function fields(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) requireThat(allowed.includes(key), `${label}: unknown field ${key}`);
}
function string(value, label) { requireThat(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`); }
function choice(value, choices, label) { requireThat(choices.includes(value), `${label} must be one of ${choices.join(", ")}`); }
function array(value, label) { requireThat(Array.isArray(value), `${label} must be an array`); }
function id(value, label) { requireThat(typeof value === "string" && ID.test(value), `${label} must be a safe identifier (letter first, up to 64 letters/digits/_/-)`); }
function date(value, label) {
  string(value, label);
  requireThat(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) && Number.isFinite(Date.parse(value)), `${label} must be a valid ISO date`);
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  requireThat(month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate(), `${label} must be a valid ISO date`);
}
function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch (error) { throw new Error(`Cannot read JSON ${filename}: ${error.message}`); }
}
function plainFile(filename) {
  const stat = fs.lstatSync(filename);
  requireThat(stat.isFile() && !stat.isSymbolicLink(), `Run artifact must be a regular, non-symlink file: ${filename}`);
}
function readOwn(run, filename) {
  requireThat(typeof filename === "string" && /^[A-Za-z0-9_.-]+$/.test(filename), "Corrupt artifact filename");
  const full = path.join(run, filename);
  plainFile(full);
  return fs.readFileSync(full, "utf8");
}
function createFile(filename, content) { fs.writeFileSync(filename, content, { flag: "wx", mode: 0o600 }); }
function replaceFile(run, filename, content) {
  const temporary = path.join(run, `.write-${crypto.randomUUID()}`);
  createFile(temporary, content);
  fs.renameSync(temporary, path.join(run, filename));
}
function saveState(run, state) {
  const content = json(state);
  replaceFile(run, "state.json", content);
  replaceFile(run, "state.sha256", `${hash(content)}\n`);
}
function known(fact) { return fact.status !== "unknown"; }

function validatePacket(packet, base, frozen = false, legacy = false) {
  fields(packet, ["task", "mode", "sources", "facts", "gates", "calculations", "max_words", "requires_independent_review"], "packet");
  string(packet.task, "packet.task");
  if (!legacy || packet.mode !== undefined) choice(packet.mode, ["coach", "evaluator"], "packet.mode");
  for (const key of ["sources", "facts", "gates", "calculations"]) array(packet[key], `packet.${key}`);
  if (packet.max_words !== undefined) requireThat(Number.isSafeInteger(packet.max_words) && packet.max_words > 0, "max_words must be a positive integer");
  if (packet.requires_independent_review !== undefined) requireThat(typeof packet.requires_independent_review === "boolean", "requires_independent_review must be a boolean");
  const ids = new Set();
  function unique(value, label) { id(value, label); requireThat(!ids.has(value), `Duplicate packet ID: ${value}`); ids.add(value); }
  const sources = packet.sources.map((source) => {
    fields(source, ["id", "path", "kind", "locator", "retrieved_at", ...(frozen ? ["content", "sha256"] : [])], "source");
    unique(source.id, "source.id");
    string(source.path, "source.path");
    string(source.locator, "source.locator");
    choice(source.kind, ["user", "external"], "source.kind");
    if (source.kind === "external") {
      let url;
      try { url = new URL(source.locator); } catch { throw new Error(`External source ${source.id} needs an HTTPS locator`); }
      requireThat(url.protocol === "https:" && !url.username && !url.password, `External source ${source.id} needs an HTTPS locator without credentials`);
      date(source.retrieved_at, "source.retrieved_at");
    } else if (source.retrieved_at !== undefined) date(source.retrieved_at, "source.retrieved_at");
    if (frozen) {
      requireThat(typeof source.content === "string" && hash(source.content) === source.sha256, `Frozen source hash mismatch: ${source.id}`);
      return source;
    }
    const sourcePath = path.resolve(base, source.path);
    requireThat(fs.statSync(sourcePath).isFile(), `Source must be a text file: ${sourcePath}`);
    const bytes = fs.readFileSync(sourcePath);
    // Reject lossy decoding so the snapshot preserves the complete input bytes as UTF-8 text.
    const content = bytes.toString("utf8");
    requireThat(Buffer.from(content, "utf8").equals(bytes), `Source must contain valid UTF-8 text: ${sourcePath}`);
    return { ...source, path: sourcePath, content, sha256: hash(content) };
  });
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  for (const fact of packet.facts) {
    fields(fact, ["id", "statement", "status", "source_id", "quote"], "fact");
    unique(fact.id, "fact.id");
    string(fact.statement, "fact.statement");
    choice(fact.status, ["observed", "reported", "unknown"], "fact.status");
    if (!known(fact)) {
      requireThat(fact.source_id === undefined && fact.quote === undefined, `Unknown fact ${fact.id} cannot contain fabricated source support; omit source_id and quote`);
    } else {
      string(fact.quote, `fact ${fact.id}.quote`);
      const source = sourceMap.get(fact.source_id);
      requireThat(source && source.content.includes(fact.quote), `Fact ${fact.id} quote must occur exactly in its cited frozen source`);
    }
  }
  const factMap = new Map(packet.facts.map((fact) => [fact.id, fact]));
  for (const gate of packet.gates) {
    fields(gate, ["id", "target", "requirement", "status", "fact_ids"], "gate");
    unique(gate.id, "gate.id");
    choice(gate.target, ["test", "build", "apply"], "gate.target");
    string(gate.requirement, "gate.requirement");
    choice(gate.status, ["passed", "failed", "unknown"], "gate.status");
    references(gate.fact_ids, factMap, `gate ${gate.id}.fact_ids`);
    if (gate.status !== "unknown") requireThat(gate.fact_ids.length > 0 && gate.fact_ids.every((key) => known(factMap.get(key))), `Gate ${gate.id} with status ${gate.status} requires known evidence`);
  }
  const values = new Map();
  const computed = [];
  for (const calc of packet.calculations) {
    fields(calc, ["id", "op", "args", "expected"], "calculation");
    unique(calc.id, "calculation.id");
    choice(calc.op, ["add", "subtract", "multiply", "divide"], "calculation.op");
    array(calc.args, `calculation ${calc.id}.args`);
    requireThat(calc.args.length >= 2, `Calculation ${calc.id} needs at least two arguments; operations fold left`);
    const args = calc.args.map((arg) => {
      if (typeof arg === "string") {
        requireThat(values.has(arg), `Calculation ${calc.id} may reference only a prior calculation ID: ${arg}`);
        return values.get(arg);
      }
      requireThat(typeof arg === "number" && Number.isFinite(arg), `Calculation ${calc.id} arguments must be finite numbers or prior calculation IDs`);
      return arg;
    });
    let value = args[0];
    for (const arg of args.slice(1)) {
      if (calc.op === "divide") requireThat(arg !== 0, `Calculation ${calc.id}: division by zero`);
      if (calc.op === "add") value += arg;
      if (calc.op === "subtract") value -= arg;
      if (calc.op === "multiply") value *= arg;
      if (calc.op === "divide") value /= arg;
      requireThat(Number.isFinite(value), `Calculation ${calc.id} produced a non-finite result`);
    }
    if (calc.expected !== undefined) {
      requireThat(typeof calc.expected === "number" && Number.isFinite(calc.expected), `Calculation ${calc.id}.expected must be finite`);
      requireThat(Math.abs(value - calc.expected) <= TOLERANCE * Math.max(1, Math.abs(value), Math.abs(calc.expected)), `Calculation ${calc.id} expected ${calc.expected}, computed ${value} (tolerance ${TOLERANCE})`);
    }
    values.set(calc.id, value);
    computed.push({ id: calc.id, op: calc.op, args, value });
  }
  return { packet: { ...packet, sources }, computed };
}
function references(value, map, label) {
  array(value, label);
  const seen = new Set();
  for (const key of value) {
    id(key, label);
    requireThat(map.has(key), `${label}: unknown fact ID ${key}`);
    requireThat(!seen.has(key), `${label}: duplicate fact ID ${key}`);
    seen.add(key);
  }
}
function requiresIndependentReview(packet, assessment) {
  return packet.mode === "evaluator" || packet.requires_independent_review === true || packet.gates.some((gate) => gate.target === "apply") || assessment?.decision.target === "apply";
}

function assess(packet, draft, assessment) {
  fields(assessment, ["claims", "decision"], "assessment");
  array(assessment.claims, "assessment.claims");
  fields(assessment.decision, ["target", "decision"], "assessment.decision");
  const decision = assessment.decision;
  choice(decision.target, ["test", "build", "apply", "artifact"], "decision.target");
  choice(decision.decision, ["proceed", "revise", "pause", "stop", "complete"], "decision.decision");
  const diagnostics = [];
  const fail = (code, message) => diagnostics.push({ code, message });
  const words = draft.trim() ? draft.trim().split(/\s+/u).length : 0;
  if (words === 0) fail("empty_draft", "Draft must contain text.");
  if (packet.max_words && words > packet.max_words) fail("word_limit", `Draft has ${words} words; maximum is ${packet.max_words}.`);
  if (assessment.claims.length === 0) fail("missing_claims", "A quality run requires claims covering the substantive draft; narrow copyediting can skip the run.");
  const facts = new Map(packet.facts.map((fact) => [fact.id, fact]));
  for (const claim of assessment.claims) {
    fields(claim, ["quote", "kind", "fact_ids"], "claim");
    string(claim.quote, "claim.quote");
    choice(claim.kind, ["fact", "inference", "unknown"], "claim.kind");
    references(claim.fact_ids, facts, "claim.fact_ids");
    if (!draft.includes(claim.quote)) fail("claim_quote", `Claim quote does not occur exactly in this draft: ${claim.quote}`);
    if (claim.kind === "fact" && claim.fact_ids.length === 0) fail("unsupported_fact", `Fact claim has no support: ${claim.quote}`);
    if (claim.kind === "inference" && claim.fact_ids.length === 0) fail("unsupported_inference", `Inference needs at least one referenced known or unknown fact as its basis: ${claim.quote}`);
    if (claim.kind === "unknown" && !claim.fact_ids.some((key) => !known(facts.get(key)))) fail("unsupported_unknown", `Unknown claim needs at least one corresponding unknown fact in the frozen packet: ${claim.quote}`);
    if (claim.kind === "fact" && claim.fact_ids.some((key) => !known(facts.get(key)))) fail("unknown_as_fact", `Fact claim depends on an unknown fact: ${claim.quote}`);
  }
  if (decision.decision === "complete" && decision.target !== "artifact") fail("decision_bounds", "complete is permitted only for artifact delivery.");
  if (decision.decision === "proceed") {
    if (decision.target === "artifact") fail("decision_bounds", "Artifact delivery uses complete, not proceed.");
    else {
      const gates = packet.gates.filter((gate) => gate.target === decision.target);
      if (gates.length === 0) fail("missing_gates", `proceed for ${decision.target} requires at least one relevant frozen gate; recheck the original packet and return a limited pause/revise/stop decision. A new run requires actual new evidence or a changed task.`);
      for (const gate of gates) if (gate.status !== "passed") fail("blocked_gate", `${decision.target} is blocked by ${gate.id}: ${gate.status}.`);
      if (decision.target === "apply") for (const key of ["program_eligibility", "required_materials"]) {
        if (!gates.some((gate) => gate.id === key && gate.status === "passed")) fail("application_gate", `apply/proceed requires passed ${key} backed by known evidence.`);
      }
    }
  }
  return { word_count: words, diagnostics, requires_independent_review: requiresIndependentReview(packet, assessment) };
}

function validateReview(review, entry, draft, state, packet) {
  fields(review, ["draft_sha256", "assessment_sha256", "reviewer", "checks", "issues", "resolutions"], "review");
  requireThat(review.draft_sha256 === entry.draft_sha256, "Review draft_sha256 must match the current draft exactly");
  requireThat(review.assessment_sha256 === entry.assessment_sha256, "Review assessment_sha256 must match the current assessment exactly");
  fields(review.reviewer, ["mode", "model"], "review.reviewer");
  choice(review.reviewer.mode, ["separate_context", "self_review"], "reviewer.mode");
  string(review.reviewer.model, "reviewer.model");
  requireThat(review.reviewer.model.trim() !== PENDING_MODEL, "Replace the reviewer model placeholder with the actual model label, or unknown");
  array(review.checks, "review.checks");
  requireThat(review.checks.length === QUALITY_CRITERIA.length, "Review must include exactly eight criterion records");
  const checks = new Map();
  for (const check of review.checks) {
    fields(check, ["id", "status", "note"], "check");
    choice(check.id, QUALITY_CRITERIA, "check.id");
    requireThat(!checks.has(check.id), `Duplicate criterion: ${check.id}`);
    choice(check.status, ["pass", "fail", "not_applicable", "unassessed"], "check.status");
    string(check.note, `check ${check.id}.note`);
    requireThat(check.note.trim() !== PENDING_NOTE, `Replace the unfinished template note for ${check.id}`);
    if (check.status === "not_applicable") {
      requireThat(!["fact_fidelity", "evidence_support", "verdict", "task_scope", "action_bounds"].includes(check.id), `Core criterion ${check.id} cannot be not_applicable in a substantive quality run`);
      if (check.id === "arithmetic") requireThat(packet.calculations.length === 0 && packet.max_words === undefined, "arithmetic cannot be not_applicable when calculations or a word limit are present");
      if (check.id === "constraints") requireThat(packet.gates.length === 0, "constraints cannot be not_applicable when gates are present");
    }
    checks.set(check.id, check);
  }
  array(review.issues, "review.issues");
  const issues = new Map();
  for (const issue of review.issues) {
    fields(issue, ["id", "criterion", "severity", "quote", "basis", "repair"], "issue");
    id(issue.id, "issue.id");
    requireThat(!issues.has(issue.id), `Duplicate issue ID: ${issue.id}`);
    choice(issue.criterion, QUALITY_CRITERIA, "issue.criterion");
    choice(issue.severity, ["critical", "material", "minor"], "issue.severity");
    for (const key of ["quote", "basis", "repair"]) string(issue[key], `issue.${key}`);
    requireThat(draft.includes(issue.quote), `Issue ${issue.id} quote must occur exactly in the current draft`);
    issues.set(issue.id, issue);
  }
  for (const check of checks.values()) if (check.status === "fail") requireThat(review.issues.some((issue) => issue.criterion === check.id), `Failed criterion ${check.id} requires an issue with an exact draft quote`);
  const resolutions = review.resolutions ?? [];
  array(resolutions, "review.resolutions");
  const old = new Map(state.active_issues.map((issue) => [issue.id, issue]));
  const resolved = new Map();
  for (const resolution of resolutions) {
    fields(resolution, ["id", "status", "basis"], "resolution");
    requireThat(old.has(resolution.id), `Resolution must reference a prior open issue: ${resolution.id}`);
    requireThat(!resolved.has(resolution.id), `Duplicate resolution: ${resolution.id}`);
    choice(resolution.status, ["fixed", "disputed"], "resolution.status");
    string(resolution.basis, "resolution.basis");
    requireThat(resolution.basis.trim() !== PENDING_RESOLUTION, `Replace the unfinished resolution basis for ${resolution.id}`);
    resolved.set(resolution.id, resolution);
  }
  for (const key of old.keys()) requireThat(resolved.has(key), `Prior issue ${key} requires an explicit fixed/disputed resolution; it cannot disappear`);
  const repeated = review.issues.filter((issue) => state.seen_major_issue_ids.includes(issue.id));
  const disputes = resolutions.filter((resolution) => resolution.status === "disputed" && old.get(resolution.id).severity !== "minor");
  const unassessed = review.checks.some((check) => check.status === "unassessed");
  const independentReviewRequired = entry.requires_independent_review && review.reviewer.mode === "self_review";
  const failures = review.checks.some((check) => check.status === "fail") || review.issues.some((issue) => issue.severity !== "minor");
  let disposition;
  if (independentReviewRequired || repeated.length || disputes.length || unassessed) disposition = "needs_review";
  else if (entry.diagnostics.length || failures) disposition = entry.number >= MAX_DRAFTS ? "exhausted" : "repair";
  else disposition = "accepted";
  // Disputed issues remain visible even when they have no matching quote in the revised draft.
  const active = [...review.issues];
  for (const resolution of resolutions) if (resolution.status === "disputed" && !issues.has(resolution.id)) active.push({ ...old.get(resolution.id), carried_from_prior_draft: true, dispute_basis: resolution.basis });
  return {
    disposition,
    active_issues: active,
    seen_major_issue_ids: [...new Set([...state.seen_major_issue_ids, ...review.issues.filter((issue) => issue.severity !== "minor").map((issue) => issue.id)])],
    review_diagnostics: [
      ...(independentReviewRequired ? [{ code: "independent_review_required", message: "This task requires a separate-context review. Self-review cannot complete this run; stop and disclose the review gap until an authorized separate reviewer is available. Reviewer mode remains self-reported, not independently verified." }] : []),
      ...(unassessed ? [{ code: "unassessed_review", message: "Review coverage is incomplete; stop this run for additional review." }] : []),
      ...repeated.map((issue) => ({ code: "repeated_major_issue", message: `Prior major issue ID ${issue.id} was reused; stop for additional review. Resolve the major issue explicitly; track a genuinely distinct residual minor issue separately with its own basis.` })),
      ...disputes.map((issue) => ({ code: "disputed_major_issue", message: `Major issue ${issue.id} remains disputed; stop this run for additional review.` }))
    ]
  };
}

function loadRun(run) {
  const stat = fs.lstatSync(run);
  requireThat(stat.isDirectory() && !stat.isSymbolicLink(), "Run directory must be a real directory, not a symlink");
  const stateContent = readOwn(run, "state.json");
  requireThat(hash(stateContent) === readOwn(run, "state.sha256").trim(), "Corrupt state: checksum mismatch");
  const state = JSON.parse(stateContent);
  requireThat(state.version === 1 && Array.isArray(state.drafts), "Unsupported or corrupt run state");
  const snapshotContent = readOwn(run, "packet.json");
  requireThat(hash(snapshotContent) === state.packet_sha256, "Frozen packet hash mismatch; refusing altered run");
  const snapshot = JSON.parse(snapshotContent);
  const legacy = same(snapshot.policy, LEGACY_POLICY);
  requireThat(legacy || same(snapshot.policy, POLICY), "Frozen policy differs from the built-in policy");
  const validated = validatePacket(snapshot.packet, run, true, legacy);
  requireThat(same(validated.computed, snapshot.computed), "Frozen calculation results differ from recomputation");
  requireThat(state.drafts.length <= MAX_DRAFTS, "Corrupt state: too many drafts");
  // Replay bounded history to verify derived dispositions and issue carryover as well as hashes.
  let replay = { active_issues: [], seen_major_issue_ids: [], disposition: "draft_required" };
  const hashes = new Set();
  for (let index = 0; index < state.drafts.length; index++) {
    const entry = state.drafts[index];
    requireThat(!TERMINAL.has(replay.disposition) && (index === 0 || replay.disposition === "repair"), "Corrupt state: draft after terminal or unreviewed result");
    requireThat(entry.number === index + 1, "Corrupt draft sequence");
    const stem = `draft-${entry.number}`;
    requireThat(entry.draft_file === `${stem}.md` && entry.assessment_file === `${stem}.assessment.json` && entry.review_template_file === `${stem}.review-template.json`, "Corrupt draft artifact paths");
    const draft = readOwn(run, entry.draft_file);
    const assessmentText = readOwn(run, entry.assessment_file);
    requireThat(hash(draft) === entry.draft_sha256 && hash(assessmentText) === entry.assessment_sha256, `Draft ${entry.number} or assessment hash mismatch`);
    const versionHash = `${entry.draft_sha256}:${entry.assessment_sha256}`;
    requireThat(!hashes.has(versionHash), "Corrupt run: identical draft/assessment pair repeated");
    hashes.add(versionHash);
    const result = assess(snapshot.packet, draft, JSON.parse(assessmentText));
    // Early policy-v1 runs predate this stored field. Replay their recorded rules,
    // then expose only a read-only historical result; never relax policy-v2 checks.
    const earlyLegacyEntry = legacy && !Object.hasOwn(entry, "requires_independent_review");
    requireThat(same(result.diagnostics, entry.diagnostics) && result.word_count === entry.word_count && (earlyLegacyEntry || result.requires_independent_review === entry.requires_independent_review), "Corrupt stored draft diagnostics or independent review requirement");
    replay.disposition = entry.diagnostics.length ? (entry.number === MAX_DRAFTS ? "exhausted" : "repair") : "awaiting_review";
    if (entry.review_file) {
      requireThat(entry.review_file === `${stem}.review.json`, "Corrupt review artifact path");
      const reviewText = readOwn(run, entry.review_file);
      requireThat(hash(reviewText) === entry.review_sha256, `Review ${entry.number} hash mismatch`);
      const reviewed = validateReview(JSON.parse(reviewText), entry, draft, replay, snapshot.packet);
      requireThat(same(reviewed.review_diagnostics, entry.review_diagnostics), "Corrupt stored review diagnostics");
      replay = { ...replay, ...reviewed };
    }
  }
  for (const key of ["disposition", "active_issues", "seen_major_issue_ids"]) requireThat(same(state[key], replay[key]), `Corrupt state: ${key} differs from verified history`);
  return { state, snapshot };
}
function output(run, state, snapshot) {
  const entry = state.drafts.at(-1);
  const legacy = same(snapshot.policy, LEGACY_POLICY);
  const independentReviewRequired = legacy || (entry?.requires_independent_review ?? requiresIndependentReview(snapshot.packet));
  let reviewedBy = null;
  if (entry?.review_file) reviewedBy = { ...JSON.parse(readOwn(run, entry.review_file)).reviewer, verification: "self_reported" };
  const actions = {
    draft_required: "Write a draft and exact-quote assessment, then submit.",
    awaiting_review: independentReviewRequired ? "Obtain an authorized separate-context review of this exact draft and assessment against the eight criteria. Self-review cannot complete this run." : "Review this exact draft against the eight criteria; fill and submit the review template.",
    repair: `Repair the reported issues, then submit a changed draft or assessment (${MAX_DRAFTS - state.drafts.length} submission(s) remain). A new run requires actual new evidence or a changed task.`,
    accepted: "This local run is complete. Report the artifact or bounded decision with review gaps; external actions require their own authorization.",
    needs_review: "Stop this run. Obtain additional review or evidence outside it; do not continue automatic repairs.",
    exhausted: "Stop this run: three draft/assessment versions used. Report unresolved issues and request additional evidence or review."
  };
  return {
    run_dir: run, mode: snapshot.packet.mode ?? null, legacy_read_only: legacy,
    recorded_disposition: legacy ? state.disposition : undefined,
    requires_independent_review: independentReviewRequired, disposition: legacy ? "needs_review" : state.disposition, packet_sha256: state.packet_sha256,
    packet_file: path.join(run, "packet.json"),
    draft_file: entry ? path.join(run, entry.draft_file) : null,
    assessment_file: entry ? path.join(run, entry.assessment_file) : null,
    draft_count: state.drafts.length, max_drafts: MAX_DRAFTS,
    draft_sha256: entry?.draft_sha256 ?? null,
    assessment_sha256: entry?.assessment_sha256 ?? null,
    computed_values: Object.fromEntries(snapshot.computed.map((calc) => [calc.id, calc.value])),
    word_count: entry?.word_count ?? null,
    diagnostics: [...(entry?.diagnostics ?? []), ...(entry?.review_diagnostics ?? []), ...(legacy ? [{ code: "legacy_policy", message: "Archived policy-v1 history is readable but lacks the current mandatory task-mode guard. Its recorded disposition is historical, not current certification; this helper will not append or self-certify this legacy run." }] : [])],
    review_template_file: entry ? path.join(run, entry.review_template_file) : null,
    reviewed_by: reviewedBy, active_issues: state.active_issues,
    next_action: legacy ? "Preserve this read-only archive and its recorded disposition. Review the original task and evidence explicitly; do not reset the run to evade prior issues or repair limits." : actions[state.disposition],
    limits: "Source quotes do not prove entailment, truth, freshness, or full draft coverage. Reviewer mode/model are self-reported; hashes detect local alteration, not a maliciously rewritten history. No model switching or external action is performed."
  };
}
function initialize(run, packetFile) {
  const packetPath = path.resolve(packetFile);
  const validated = validatePacket(readJson(packetPath), path.dirname(packetPath));
  if (fs.existsSync(run)) {
    const stat = fs.lstatSync(run);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink() && fs.readdirSync(run).length === 0, "Run directory already exists and is not empty (or is a symlink); never overwrite an existing run");
    fs.chmodSync(run, 0o700);
  } else fs.mkdirSync(run, { mode: 0o700 });
  const snapshot = { policy: POLICY, ...validated };
  const content = json(snapshot);
  createFile(path.join(run, "packet.json"), content);
  const state = { version: 1, packet_sha256: hash(content), disposition: "draft_required", drafts: [], active_issues: [], seen_major_issue_ids: [] };
  saveState(run, state);
  return output(run, state, snapshot);
}
function submit(run, draftFile, assessmentFile) {
  const { state, snapshot } = loadRun(run);
  requireThat(!same(snapshot.policy, LEGACY_POLICY), "Legacy policy run is read-only; preserve its historical record and review limits");
  requireThat(!TERMINAL.has(state.disposition), `Run is terminal (${state.disposition}); no further drafts allowed`);
  requireThat(state.drafts.length < MAX_DRAFTS, "Three-draft limit reached");
  requireThat(["draft_required", "repair"].includes(state.disposition), "Review the current draft before submitting a repair");
  const draft = fs.readFileSync(path.resolve(draftFile), "utf8");
  const draftHash = hash(draft);
  const assessment = readJson(path.resolve(assessmentFile));
  const assessmentText = json(assessment);
  const assessmentHash = hash(assessmentText);
  requireThat(!state.drafts.some((entry) => entry.draft_sha256 === draftHash && entry.assessment_sha256 === assessmentHash), "Identical draft/assessment pair is not a repair; change the defective draft or assessment");
  const result = assess(snapshot.packet, draft, assessment);
  const number = state.drafts.length + 1;
  const stem = `draft-${number}`;
  const entry = {
    number, draft_file: `${stem}.md`, assessment_file: `${stem}.assessment.json`,
    draft_sha256: draftHash, assessment_sha256: assessmentHash,
    review_template_file: `${stem}.review-template.json`, ...result
  };
  const reviewTemplate = {
    draft_sha256: draftHash,
    assessment_sha256: assessmentHash,
    reviewer: { mode: "self_review", model: PENDING_MODEL },
    checks: QUALITY_CRITERIA.map((criterion) => ({ id: criterion, status: "unassessed", note: PENDING_NOTE })),
    issues: [], resolutions: state.active_issues.map((issue) => ({ id: issue.id, status: "disputed", basis: PENDING_RESOLUTION }))
  };
  createFile(path.join(run, entry.draft_file), draft);
  createFile(path.join(run, entry.assessment_file), assessmentText);
  createFile(path.join(run, entry.review_template_file), json(reviewTemplate));
  state.drafts.push(entry);
  state.disposition = result.diagnostics.length ? (number === MAX_DRAFTS ? "exhausted" : "repair") : "awaiting_review";
  saveState(run, state);
  return output(run, state, snapshot);
}
function reviewRun(run, reviewFile) {
  const { state, snapshot } = loadRun(run);
  requireThat(!same(snapshot.policy, LEGACY_POLICY), "Legacy policy run is read-only; preserve its historical record and review limits");
  requireThat(!TERMINAL.has(state.disposition), `Run is terminal (${state.disposition}); no further review allowed`);
  const entry = state.drafts.at(-1);
  requireThat(entry && !entry.review_file, "Submit a draft before review; each draft has one recorded review");
  const review = readJson(path.resolve(reviewFile));
  const draft = readOwn(run, entry.draft_file);
  const result = validateReview(review, entry, draft, state, snapshot.packet);
  const text = json(review);
  entry.review_file = `draft-${entry.number}.review.json`;
  entry.review_sha256 = hash(text);
  entry.review_diagnostics = result.review_diagnostics;
  createFile(path.join(run, entry.review_file), text);
  Object.assign(state, { disposition: result.disposition, active_issues: result.active_issues, seen_major_issue_ids: result.seen_major_issue_ids });
  saveState(run, state);
  return output(run, state, snapshot);
}

export function runQuality(argv) {
  requireThat(Array.isArray(argv), "runQuality expects an argv array");
  const [command, directory, ...args] = argv;
  if (!command || command === "--help" || command === "help") return {
    usage: ["quality.js init RUN_DIR PACKET_JSON", "quality.js submit RUN_DIR DRAFT_MD ASSESSMENT_JSON", "quality.js review RUN_DIR REVIEW_JSON", "quality.js status RUN_DIR"],
    packet: "{task,mode:coach|evaluator,sources:[{id,path,kind:user|external,locator,retrieved_at?}],facts:[{id,statement,status:observed|reported|unknown,source_id?,quote?}],gates:[{id,target:test|build|apply,requirement,status:passed|failed|unknown,fact_ids:[]}],calculations:[{id,op:add|subtract|multiply|divide,args:[number|prior_calc_id],expected?}],max_words?,requires_independent_review?:boolean}",
    assessment: "{claims:[{quote,kind:fact|inference|unknown,fact_ids:[]}],decision:{target:test|build|apply|artifact,decision:proceed|revise|pause|stop|complete}}",
    review: "{draft_sha256,assessment_sha256,reviewer:{mode:separate_context|self_review,model},checks:[{id,status:pass|fail|not_applicable|unassessed,note}],issues:[{id,criterion,severity:critical|material|minor,quote,basis,repair}],resolutions?:[{id,status:fixed|disputed,basis}]}",
    criteria: QUALITY_CRITERIA,
    hints: [
      "Paths in a packet resolve relative to that packet; source text and calculations are frozen. HTTPS external locators require retrieval dates. No network requests are made.",
      "Quotes must match source/draft text exactly. Known facts require support; unknown facts omit source_id/quote. Inference labels in actual prose and full coverage require reviewer judgment.",
      "All IDs within a packet are globally unique safe identifiers. Arithmetic folds left, permits only prior calculation references, and checks expected values at relative tolerance 1e-8 with a unit floor.",
      "Proceed requires relevant passed gates. apply/proceed requires program_eligibility and required_materials; complete is artifact-only. Empty collections are for inapplicable evidence, not bypassing prerequisites.",
      "New packets require explicit mode coach or evaluator. Evaluator mode, requires_independent_review=true, any frozen apply gate, or an apply decision require separate-context review. A false flag cannot override evaluator mode. Self-review then stops with needs_review, even for artifact/complete. Reviewer labels remain self-reported; no model switch occurs.",
      "Policy-v1 archives remain readable with recorded_disposition, but return a legacy needs_review limitation and cannot be appended. Never silently classify an old unspecified task as coach or reset its prior issues/repair budget.",
      "Submit returns deterministic diagnostics even for a failing draft. At most three draft/assessment versions; assessment-only repairs are allowed. Actual new evidence or a changed task requires a new run. Review hashes bind the exact current draft and assessment.",
      "Eight criterion notes are required. Major issues block acceptance; unassessed checks, repeated major issue IDs, and disputed major carryovers stop with needs_review. Every prior issue needs a resolution on later review.",
      "Accepted means this local checklist passed; it is not proof of factual truth, reviewer independence, provider switching, or permission for external actions. Reviewer labels are self-reported.",
      "Example: node quality.js init ./quality-run ./packet.json, then submit; fill the generated draft-1.review-template.json in a separate file and review it."
    ]
  };
  choice(command, ["init", "submit", "review", "status"], "command");
  string(directory, "RUN_DIR");
  requireThat(args.length === ({ init: 1, submit: 2, review: 1, status: 0 })[command], `Wrong number of arguments for ${command}; use --help`);
  const run = path.resolve(directory);
  if (command === "init") return initialize(run, args[0]);
  if (command === "submit") return submit(run, ...args);
  if (command === "review") return reviewRun(run, args[0]);
  const { state, snapshot } = loadRun(run);
  return output(run, state, snapshot);
}
export function main(argv = process.argv.slice(2)) {
  try { console.log(JSON.stringify(runQuality(argv))); return 0; }
  catch (error) { console.error(JSON.stringify({ error: error.message })); return 1; }
}
function isMain() {
  try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isMain()) process.exitCode = main();
