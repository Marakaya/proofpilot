import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { isDate, isHttpsUrl, validateFreshnessSemantics } from "./freshness.js";
import { renderToolDocs } from "./tool-docs.js";

import { isDateTime } from "../skills/proofpilot/scripts/validate-response.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const references = path.join(root, "skills", "proofpilot", "references");
const readJson = (filename) => JSON.parse(fs.readFileSync(path.join(references, filename), "utf8"));
function createValidators() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("date", isDate);
  ajv.addFormat("date-time", isDateTime);
  ajv.addFormat("uri", isHttpsUrl);
  const toolSchema = readJson("tool-registry.schema.json");
  const sourceSchema = readJson("source-registry.schema.json");
  const schemas = {
    tool: ajv.compile(toolSchema),
    source: ajv.compile(sourceSchema),
    // Programs have no dedicated schema. Validate their metadata against the
    // same canonical definitions instead of maintaining a separate copy here.
    metadata: ajv.compile({
      type: "object",
      required: ["id", "last_verified_at", "verification", "freshness_review"],
      properties: {
        id: { $ref: "#/$defs/id" },
        last_verified_at: { $ref: "#/$defs/nullableDate" },
        verification: { $ref: "#/$defs/verification" },
        freshness_review: { $ref: "#/$defs/freshnessReview" },
        reference_checks: { $ref: "#/$defs/referenceChecks" },
        runtime_probes: { $ref: "#/$defs/runtimeProbes" }
      },
      $defs: toolSchema.$defs
    })
  };
  const schemaErrors = (validate, value) => validate(value) ? [] : validate.errors.map(
    (error) => `${error.instancePath || "/"} ${error.message}`
  );
  return {
    registry(data, kind) {
      return schemaErrors(schemas[kind], data);
    },
    entry(entry, kind) {
      const structural = schemaErrors(schemas.metadata, entry);
      return structural.length ? structural : validateFreshnessSemantics(entry, { kind });
    }
  };
}

function documentFixture() {
  return {
    id: "fixture_documentation",
    last_verified_at: "2026-09-05",
    freshness_review: {
      checked_at: "2026-09-05",
      availability: "reachable",
      content_status: "confirmed",
      limitations: ["Documentation review only; no adapter executed."]
    },
    reference_checks: [{
      url: "https://example.test/docs",
      published_at: "2025-02-12",
      checked_at: "2026-09-05",
      claim_scope: "Documents a public read endpoint; operation was not executed."
    }],
    verification: {
      scope: "official_documentation",
      claims: "Official endpoint description inspected.",
      api_runtime_status: "not_tested"
    },
    capabilities: [{ id: "read", status: "connector_spec" }]
  };
}

function liveFixture(checkedAt = "2026-09-05T12:34:56Z") {
  const entry = documentFixture();
  entry.verification = {
    scope: "live_api",
    claims: "One anonymous public GET returned metadata.",
    api_runtime_status: "verified"
  };
  entry.runtime_probes = [{
    url: "https://example.test/api/public/one",
    method: "GET",
    checked_at: checkedAt,
    http_status: 200,
    observation: "Received the expected public resource identifier.",
    scope_limit: "One public read only; no authentication, writes, or installed adapter tested."
  }];
  return entry;
}

export function runFreshnessTests({ checkRegistries = true } = {}) {
  const validate = createValidators();
  let cases = 0;
  const expect = (name, entry, valid, kind = "tool") => {
    const before = structuredClone(entry);
    const errors = validate.entry(entry, kind);
    assert.equal(errors.length === 0, valid, `${name}: ${errors.join("; ") || "unexpectedly accepted"}`);
    assert.deepEqual(entry, before, `${name}: validation must not alter evidence or capability statuses`);
    cases += 1;
  };

  expect("documentation review is valid without runtime", documentFixture(), true);
  const bumpedDates = documentFixture();
  bumpedDates.last_verified_at = "2027-01-02";
  bumpedDates.freshness_review.checked_at = "2027-01-02";
  bumpedDates.reference_checks[0].checked_at = "2027-01-02";
  expect("new review dates keep untested connector valid", bumpedDates, true);
  assert.equal(bumpedDates.verification.api_runtime_status, "not_tested");
  assert.equal(bumpedDates.capabilities[0].status, "connector_spec");
  bumpedDates.verification.scope = "live_api";
  bumpedDates.verification.api_runtime_status = "verified";
  expect("bumped dates cannot substitute for runtime evidence", bumpedDates, false);

  const onlyStatus = documentFixture();
  onlyStatus.verification.api_runtime_status = "verified";
  expect("verified status cannot be attached to documentation scope", onlyStatus, false);
  const onlyScope = documentFixture();
  onlyScope.verification.scope = "live_api";
  expect("live API scope requires verified status and probe", onlyScope, false);
  expect("bounded public GET with exact timestamp", liveFixture(), true);
  expect("honest date-only probe without invented UTC time", liveFixture("2026-09-05"), true);
  const migrated = liveFixture();
  migrated.verification.runtime_api_base = "https://example.test/api/v2";
  migrated.runtime_probes[0].url = "https://example.test/api/v1/status";
  expect("historical API version cannot verify the current contract", migrated, false);
  migrated.runtime_probes[0].url = "https://example.test/api/v20/status";
  expect("API prefix lookalikes cannot verify the current contract", migrated, false);
  migrated.runtime_probes[0].url = "https://example.test/api/v2/status";
  expect("bounded current-version probe can support its declared API scope", migrated, true);
  const colosseum = readJson("tool-registry.json").tools.find(tool => tool.id === "colosseum_copilot");
  const promoted = structuredClone(colosseum);
  Object.assign(promoted.verification, { scope: "live_api", api_runtime_status: "verified" });
  expect("preserved V1 Colosseum probes never verify V2", promoted, false);
  const row = renderToolDocs({ sources: [], tools: [colosseum] }).split("\n").find(line => line.startsWith("| Colosseum Copilot |"));
  assert.ok(row.includes("not_tested") && row.includes("2026-09-05") && row.includes("/api/v1/"));
  cases++;
  assert.equal(liveFixture().capabilities[0].status, "connector_spec");

  for (const [name, patch] of [
    ["redirect is not a successful API result", { http_status: 301 }],
    ["authorization failure is not a successful API result", { http_status: 401 }],
    ["rate limit is not a successful API result", { http_status: 429 }],
    ["server error is not a successful API result", { http_status: 503 }],
    ["POST is outside read-only probe scope", { method: "POST" }],
    ["missing observation does not establish a result", { observation: "" }],
    ["blank scope limit cannot support a broad claim", { scope_limit: "   " }],
    ["invalid calendar date is rejected", { checked_at: "2026-02-30" }]
  ]) {
    const fixture = liveFixture();
    Object.assign(fixture.runtime_probes[0], patch);
    expect(name, fixture, false);
  }

  const noScope = liveFixture();
  delete noScope.runtime_probes[0].scope_limit;
  expect("probe must record its scope limit", noScope, false);
  const nullPublication = documentFixture();
  nullPublication.reference_checks[0].published_at = null;
  expect("unknown publication date remains explicitly null", nullPublication, true);
  const missingPublication = documentFixture();
  delete missingPublication.reference_checks[0].published_at;
  expect("publication and retrieval dates are separate required fields", missingPublication, false);
  const missingReview = documentFixture();
  delete missingReview.freshness_review;
  expect("catalog date alone is insufficient review metadata", missingReview, false);
  const noReferences = documentFixture();
  delete noReferences.reference_checks;
  expect("concrete source must have scoped references", noReferences, false, "source");

  const selectedAtRuntime = documentFixture();
  selectedAtRuntime.id = "fixture_runtime_selected";
  selectedAtRuntime.status = "runtime_input";
  selectedAtRuntime.last_verified_at = null;
  selectedAtRuntime.verification.scope = "runtime_required";
  selectedAtRuntime.freshness_review.availability = "runtime_selected";
  selectedAtRuntime.freshness_review.content_status = "runtime_required";
  delete selectedAtRuntime.reference_checks;
  expect("unselected runtime source has no fabricated verification date", selectedAtRuntime, true, "source");
  selectedAtRuntime.last_verified_at = "2026-09-05";
  expect("catalog review cannot verify an unselected runtime source", selectedAtRuntime, false, "source");
  selectedAtRuntime.last_verified_at = null;
  selectedAtRuntime.freshness_review.content_status = "confirmed";
  expect("runtime-required content cannot silently become confirmed", selectedAtRuntime, false, "source");

  const counts = { tools: 0, sources: 0, programs: 0 };
  if (checkRegistries) {
    for (const [filename, key, kind] of [
      ["tool-registry.json", "tools", "tool"],
      ["source-registry.json", "sources", "source"],
      ["accelerator-programs.json", "programs", "program"]
    ]) {
      const data = readJson(filename);
      if (kind !== "program") {
        assert.deepEqual(validate.registry(data, kind), [], `${filename} failed its canonical Ajv schema`);
      }
      for (const entry of data[key]) {
        const errors = validate.entry(entry, kind);
        assert.deepEqual(errors, [], `${filename}/${entry.id}: ${errors.join("; ")}`);
      }
      counts[key] = data[key].length;
    }
  }
  return { cases, ...counts };
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const summary = runFreshnessTests();
  console.log(`Freshness tests passed: ${summary.cases} cases; ${summary.tools} tools, ${summary.sources} sources, ${summary.programs} programs.`);
}
