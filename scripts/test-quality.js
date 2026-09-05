import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { QUALITY_CRITERIA, runQuality } from "../skills/proofpilot/scripts/quality.js";

const runtime = fileURLToPath(new URL("../skills/proofpilot/scripts/quality.js", import.meta.url));
const BASE_DRAFT = "Capacity is ten customers; nine are active. Acquisition cost is unknown.";
const clone = (value) => structuredClone(value);
export function runQualityTests() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-quality-"));
  let sequence = 0;
  let cases = 0;
  const sourcePath = path.join(temporaryRoot, "facts.md");
  const originalSource = "Capacity: 10 customers. Active: 9.\nThis is a user report, not an independent audit.\n";
  fs.writeFileSync(sourcePath, originalSource);
  const packet = {
    task: "Assess whether one more weekly customer fits the reported capacity.",
    mode: "coach",
    sources: [{ id: "u1", path: "facts.md", kind: "user", locator: "User operating log" }],
    facts: [
      { id: "f1", statement: "Capacity is ten customers; nine are active.", status: "reported", source_id: "u1", quote: "Capacity: 10 customers. Active: 9." },
      { id: "f2", statement: "Acquisition cost is unknown.", status: "unknown" }
    ],
    gates: [{ id: "capacity", target: "build", requirement: "One additional customer fits the reported capacity.", status: "passed", fact_ids: ["f1"] }],
    calculations: [{ id: "remaining", op: "subtract", args: [10, 9], expected: 1 }, { id: "twice_remaining", op: "multiply", args: ["remaining", 2], expected: 2 }],
    max_words: 60
  };
  const assessment = {
    claims: [
      { quote: "Capacity is ten customers; nine are active.", kind: "fact", fact_ids: ["f1"] },
      { quote: "Acquisition cost is unknown.", kind: "unknown", fact_ids: ["f2"] }
    ],
    decision: { target: "build", decision: "proceed" }
  };
  function write(value, extension = "json") {
    const filename = path.join(temporaryRoot, `input-${++sequence}.${extension}`);
    fs.writeFileSync(filename, extension === "json" ? JSON.stringify(value) : value);
    return filename;
  }
  function init(change = () => {}) {
    const input = clone(packet);
    change(input);
    const file = write(input);
    const run = path.join(temporaryRoot, `run-${++sequence}`);
    return runQuality(["init", run, file]);
  }
  function submit(run, draft = BASE_DRAFT, change = () => {}) {
    const input = clone(assessment);
    change(input);
    return runQuality(["submit", run.run_dir, write(draft, "md"), write(input)]);
  }
  function reviewFor(current) {
    return {
      draft_sha256: current.draft_sha256,
      assessment_sha256: current.assessment_sha256,
      reviewer: { mode: "separate_context", model: "test-reviewer" },
      checks: QUALITY_CRITERIA.map((criterion) => ({ id: criterion, status: "pass", note: `Checked ${criterion} against the source, task, and actual draft.` })),
      issues: [], resolutions: []
    };
  }
  function review(current, change = () => {}) {
    const input = reviewFor(current);
    change(input);
    return runQuality(["review", current.run_dir, write(input)]);
  }
  function issue(id = "wrong_scope", severity = "material") {
    return { id, criterion: "fact_fidelity", severity, quote: "Capacity is ten customers; nine are active.", basis: "The review requests an explicit source attribution so the user report is not mistaken for an audit.", repair: "Add clear attribution to the user's operating log." };
  }
  function failedReview(current, id = "wrong_scope", severity = "material") {
    return review(current, (input) => {
      input.checks[0].status = "fail";
      input.issues = [issue(id, severity)];
    });
  }
  function test(label, fn) {
    try { fn(); cases++; }
    catch (error) { throw new Error(`Quality regression '${label}' failed: ${error.message}`, { cause: error }); }
  }
  function diagnostic(result, code) { assert(result.diagnostics.some((item) => item.code === code), `Missing diagnostic ${code}: ${JSON.stringify(result)}`); }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Quality helper must not make external calls"); };
  try {
    test("new packets require an explicit valid task mode", () => {
      assert.throws(() => init((input) => { delete input.mode; }), /packet.mode/);
      for (const value of ["judge", "", false, null]) assert.throws(() => init((input) => { input.mode = value; }), /packet.mode/);
    });
    test("evaluator mode requires independent review without an optional flag", () => {
      for (const flag of [undefined, false]) {
        const run = init((input) => { input.mode = "evaluator"; if (flag !== undefined) input.requires_independent_review = flag; });
        const current = submit(run, BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
        assert.equal(current.requires_independent_review, true);
        const result = review(current, (input) => { input.reviewer.mode = "self_review"; });
        assert.equal(result.disposition, "needs_review");
        diagnostic(result, "independent_review_required");
      }
    });
    test("legacy unspecified-mode history is preserved and cannot be newly certified", () => {
      const old = review(submit(init()), (input) => { input.reviewer.mode = "self_review"; });
      const snapshotPath = path.join(old.run_dir, "packet.json");
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      snapshot.policy.version = 1;
      delete snapshot.packet.mode;
      const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
      fs.writeFileSync(snapshotPath, bytes);
      const statePath = path.join(old.run_dir, "state.json");
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      state.packet_sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const stateBytes = `${JSON.stringify(state, null, 2)}\n`;
      fs.writeFileSync(statePath, stateBytes);
      fs.writeFileSync(path.join(old.run_dir, "state.sha256"), `${crypto.createHash("sha256").update(stateBytes).digest("hex")}\n`);
      const status = runQuality(["status", old.run_dir]);
      assert.equal(status.recorded_disposition, "accepted");
      assert.equal(status.disposition, "needs_review");
      assert.equal(status.legacy_read_only, true);
      assert.equal(status.mode, null);
      assert.throws(() => submit(old), /Legacy policy run is read-only/);
      assert.throws(() => review(old), /Legacy policy run is read-only/);
      assert.equal(fs.readFileSync(statePath, "utf8"), stateBytes);
    });
    test("early legacy history without the independent-review field remains read-only", () => {
      const old = review(submit(init(), BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; }), (input) => { input.reviewer.mode = "self_review"; });
      const snapshotPath = path.join(old.run_dir, "packet.json");
      const statePath = path.join(old.run_dir, "state.json");
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      delete state.drafts[0].requires_independent_review;
      const saveState = () => {
        const bytes = `${JSON.stringify(state, null, 2)}\n`;
        fs.writeFileSync(statePath, bytes);
        fs.writeFileSync(path.join(old.run_dir, "state.sha256"), `${crypto.createHash("sha256").update(bytes).digest("hex")}\n`);
        return bytes;
      };
      saveState();
      assert.throws(() => runQuality(["status", old.run_dir]), /Corrupt stored draft diagnostics/);
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      snapshot.policy.version = 1;
      delete snapshot.packet.mode;
      snapshot.packet.gates[0].target = "apply";
      const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
      fs.writeFileSync(snapshotPath, bytes);
      state.packet_sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const before = saveState();
      const status = runQuality(["status", old.run_dir]);
      assert.equal(status.recorded_disposition, "accepted");
      assert.equal(status.disposition, "needs_review");
      assert.equal(status.requires_independent_review, true);
      assert.equal(status.legacy_read_only, true);
      assert.throws(() => submit(old), /Legacy policy run is read-only/);
      assert.throws(() => review(old), /Legacy policy run is read-only/);
      assert.equal(fs.readFileSync(statePath, "utf8"), before);
    });
    test("source-grounded positive decision and actual calculations", () => {
      const run = init();
      assert.deepEqual(run.computed_values, { remaining: 1, twice_remaining: 2 });
      const current = submit(run);
      assert.equal(current.disposition, "awaiting_review");
      assert.equal(current.word_count, 11);
      const result = review(current);
      assert.equal(result.disposition, "accepted");
      assert.equal(runQuality(["status", run.run_dir]).disposition, "accepted");
      assert.equal(result.reviewed_by.verification, "self_reported");
      assert(result.packet_file && result.draft_file && result.assessment_file && result.review_template_file);
      assert.throws(() => submit(run, `${BASE_DRAFT} Additional text.`), /terminal/);
    });
    test("honest unknown is acceptable in a completed artifact", () => {
      const current = submit(init((input) => { input.gates[0].status = "unknown"; input.gates[0].fact_ids = []; }), BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
      assert.equal(review(current).disposition, "accepted");
    });
    test("self-review stays explicitly self-reported", () => {
      const result = review(submit(init()), (input) => { input.reviewer.mode = "self_review"; });
      assert.equal(result.disposition, "accepted");
      assert.deepEqual(result.reviewed_by, { mode: "self_review", model: "test-reviewer", verification: "self_reported" });
    });
    test("minor residual issues need no pointless repair", () => {
      const result = review(submit(init()), (input) => { input.issues = [issue("attribution_style", "minor")]; });
      assert.equal(result.disposition, "accepted");
      assert.equal(result.active_issues[0].severity, "minor");
    });
    test("unknown-to-fact laundering is a retained repair diagnostic", () => {
      const current = submit(init(), BASE_DRAFT, (input) => { input.claims[1].kind = "fact"; });
      assert.equal(current.disposition, "repair");
      diagnostic(current, "unknown_as_fact");
      assert(fs.existsSync(current.draft_file));
      assert.deepEqual(current.computed_values, { remaining: 1, twice_remaining: 2 });
      assert.equal(review(current).disposition, "repair");
    });
    test("known claims and deductions require actual fact links", () => {
      diagnostic(submit(init(), BASE_DRAFT, (input) => { input.claims[0].fact_ids = []; }), "unsupported_fact");
      diagnostic(submit(init(), BASE_DRAFT, (input) => { input.claims[0].kind = "inference"; input.claims[0].fact_ids = []; }), "unsupported_inference");
    });
    test("provisional inferences can accurately depend on known unknowns", () => {
      const inference = "Given the unknown acquisition cost, I recommend pausing scaling until it is measured.";
      const current = submit(init(), `${BASE_DRAFT} ${inference}`, (input) => {
        input.claims.push({ quote: inference, kind: "inference", fact_ids: ["f2"] });
        input.decision = { target: "build", decision: "pause" };
      });
      assert.equal(current.disposition, "awaiting_review");
      assert.equal(review(current).disposition, "accepted");
    });
    test("unknown claims require corresponding unknown facts", () => {
      diagnostic(submit(init(), BASE_DRAFT, (input) => { input.claims[1].fact_ids = []; }), "unsupported_unknown");
      diagnostic(submit(init(), BASE_DRAFT, (input) => { input.claims[1].fact_ids = ["f1"]; }), "unsupported_unknown");
    });
    test("source quote fabrication and unknown support are refused", () => {
      assert.throws(() => init((input) => { input.facts[0].quote = "Paid conversion: 99%."; }), /quote must occur exactly/);
      assert.throws(() => init((input) => { input.facts[1].quote = "Capacity"; input.facts[1].source_id = "u1"; }), /Unknown fact/);
      assert.throws(() => init((input) => { delete input.facts[0].source_id; }), /quote must occur exactly/);
      assert.throws(() => init((input) => { input.facts[0].quote = ""; }), /nonempty/);
    });
    test("external sources require HTTPS and real retrieval date", () => {
      assert.throws(() => init((input) => { input.sources[0].kind = "external"; }), /HTTPS/);
      assert.throws(() => init((input) => { Object.assign(input.sources[0], { kind: "external", locator: "https://example.invalid/report", retrieved_at: "2026-02-30" }); }), /valid ISO date/);
      assert.throws(() => init((input) => { Object.assign(input.sources[0], { kind: "external", locator: "https://example.invalid/report" }); }), /retrieved_at/);
      assert.equal(init((input) => { Object.assign(input.sources[0], { kind: "external", locator: "https://example.invalid/report", retrieved_at: "2026-09-05T08:00:00Z" }); }).disposition, "draft_required");
    });
    test("IDs, references, and packet fields are fail-closed", () => {
      assert.throws(() => init((input) => { input.facts[0].id = "u1"; }), /Duplicate packet ID/);
      assert.throws(() => init((input) => { input.sources[0].id = "../source"; }), /safe identifier/);
      assert.throws(() => init((input) => { input.gates[0].fact_ids = ["missing"]; }), /unknown fact ID/);
      assert.throws(() => init((input) => { input.custom_policy = { max_drafts: 99 }; }), /unknown field/);
    });
    test("failed and unknown gates block relevant proceed", () => {
      for (const status of ["failed", "unknown"]) {
        const current = submit(init((input) => { input.gates[0].status = status; }));
        diagnostic(current, "blocked_gate");
        assert.equal(current.disposition, "repair");
      }
      diagnostic(submit(init((input) => { input.gates = []; })), "missing_gates");
    });
    test("passed or failed gates cannot rest on missing or unknown facts", () => {
      assert.throws(() => init((input) => { input.gates[0].fact_ids = []; }), /requires known evidence/);
      assert.throws(() => init((input) => { input.gates[0].status = "failed"; input.gates[0].fact_ids = ["f2"]; }), /requires known evidence/);
    });
    test("apply requires both named evidenced gates", () => {
      diagnostic(submit(init(), BASE_DRAFT, (input) => { input.decision.target = "apply"; }), "application_gate");
      const current = submit(init((input) => {
        input.gates = ["program_eligibility", "required_materials"].map((id) => ({ id, target: "apply", requirement: `Source establishes ${id}.`, status: "passed", fact_ids: ["f1"] }));
      }), BASE_DRAFT, (input) => { input.decision.target = "apply"; });
      assert.equal(current.disposition, "awaiting_review");
      assert.equal(review(current).disposition, "accepted");
    });
    test("apply self-review cannot accept even with passed gates and arithmetic", () => {
      const run = init((input) => {
        input.gates = ["program_eligibility", "required_materials"].map((id) => ({ id, target: "apply", requirement: `Source establishes ${id}.`, status: "passed", fact_ids: ["f1"] }));
      });
      assert.equal(run.requires_independent_review, true);
      const current = submit(run, BASE_DRAFT, (input) => { input.decision.target = "apply"; });
      assert.equal(current.requires_independent_review, true);
      const result = review(current, (input) => { input.reviewer.mode = "self_review"; });
      assert.equal(result.disposition, "needs_review");
      diagnostic(result, "independent_review_required");
      assert.equal(runQuality(["status", result.run_dir]).requires_independent_review, true);
      assert.throws(() => submit(result, `${BASE_DRAFT} Revision.`), /terminal/);
    });
    test("apply target requires separate-context review even without frozen apply gates", () => {
      const current = submit(init(), BASE_DRAFT, (input) => { input.decision = { target: "apply", decision: "pause" }; });
      assert.equal(current.requires_independent_review, true);
      assert.equal(review(current).disposition, "accepted");
      const self = submit(init(), BASE_DRAFT, (input) => { input.decision = { target: "apply", decision: "pause" }; });
      diagnostic(review(self, (input) => { input.reviewer.mode = "self_review"; }), "independent_review_required");
    });
    test("artifact completion cannot bypass frozen apply review requirements", () => {
      const current = submit(init((input) => { input.gates[0].target = "apply"; }), BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
      const result = review(current, (input) => { input.reviewer.mode = "self_review"; });
      assert.equal(result.disposition, "needs_review");
      diagnostic(result, "independent_review_required");
    });
    test("manual independent-review flag prevents build self-acceptance", () => {
      const run = init((input) => { input.requires_independent_review = true; });
      assert.equal(run.requires_independent_review, true);
      const result = review(submit(run), (input) => { input.reviewer.mode = "self_review"; });
      assert.equal(result.disposition, "needs_review");
      diagnostic(result, "independent_review_required");
    });
    test("ordinary build can still accept explicitly labeled self-review", () => {
      const current = submit(init((input) => { input.requires_independent_review = false; }));
      assert.equal(current.requires_independent_review, false);
      const result = review(current, (input) => { input.reviewer.mode = "self_review"; });
      assert.equal(result.disposition, "accepted");
      assert.equal(result.reviewed_by.mode, "self_review");
      assert.equal(result.reviewed_by.verification, "self_reported");
    });
    test("independent-review flag rejects nonboolean values", () => {
      for (const value of ["false", "true", 0, 1, null, {}, []]) assert.throws(() => init((input) => { input.requires_independent_review = value; }), /requires_independent_review must be a boolean/);
    });
    test("complete and proceed retain separate action bounds", () => {
      diagnostic(submit(init(), BASE_DRAFT, (input) => { input.decision.decision = "complete"; }), "decision_bounds");
      diagnostic(submit(init(), BASE_DRAFT, (input) => { input.decision.target = "artifact"; }), "decision_bounds");
    });
    test("arithmetic reproduces values and rejects wrong results or unsafe expressions", () => {
      assert.throws(() => init((input) => { input.calculations[0].expected = 100; }), /expected 100, computed 1/);
      assert.throws(() => init((input) => { input.calculations[0] = { id: "remaining", op: "divide", args: [1, 0] }; }), /division by zero/);
      assert.throws(() => init((input) => { input.calculations[0].args = ["twice_remaining", 1]; }), /prior calculation ID/);
      assert.throws(() => init((input) => { input.calculations[0].args = ["process.exit()", 1]; }), /prior calculation ID/);
      assert.throws(() => init((input) => { input.calculations[0].op = "eval"; }), /calculation.op/);
      assert.throws(() => init((input) => { input.calculations[0] = { id: "remaining", op: "multiply", args: [1e308, 1e308] }; }), /non-finite/);
      assert.equal(init((input) => { input.calculations = [{ id: "decimal", op: "add", args: [0.1, 0.2], expected: 0.3 }]; }).computed_values.decimal, 0.1 + 0.2);
    });
    test("claim quotes bind to current draft, not merely sources", () => {
      const current = submit(init(), BASE_DRAFT, (input) => { input.claims[0].quote = "Capacity: 10 customers. Active: 9."; });
      diagnostic(current, "claim_quote");
    });
    test("substantive assessments cannot omit all claims", () => {
      diagnostic(submit(init(), BASE_DRAFT, (input) => { input.claims = []; }), "missing_claims");
      diagnostic(submit(init(), ""), "empty_draft");
    });
    test("word limits report actual count and failing draft", () => {
      const current = submit(init((input) => { input.max_words = 3; }));
      assert.equal(current.word_count, 11);
      diagnostic(current, "word_limit");
      assert.equal(current.disposition, "repair");
      assert.throws(() => init((input) => { input.max_words = 0; }), /positive integer/);
    });
    test("review binds exact draft hash and exact issue quote", () => {
      const current = submit(init());
      assert.throws(() => review(current, (input) => { input.draft_sha256 = "0".repeat(64); }), /current draft/);
      assert.throws(() => review(current, (input) => { input.assessment_sha256 = "0".repeat(64); }), /current assessment/);
      assert.throws(() => review(current, (input) => { input.issues = [{ ...issue(), quote: "Not in this draft" }]; }), /quote must occur exactly/);
      assert.equal(runQuality(["status", current.run_dir]).disposition, "awaiting_review");
    });
    test("review requires eight unique criteria and meaningful note fields", () => {
      const current = submit(init());
      assert.throws(() => review(current, (input) => { input.checks.pop(); }), /exactly eight/);
      assert.throws(() => review(current, (input) => { input.checks[1].id = input.checks[0].id; }), /Duplicate criterion/);
      assert.throws(() => review(current, (input) => { input.checks[0].note = "  "; }), /nonempty/);
      assert.throws(() => review(current, (input) => { input.checks[0].status = "fail"; }), /requires an issue/);
    });
    test("not-applicable cannot erase substantive or mechanical criteria", () => {
      const current = submit(init());
      for (const criterion of ["fact_fidelity", "evidence_support", "verdict", "task_scope", "action_bounds", "arithmetic", "constraints"]) {
        assert.throws(() => review(current, (input) => { input.checks.find((check) => check.id === criterion).status = "not_applicable"; }), /cannot be not_applicable/);
      }
      const simple = submit(init((input) => { input.gates = []; input.calculations = []; delete input.max_words; }), BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
      assert.equal(review(simple, (input) => { for (const criterion of ["arithmetic", "constraints", "next_step"]) input.checks.find((check) => check.id === criterion).status = "not_applicable"; }).disposition, "accepted");
    });
    test("unfinished template model, notes, and resolutions cannot pass", () => {
      const current = submit(init());
      const unfinished = JSON.parse(fs.readFileSync(current.review_template_file, "utf8"));
      for (const check of unfinished.checks) check.status = "pass";
      assert.throws(() => runQuality(["review", current.run_dir, write(unfinished)]), /model placeholder/);
      unfinished.reviewer.model = "unknown";
      assert.throws(() => runQuality(["review", current.run_dir, write(unfinished)]), /unfinished template note/);
      const failed = failedReview(current);
      const revised = submit(failed, `According to the user: ${BASE_DRAFT}`);
      assert.throws(() => review(revised, (input) => { input.resolutions = [{ id: "wrong_scope", status: "fixed", basis: "Pending resolution; explain the fix or dispute." }]; }), /unfinished resolution basis/);
    });
    test("unassessed coverage stops automatic repairs", () => {
      const result = review(submit(init()), (input) => { input.checks[0].status = "unassessed"; });
      assert.equal(result.disposition, "needs_review");
      diagnostic(result, "unassessed_review");
      assert.throws(() => submit(result, `${BASE_DRAFT} Revision.`), /terminal/);
    });
    test("major issues block all-pass reviews", () => {
      const result = review(submit(init()), (input) => { input.issues = [issue()]; });
      assert.equal(result.disposition, "repair");
    });
    test("prior issues cannot disappear without resolutions", () => {
      const failed = failedReview(submit(init()));
      const revised = submit(failed, `According to the user log: ${BASE_DRAFT}`);
      assert.throws(() => review(revised), /requires an explicit fixed\/disputed resolution/);
      const accepted = review(revised, (input) => { input.resolutions = [{ id: "wrong_scope", status: "fixed", basis: "The added opening explicitly attributes capacity to the user log." }]; });
      assert.equal(accepted.disposition, "accepted");
      assert.equal(runQuality(["status", accepted.run_dir]).disposition, "accepted");
    });
    test("repeated major issue stops even when downgraded in labels", () => {
      const failed = failedReview(submit(init()));
      const revised = submit(failed, `${BASE_DRAFT} More context.`);
      const result = review(revised, (input) => {
        input.resolutions = [{ id: "wrong_scope", status: "fixed", basis: "Writer claims the additional context is enough." }];
        input.issues = [issue("wrong_scope", "minor")];
      });
      assert.equal(result.disposition, "needs_review");
      diagnostic(result, "repeated_major_issue");
      assert.equal(runQuality(["status", result.run_dir]).disposition, "needs_review");
    });
    test("disputed material issue is carried visibly and stops", () => {
      const failed = failedReview(submit(init()));
      const revised = submit(failed, `${BASE_DRAFT} More context.`);
      const result = review(revised, (input) => { input.resolutions = [{ id: "wrong_scope", status: "disputed", basis: "The source does not settle the disputed interpretation." }]; });
      assert.equal(result.disposition, "needs_review");
      assert.equal(result.active_issues[0].carried_from_prior_draft, true);
      diagnostic(result, "disputed_major_issue");
    });
    test("fixed major issue permits a separately justified residual minor", () => {
      const failed = failedReview(submit(init()));
      const revised = submit(failed, `According to the user log: ${BASE_DRAFT}`);
      const result = review(revised, (input) => {
        input.resolutions = [{ id: "wrong_scope", status: "fixed", basis: "Opening now attributes the reported capacity to the user log." }];
        input.issues = [{ ...issue("punctuation", "minor"), basis: "The extra colon can be simplified; this does not change attribution or the decision.", repair: "Optionally simplify punctuation." }];
      });
      assert.equal(result.disposition, "accepted");
      assert.equal(result.active_issues[0].id, "punctuation");
    });
    test("unreviewed drafts and identical repairs are refused", () => {
      const current = submit(init());
      assert.throws(() => submit(current, `${BASE_DRAFT} Revision.`), /Review the current draft/);
      const failed = failedReview(current);
      assert.throws(() => submit(failed), /Identical draft/);
    });
    test("assessment-only repair preserves correct prose and binds fresh review", () => {
      const first = submit(init(), BASE_DRAFT, (input) => { input.claims[0].fact_ids = []; });
      diagnostic(first, "unsupported_fact");
      const second = submit(first);
      assert.equal(second.draft_count, 2);
      assert.equal(second.draft_sha256, first.draft_sha256);
      assert.notEqual(second.assessment_sha256, first.assessment_sha256);
      assert.equal(second.disposition, "awaiting_review");
      assert.throws(() => runQuality(["review", second.run_dir, write(reviewFor(first))]), /current assessment/);
      assert.equal(review(second).disposition, "accepted");
      assert.equal(runQuality(["status", second.run_dir]).draft_count, 2);
    });
    test("three drafts maximum with no silent version reset", () => {
      const first = failedReview(submit(init()), "issue_one");
      const second = submit(first, `${BASE_DRAFT} Second draft.`);
      const failedSecond = review(second, (input) => {
        input.resolutions = [{ id: "issue_one", status: "fixed", basis: "First defect resolved in the revised source attribution." }];
        input.checks[0].status = "fail"; input.issues = [issue("issue_two")];
      });
      const third = submit(failedSecond, `${BASE_DRAFT} Third draft.`);
      const exhausted = review(third, (input) => {
        input.resolutions = [{ id: "issue_two", status: "fixed", basis: "Second defect resolved with the extra caveat." }];
        input.checks[0].status = "fail"; input.issues = [issue("issue_three")];
      });
      assert.equal(exhausted.disposition, "exhausted");
      assert.equal(exhausted.draft_count, 3);
      assert.throws(() => submit(exhausted, `${BASE_DRAFT} Fourth draft.`), /terminal/);
      assert.equal(runQuality(["status", exhausted.run_dir]).disposition, "exhausted");
    });
    test("three mechanically failing drafts also exhaust the run", () => {
      let current = submit(init((input) => { input.max_words = 1; }));
      current = submit(current, `${BASE_DRAFT} Second.`);
      current = submit(current, `${BASE_DRAFT} Third.`);
      assert.equal(current.disposition, "exhausted");
      assert.equal(runQuality(["status", current.run_dir]).disposition, "exhausted");
    });
    test("source snapshots stay stable after the original file changes", () => {
      const run = init();
      fs.writeFileSync(sourcePath, "Changed original, with no old facts.");
      try {
        const snapshot = JSON.parse(fs.readFileSync(run.packet_file, "utf8"));
        assert.equal(snapshot.packet.sources[0].content, originalSource);
        assert.equal(runQuality(["status", run.run_dir]).packet_sha256, run.packet_sha256);
      } finally { fs.writeFileSync(sourcePath, originalSource); }
    });
    test("private storage and no overwrite of existing runs", () => {
      const run = submit(init());
      assert.equal(fs.statSync(run.run_dir).mode & 0o777, 0o700);
      for (const entry of fs.readdirSync(run.run_dir)) assert.equal(fs.statSync(path.join(run.run_dir, entry)).mode & 0o777, 0o600);
      assert.throws(() => runQuality(["init", run.run_dir, write(packet)]), /never overwrite/);
      const empty = path.join(temporaryRoot, `empty-${++sequence}`); fs.mkdirSync(empty);
      assert.equal(runQuality(["init", empty, write(packet)]).disposition, "draft_required");
    });
    test("altered packet, draft, assessment, review and state are refused", () => {
      for (const target of ["packet.json", "draft-1.md", "draft-1.assessment.json", "draft-1.review.json", "state.json"]) {
        const run = review(submit(init()));
        fs.appendFileSync(path.join(run.run_dir, target), " ");
        assert.throws(() => runQuality(["status", run.run_dir]), /hash mismatch|checksum mismatch/);
        assert.throws(() => runQuality(["review", run.run_dir, write(reviewFor(run))]), /hash mismatch|checksum mismatch/);
      }
    });
    test("run artifact symlinks are refused", () => {
      const run = init();
      const packetCopy = path.join(temporaryRoot, `copy-${++sequence}.json`);
      fs.renameSync(run.packet_file, packetCopy);
      fs.symlinkSync(packetCopy, run.packet_file);
      assert.throws(() => runQuality(["status", run.run_dir]), /non-symlink/);
      const link = path.join(temporaryRoot, `linked-run-${++sequence}`);
      fs.symlinkSync(run.run_dir, link);
      assert.throws(() => runQuality(["status", link]), /not a symlink/);
    });
    test("direct and symlink-installed CLI entry points produce JSON", () => {
      const link = path.join(temporaryRoot, "installed-quality.js");
      fs.symlinkSync(runtime, link);
      for (const executable of [runtime, link]) {
        const result = spawnSync(process.execPath, [executable, "--help"], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).criteria.length, 8);
      }
      const run = init();
      const status = spawnSync(process.execPath, [link, "status", run.run_dir], { encoding: "utf8" });
      assert.equal(status.status, 0, status.stderr);
      assert.equal(JSON.parse(status.stdout).packet_sha256, run.packet_sha256);
      const invalid = spawnSync(process.execPath, [link, "submit"], { encoding: "utf8" });
      assert.equal(invalid.status, 1);
      assert(JSON.parse(invalid.stderr).error);
    });
    test("runtime has no provider, network, process execution or dependency imports", () => {
      const code = fs.readFileSync(runtime, "utf8");
      const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      assert.deepEqual(imports, ["node:fs", "node:path", "node:crypto", "node:url"]);
      assert(!/\b(?:fetch|eval|spawn|execSync|execFile)\s*\(/.test(code));
      assert(!code.includes("process.env"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  return { cases };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  console.log(`ProofPilot quality tests passed: ${runQualityTests().cases} cases.`);
}
