#!/usr/bin/env node
// Portable response validation for an installed skill; uses only Node built-ins.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCORE_TOLERANCE = 1e-6;
const asArray = (value) => Array.isArray(value) ? value : [];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const verifiedTypes = new Set(["user_verified", "primary_current", "primary_historical", "secondary"]);

function parseDateTime(value) {
  if (typeof value !== "string") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone, offsetHourText = "0", offsetMinuteText = "0"] = parts;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59)) return null;
  // Date supplies timezone normalization for whole seconds only. Keeping the
  // original fractional digits prevents millisecond truncation at frozen cutoffs.
  const seconds = Date.parse(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${zone}`) / 1000;
  if (!Number.isFinite(seconds)) return null;
  return { seconds, fraction: fraction.replace(/0+$/, "") };
}

export function isDateTime(value) {
  return parseDateTime(value) !== null;
}

function isAfterDateTime(value, boundary) {
  const left = parseDateTime(value);
  const right = parseDateTime(boundary);
  if (!left || !right) return false; // Invalid inputs receive their own diagnostic.
  if (left.seconds !== right.seconds) return left.seconds > right.seconds;
  const length = Math.max(left.fraction.length, right.fraction.length);
  return left.fraction.padEnd(length, "0") > right.fraction.padEnd(length, "0");
}

function isHttps(value) {
  try { return typeof value === "string" && value.startsWith("https://") && new URL(value).protocol === "https:"; }
  catch { return false; }
}

/** Checks the JSON Schema vocabulary used by response.schema.json, without dependencies.
 * Repository validation additionally uses Ajv as the full JSON Schema implementation.
 */
export function validateResponseStructure(response, schema) {
  const errors = [];
  const supported = new Set(["$schema", "$id", "$ref", "$defs", "title", "description", "type", "const", "enum", "anyOf", "allOf", "if", "then", "else", "required", "properties", "additionalProperties", "items", "minItems", "maxItems", "uniqueItems", "minLength", "pattern", "format", "minimum", "maximum"]);
  function visit(value, rule, location, output) {
    for (const key of Object.keys(rule)) {
      if (!supported.has(key)) throw new Error(`Unsupported response-schema keyword: ${key}`);
    }
    const error = (message) => output.push(`${location || "/"}: ${message}`);
    if (rule.$ref) {
      if (!rule.$ref.startsWith("#/")) throw new Error(`Unsupported external reference: ${rule.$ref}`);
      const resolved = rule.$ref.slice(2).split("/").reduce((node, key) => node?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], schema);
      if (!resolved) throw new Error(`Unresolved schema reference: ${rule.$ref}`);
      visit(value, resolved, location, output);
    }
    if (rule.type) {
      const matches = rule.type === "null" ? value === null :
        rule.type === "object" ? isObject(value) :
        rule.type === "array" ? Array.isArray(value) :
        rule.type === "integer" ? Number.isInteger(value) :
        rule.type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === rule.type;
      if (!matches) { error(`must be ${rule.type}`); return; }
    }
    if (Object.hasOwn(rule, "const") && value !== rule.const) error(`must equal ${JSON.stringify(rule.const)}`);
    if (rule.enum && !rule.enum.includes(value)) error(`must be one of ${rule.enum.join(", ")}`);
    if (rule.anyOf && !rule.anyOf.some((branch) => { const result = []; visit(value, branch, location, result); return result.length === 0; })) error("must match an allowed schema");
    for (const branch of rule.allOf ?? []) visit(value, branch, location, output);
    if (rule.if) {
      const result = [];
      visit(value, rule.if, location, result);
      const branch = result.length ? rule.else : rule.then;
      if (branch) visit(value, branch, location, output);
    }
    if (isObject(value)) {
      for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) error(`missing required property ${key}`);
      for (const [key, item] of Object.entries(value)) {
        if (rule.properties && Object.hasOwn(rule.properties, key)) visit(item, rule.properties[key], `${location}/${key}`, output);
        else if (rule.additionalProperties === false) error(`unexpected property ${key}`);
      }
    }
    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems) error(`requires at least ${rule.minItems} item(s)`);
      if (rule.maxItems !== undefined && value.length > rule.maxItems) error(`allows at most ${rule.maxItems} item(s)`);
      if (rule.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) error("items must be unique");
      if (rule.items) value.forEach((item, index) => visit(item, rule.items, `${location}/${index}`, output));
    }
    if (typeof value === "string") {
      if (rule.minLength !== undefined && [...value].length < rule.minLength) error(`requires at least ${rule.minLength} character(s)`);
      if (rule.pattern && !new RegExp(rule.pattern).test(value)) error(`must match ${rule.pattern}`);
      if (rule.format === "date-time" && !isDateTime(value)) error("must be a valid date-time with a timezone");
      if (rule.format === "uri" && !isHttps(value)) error("must be an absolute HTTPS URL");
    }
    if (typeof value === "number") {
      if (rule.minimum !== undefined && value < rule.minimum) error(`must be >= ${rule.minimum}`);
      if (rule.maximum !== undefined && value > rule.maximum) error(`must be <= ${rule.maximum}`);
    }
  }
  visit(response, schema, "", errors);
  return errors;
}

/** Normalize only scored weights; keep missing evidence visible in coverage. */
export function calculateScorecard(card, rubric) {
  const dimensions = new Map(asArray(card.dimensions).map((dimension) => [dimension.dimension_id, dimension]));
  let applicableWeight = 0;
  let scoredWeight = 0;
  let weightedTotal = 0;
  for (const dimension of rubric.dimensions) {
    const finding = dimensions.get(dimension.id);
    if (finding?.state === "not_applicable") continue;
    applicableWeight += dimension.weight;
    if (finding?.state === "scored" && Number.isInteger(finding.score)) {
      scoredWeight += dimension.weight;
      weightedTotal += dimension.weight * finding.score;
    }
  }
  return {
    weighted_score: scoredWeight > 0 ? weightedTotal / scoredWeight : null,
    evidence_coverage: applicableWeight > 0 ? scoredWeight / applicableWeight : 0
  };
}

/** Pure semantic validation. Supply the versioned rubric, source, tool, and credential registries.
 * This checks consistency, not whether natural-language claims are true or relevant.
 */
export function validateResponseSemantics(response, { rubrics, sources, tools, credentials }) {
  const errors = [];
  if (!isObject(response)) return ["Response must be an object"];
  const evidence = asArray(response.evidence);
  const checks = asArray(response.blocking_checks);
  const cards = asArray(response.scorecards);
  const sourceIds = new Set(asArray(sources?.sources).map((source) => source.id));
  const sourceMap = new Map(asArray(sources?.sources).map((source) => [source.id, source]));
  const rubricMap = new Map(asArray(rubrics?.rubrics).map((rubric) => [rubric.id, rubric]));
  const toolMap = new Map(asArray(tools?.tools).map((tool) => [tool.id, tool]));
  const credentialClasses = new Set(asArray(credentials?.credential_classes).map((credential) => credential.id));
  const evidenceMap = new Map(evidence.map((item) => [item?.id, item]));
  const recommendation = response.recommendation ?? {};
  const snapshot = response.run?.evaluation_snapshot;
  const evaluator = response.run?.mode === "evaluator";
  const allowedSources = new Set(asArray(snapshot?.allowed_source_ids));
  const artifactIds = new Set(asArray(snapshot?.artifacts).map((artifact) => artifact.id));
  function unique(items, key, label) {
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item?.[key])) errors.push(`Duplicate ${label}: ${item?.[key]}`);
      seen.add(item?.[key]);
    }
  }
  function knownSource(id, label) {
    if (!sourceIds.has(id)) errors.push(`${label}: unknown source_id ${id}`);
  }
  function evidenceReferences(ids, label) {
    if (new Set(asArray(ids)).size !== asArray(ids).length) errors.push(`${label}: duplicate evidence_ids`);
    for (const id of asArray(ids)) if (!evidenceMap.has(id)) errors.push(`${label}: unknown evidence_id ${id}`);
  }
  function hasObservedEvidence(ids) {
    return asArray(ids).some((id) => {
      const item = evidenceMap.get(id);
      const roles = asArray(sourceMap.get(item?.source_id)?.source_roles);
      const methodologyOnly = roles.length > 0 && roles.every((role) => role === "methodology");
      return verifiedTypes.has(item?.evidence_type) && !methodologyOnly;
    });
  }
  function hasCurrentGateEvidence(ids, passed) {
    return asArray(ids).some((id) => {
      const item = evidenceMap.get(id);
      const roles = asArray(sourceMap.get(item?.source_id)?.source_roles);
      const methodologyOnly = roles.length > 0 && roles.every((role) => role === "methodology");
      return ["user_verified", "primary_current"].includes(item?.evidence_type) &&
        !methodologyOnly && (passed ? item.stance === "supports" : ["supports", "contradicts"].includes(item.stance));
    });
  }
  unique(evidence, "id", "evidence id");
  unique(checks, "id", "blocking check id");
  unique(cards, "rubric_id", "scorecard rubric id");
  unique(asArray(response.directions), "id", "direction id");
  unique(asArray(response.next_actions), "order", "next action order");
  unique(asArray(snapshot?.artifacts), "id", "artifact id");
  // A matching request describes setup only; it neither proves implementation nor authorizes execution.
  const requestedCapabilities = new Set();
  for (const request of asArray(response.credential_requests)) {
    const label = `Credential request ${request?.tool_id}.${request?.capability_id}`;
    const key = JSON.stringify([request?.tool_id, request?.capability_id]);
    if (requestedCapabilities.has(key)) errors.push(`${label}: duplicate tool/capability request`);
    requestedCapabilities.add(key);
    if (!credentialClasses.has(request?.credential_class)) errors.push(`${label}: unknown credential_class ${request?.credential_class}`);
    const tool = toolMap.get(request?.tool_id);
    if (!tool) { errors.push(`${label}: unknown tool_id ${request?.tool_id}`); continue; }
    const capability = asArray(tool.capabilities).find((item) => item.id === request?.capability_id);
    if (!capability) { errors.push(`${label}: unknown capability_id ${request?.capability_id} for tool ${tool.id}`); continue; }
    if (request.credential_class !== capability.credential_class) errors.push(`${label}: credential_class must be ${capability.credential_class}, not ${request.credential_class}`);
  }
  const sourceChecks = [...asArray(response.sources_checked), ...asArray(response.sources_not_checked)];
  unique(sourceChecks, "source_id", "source check id (conflicting or repeated status)");
  const sourceStatus = new Map(sourceChecks.map((check) => [check?.source_id, check?.status]));
  for (const source of sourceChecks) knownSource(source?.source_id, "Source check");
  for (const source of asArray(response.sources_checked)) {
    if (!["checked", "no_evidence_found"].includes(source?.status)) errors.push(`sources_checked: invalid status for ${source?.source_id}`);
    if (evaluator && !allowedSources.has(source?.source_id)) errors.push(`Checked source ${source?.source_id} is outside evaluation_snapshot.allowed_source_ids`);
  }
  for (const source of asArray(response.sources_not_checked)) {
    if (!["not_checked", "unavailable"].includes(source?.status)) errors.push(`sources_not_checked: invalid status for ${source?.source_id}`);
  }
  if (evaluator && !snapshot) errors.push("Evaluator requires run.evaluation_snapshot");
  if (evaluator && cards.length === 0) errors.push("Evaluator requires at least one scorecard");
  if (snapshot) {
    for (const id of allowedSources) knownSource(id, "Evaluation snapshot");
    if (new Set(asArray(snapshot.allowed_source_ids)).size !== asArray(snapshot.allowed_source_ids).length) errors.push("Evaluation snapshot has duplicate allowed_source_ids");
    if (!isDateTime(snapshot.evidence_cutoff)) errors.push("Evaluation snapshot has an invalid evidence_cutoff");
    if (isAfterDateTime(snapshot.evidence_cutoff, response.run?.generated_at)) errors.push("Evaluation evidence_cutoff is after generated_at");
  }
  if (!isDateTime(response.run?.generated_at)) errors.push("Run has an invalid generated_at");
  for (const item of evidence) {
    knownSource(item?.source_id, `Evidence ${item?.id}`);
    if (sourceStatus.get(item?.source_id) !== "checked") errors.push(`Evidence ${item?.id} requires source ${item?.source_id} to have checked status`);
    if (["primary_current", "primary_historical", "secondary"].includes(item?.evidence_type) && !isHttps(item?.source_url)) errors.push(`Evidence ${item?.id} requires an HTTPS source_url`);
    if (!isDateTime(item?.retrieved_at)) errors.push(`Evidence ${item?.id} has an invalid retrieved_at`);
    if (isAfterDateTime(item?.retrieved_at, response.run?.generated_at)) errors.push(`Evidence ${item?.id} was retrieved after generated_at`);
    if (evaluator && !allowedSources.has(item?.source_id)) errors.push(`Evidence ${item?.id} uses a source outside evaluation_snapshot.allowed_source_ids`);
    if (evaluator && isAfterDateTime(item?.retrieved_at, snapshot?.evidence_cutoff)) errors.push(`Evidence ${item?.id} was retrieved after evidence_cutoff`);
    if (evaluator && item?.evidence_type === "user_verified" && !item.artifact_ref) errors.push(`Evaluator user_verified evidence ${item.id} requires artifact_ref in the evaluation snapshot`);
    if (snapshot && item?.artifact_ref && !artifactIds.has(item.artifact_ref)) errors.push(`Evidence ${item.id} has unknown artifact_ref ${item.artifact_ref}`);
  }
  if (!["test", "build", "apply", "artifact"].includes(recommendation.target)) errors.push("Recommendation has an invalid target");
  if (!["proceed", "revise", "pause", "stop", "complete"].includes(recommendation.decision)) errors.push("Recommendation has an invalid decision");
  if (recommendation.decision === "complete" && recommendation.target !== "artifact") errors.push("complete is only valid for target artifact");
  if (recommendation.target === "artifact" && recommendation.decision === "proceed") errors.push("An artifact cannot imply proceed; use complete for a finished draft");
  for (const check of checks) {
    evidenceReferences(check?.evidence_ids, `Blocking check ${check?.id}`);
    if (check?.status === "passed" && !hasCurrentGateEvidence(check.evidence_ids, true)) errors.push(`Passed blocking check ${check.id} requires current supporting observed evidence, not only claims, inference, historical, secondary, neutral, contrary, or methodology-only sources`);
    if (check?.status === "failed" && !hasCurrentGateEvidence(check.evidence_ids, false)) errors.push(`Failed blocking check ${check.id} requires current observed evidence of incompatibility; use unknown for an unchecked condition`);
    if (recommendation.decision === "proceed" && check?.target === recommendation.target && check?.status !== "passed") errors.push(`Cannot proceed with ${recommendation.target}: blocking check ${check?.id} is ${check?.status}`);
  }
  if (recommendation.target === "build" && recommendation.decision === "proceed" && !checks.some(check => check?.target === "build")) {
    errors.push("build/proceed requires at least one build blocking check with evidence");
  }
  if (recommendation.target === "apply" && recommendation.decision === "proceed") {
    for (const id of ["program_eligibility", "required_materials"]) {
      if (!checks.some((check) => check?.id === id && check?.target === "apply" && check?.status === "passed" && asArray(check.evidence_ids).length)) errors.push(`apply/proceed requires passed ${id} with evidence`);
    }
  }
  const unknownBlocker = checks.some((check) => check?.target === recommendation.target && check?.status === "unknown");
  for (const card of cards) {
    const rubric = rubricMap.get(card?.rubric_id);
    if (!rubric) { errors.push(`Unknown rubric_id ${card?.rubric_id}`); continue; }
    if (card.rubric_version !== rubrics.version) errors.push(`Scorecard ${card.rubric_id} rubric_version must be ${rubrics.version}`);
    const dimensions = asArray(card.dimensions);
    unique(dimensions, "dimension_id", `dimension in ${card.rubric_id}`);
    const expectedIds = new Set(rubric.dimensions.map((dimension) => dimension.id));
    for (const expected of expectedIds) if (!dimensions.some((dimension) => dimension?.dimension_id === expected)) errors.push(`Scorecard ${card.rubric_id} is missing dimension ${expected}`);
    for (const dimension of dimensions) {
      if (!expectedIds.has(dimension?.dimension_id)) errors.push(`Scorecard ${card.rubric_id} has unknown dimension ${dimension?.dimension_id}`);
      evidenceReferences(dimension?.evidence_ids, `Dimension ${dimension?.dimension_id}`);
      if (dimension?.state === "scored") {
        if (!Number.isInteger(dimension.score) || dimension.score < 0 || dimension.score > 4) errors.push(`Scored dimension ${dimension.dimension_id} requires an integer score 0..4`);
        if (!hasObservedEvidence(dimension.evidence_ids)) errors.push(`Scored dimension ${dimension.dimension_id} requires observed evidence, not only user_claim, inference, or methodology-only sources`);
      } else {
        if (!["insufficient_evidence", "not_applicable"].includes(dimension?.state)) errors.push(`Dimension ${dimension?.dimension_id} has invalid state ${dimension?.state}`);
        if (dimension?.score !== null) errors.push(`Unscored dimension ${dimension?.dimension_id} must have a null score`);
      }
    }
    const expected = calculateScorecard(card, rubric);
    if (expected.weighted_score === null ? card.weighted_score !== null : typeof card.weighted_score !== "number" || !Number.isFinite(card.weighted_score) || Math.abs(card.weighted_score - expected.weighted_score) > SCORE_TOLERANCE) errors.push(`Scorecard ${card.rubric_id} weighted_score must be ${expected.weighted_score}`);
    if (typeof card.evidence_coverage !== "number" || !Number.isFinite(card.evidence_coverage) || Math.abs(card.evidence_coverage - expected.evidence_coverage) > SCORE_TOLERANCE) errors.push(`Scorecard ${card.rubric_id} evidence_coverage must be ${expected.evidence_coverage}`);
    const requiredProvisional = expected.evidence_coverage < rubrics.evidence_policy.provisional_below_coverage || dimensions.some((dimension) => dimension?.state === "insufficient_evidence") || unknownBlocker;
    if (requiredProvisional && card.provisional !== true) errors.push(`Scorecard ${card.rubric_id} must be provisional because evidence or a matching blocking check is unknown`);
  }
  return errors;
}

// Node resolves module URLs through symlinks; installed profile paths may retain them in argv.
const isMain = process.argv[1] && fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const input = process.argv[2];
    if (!input || process.argv.length !== 3) throw new Error("Usage: node scripts/validate-response.js <response.json>");
    const references = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../references");
    const read = (name) => JSON.parse(fs.readFileSync(path.join(references, name), "utf8"));
    const response = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
    const structural = validateResponseStructure(response, read("response.schema.json"));
    const errors = structural.length ? structural : validateResponseSemantics(response, {
      rubrics: read("rubrics.json"),
      sources: read("source-registry.json"),
      tools: read("tool-registry.json"),
      credentials: read("credential-registry.json")
    });
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(`ProofPilot response validation passed: ${path.resolve(input)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
