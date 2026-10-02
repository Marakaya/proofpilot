#!/usr/bin/env node

// Bounded evidence reads. Contract: official Copilot skill 2.0.0, 2026-10-01.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkColosseum } from "./setup.js";
import { COLOSSEUM_API_BASE, runColosseumRequest, parseColosseumResponse } from "./colosseum-connection.js";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const slugPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const archiveIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = {
  filters: [], categories: [],
  "search-projects": ["query", "limit", "offset", "winners-only", "accelerator-only"],
  "search-archives": ["query", "limit", "offset"],
  project: ["slug"], archive: ["id", "offset", "max-chars"]
};
function invalid() { throw new Error("invalid_arguments"); }
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) invalid();
  return parsed;
}
function text(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) invalid();
  return value;
}
function boolean(value) {
  if (!["true", "false"].includes(value)) invalid();
  return value === "true";
}

/** Named operations only; no arbitrary URLs, curl flags or write endpoints. */
export function buildColosseumReadRequest(args) {
  if (!Array.isArray(args) || !args.every(arg => typeof arg === "string")) invalid();
  const operation = args[0];
  if (!Object.hasOwn(fields, operation)) invalid();
  const values = Object.create(null);
  let jsonSeen = false;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") { if (jsonSeen) invalid(); jsonSeen = true; continue; }
    const key = flag.slice(2);
    if (!flag.startsWith("--") || !fields[operation].includes(key) || Object.hasOwn(values, key)) invalid();
    const value = args[++index];
    if (typeof value !== "string" || value.startsWith("--")) invalid();
    values[key] = value;
  }
  let route;
  let body = null;
  if (["filters", "categories"].includes(operation)) route = `/${operation}`;
  else if (operation.startsWith("search-")) {
    const query = text(values.query, /^[^\x00-\x1f\x7f]{1,500}$/u).trim();
    if (!query) invalid();
    const archives = operation === "search-archives";
    route = archives ? "/search/archives" : "/search/projects";
    body = { query, limit: integer(values.limit, 5, 1, archives ? 10 : 25), offset: integer(values.offset, 0, 0, archives ? 50 : 1000000) };
    if (archives) body.maxChunksPerDoc = 2;
    else {
      const filters = {};
      if (values["winners-only"] !== undefined) filters.winnersOnly = boolean(values["winners-only"]);
      if (values["accelerator-only"] !== undefined) filters.acceleratorOnly = boolean(values["accelerator-only"]);
      if (Object.keys(filters).length) body.filters = filters;
    }
  } else if (operation === "project") {
    route = `/projects/by-slug/${encodeURIComponent(text(values.slug, slugPattern))}`;
  } else {
    const id = text(values.id, archiveIdPattern);
    const offset = integer(values.offset, 0, 0, 1000000);
    const maxChars = integer(values["max-chars"], 8000, 200, 20000);
    route = `/archives/${id}?offset=${offset}&maxChars=${maxChars}`;
  }
  return { operation, url: `${COLOSSEUM_API_BASE}${route}`, method: body ? "POST" : "GET", body };
}

const messages = {
  invalid_arguments: "Unsupported or out-of-range arguments. Use --help; never pass credentials here.",
  helper_missing: "The official Copilot Connect helper is unavailable locally. Complete V2 sign-in first.",
  helper_untrusted: "The managed Copilot Connect helper cache failed validation and was not run. Preserve the cache and run setup.js --status for its exact path and recovery steps; repeating sign-in alone cannot repair it.",
  missing: "No Colosseum V2 connection is saved. Use the official browser or device login.",
  expired: "The authorization expired. Reconnect with the official helper.",
  revoked: "The authorization was revoked. Reconnect with the official helper.",
  refresh_pending: "Renewal is pending. Preserve the connection and try later.",
  evidence_unavailable: "Evidence access is unavailable. Preserve the connection and use public sources.",
  unauthorized401: "Authentication was rejected. Check helper status once before reconnecting.",
  forbidden403: "Access was forbidden. Check scopes and account permissions; this does not prove expiry.",
  rate_limited429: "Rate limit reached. Wait before another request; no retry was attempted.",
  payment_required402: "Payment was requested. No payment or retry was attempted.",
  not_found404: "The V2 resource was not found. No V1 fallback was attempted.",
  redirect_refused: "A redirect was refused. Credentials were not forwarded.",
  transport_missing: "No curl executable is available in trusted system locations. Prepare system curl, then retry; see references/onboarding.md for accepted locations. This request did not retrieve or renew a token; this does not establish an authorization failure.",
  invalid_response: "The service returned an unexpected response; its contents were not displayed.",
  unavailable: "The request could not complete. No conclusion about authorization validity is available."
};
function failure(operation, checkedAt, code, httpStatus = null, phase = "request") {
  const safeCode = Object.hasOwn(messages, code) ? code : "invalid_response";
  return {
    ok: false, api_version: "v2", operation, operation_verified: false,
    checked_at: checkedAt, http_status: httpStatus, phase,
    verification_scope: "Authentication confirms evidence access only; each corpus operation is verified separately.",
    error: { code: safeCode, message: messages[safeCode] }
  };
}
function validResponse(request, body) {
  const { operation } = request;
  if (!object(body)) return false;
  if (operation.startsWith("search-")) return Array.isArray(body.results);
  if (operation === "filters") return Array.isArray(body.hackathons);
  if (operation === "categories") return Array.isArray(body.areas) && Array.isArray(body.groups);
  const requestedId = new URL(request.url).pathname.split("/").at(-1);
  if (operation === "project") return typeof body.slug === "string" && slugPattern.test(body.slug) &&
    body.slug.toLowerCase() === requestedId.toLowerCase();
  return typeof body.documentId === "string" && archiveIdPattern.test(body.documentId) &&
    body.documentId.toLowerCase() === requestedId.toLowerCase();
}

/** Fresh V2 access check followed by one bounded read, with no automatic retry. */
export async function readColosseum(args, options = {}) {
  const checkedAt = new Date(options.now ?? new Date()).toISOString();
  let request;
  try { request = buildColosseumReadRequest(args); }
  catch { return failure(null, checkedAt, "invalid_arguments", null, "arguments"); }
  try {
    const status = await checkColosseum(options);
    if (status.colosseum.status !== "verified" || status.colosseum.live_check_performed !== true) {
      return failure(request.operation, checkedAt, status.colosseum.status, status.colosseum.http_status ?? null, "authentication");
    }
    const response = parseColosseumResponse(await (options.runner ?? runColosseumRequest)(request, options));
    if (response.error) return failure(request.operation, checkedAt, response.error, response.http_status);
    if (!validResponse(request, response.data)) return failure(request.operation, checkedAt, "invalid_response", response.http_status);
    return {
      ok: true, api_version: "v2", operation: request.operation, operation_verified: true,
      checked_at: checkedAt, http_status: response.http_status,
      authentication_checked_at: status.colosseum.checked_at, data: response.data
    };
  } catch { return failure(request.operation, checkedAt, "unavailable"); }
}

export async function runColosseumReadCli(args = process.argv.slice(2), options = {}) {
  const output = options.stdout ?? process.stdout;
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    output.write("Usage: colosseum-read.js <operation> [options] [--json]\n  filters\n  categories\n  search-projects --query <text> [--limit 1..25] [--offset 0..1000000] [--winners-only true|false] [--accelerator-only true|false]\n  search-archives --query <text> [--limit 1..10] [--offset 0..50]\n  project --slug <slug>\n  archive --id <UUID> [--offset 0..1000000] [--max-chars 200..20000]\nUses official Copilot Connect sign-in and API V2. No PAT input, retries, redirects, payments, session sharing or remote writes.\n");
    return 0;
  }
  const result = await readColosseum(args, options);
  output.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1]) {
  let invoked = path.resolve(process.argv[1]);
  try { invoked = fs.realpathSync(invoked); } catch { /* Not this entrypoint. */ }
  if (invoked === fileURLToPath(import.meta.url)) process.exitCode = await runColosseumReadCli();
}
