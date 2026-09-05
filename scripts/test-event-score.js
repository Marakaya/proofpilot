import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runEventScore } from "../skills/proofpilot/scripts/event-score.js";

const runtime = fileURLToPath(new URL("../skills/proofpilot/scripts/event-score.js", import.meta.url));
const profileFile = fileURLToPath(new URL("../skills/proofpilot/references/event-profiles.json", import.meta.url));
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");

export function runEventScoreTests() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-event-score-"));
  let cases = 0;
  let sequence = 0;
  const write = (value) => {
    const filename = path.join(temporary, `input-${++sequence}.json`);
    fs.writeFileSync(filename, JSON.stringify(value));
    return filename;
  };
  function template(profile = "solana_hackathon") {
    const destination = path.join(temporary, `card-${++sequence}.json`);
    runEventScore(["init", profile, destination]);
    return JSON.parse(fs.readFileSync(destination, "utf8"));
  }
  function card(profile = "solana_hackathon") {
    const value = template(profile);
    value.event = { id: "event_one", name: "Test event", rules_locator: "local:published-rules-v1.md" };
    value.project = { id: "project_one", name: "Test project" };
    value.reviewer = { id: "reviewer_one", kind: "human", name: "Test judge" };
    value.mode = "evaluator";
    value.evidence_cutoff = "2026-09-06T12:00:00Z";
    return value;
  }
  function supported(value) {
    value.artifacts.push({ id: "inspection", location: "local:judging-notes.txt", version: "notes-v1-for-commit-abc123", kind: "submitted", available_at: "2026-09-06T11:00:00Z", basis: "observed", scope: "Test fixture recording checks of the submitted version; not an authenticity guarantee." });
    return value;
  }
  function score(dimension, level = 4) {
    Object.assign(dimension, { score: level, basis: "observed", confidence: "medium", rationale: "The cited inspection supports this anchor within the stated scope.", evidence_refs: ["inspection"] });
  }
  function complete(value = supported(card())) {
    value.dimensions.forEach((dimension) => score(dimension));
    value.admission.forEach((check) => Object.assign(check, { status: "passed", rationale: "Published requirement checked in the cited record.", evidence_refs: ["inspection"] }));
    return value;
  }
  const check = (value) => runEventScore(["check", write(value)]);
  function test(label, fn) {
    try { fn(); cases++; }
    catch (error) { throw new Error(`Event-score regression '${label}' failed: ${error.message}`, { cause: error }); }
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Event score must remain offline"); };
  try {
    test("two own presets each total 100 with 0..4 anchors", () => {
      const profiles = runEventScore(["list"]).profiles;
      assert.deepEqual(profiles.map((profile) => profile.id), ["solana_hackathon", "learning_workshop"]);
      for (const profile of profiles) {
        assert.equal(profile.origin, "proofpilot");
        assert.equal(profile.dimensions.reduce((sum, item) => sum + item.weight, 0), 100);
        assert.deepEqual(profile.scale, { min: 0, max: 4, step: 1 });
        assert(profile.dimensions.every((item) => Object.keys(item.anchors).join(",") === "0,2,4"));
      }
    });
    test("init is exclusive and never overwrites an existing scorecard", () => {
      const filename = write({ preserved: "user content" });
      assert.throws(() => runEventScore(["init", "solana_hackathon", filename]), /EEXIST/);
      assert.deepEqual(JSON.parse(fs.readFileSync(filename)), { preserved: "user content" });
    });
    test("incomplete template is not presented as a checked scorecard", () => assert.throws(() => check(template()), /completed string/));
    test("all unknown produces no total, 0 coverage and upper 100", () => {
      const result = check(card());
      assert.equal(result.total, null);
      assert.equal(result.earned_points, 0);
      assert.equal(result.coverage_weight_percent, 0);
      assert.equal(result.possible_points_upper, 100);
      assert.equal(result.provisional, true);
      assert.equal(result.mechanically_comparable, false);
    });
    test("partial score keeps original denominator and never becomes a final score", () => {
      const value = supported(card());
      score(value.dimensions[0], 2);
      const result = check(value);
      assert.equal(result.total, null);
      assert.equal(result.earned_points, 12.5);
      assert.equal(result.coverage_weight_percent, 25);
      assert.equal(result.possible_points_upper, 87.5);
      assert.equal(result.provisional, true);
    });
    test("a supported zero is distinct from missing evidence", () => {
      const value = supported(card());
      score(value.dimensions[0], 0);
      const result = check(value);
      assert.equal(result.earned_points, 0);
      assert.equal(result.coverage_weight_percent, 25);
      assert.equal(result.possible_points_upper, 75);
      assert.equal(result.dimensions[0].points, 0);
      assert.equal(result.dimensions[1].points, null);
    });
    test("complete admitted evaluator gets computed 100 with mechanical-only limits", () => {
      const result = check(complete());
      assert.equal(result.total, 100);
      assert.equal(result.mechanically_comparable, true);
      assert.equal(result.mechanical_only, true);
      assert.equal(result.independent_review_verified, false);
      assert.equal(result.evidence_authenticity_verified, false);
    });
    test("workshop midpoint yields 50 and can never depend on market traction", () => {
      const value = complete(supported(card("learning_workshop")));
      value.dimensions.forEach((item) => score(item, 2));
      assert.equal(check(value).total, 50);
      assert.deepEqual(value.dimensions.map((item) => item.id), ["working_task", "technology_application", "understanding", "usability", "task_value"]);
    });
    test("failed or unknown admission prevents comparison even with full score", () => {
      for (const status of ["failed", "unknown"]) {
        const value = complete();
        value.admission[0].status = status;
        const result = check(value);
        assert.equal(result.total, 100);
        assert.equal(result.admission_status, status);
        assert.equal(result.mechanically_comparable, false);
        assert.equal(result.provisional, true);
      }
    });
    test("coach scores remain provisional and non-comparative", () => {
      const value = complete();
      value.mode = "coach";
      assert.equal(check(value).mechanically_comparable, false);
      assert.equal(check(value).provisional, true);
    });
    test("manual score totals and per-dimension weights are rejected", () => {
      const value = complete();
      value.total = 100;
      assert.throws(() => check(value), /unknown fields/);
      delete value.total;
      value.dimensions[0].weight = 99;
      assert.throws(() => check(value), /unknown fields/);
    });
    test("duplicate, missing and unknown dimensions are rejected", () => {
      const value = complete();
      value.dimensions.push(value.dimensions[0]);
      assert.throws(() => check(value), /duplicate ID/);
      value.dimensions.splice(-2);
      assert.throws(() => check(value), /every rubric ID/);
      value.dimensions.push({ ...value.dimensions[0], id: "invented_dimension" });
      assert.throws(() => check(value), /every rubric ID/);
    });
    test("out of range, fractional, string and infinite scores are rejected", () => {
      for (const invalid of [-1, 5, 2.5, "4"]) {
        const value = complete();
        value.dimensions[0].score = invalid;
        assert.throws(() => check(value), /integer 0\.\.4/);
      }
      const filename = write(complete());
      fs.writeFileSync(filename, fs.readFileSync(filename, "utf8").replace('"score":4', '"score":1e309'));
      assert.throws(() => runEventScore(["check", filename]), /integer 0\.\.4/);
    });
    test("numeric dimensions require evidence and rationale", () => {
      const value = complete();
      value.dimensions[0].evidence_refs = [];
      assert.throws(() => check(value), /requires evidence/);
      value.dimensions[0].evidence_refs = ["inspection"];
      value.dimensions[0].rationale = " ";
      assert.throws(() => check(value), /completed string/);
    });
    test("reported claims never become numeric established outcomes", () => {
      for (const basis of ["team_reported", "unavailable"]) {
        const value = complete();
        value.dimensions[0].basis = basis;
        assert.throws(() => check(value), /cannot establish a numeric score/);
      }
      const value = supported(card());
      value.artifacts[0].basis = "team_reported";
      score(value.dimensions[0]);
      assert.throws(() => check(value), /requires evidence matching/);
      Object.assign(value.dimensions[0], { score: null, basis: "team_reported", confidence: "unknown" });
      assert.equal(check(value).total, null);
    });
    test("artifact-supported evidence is allowed without claiming independent verification", () => {
      const value = supported(card());
      value.artifacts[0].basis = "artifact_supported";
      score(value.dimensions[0], 1);
      value.dimensions[0].basis = "artifact_supported";
      const result = check(value);
      assert.equal(result.earned_points, 6.25);
      assert.equal(result.evidence_authenticity_verified, false);
    });
    test("reference IDs, artifact version and source policy are enforced", () => {
      const value = complete();
      value.dimensions[0].evidence_refs = ["missing"];
      assert.throws(() => check(value), /unknown artifact/);
      value.dimensions[0].evidence_refs = ["inspection"];
      value.artifacts[0].version = "";
      assert.throws(() => check(value), /artifact.version/);
      value.artifacts[0].version = "v1";
      value.artifacts[0].kind = "public";
      assert.throws(() => check(value), /source policy/);
    });
    test("evidence after cutoff or impossible dates are rejected", () => {
      const value = complete();
      value.artifacts[0].available_at = "2026-09-06T12:00:01Z";
      assert.throws(() => check(value), /after the evidence cutoff/);
      value.artifacts[0].available_at = "2026-02-30T11:00:00Z";
      assert.throws(() => check(value), /real date/);
    });
    test("later inspection of on-time frozen work is allowed without extending cutoff", () => {
      const value = complete();
      value.artifacts[0].observed_at = "2026-09-08T15:00:00Z";
      assert.equal(check(value).total, 100);
      value.artifacts[0].available_at = "2026-09-07T11:00:00Z";
      assert.throws(() => check(value), /after the evidence cutoff/);
    });
    test("admission decisions require evidence and cannot omit required checks", () => {
      const value = complete();
      value.admission[0].evidence_refs = [];
      assert.throws(() => check(value), /inspected supporting evidence/);
      value.admission.pop();
      assert.throws(() => check(value), /every rubric ID/);
    });
    test("changed built-in snapshot fails even if its checksum is recomputed", () => {
      const value = complete();
      value.rubric_snapshot.dimensions[0].weight = 24;
      value.rubric_snapshot.dimensions[1].weight = 26;
      assert.throws(() => check(value), /hash mismatch/);
      value.rubric_sha256 = digest(value.rubric_snapshot);
      assert.throws(() => check(value), /differs from the packaged preset/);
      const version = complete();
      version.rubric_snapshot.version = "999.0.0";
      version.rubric_sha256 = digest(version.rubric_snapshot);
      assert.throws(() => check(version), /differs from the packaged preset/);
    });
    test("explicit custom and supplied official rubrics work with honest provenance limits", () => {
      for (const origin of ["custom", "official"]) {
        const profile = template().rubric_snapshot;
        profile.id = `test_${origin}`;
        profile.origin = origin;
        profile.source_locator = "https://example.test/published-rules";
        profile.provenance = "Test fixture of explicitly supplied weights; not a real event rubric.";
        const value = complete(supported(card(write(profile))));
        const result = check(value);
        assert.equal(result.profile.origin, origin);
        assert.equal(result.total, 100);
        assert(result.limitations.some((item) => item.includes("official attribution")));
      }
    });
    test("custom profiles require complete weights, provenance and supported explicit scale", () => {
      for (const mutate of [
        (profile) => { profile.dimensions[0].weight = 30; },
        (profile) => { profile.source_locator = ""; },
        (profile) => { delete profile.provenance; },
        (profile) => { profile.scale.max = 5; },
        (profile) => { profile.dimensions[0].weight = "25"; },
        (profile) => { profile.dimensions.push(profile.dimensions[0]); }
      ]) {
        const profile = template().rubric_snapshot;
        profile.id = "my_event";
        profile.origin = "custom";
        mutate(profile);
        assert.throws(() => template(write(profile)));
      }
    });
    test("archived preset stays verifiable after the current preset is upgraded", () => {
      const installed = path.join(temporary, "upgraded-skill");
      fs.mkdirSync(path.join(installed, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(installed, "references"));
      const helper = path.join(installed, "scripts", "event-score.mjs");
      fs.copyFileSync(runtime, helper);
      const registry = JSON.parse(fs.readFileSync(profileFile, "utf8"));
      registry.archived_profiles = [structuredClone(registry.profiles[0])];
      registry.profiles[0].version = "1.1.0";
      registry.profiles[0].dimensions[0].weight = 24;
      registry.profiles[0].dimensions[1].weight = 26;
      const registryPath = path.join(installed, "references", "event-profiles.json");
      fs.writeFileSync(registryPath, JSON.stringify(registry));
      const filename = write(complete());
      const checked = spawnSync(process.execPath, [helper, "check", filename], { encoding: "utf8" });
      assert.equal(checked.status, 0, checked.stderr);
      assert.equal(JSON.parse(checked.stdout).profile.version, "1.0.0");
      assert.equal(JSON.parse(checked.stdout).total, 100);
      const pinned = path.join(temporary, "pinned-card.json");
      const created = spawnSync(process.execPath, [helper, "init", "solana_hackathon@1.0.0", pinned], { encoding: "utf8" });
      assert.equal(created.status, 0, created.stderr);
      assert.equal(JSON.parse(fs.readFileSync(pinned)).rubric_snapshot.dimensions[0].weight, 25);
      registry.archived_profiles.push(structuredClone(registry.archived_profiles[0]));
      fs.writeFileSync(registryPath, JSON.stringify(registry));
      const invalid = spawnSync(process.execPath, [helper, "list"], { encoding: "utf8" });
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /Duplicate packaged rubric version/);
    });
    test("documented judge evidence can support zero without becoming agent observation", () => {
      const value = supported(card("learning_workshop"));
      value.artifacts[0].basis = "artifact_supported";
      value.artifacts[0].scope = "Supplied teacher record of an incorrect explanation; not an agent-observed Q&A.";
      score(value.dimensions[2], 0);
      value.dimensions[2].basis = "artifact_supported";
      const result = check(value);
      assert.equal(result.dimensions[2].points, 0);
      assert.equal(result.dimensions[2].basis, "artifact_supported");
      assert.equal(result.evidence_authenticity_verified, false);
      assert.equal(result.coverage_weight_percent, 20);
    });
    test("standalone installed skill path works outside repository and without dependencies", () => {
      const installed = path.join(temporary, "installed-skill");
      fs.mkdirSync(path.join(installed, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(installed, "references"));
      fs.copyFileSync(runtime, path.join(installed, "scripts", "event-score.mjs"));
      fs.copyFileSync(profileFile, path.join(installed, "references", "event-profiles.json"));
      const filename = write(complete());
      const result = spawnSync(process.execPath, [path.join(installed, "scripts", "event-score.mjs"), "check", filename], { cwd: os.tmpdir(), encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).total, 100);
    });
    test("CLI returns nonzero on invalid input and displays concise help", () => {
      const invalid = spawnSync(process.execPath, [runtime, "check", write({})], { encoding: "utf8" });
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /event-score:/);
      const help = spawnSync(process.execPath, [runtime, "--help"], { encoding: "utf8" });
      assert.equal(help.status, 0);
      assert.match(help.stdout, /No network access/);
    });
    return { cases };
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runEventScoreTests();
  process.stdout.write(`event-score tests: ${result.cases} passed\n`);
}
