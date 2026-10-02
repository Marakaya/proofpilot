import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createResponseValidator } from "./validate.js";
import { calculateScorecard, validateResponseSemantics, validateResponseStructure } from "../skills/proofpilot/scripts/validate-response.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

export function runResponseTests() {
  const schema = read("skills/proofpilot/references/response.schema.json");
  const rubrics = read("skills/proofpilot/references/rubrics.json");
  const sources = read("skills/proofpilot/references/source-registry.json");
  const tools = read("skills/proofpilot/references/tool-registry.json");
  const credentials = read("skills/proofpilot/references/credential-registry.json");
  const validate = createResponseValidator({ schema, rubrics, sources, tools, credentials });
  const partial = read("examples/responses/evaluator-partial-evidence.json");
  const ineligible = read("examples/responses/ineligible-application.json");
  const coach = read("examples/responses/unknown-idea.json");
  let count = 0;
  function test(name, base, mutate, expectedError = null) {
    const response = structuredClone(base);
    mutate?.(response);
    const errors = validate(response);
    const structural = validateResponseStructure(response, schema);
    const portableErrors = structural.length ? structural : validateResponseSemantics(response, { rubrics, sources, tools, credentials });
    assert.equal(portableErrors.length === 0, errors.length === 0, `${name}: portable/Ajv validator disagreement`);
    if (expectedError) {
      assert.ok(errors.length > 0, `${name}: invalid response was accepted`);
      assert.match(errors.join("; "), expectedError, name);
    } else {
      assert.deepEqual(errors, [], name);
    }
    count++;
    return response;
  }
  for (const key of ["constructor", "toString", "__proto__"]) {
    test(`prototype-named extra property ${key} rejected consistently`, coach, response => {
      Object.defineProperty(response, key, { value: "Synthetic unexpected key", enumerable: true });
    }, /additional properties|unexpected property/);
  }
  function recompute(response) {
    const card = response.scorecards[0];
    const rubric = rubrics.rubrics.find((item) => item.id === card.rubric_id);
    Object.assign(card, calculateScorecard(card, rubric));
  }
  const full = structuredClone(partial);
  for (const dimension of full.scorecards[0].dimensions) {
    Object.assign(dimension, { state: "scored", score: 3, evidence_ids: ["observed_packet"] });
  }
  recompute(full);
  full.scorecards[0].provisional = false;
  const eligible = structuredClone(ineligible);
  eligible.recommendation.decision = "proceed";
  eligible.blocking_checks[0].status = "passed";
  eligible.blocking_checks[0].requirement = "Synthetic program admits the supplied applicant location.";
  // This fixture intentionally has a low quality score: gates do not depend on it.
  for (const dimension of eligible.scorecards[0].dimensions) dimension.score = 0;
  recompute(eligible);

  test("coach can propose a test from candid user claims", coach);
  test("partial evidence can yield high score with low coverage", partial);
  test("high quality score cannot erase ineligibility", ineligible);
  test("full observed coverage can be nonprovisional", full);
  test("conservative provisional flag is allowed", full, (r) => { r.scorecards[0].provisional = true; });
  test("low score does not decide independent eligibility", eligible);
  test("no generic traction eligibility requirement", eligible, (r) => { r.diagnosis = "Synthetic pre-idea accelerator accepts eligible candidates before customer traction."; });
  test("not-applicable weight excluded from coverage", partial, (r) => {
    r.scorecards[0].dimensions[1].state = "not_applicable";
    recompute(r);
    assert.ok(Math.abs(r.scorecards[0].evidence_coverage - 3 / 7) < 1e-9);
  });
  test("all not-applicable means null score and zero coverage", partial, (r) => {
    for (const d of r.scorecards[0].dimensions) Object.assign(d, { state: "not_applicable", score: null, evidence_ids: [] });
    recompute(r);
    assert.equal(r.scorecards[0].weighted_score, null);
    assert.equal(r.scorecards[0].evidence_coverage, 0);
  });
  test("no evidence remains unknown rather than real zero", partial, (r) => {
    for (const d of r.scorecards[0].dimensions) Object.assign(d, { state: "insufficient_evidence", score: null, evidence_ids: [] });
    recompute(r);
  });
  test("real observed zero is scored and fully covered", full, (r) => {
    for (const d of r.scorecards[0].dimensions) d.score = 0;
    recompute(r);
    assert.equal(r.scorecards[0].weighted_score, 0);
    assert.equal(r.scorecards[0].evidence_coverage, 1);
  });
  test("rounding up to tolerance accepted", full, (r) => { r.scorecards[0].weighted_score += 5e-7; });
  test("draft completion is artifact completion", coach, (r) => { r.recommendation.target = "artifact"; r.recommendation.decision = "complete"; });
  test("build blocker does not prevent separate test", full, (r) => {
    r.blocking_checks.push({ id: "implementation_access", target: "build", requirement: "Authorized data access needed for production build.", status: "unknown", evidence_ids: [] });
  });
  test("build proceed requires a matching prerequisite", coach, (r) => {
    r.recommendation.target = "build";
    r.recommendation.decision = "proceed";
    r.blocking_checks = [];
  }, /build\/proceed requires at least one build blocking check/);
  test("test checks do not establish build prerequisites", full, (r) => {
    r.recommendation.target = "build";
    r.recommendation.decision = "proceed";
    assert.ok(r.blocking_checks.every(check => check.target !== "build"));
  }, /build\/proceed requires at least one build blocking check/);
  test("build proceed accepts an observed passed prerequisite", full, (r) => {
    r.recommendation.target = "build";
    r.recommendation.decision = "proceed";
    r.blocking_checks.push({ id: "implementation_access", target: "build", requirement: "Inspected authorized data access for this build.", status: "passed", evidence_ids: ["observed_packet"] });
  });
  test("build prerequisite still needs supporting observed evidence", coach, (r) => {
    r.recommendation.target = "build";
    r.recommendation.decision = "proceed";
    r.blocking_checks = [{ id: "implementation_access", target: "build", requirement: "Asserted authorized access.", status: "passed", evidence_ids: ["founder_context"] }];
  }, /current supporting observed evidence/);
  test("build pause does not need invented prerequisites", coach, (r) => {
    r.recommendation.target = "build";
    r.recommendation.decision = "pause";
    r.blocking_checks = [];
  });
  test("failed gate permits pause rather than proceed", full, (r) => {
    r.recommendation.decision = "pause";
    r.blocking_checks.push({ id: "test_access", target: "test", requirement: "Test participants provide data access.", status: "failed", evidence_ids: ["observed_packet"] });
  });
  test("unknown matching gate needs provisional even with full score", full, (r) => {
    r.recommendation.decision = "pause";
    r.scorecards[0].provisional = true;
    r.blocking_checks.push({ id: "test_access", target: "test", requirement: "Confirm test data access.", status: "unknown", evidence_ids: [] });
  });

  const request = {
    tool_id: "github",
    capability_id: "connected_repository",
    credential_class: "api_token",
    reason: "Plan access to a user-selected private repository after authorization.",
    minimum_scope: "Read-only access to the selected repository; no writes."
  };
  const withRequest = test("actual registry permits a named connector setup request", coach, (r) => {
    r.credential_requests = [structuredClone(request)];
  });
  test("unknown credential-request tool rejected", withRequest, (r) => { r.credential_requests[0].tool_id = "invented"; }, /unknown tool_id/);
  test("unknown credential-request capability rejected", withRequest, (r) => { r.credential_requests[0].capability_id = "invented"; }, /unknown capability_id/);
  test("capability belonging to another tool rejected", withRequest, (r) => { r.credential_requests[0].capability_id = "account_api"; }, /unknown capability_id.*for tool github/);
  test("unknown credential class rejected", withRequest, (r) => { r.credential_requests[0].credential_class = "invented"; }, /unknown credential_class/);
  test("known but mismatched credential class rejected", withRequest, (r) => { r.credential_requests[0].credential_class = "oauth"; }, /credential_class must be api_token/);
  test("no-secret cannot replace required credential", withRequest, (r) => { r.credential_requests[0].credential_class = "no_secret"; }, /credential_class must be api_token/);
  const publicRequest = test("public capability may explicitly describe no-secret setup", withRequest, (r) => {
    Object.assign(r.credential_requests[0], { capability_id: "public_research", credential_class: "no_secret", reason: "Inspect public project proof.", minimum_scope: "Public repository data only; no account connection." });
  });
  test("public capability cannot request an API token", publicRequest, (r) => { r.credential_requests[0].credential_class = "api_token"; }, /credential_class must be no_secret/);
  test("deferred setup request does not require a working integration", withRequest, (r) => {
    Object.assign(r.credential_requests[0], { capability_id: "repository_write", credential_class: "oauth", reason: "Describe setup for a future authorized repository draft.", minimum_scope: "Selected repository only; execution requires separate authorization." });
  });
  test("different capabilities on one tool are distinct requests", withRequest, (r) => { r.credential_requests.push(structuredClone(publicRequest.credential_requests[0])); });
  test("duplicate tool/capability requests rejected", withRequest, (r) => {
    r.credential_requests.push({ ...request, reason: "A second reason must not duplicate the same setup request." });
  }, /duplicate tool\/capability request/);
  // Exercise registry defaults and fail closed if either supplied registry lacks the requested identity.
  assert.deepEqual(createResponseValidator()(withRequest), []);
  count++;
  assert.match(createResponseValidator({ tools: { tools: [] } })(withRequest).join("; "), /unknown tool_id/);
  count++;
  assert.match(createResponseValidator({ credentials: { credential_classes: [] } })(withRequest).join("; "), /unknown credential_class/);
  count++;

  test("audit exploit 4/4 without evidence rejected", partial, (r) => {
    r.evidence = [];
    r.scorecards[0].evidence_coverage = 0;
    r.scorecards[0].provisional = false;
  }, /evidence_id|coverage|provisional/);
  test("scored dimension needs nonempty evidence ids", partial, (r) => { r.scorecards[0].dimensions[0].evidence_ids = []; }, /evidence_ids|item/);
  test("unknown evidence references rejected", partial, (r) => { r.scorecards[0].dimensions[0].evidence_ids = ["missing"]; }, /unknown evidence_id/);
  test("duplicate evidence ids rejected", partial, (r) => { r.evidence.push(structuredClone(r.evidence[0])); }, /Duplicate evidence id/);
  test("duplicate dimensions rejected", partial, (r) => { r.scorecards[0].dimensions.push(structuredClone(r.scorecards[0].dimensions[0])); }, /Duplicate dimension/);
  test("missing rubric dimension rejected", partial, (r) => { r.scorecards[0].dimensions.pop(); }, /missing dimension/);
  test("invented dimension rejected", partial, (r) => { r.scorecards[0].dimensions[0].dimension_id = "invented"; }, /unknown dimension/);
  test("unknown rubric rejected", partial, (r) => { r.scorecards[0].rubric_id = "invented"; }, /Unknown rubric_id/);
  test("old rubric version rejected", partial, (r) => { r.scorecards[0].rubric_version = "0.2.0"; }, /rubric_version/);
  test("duplicate scorecard rubric rejected", partial, (r) => { r.scorecards.push(structuredClone(r.scorecards[0])); }, /Duplicate scorecard/);
  test("weighted-score calculation enforced", partial, (r) => { r.scorecards[0].weighted_score = 3; }, /weighted_score/);
  test("coverage calculation enforced", partial, (r) => { r.scorecards[0].evidence_coverage = 1; }, /evidence_coverage/);
  test("rounding outside tolerance rejected", full, (r) => { r.scorecards[0].weighted_score += 2e-6; }, /weighted_score/);
  test("partial evidence must be provisional", partial, (r) => { r.scorecards[0].provisional = false; }, /provisional/);
  test("one unknown forces provisional even above 50% coverage", full, (r) => {
    Object.assign(r.scorecards[0].dimensions[0], { state: "insufficient_evidence", score: null, evidence_ids: [] });
    recompute(r);
  }, /provisional/);
  test("unknown score cannot be numeric", partial, (r) => { r.scorecards[0].dimensions[1].score = 0; }, /null/);
  test("scored state cannot have null", partial, (r) => { r.scorecards[0].dimensions[0].score = null; }, /integer/);
  test("fractional dimension score rejected", partial, (r) => { r.scorecards[0].dimensions[0].score = 3.5; }, /integer/);
  test("user statement is not verified observed evidence", partial, (r) => { r.evidence[0].evidence_type = "user_claim"; }, /observed evidence/);
  test("inference alone cannot earn a score", partial, (r) => { r.evidence[0].evidence_type = "inference"; }, /observed evidence/);
  test("null evidence URL is invalid for public primary", partial, (r) => { r.evidence[0].evidence_type = "primary_current"; }, /string/);
  test("HTTP evidence URL rejected", partial, (r) => { r.evidence[0].source_url = "http://example.org/proof"; }, /uri|pattern|schema/);
  test("evidence source must exist in registry", partial, (r) => { r.evidence[0].source_id = "invented"; }, /unknown source_id/);
  test("checked source must exist in registry", partial, (r) => { r.sources_checked[0].source_id = "invented"; }, /unknown source_id/);
  test("checked vs unavailable conflict rejected", partial, (r) => {
    r.sources_not_checked.push({ source_id: "user_artifacts", status: "unavailable", note: "Conflicts with checked status." });
  }, /conflicting or repeated/);
  test("no-evidence-found cannot supply evidence", partial, (r) => { r.sources_checked[0].status = "no_evidence_found"; }, /checked status/);
  test("checked source cannot appear in not-checked list", partial, (r) => { r.sources_not_checked = [r.sources_checked.pop()]; }, /allowed values|enum/);
  test("evidence requires an actual source check", partial, (r) => { r.sources_checked = []; }, /checked status/);
  test("evaluator snapshot required", partial, (r) => { delete r.run.evaluation_snapshot; }, /evaluation_snapshot/);
  test("evaluator scorecards required", partial, (r) => { delete r.scorecards; }, /scorecards/);
  test("evaluator scorecards cannot be empty", partial, (r) => { r.scorecards = []; }, /item/);
  test("snapshot source allowlist enforced", partial, (r) => { r.run.evaluation_snapshot.allowed_source_ids = []; }, /allowed_source_ids/);
  test("snapshot source must exist in registry", partial, (r) => { r.run.evaluation_snapshot.allowed_source_ids.push("invented"); }, /unknown source_id/);
  test("evidence after cutoff rejected", partial, (r) => { r.evidence[0].retrieved_at = "2026-09-05T09:30:00Z"; }, /after evidence_cutoff/);
  test("cutoff after generation rejected", partial, (r) => { r.run.evaluation_snapshot.evidence_cutoff = "2026-09-05T11:00:00Z"; }, /after generated_at/);
  const timestampCases = [
    {
      name: "retrieval one microsecond after cutoff rejected",
      generated: "2026-09-05T08:00:00.123458Z", cutoff: "2026-09-05T08:00:00.123456Z", retrieved: "2026-09-05T08:00:00.123457Z",
      error: /retrieved after evidence_cutoff/
    },
    {
      name: "cutoff one microsecond after generation rejected",
      generated: "2026-09-05T08:00:00.123456Z", cutoff: "2026-09-05T08:00:00.123457Z", retrieved: "2026-09-05T08:00:00.123455Z",
      error: /evidence_cutoff is after generated_at/
    },
    {
      name: "retrieval one microsecond after generation rejected",
      generated: "2026-09-05T08:00:00.123456Z", cutoff: "2026-09-05T08:00:00.123455Z", retrieved: "2026-09-05T08:00:00.123457Z",
      error: /retrieved after generated_at/
    },
    {
      name: "millisecond-late retrieval remains rejected",
      generated: "2026-09-05T08:00:00.125Z", cutoff: "2026-09-05T08:00:00.123Z", retrieved: "2026-09-05T08:00:00.124Z",
      error: /retrieved after evidence_cutoff/
    },
    {
      name: "long fraction preserves a difference beyond numeric precision",
      generated: "2026-09-05T08:00:00.123456789012345678901234567892Z", cutoff: "2026-09-05T08:00:00.123456789012345678901234567890Z", retrieved: "2026-09-05T08:00:00.123456789012345678901234567891Z",
      error: /retrieved after evidence_cutoff/
    },
    {
      name: "equal instants accept timezone offsets and trailing fractional zeroes",
      generated: "2026-09-05T13:00:00.123456+05:00", cutoff: "2026-09-05T03:00:00.1234560-05:00", retrieved: "2026-09-05T08:00:00.123456000Z"
    },
    {
      name: "equal whole seconds accept missing and zero fractions",
      generated: "2026-09-05T08:00:00Z", cutoff: "2026-09-05T08:00:00.000Z", retrieved: "2026-09-05T08:00:00.000000Z"
    },
    {
      name: "equal long fractions remain accepted",
      generated: "2026-09-05T08:00:00.12345678901234567890123456789Z", cutoff: "2026-09-05T08:00:00.123456789012345678901234567890Z", retrieved: "2026-09-05T08:00:00.12345678901234567890123456789000Z"
    },
    {
      name: "timezone normalization preserves equality across calendar days",
      generated: "2026-09-05T00:00:00.123456Z", cutoff: "2026-09-04T19:00:00.123456-05:00", retrieved: "2026-09-05T05:30:00.12345600+05:30"
    },
    {
      name: "whole-second ordering dominates fractional ordering",
      generated: "2026-09-05T08:00:01.000000Z", cutoff: "2026-09-05T08:00:00.999999Z", retrieved: "2026-09-05T08:00:00.999998Z"
    },
    {
      name: "precise boundaries work before the Unix epoch",
      generated: "1969-12-31T23:59:59.123458Z", cutoff: "1969-12-31T23:59:59.123456Z", retrieved: "1969-12-31T23:59:59.123455Z"
    },
    {
      name: "year zero leap-day remains valid",
      generated: "0000-02-29T08:00:00.123458Z", cutoff: "0000-02-29T08:00:00.123456Z", retrieved: "0000-02-29T08:00:00.123455Z"
    }
  ].map(({ name, generated, cutoff, retrieved, error }) => ({
    name,
    error,
    response: test(name, partial, (r) => {
      r.run.generated_at = generated;
      r.run.evaluation_snapshot.evidence_cutoff = cutoff;
      r.evidence[0].retrieved_at = retrieved;
    }, error)
  }));
  test("invalid calendar date rejected", partial, (r) => { r.evidence[0].retrieved_at = "2026-02-30T08:00:00Z"; }, /date-time/);
  test("ambiguous timestamp without timezone rejected", partial, (r) => { r.evidence[0].retrieved_at = "2026-09-05T08:00:00"; }, /date-time/);
  for (const timestamp of ["1900-02-29T08:00:00Z", "2026-00-01T08:00:00Z", "2026-13-01T08:00:00Z", "2026-09-00T08:00:00Z", "2026-09-05T24:00:00Z", "2026-09-05T08:60:00Z", "2026-09-05T08:00:60Z", "2026-09-05T08:00:00+24:00", "2026-09-05T08:00:00+05:60"]) {
    test(`invalid timestamp ${timestamp} rejected`, partial, (r) => { r.evidence[0].retrieved_at = timestamp; }, /date-time/);
  }
  test("verified user artifact must be pinned in evaluator", partial, (r) => { delete r.evidence[0].artifact_ref; }, /requires artifact_ref/);
  test("artifact reference must exist in snapshot", partial, (r) => { r.evidence[0].artifact_ref = "missing"; }, /unknown artifact_ref/);
  test("artifact identity must be unique", partial, (r) => { r.run.evaluation_snapshot.artifacts.push(structuredClone(r.run.evaluation_snapshot.artifacts[0])); }, /Duplicate artifact id/);
  test("artifact version cannot be empty", partial, (r) => { r.run.evaluation_snapshot.artifacts[0].version = ""; }, /character/);
  test("blocking-check array required", coach, (r) => { delete r.blocking_checks; }, /blocking_checks/);
  test("legacy unscoped decision rejected", coach, (r) => { r.recommendation.decision = "apply_now"; }, /allowed values|enum/);
  test("decision target required", coach, (r) => { delete r.recommendation.target; }, /target/);
  test("artifact cannot grant permission to proceed", coach, (r) => { r.recommendation.target = "artifact"; }, /allowed values|enum/);
  test("complete cannot stand for applying", coach, (r) => { r.recommendation.target = "apply"; r.recommendation.decision = "complete"; }, /constant/);
  test("high score cannot override failed eligibility", ineligible, (r) => { r.recommendation.decision = "proceed"; }, /Cannot proceed/);
  test("unknown eligibility blocks applying", eligible, (r) => { r.blocking_checks[0].status = "unknown"; }, /Cannot proceed/);
  test("apply needs explicit eligibility and materials checks", eligible, (r) => { r.blocking_checks = []; }, /program_eligibility|required_materials/);
  test("required-materials gate cannot be omitted", eligible, (r) => { r.blocking_checks.pop(); }, /required_materials/);
  test("wrong-target eligibility gate cannot authorize apply", eligible, (r) => { r.blocking_checks[0].target = "build"; }, /program_eligibility/);
  test("passed gate needs evidence", eligible, (r) => { r.blocking_checks[0].evidence_ids = []; }, /evidence_ids|item/);
  test("passed gate cannot rely only on user claim", eligible, (r) => {
    r.evidence[0].evidence_type = "user_claim";
    r.blocking_checks[0].evidence_ids = ["observed_packet"];
  }, /Passed blocking check.*observed evidence/);
  for (const type of ["primary_historical", "secondary"]) {
    test(`${type} alone cannot pass current gate`, eligible, (r) => {
      r.evidence[1].evidence_type = type;
      r.blocking_checks[0].evidence_ids = ["official_fixture_rules"];
    }, /Passed blocking check.*current supporting/);
  }
  for (const stance of ["neutral", "contradicts"]) {
    test(`${stance} evidence alone cannot pass gate`, eligible, (r) => {
      r.evidence[1].stance = stance;
      r.blocking_checks[0].evidence_ids = ["official_fixture_rules"];
    }, /Passed blocking check.*current supporting/);
  }
  test("failed gate cannot turn absence into incompatibility", ineligible, (r) => {
    r.blocking_checks[0].evidence_ids = [];
  }, /Failed blocking check.*use unknown/);
  test("failed gate cannot rely only on an unverified assertion", ineligible, (r) => {
    r.evidence[0].evidence_type = "user_claim";
    r.blocking_checks[0].evidence_ids = ["observed_packet"];
  }, /Failed blocking check/);
  test("contradictory observed evidence may support a failed condition", ineligible, (r) => {
    r.evidence[0].stance = "contradicts";
    r.blocking_checks[0].evidence_ids = ["observed_packet"];
  });
  test("gate evidence reference must exist", eligible, (r) => { r.blocking_checks[0].evidence_ids = ["invented"]; }, /unknown evidence_id/);
  test("gate identity must be unique", eligible, (r) => { r.blocking_checks.push(structuredClone(r.blocking_checks[0])); }, /Duplicate blocking check/);
  test("unknown matching blocker requires provisional", full, (r) => {
    r.recommendation.decision = "pause";
    r.blocking_checks.push({ id: "test_access", target: "test", requirement: "Confirm access.", status: "unknown", evidence_ids: [] });
  }, /provisional/);

  // A framework article can inform a method, but cannot alone establish this project's quality.
  const methodSources = structuredClone(sources);
  methodSources.sources.find((source) => source.id === "user_artifacts").source_roles = ["methodology"];
  const methodErrors = createResponseValidator({ schema, rubrics, sources: methodSources })(partial);
  assert.match(methodErrors.join("; "), /methodology-only/);
  count++;

  // Validate actual JSON files through the co-installed portable command, including its failure status.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-response-test-"));
  try {
    const command = path.join(root, "skills/proofpilot/scripts/validate-response.js");
    const inputPath = path.join(temporary, "response.json");
    for (const [response, expectedStatus] of [[partial, 0], [{ ...partial, blocking_checks: undefined }, 1]]) {
      fs.writeFileSync(inputPath, JSON.stringify(response));
      const result = spawnSync(process.execPath, [command, inputPath], { encoding: "utf8" });
      assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
      count++;
    }
    const invalidRequest = structuredClone(withRequest);
    invalidRequest.credential_requests[0].credential_class = "oauth";
    for (const [response, expectedStatus] of [[withRequest, 0], [invalidRequest, 1]]) {
      fs.writeFileSync(inputPath, JSON.stringify(response));
      const result = spawnSync(process.execPath, [command, inputPath], { encoding: "utf8" });
      assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
      if (expectedStatus === 1) assert.match(result.stderr, /credential_class must be api_token/);
      count++;
    }
    for (const { name, response, error } of timestampCases) {
      fs.writeFileSync(inputPath, JSON.stringify(response));
      const result = spawnSync(process.execPath, [command, inputPath], { cwd: temporary, encoding: "utf8" });
      assert.equal(result.status, error ? 1 : 0, `${name}: ${result.stderr || result.stdout}`);
      if (error) assert.match(result.stderr, error, name);
      else assert.match(result.stdout, /response validation passed/, name);
      count++;
    }
    fs.writeFileSync(inputPath, "{broken");
    assert.equal(spawnSync(process.execPath, [command, inputPath], { encoding: "utf8" }).status, 1);
    count++;
    const linkedCommand = path.join(temporary, "linked-validator.js");
    fs.symlinkSync(command, linkedCommand);
    for (const [response, expectedStatus] of [[partial, 0], [{ ...partial, blocking_checks: undefined }, 1]]) {
      fs.writeFileSync(inputPath, JSON.stringify(response));
      const result = spawnSync(process.execPath, [linkedCommand, inputPath], { cwd: os.tmpdir(), encoding: "utf8" });
      assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
      assert.ok((result.stdout + result.stderr).trim(), "Symlink entrypoint must actually run validation");
      count++;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return { cases: count };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const result = runResponseTests();
  console.log(`ProofPilot response contract tests passed: ${result.cases} cases.`);
}
