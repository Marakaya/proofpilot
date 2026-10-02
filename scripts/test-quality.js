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
  const originalSource = "Capacity: 10 customers. Active: 9.\nInspected synthetic operating log; no real independent audit is claimed.\n";
  fs.writeFileSync(sourcePath, originalSource);
  const packet = {
    task: "Assess whether one more weekly customer fits the reported capacity.",
    mode: "coach",
    decision_context: "general",
    sources: [{ id: "u1", path: "facts.md", kind: "user", locator: "User operating log" }],
    facts: [
      { id: "f1", statement: "Capacity is ten customers; nine are active.", status: "observed", source_id: "u1", quote: "Capacity: 10 customers. Active: 9." },
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
      packet_sha256: current.packet_sha256,
      policy_version: current.policy_version,
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
  const encodingMarker = "Literal \uFFFD café 日本 🚀";
  const invalidJsonInput = (value, malformed = Buffer.from([0xff])) => {
    const bytes = Buffer.from(JSON.stringify(value)), index = bytes.indexOf(Buffer.from("\uFFFD"));
    assert.notEqual(index, -1, "Encoding fixture must include a literal valid replacement character");
    return write(Buffer.concat([bytes.subarray(0, index), malformed, bytes.subarray(index + 3)]), "json-bytes");
  };
  const runArtifacts = run => fs.readdirSync(run).sort().map(name => {
    const file = path.join(run, name), stat = fs.lstatSync(file, { bigint: true });
    return { name, bytes: fs.readFileSync(file), dev: stat.dev, ino: stat.ino, mode: stat.mode, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Quality helper must not make external calls"); };
  try {
    test("new packets require an explicit valid task mode", () => {
      assert.throws(() => init((input) => { delete input.mode; }), /packet.mode/);
      for (const value of ["judge", "", false, null]) assert.throws(() => init((input) => { input.mode = value; }), /packet.mode/);
    });
    test("new packets require an explicit valid decision context before creating a run", () => {
      for (const value of [undefined, "apply", "", false, null, {}, []]) {
        const input = clone(packet);
        if (value === undefined) delete input.decision_context;
        else input.decision_context = value;
        const run = path.join(temporaryRoot, `missing-context-${++sequence}`);
        assert.throws(() => runQuality(["init", run, write(input)]), /packet.decision_context/);
        assert.equal(fs.existsSync(run), false, "An invalid packet must not leave an initialized or partial run");
      }
    });
    for (const flag of [undefined, false]) {
      test(`application report requires independent review without apply gates, flag ${flag}`, () => {
        const run = init((input) => {
          input.task = "Подготовить заключение по заявке.";
          input.decision_context = "application";
          input.gates = [];
          if (flag !== undefined) input.requires_independent_review = flag;
        });
        assert.equal(run.policy_version, 4);
        assert.equal(run.decision_context, "application");
        assert.equal(run.requires_independent_review, true);
        const current = submit(run, BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
        assert.deepEqual(current.diagnostics, []);
        const result = review(current, (input) => { input.reviewer.mode = "self_review"; });
        assert.equal(result.disposition, "needs_review");
        diagnostic(result, "independent_review_required");
        assert.equal(runQuality(["status", result.run_dir]).requires_independent_review, true);
      });
    }
    test("application report can complete after a recorded separate-context review", () => {
      const current = submit(init((input) => { input.decision_context = "application"; input.gates = []; }), BASE_DRAFT,
        (input) => { input.decision = { target: "artifact", decision: "complete" }; });
      assert.equal(review(current).disposition, "accepted");
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
      delete snapshot.packet.decision_context;
      const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
      fs.writeFileSync(snapshotPath, bytes);
      const statePath = path.join(old.run_dir, "state.json");
      const state = JSON.parse(fs.readFileSync(statePath, "utf8")).state;
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
      const state = JSON.parse(fs.readFileSync(statePath, "utf8")).state;
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
      delete snapshot.packet.decision_context;
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
    test("policy-v2 archives preserve completed history without recertification", () => {
      const old = review(submit(init()), input => { input.reviewer.mode = "self_review"; });
      const snapshotPath = path.join(old.run_dir, "packet.json");
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      snapshot.policy.version = 2;
      delete snapshot.packet.decision_context;
      const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
      fs.writeFileSync(snapshotPath, bytes);
      const statePath = path.join(old.run_dir, "state.json");
      const state = JSON.parse(fs.readFileSync(statePath, "utf8")).state;
      state.packet_sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const stateBytes = `${JSON.stringify(state, null, 2)}\n`;
      fs.writeFileSync(statePath, stateBytes);
      fs.writeFileSync(path.join(old.run_dir, "state.sha256"), `${crypto.createHash("sha256").update(stateBytes).digest("hex")}\n`);
      const status = runQuality(["status", old.run_dir]);
      assert.equal(status.policy_version, 2);
      assert.equal(status.recorded_disposition, "accepted");
      assert.equal(status.disposition, "needs_review");
      assert.equal(status.legacy_read_only, true);
      assert.throws(() => submit(old), /Legacy policy run is read-only/);
      assert.equal(fs.readFileSync(statePath, "utf8"), stateBytes);
    });
    function archiveV3(current) {
      const encode = value => `${JSON.stringify(value, null, 2)}\n`;
      const digest = value => crypto.createHash("sha256").update(value).digest("hex");
      const snapshot = JSON.parse(fs.readFileSync(current.packet_file, "utf8"));
      snapshot.policy.version = 3;
      delete snapshot.packet.decision_context;
      const packetBytes = encode(snapshot);
      fs.writeFileSync(current.packet_file, packetBytes);
      const stateFile = path.join(current.run_dir, "state.json");
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8")).state;
      state.packet_sha256 = digest(packetBytes);
      for (const entry of state.drafts) {
        for (const filename of [entry.review_template_file, entry.review_file].filter(Boolean)) {
          const file = path.join(current.run_dir, filename);
          const review = JSON.parse(fs.readFileSync(file, "utf8"));
          review.packet_sha256 = state.packet_sha256;
          review.policy_version = 3;
          const reviewBytes = encode(review);
          fs.writeFileSync(file, reviewBytes);
          if (filename === entry.review_file) entry.review_sha256 = digest(reviewBytes);
        }
      }
      fs.writeFileSync(stateFile, encode({ format: 2, state, sha256: digest(encode(state)) }));
      return fs.readdirSync(current.run_dir).map(filename => {
        const file = path.join(current.run_dir, filename);
        return [file, fs.readFileSync(file)];
      });
    }
    for (const target of ["artifact", "test"]) {
      test(`policy-v3 ${target} history remains readable under its exact recorded rules`, () => {
        const current = review(submit(init((input) => {
          input.task = "Review the supplied application report.";
          input.gates = [];
        }), BASE_DRAFT, (input) => { input.decision = { target, decision: target === "artifact" ? "complete" : "proceed" }; }),
        (input) => { input.reviewer.mode = "self_review"; });
        const before = archiveV3(current);
        const status = runQuality(["status", current.run_dir]);
        assert.equal(status.policy_version, 3);
        assert.equal(status.decision_context, null);
        assert.equal(status.recorded_disposition, "accepted");
        assert.equal(status.disposition, "needs_review");
        assert.equal(status.legacy_read_only, true);
        diagnostic(status, "legacy_policy");
        assert.throws(() => submit(current), /Legacy policy run is read-only/);
        assert.throws(() => review(current), /Legacy policy run is read-only/);
        for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes, `Archive was changed: ${file}`);
      });
    }
    test("policy-v3 retains persistent application review across assessment-only repairs", () => {
      const first = submit(init(), BASE_DRAFT, input => { input.decision = { target: "apply", decision: "proceed" }; });
      const second = submit(first, BASE_DRAFT, input => { input.decision = { target: "artifact", decision: "complete" }; });
      const current = review(second, input => { input.reviewer.mode = "self_review"; });
      const before = archiveV3(current);
      const status = runQuality(["status", current.run_dir]);
      assert.equal(status.recorded_disposition, "needs_review");
      assert.equal(status.draft_count, 2);
      diagnostic(status, "independent_review_required");
      assert.throws(() => submit(current), /Legacy policy run is read-only/);
      for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes);
    });
    test("policy-v3 still rejects a review unbound from its frozen packet", () => {
      const current = review(submit(init()));
      archiveV3(current);
      const stateFile = path.join(current.run_dir, "state.json");
      const record = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const entry = record.state.drafts[0];
      const reviewFile = path.join(current.run_dir, entry.review_file);
      const archivedReview = JSON.parse(fs.readFileSync(reviewFile, "utf8"));
      archivedReview.packet_sha256 = "0".repeat(64);
      const bytes = `${JSON.stringify(archivedReview, null, 2)}\n`;
      fs.writeFileSync(reviewFile, bytes);
      entry.review_sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      record.sha256 = crypto.createHash("sha256").update(`${JSON.stringify(record.state, null, 2)}\n`).digest("hex");
      fs.writeFileSync(stateFile, `${JSON.stringify(record, null, 2)}\n`);
      assert.throws(() => runQuality(["status", current.run_dir]), /current frozen packet/);
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
    test("reported-only prerequisites cannot be promoted to passed", () => {
      assert.throws(() => init((input) => { input.facts[0].status = "reported"; }), /requires current inspected evidence/);
    });
    test("a bounded first test can proceed from candid claims without an invented gate", () => {
      const run = init((input) => { input.facts[0].status = "reported"; input.gates = []; });
      const current = submit(run, BASE_DRAFT, (input) => { input.decision.target = "test"; });
      assert.deepEqual(current.diagnostics, []);
      assert.equal(review(current, (input) => { input.reviewer.mode = "self_review"; }).disposition, "accepted");
    });
    test("application review requirements persist after switching the assessment to artifact", () => {
      const first = submit(init(), BASE_DRAFT, (input) => { input.decision = { target: "apply", decision: "proceed" }; });
      assert.equal(first.requires_independent_review, true);
      const second = submit(first, BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
      assert.equal(second.requires_independent_review, true);
      const result = review(second, (input) => { input.reviewer.mode = "self_review"; });
      assert.equal(result.disposition, "needs_review");
      assert.equal(runQuality(["status", result.run_dir]).requires_independent_review, true);
    });
    test("self-review cannot resolve an application issue by relabeling the unchanged draft", () => {
      const first = submit(init(), BASE_DRAFT, (input) => { input.decision = { target: "apply", decision: "pause" }; });
      const repaired = failedReview(first);
      const second = submit(repaired, BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
      const result = review(second, (input) => {
        input.reviewer.mode = "self_review";
        input.resolutions = [{ id: "wrong_scope", status: "fixed", basis: "Changed only the assessment target." }];
      });
      assert.equal(result.disposition, "needs_review");
    });
    test("reviews are bound to the frozen packet as well as identical draft and assessment", () => {
      const first = submit(init(), BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
      const second = submit(init((input) => { input.mode = "evaluator"; input.task = "Evaluate this report in a different frozen context."; }), BASE_DRAFT, (input) => { input.decision = { target: "artifact", decision: "complete" }; });
      assert.equal(first.draft_sha256, second.draft_sha256);
      assert.equal(first.assessment_sha256, second.assessment_sha256);
      assert.notEqual(first.packet_sha256, second.packet_sha256);
      assert.throws(() => runQuality(["review", second.run_dir, write(reviewFor(first))]), /current frozen packet/);
      assert.equal(runQuality(["status", second.run_dir]).disposition, "awaiting_review");
    });
    test("invalid draft encoding is rejected before it consumes a version", () => {
      const run = init();
      const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(BASE_DRAFT, "utf16le")]);
      assert.throws(() => submit(run, bytes), /valid UTF-8/);
      assert.equal(runQuality(["status", run.run_dir]).draft_count, 0);
      assert.equal(fs.existsSync(path.join(run.run_dir, "draft-1.md")), false);
      assert.equal(submit(run).draft_count, 1);
    });
    test("invalid packet JSON encoding refuses initialization without creating or changing a run", () => {
      for (const malformed of [Buffer.from([0xff]), Buffer.from([0xc3]), Buffer.from([0xed, 0xa0, 0x80])]) {
        for (const preexisting of [false, true]) {
          const input = clone(packet); input.task += ` ${encodingMarker}`;
          const file = invalidJsonInput(input, malformed), beforeInput = fs.readFileSync(file);
          const run = path.join(temporaryRoot, `encoding-init-${++sequence}`);
          if (preexisting) fs.mkdirSync(run, { mode: 0o750 });
          const stat = preexisting && fs.lstatSync(run, { bigint: true });
          assert.throws(() => runQuality(["init", run, file]), /JSON input must contain valid UTF-8/);
          assert.deepEqual(fs.readFileSync(file), beforeInput);
          if (preexisting) {
            const after = fs.lstatSync(run, { bigint: true });
            assert.deepEqual([after.dev, after.ino, after.mode], [stat.dev, stat.ino, stat.mode]);
            assert.deepEqual(fs.readdirSync(run), []);
          } else assert.equal(fs.existsSync(run), false);
          assert.equal(runQuality(["init", run, write(input)]).draft_count, 0, "A valid retry must use the same run destination.");
        }
      }
    });
    test("invalid assessment JSON encoding consumes no draft or artifact and allows a valid retry", () => {
      const run = init(), draft = `${BASE_DRAFT} ${encodingMarker}`, input = clone(assessment);
      input.claims[1].quote += ` ${encodingMarker}`;
      const before = runArtifacts(run.run_dir), draftFile = write(draft, "md");
      const invalid = invalidJsonInput(input), inputBytes = fs.readFileSync(invalid);
      assert.throws(() => runQuality(["submit", run.run_dir, draftFile, invalid]), /JSON input must contain valid UTF-8/);
      assert.deepEqual(runArtifacts(run.run_dir), before, "Rejected JSON must not reserve artifacts or change state/inodes.");
      assert.deepEqual(fs.readFileSync(invalid), inputBytes);
      assert.equal(runQuality(["status", run.run_dir]).draft_count, 0);
      const current = runQuality(["submit", run.run_dir, draftFile, write(input)]);
      assert.equal(current.draft_count, 1);
      assert.deepEqual(current.diagnostics, []);
      assert.equal(JSON.parse(fs.readFileSync(current.assessment_file)).claims[1].quote, input.claims[1].quote);
    });
    test("invalid review JSON encoding records no review and permits the same valid review afterward", () => {
      const current = submit(init()), input = reviewFor(current);
      input.checks[0].note += ` ${encodingMarker}`;
      const before = runArtifacts(current.run_dir), invalid = invalidJsonInput(input), inputBytes = fs.readFileSync(invalid);
      assert.throws(() => runQuality(["review", current.run_dir, invalid]), /JSON input must contain valid UTF-8/);
      assert.deepEqual(runArtifacts(current.run_dir), before);
      assert.deepEqual(fs.readFileSync(invalid), inputBytes);
      assert.equal(runQuality(["status", current.run_dir]).disposition, "awaiting_review");
      assert.equal(runQuality(["review", current.run_dir, write(input)]).disposition, "accepted");
      const recorded = JSON.parse(fs.readFileSync(path.join(current.run_dir, "draft-1.review.json")));
      assert.equal(recorded.checks[0].note, input.checks[0].note);
    });
    test("literal replacement characters and multibyte JSON text survive a complete quality run", () => {
      const run = init(input => { input.task += ` ${encodingMarker}`; input.sources[0].locator += ` ${encodingMarker}`; });
      const draft = `${BASE_DRAFT} ${encodingMarker}`;
      const current = submit(run, draft, input => { input.claims[1].quote += ` ${encodingMarker}`; });
      assert.deepEqual(current.diagnostics, []);
      const result = review(current, input => { input.reviewer.model += ` ${encodingMarker}`; input.checks[0].note += ` ${encodingMarker}`; });
      assert.equal(result.disposition, "accepted");
      const storedPacket = JSON.parse(fs.readFileSync(run.packet_file));
      assert.equal(storedPacket.packet.task, `${packet.task} ${encodingMarker}`);
      assert.equal(storedPacket.packet.sources[0].locator, `${packet.sources[0].locator} ${encodingMarker}`);
      assert.deepEqual(fs.readFileSync(current.draft_file), Buffer.from(draft));
      assert.equal(JSON.parse(fs.readFileSync(current.assessment_file)).claims[1].quote, `${assessment.claims[1].quote} ${encodingMarker}`);
      const storedReview = JSON.parse(fs.readFileSync(path.join(result.run_dir, "draft-1.review.json")));
      assert.equal(storedReview.reviewer.model, `test-reviewer ${encodingMarker}`);
      assert.equal(runQuality(["status", result.run_dir]).disposition, "accepted");
    });
    for (const artifact of ["packet.json", "draft-1.md", "draft-1.assessment.json", "draft-1.review.json"]) {
      test(`invalid UTF-8 in archived ${artifact} cannot retain its decoded-text hash`, () => {
        const run = init(input => { input.task += ` ${encodingMarker}`; });
        const current = submit(run, `${BASE_DRAFT} ${encodingMarker}`, input => { input.claims[1].quote += ` ${encodingMarker}`; });
        const result = review(current, input => { input.checks[0].note += ` ${encodingMarker}`; });
        assert.equal(result.disposition, "accepted");
        const file = path.join(result.run_dir, artifact), original = fs.readFileSync(file), index = original.indexOf(Buffer.from("\uFFFD"));
        assert.notEqual(index, -1);
        const altered = Buffer.concat([original.subarray(0, index), Buffer.from([0xff]), original.subarray(index + 3)]);
        assert.notEqual(crypto.createHash("sha256").update(original).digest("hex"), crypto.createHash("sha256").update(altered).digest("hex"));
        fs.writeFileSync(file, altered);
        const before = runArtifacts(result.run_dir);
        assert.throws(() => runQuality(["status", result.run_dir]), /Run artifact must contain valid UTF-8/);
        assert.deepEqual(runArtifacts(result.run_dir), before, "Reject altered bytes without rewriting any history.");
        fs.writeFileSync(file, original);
        assert.equal(runQuality(["status", result.run_dir]).disposition, "accepted", "Restoring exact retained bytes preserves the original valid history.");
      });
    }
    for (const preexisting of [false, true]) {
      test(`failed initial state commit cleans its files and retries in ${preexisting ? "an existing empty" : "a new"} directory`, () => {
        const run = path.join(temporaryRoot, `initial-fault-${++sequence}`);
        if (preexisting) fs.mkdirSync(run, { mode: 0o750 });
        const inode = preexisting ? fs.statSync(run).ino : null;
        const input = write(packet);
        const inputBytes = fs.readFileSync(input);
        const sourceBytes = fs.readFileSync(sourcePath);
        const originalRename = fs.renameSync;
        const commitError = Object.assign(new Error("Synthetic EIO during initial state commit"), { code: "EIO" });
        let interrupted = false;
        fs.renameSync = (from, to) => {
          if (path.resolve(to) !== path.join(run, "state.json")) return originalRename(from, to);
          interrupted = true;
          assert.equal(fs.existsSync(path.join(run, "packet.json")), true);
          throw commitError;
        };
        try { assert.throws(() => runQuality(["init", run, input]), error => error === commitError); }
        finally { fs.renameSync = originalRename; }
        assert.equal(interrupted, true, "The failure must occur after creating the packet and writing initial state");
        assert.equal(fs.statSync(run).isDirectory(), true, "Initialization rollback preserves its directory");
        if (preexisting) assert.equal(fs.statSync(run).ino, inode, "A pre-existing directory must survive rollback");
        assert.deepEqual(fs.readdirSync(run), [], "Untouched packet and state temporary must both be removed");
        assert.deepEqual(fs.readFileSync(input), inputBytes);
        assert.deepEqual(fs.readFileSync(sourcePath), sourceBytes);
        const retried = runQuality(["init", run, input]);
        assert.equal(retried.draft_count, 0);
        assert.equal(retried.disposition, "draft_required");
        assert.equal(runQuality(["status", run]).disposition, "draft_required");
      });
    }
    for (const saveMode of ["atomic replacement", "same-inode edit", "atomic replacement with unchanged bytes", "uninspectable ownership"]) {
      test(`failed initialization preserves packet.json with ${saveMode}`, () => {
        const run = path.join(temporaryRoot, `initial-foreign-${++sequence}`);
        const input = write(packet);
        const protectedBytes = [sourcePath, input].map(file => [file, fs.readFileSync(file)]);
        const target = path.join(run, "packet.json");
        const originalRename = fs.renameSync;
        const originalLstat = fs.lstatSync;
        const commitError = Object.assign(new Error("Synthetic EIO during initial state publication"), { code: "EIO" });
        let saved;
        let denyInspection = false;
        let inspectionFailures = 0;
        let thrown;
        fs.lstatSync = (file, ...args) => {
          if (denyInspection && path.resolve(file) === target) {
            inspectionFailures++;
            throw Object.assign(new Error("Synthetic packet inspection denied"), { code: "EACCES" });
          }
          return originalLstat(file, ...args);
        };
        fs.renameSync = (from, to) => {
          if (path.resolve(to) !== path.join(run, "state.json")) return originalRename(from, to);
          const inode = fs.statSync(target).ino;
          saved = saveMode === "atomic replacement with unchanged bytes" || saveMode === "uninspectable ownership"
            ? fs.readFileSync(target) : Buffer.from(`Other author saved packet: ${saveMode}.\n`);
          if (saveMode.startsWith("atomic replacement")) {
            const temporary = path.join(run, "author-packet.tmp");
            fs.writeFileSync(temporary, saved, { flag: "wx" });
            originalRename(temporary, target);
            assert.notEqual(fs.statSync(target).ino, inode);
          } else if (saveMode === "same-inode edit") {
            fs.writeFileSync(target, saved);
            assert.equal(fs.statSync(target).ino, inode);
          } else denyInspection = true;
          throw commitError;
        };
        try { runQuality(["init", run, input]); }
        catch (error) { thrown = error; }
        finally { fs.renameSync = originalRename; fs.lstatSync = originalLstat; }
        assert(saved, "The test must reach initial state publication");
        assert.equal(thrown?.code, "EIO");
        assert.match(thrown.message, /Synthetic EIO during initial state publication/);
        assert(thrown.message.includes(target), "The retained packet path must be disclosed");
        assert.deepEqual(fs.readdirSync(run), ["packet.json"], "State temporary must be cleaned while the uncertain packet remains");
        assert.deepEqual(fs.readFileSync(target), saved);
        if (saveMode === "uninspectable ownership") assert(inspectionFailures > 0);
        assert.throws(() => runQuality(["init", run, input]), /never overwrite/);
        assert.deepEqual(fs.readFileSync(target), saved);
        for (const [file, bytes] of protectedBytes) assert.deepEqual(fs.readFileSync(file), bytes);
        const preserved = path.join(temporaryRoot, `preserved-initial-packet-${++sequence}`);
        fs.renameSync(target, preserved);
        assert.equal(runQuality(["init", run, input]).disposition, "draft_required");
        assert.deepEqual(fs.readFileSync(preserved), saved);
      });
    }
    test("failed initialization leaves an unrelated concurrent artifact intact", () => {
      const run = path.join(temporaryRoot, `initial-unrelated-${++sequence}`);
      const input = write(packet);
      const foreignFile = path.join(run, "author-note.md");
      const foreignBytes = "Other author owns this note.\n";
      const originalRename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (path.resolve(to) !== path.join(run, "state.json")) return originalRename(from, to);
        fs.writeFileSync(foreignFile, foreignBytes, { flag: "wx" });
        throw new Error("Synthetic initial commit failure after a concurrent write");
      };
      try { assert.throws(() => runQuality(["init", run, input]), /Synthetic initial commit failure/); }
      finally { fs.renameSync = originalRename; }
      assert.deepEqual(fs.readdirSync(run), ["author-note.md"]);
      assert.equal(fs.readFileSync(foreignFile, "utf8"), foreignBytes);
      assert.throws(() => runQuality(["init", run, input]), /never overwrite/);
      assert.equal(fs.readFileSync(foreignFile, "utf8"), foreignBytes);
    });
    test("failed atomic state commit preserves the last valid run and permits retry", () => {
      const run = init();
      const stateBytes = fs.readFileSync(path.join(run.run_dir, "state.json"));
      const packetBytes = fs.readFileSync(run.packet_file);
      const originalRename = fs.renameSync;
      fs.renameSync = () => { throw new Error("Synthetic state commit interruption"); };
      try { assert.throws(() => submit(run), /Synthetic state commit interruption/); }
      finally { fs.renameSync = originalRename; }
      assert.equal(runQuality(["status", run.run_dir]).draft_count, 0);
      for (const filename of ["draft-1.md", "draft-1.assessment.json", "draft-1.review-template.json"]) {
        assert.equal(fs.existsSync(path.join(run.run_dir, filename)), false);
      }
      assert.deepEqual(fs.readFileSync(path.join(run.run_dir, "state.json")), stateBytes);
      assert.deepEqual(fs.readFileSync(run.packet_file), packetBytes);
      assert.equal(fs.existsSync(path.join(run.run_dir, "state.sha256")), false);
      assert.equal(submit(run).draft_count, 1);
    });
    for (const operation of ["submit", "review"]) {
      const artifacts = operation === "submit"
        ? ["draft-1.md", "draft-1.assessment.json", "draft-1.review-template.json"]
        : ["draft-1.review.json"];
      const saveModes = ["atomic replacement", "same-inode edit", ...(operation === "review" ? ["atomic replacement with unchanged bytes"] : [])];
      for (const filename of artifacts) for (const saveMode of saveModes) {
        test(`failed ${operation} commit preserves ${saveMode} of ${filename}`, () => {
          const current = operation === "review" ? submit(init()) : init();
          const inputs = operation === "submit" ? [write(BASE_DRAFT, "md"), write(assessment)] : [write(reviewFor(current))];
          const argv = [operation, current.run_dir, ...inputs];
          const target = path.join(current.run_dir, filename);
          const stateFile = path.join(current.run_dir, "state.json");
          const protectedFiles = [sourcePath,
            ...fs.readdirSync(temporaryRoot).filter((entry) => entry.startsWith("input-")).map((entry) => path.join(temporaryRoot, entry)),
            ...fs.readdirSync(current.run_dir).map((entry) => path.join(current.run_dir, entry))];
          const before = protectedFiles.map((file) => [file, fs.readFileSync(file)]);
          let foreignBytes = Buffer.from(`Concurrent author saved ${filename}: ${saveMode}.\n`);
          const commitError = Object.assign(new Error("Synthetic ENOSPC during quality state commit"), { code: "ENOSPC" });
          const originalRename = fs.renameSync;
          let interrupted = false;
          let thrown;
          fs.renameSync = (from, to) => {
            if (path.resolve(to) !== stateFile) return originalRename(from, to);
            assert.equal(interrupted, false, "Only the state publication is interrupted");
            interrupted = true;
            const created = fs.statSync(target);
            if (saveMode.startsWith("atomic replacement")) {
              if (saveMode === "atomic replacement with unchanged bytes") foreignBytes = fs.readFileSync(target);
              const saved = path.join(current.run_dir, `.author-save-${++sequence}`);
              fs.writeFileSync(saved, foreignBytes, { flag: "wx", mode: 0o600 });
              originalRename(saved, target);
              assert.notEqual(fs.statSync(target).ino, created.ino, "Atomic save must replace the artifact inode");
            } else {
              fs.writeFileSync(target, foreignBytes);
              assert.equal(fs.statSync(target).ino, created.ino, "In-place save must keep the artifact inode");
            }
            assert.deepEqual(fs.readFileSync(target), foreignBytes);
            throw commitError;
          };
          try { runQuality(argv); }
          catch (error) { thrown = error; }
          finally { fs.renameSync = originalRename; }
          assert.equal(interrupted, true, "The test must reach state publication");
          assert(thrown, "A failed state commit must be reported");
          assert.equal(thrown.code, "ENOSPC");
          assert.match(thrown.message, /Synthetic ENOSPC during quality state commit/);
          assert.equal(fs.existsSync(target), true, "The other author's save must survive rollback");
          assert.deepEqual(fs.readFileSync(target), foreignBytes);
          assert(thrown.message.includes(filename), "The CLI error must disclose the retained artifact");
          for (const artifact of artifacts.filter((entry) => entry !== filename)) {
            assert.equal(fs.existsSync(path.join(current.run_dir, artifact)), false, "Untouched operation-owned output must be cleaned up");
          }
          for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes, `Frozen state/input changed: ${file}`);
          const status = runQuality(["status", current.run_dir]);
          assert.equal(status.draft_count, operation === "submit" ? 0 : 1);
          assert.equal(status.disposition, operation === "submit" ? "draft_required" : "awaiting_review");
          assert.throws(() => runQuality(argv), /EEXIST|already exists/, "Retry must refuse to overwrite a retained save");
          assert.deepEqual(fs.readFileSync(target), foreignBytes);
          for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes, `Retry changed frozen state/input: ${file}`);
          const preserved = path.join(temporaryRoot, `preserved-author-save-${++sequence}`);
          fs.renameSync(target, preserved);
          const retried = runQuality(argv);
          assert.equal(retried.draft_count, 1, "An uncommitted attempt must not consume a draft version");
          assert.equal(retried.disposition, operation === "submit" ? "awaiting_review" : "accepted");
          assert.deepEqual(fs.readFileSync(preserved), foreignBytes, "Operator-preserved bytes must remain intact after retry");
        });
      }
    }
    for (const operation of ["submit", "review"]) {
      test(`failed ${operation} commit preserves an artifact whose ownership cannot be inspected`, () => {
        const current = operation === "review" ? submit(init()) : init();
        const inputs = operation === "submit" ? [write(BASE_DRAFT, "md"), write(assessment)] : [write(reviewFor(current))];
        const argv = [operation, current.run_dir, ...inputs];
        const filename = operation === "submit" ? "draft-1.md" : "draft-1.review.json";
        const target = path.join(current.run_dir, filename);
        const stateFile = path.join(current.run_dir, "state.json");
        const before = [sourcePath, ...inputs, ...fs.readdirSync(current.run_dir).map((entry) => path.join(current.run_dir, entry))]
          .map((file) => [file, fs.readFileSync(file)]);
        const originalRename = fs.renameSync;
        const originalLstat = fs.lstatSync;
        const commitError = Object.assign(new Error("Synthetic ENOSPC before ownership inspection"), { code: "ENOSPC" });
        let saved;
        let denyingInspection = false;
        let inspectionFailures = 0;
        let thrown;
        fs.lstatSync = (file, ...args) => {
          if (denyingInspection && path.resolve(file) === target) {
            inspectionFailures++;
            throw Object.assign(new Error("Synthetic artifact inspection denied"), { code: "EACCES" });
          }
          return originalLstat(file, ...args);
        };
        fs.renameSync = (from, to) => {
          if (path.resolve(to) !== stateFile) return originalRename(from, to);
          saved = fs.readFileSync(target);
          denyingInspection = true;
          throw commitError;
        };
        try { runQuality(argv); }
        catch (error) { thrown = error; }
        finally { fs.renameSync = originalRename; fs.lstatSync = originalLstat; }
        assert(saved, "The test must reach state publication after artifact creation");
        assert.equal(thrown?.code, "ENOSPC", "Cleanup inspection must not replace the original state error");
        assert.match(thrown.message, /Synthetic ENOSPC before ownership inspection/);
        assert.equal(fs.existsSync(target), true, "Uncertain ownership must preserve the artifact");
        assert.deepEqual(fs.readFileSync(target), saved);
        assert(inspectionFailures > 0, "The ownership inspection must actually fail");
        assert(thrown.message.includes(filename), "The retained artifact must be disclosed");
        for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes);
        assert.equal(runQuality(["status", current.run_dir]).disposition, operation === "submit" ? "draft_required" : "awaiting_review");
        assert.throws(() => runQuality(argv), /EEXIST|already exists/);
        assert.deepEqual(fs.readFileSync(target), saved);
        for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes);
        const preserved = path.join(temporaryRoot, `uninspected-author-save-${++sequence}`);
        fs.renameSync(target, preserved);
        const retried = runQuality(argv);
        assert.equal(retried.draft_count, 1);
        assert.equal(retried.disposition, operation === "submit" ? "awaiting_review" : "accepted");
        assert.deepEqual(fs.readFileSync(preserved), saved);
      });
    }
    test("failed review commit removes only its untouched output and permits retry", () => {
      const current = submit(init());
      const input = write(reviewFor(current));
      const stateFile = path.join(current.run_dir, "state.json");
      const before = fs.readdirSync(current.run_dir).map((entry) => {
        const file = path.join(current.run_dir, entry);
        return [file, fs.readFileSync(file)];
      });
      const originalRename = fs.renameSync;
      const commitError = Object.assign(new Error("Synthetic ENOSPC during quality review commit"), { code: "ENOSPC" });
      fs.renameSync = (from, to) => {
        if (path.resolve(to) === stateFile) throw commitError;
        return originalRename(from, to);
      };
      try { assert.throws(() => runQuality(["review", current.run_dir, input]), (error) => error.code === "ENOSPC" && error.message === commitError.message); }
      finally { fs.renameSync = originalRename; }
      assert.equal(fs.existsSync(path.join(current.run_dir, "draft-1.review.json")), false);
      for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes);
      const status = runQuality(["status", current.run_dir]);
      assert.equal(status.draft_count, 1);
      assert.equal(status.disposition, "awaiting_review");
      const accepted = runQuality(["review", current.run_dir, input]);
      assert.equal(accepted.draft_count, 1);
      assert.equal(accepted.disposition, "accepted");
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
    for (const filename of ["draft-1.md", "draft-1.assessment.json", "draft-1.review-template.json"]) {
      test(`interrupted submit preserves ${filename} and explains recovery`, () => {
        const run = init();
        const orphan = path.join(run.run_dir, filename);
        const bytes = "Uncommitted preserved artifact from an interrupted writer.\n";
        fs.writeFileSync(orphan, bytes);
        assert.throws(() => submit(run), error => error.code === "EEXIST" && /interrupted operation/.test(error.message) && /last committed run status/.test(error.message) && /never overwrite/.test(error.message));
        assert.equal(fs.readFileSync(orphan, "utf8"), bytes);
        assert.deepEqual(fs.readdirSync(run.run_dir).sort(), ["packet.json", "state.json", filename].sort());
        const status = runQuality(["status", run.run_dir]);
        assert.equal(status.disposition, "draft_required");
        assert.equal(status.draft_count, 0);
        fs.renameSync(orphan, path.join(temporaryRoot, `preserved-${++sequence}.txt`));
        assert.equal(submit(run).disposition, "awaiting_review");
      });
    }
    test("interrupted review preserves the orphan and explains same-run retry", () => {
      const current = submit(init());
      const orphan = path.join(current.run_dir, "draft-1.review.json");
      fs.writeFileSync(orphan, "Uncommitted review.\n");
      assert.throws(() => review(current), error => error.code === "EEXIST" && /move the uncommitted artifact aside/.test(error.message));
      assert.equal(fs.readFileSync(orphan, "utf8"), "Uncommitted review.\n");
      assert.equal(runQuality(["status", current.run_dir]).disposition, "awaiting_review");
      fs.renameSync(orphan, path.join(temporaryRoot, `preserved-${++sequence}.txt`));
      assert.equal(review(current).disposition, "accepted");
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
