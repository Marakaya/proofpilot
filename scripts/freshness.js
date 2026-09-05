import { isDateTime } from "../skills/proofpilot/scripts/validate-response.js";

const nonblank = (value) => typeof value === "string" && value.trim().length > 0;

export function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isHttpsUrl(value) {
  try {
    return typeof value === "string" && value.startsWith("https://") && new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate the boundary between a catalog review and recorded runtime evidence.
 * This checks evidence records, not whether a remote request really happened or
 * an adapter was implemented. It never performs requests or promotes statuses.
 * Schema validation should accompany this reusable semantic check.
 */
export function validateFreshnessSemantics(entry, { kind = "tool" } = {}) {
  const errors = [];
  const label = `${kind} ${entry.id ?? "<missing id>"}`;
  const fail = (message) => errors.push(`${label}: ${message}`);
  const verification = entry.verification;
  const review = entry.freshness_review;

  if (!verification) fail("verification metadata is required");
  if (!review) fail("freshness_review metadata is required");
  if (!verification || !review) return errors;

  const runtimeSelected = kind === "source" && (
    ["runtime_input", "platform_only"].includes(entry.status) ||
    verification.scope === "runtime_required"
  );

  if (runtimeSelected) {
    if (entry.last_verified_at !== null) fail("runtime-selected source must keep last_verified_at null");
    if (verification.scope !== "runtime_required") fail("runtime-selected source requires runtime_required scope");
    if (verification.api_runtime_status !== "not_tested") fail("runtime-selected source has no verified runtime yet");
    if (review.content_status !== "runtime_required") fail("runtime-selected source content must remain runtime_required");
    if (entry.runtime_probes?.length) fail("unselected runtime source cannot carry a concrete runtime probe");
  } else if (!Array.isArray(entry.reference_checks) || !entry.reference_checks.length) {
    fail("concrete catalog entry requires scoped reference_checks");
  }

  const live = verification.scope === "live_api";
  const verified = verification.api_runtime_status === "verified";
  if (live !== verified) fail("live_api scope and verified API status must be used together");

  if (live || verified) {
    const hasSuccessfulProbe = Array.isArray(entry.runtime_probes) && entry.runtime_probes.some((probe) => (
      probe.method === "GET" &&
      Number.isInteger(probe.http_status) && probe.http_status >= 200 && probe.http_status < 300 &&
      isHttpsUrl(probe.url) &&
      (isDate(probe.checked_at) || isDateTime(probe.checked_at)) &&
      nonblank(probe.observation) && nonblank(probe.scope_limit)
    ));
    if (!hasSuccessfulProbe) fail("live_api/verified requires a dated GET 2xx runtime_probes record with observation and scope_limit");
  }

  for (const [index, probe] of (entry.runtime_probes ?? []).entries()) {
    if (!nonblank(probe.scope_limit)) fail(`runtime_probes[${index}].scope_limit must explain the bounded evidence`);
    if (!nonblank(probe.observation)) fail(`runtime_probes[${index}].observation must describe the observed result`);
  }
  return errors;
}
