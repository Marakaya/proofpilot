#!/usr/bin/env node

// Narrow read interface. API contract checked against the official documentation:
// https://docs.colosseum.com/copilot/api-reference (2026-09-05).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveColosseumCredential, checkColosseum, runColosseumCurl } from "./setup.js";

const BASE = "https://copilot.colosseum.com/api/v1";
const MARKER = "\nPROOFPILOT_HTTP_STATUS:";
const MAX_BYTES = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fields = {
  filters: [],
  "search-projects": ["query", "limit", "offset"],
  "search-archives": ["query", "limit", "offset"],
  project: ["slug"],
  archive: ["id", "offset", "max-chars"],
  cluster: ["key"]
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

/** Only named operations can produce a request; no supplied URL or curl flags. */
export function buildColosseumReadRequest(args) {
  if (!Array.isArray(args) || !args.every(arg => typeof arg === "string")) invalid();
  const operation = args[0];
  if (!Object.hasOwn(fields, operation)) invalid();
  const values = Object.create(null);
  let jsonSeen = false;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") {
      if (jsonSeen) invalid();
      jsonSeen = true;
      continue;
    }
    const key = flag.slice(2);
    if (!flag.startsWith("--") || !fields[operation].includes(key) || Object.hasOwn(values, key)) invalid();
    const value = args[++index];
    if (typeof value !== "string" || value.startsWith("--")) invalid();
    values[key] = value;
  }
  let route;
  let body = null;
  if (operation === "filters") route = "/filters";
  else if (operation.startsWith("search-")) {
    const query = text(values.query, /^[^\x00-\x1f\x7f]{1,500}$/u).trim();
    if (!query) invalid();
    const archives = operation === "search-archives";
    route = archives ? "/search/archives" : "/search/projects";
    body = {
      query,
      limit: integer(values.limit, 5, 1, archives ? 10 : 20),
      offset: integer(values.offset, 0, 0, 1000000)
    };
    if (archives) body.maxChunksPerDoc = 2;
  } else if (operation === "project") {
    route = `/projects/by-slug/${encodeURIComponent(text(values.slug, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/))}`;
  } else if (operation === "archive") {
    const id = text(values.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const offset = integer(values.offset, 0, 0, 1000000);
    const maxChars = integer(values["max-chars"], 8000, 200, 20000);
    route = `/archives/${id}?offset=${offset}&maxChars=${maxChars}`;
  } else {
    route = `/clusters/${text(values.key, /^v\d{1,6}-c\d{1,9}$/)}`;
  }
  return { operation, url: `${BASE}${route}`, method: body ? "POST" : "GET", body };
}

const quote = value => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Internal transport result may contain untrusted server data; never log it. */
export function runColosseumReadCurl(token, args, options = {}) {
  const request = buildColosseumReadRequest(args);
  if (typeof token !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(token)) invalid();
  const env = { ...(options.env ?? process.env) };
  delete env.COLOSSEUM_COPILOT_PAT;
  const lines = [
    `url = ${quote(request.url)}`,
    `request = ${quote(request.method)}`,
    `header = ${quote(`Authorization: Bearer ${token}`)}`,
    'header = "Accept: application/json"',
    "silent", "show-error", "max-time = 20", "connect-timeout = 10",
    'proto = "=https"',
    'write-out = "\\nPROOFPILOT_HTTP_STATUS:%{http_code}"'
  ];
  if (request.body) {
    lines.push('header = "Content-Type: application/json"');
    lines.push(`data-binary = ${quote(JSON.stringify(request.body))}`);
  }
  return (options.spawn ?? spawnSync)("curl", ["--disable", "--config", "-"], {
    input: `${lines.join("\n")}\n`, encoding: "utf8", env,
    timeout: 21000, maxBuffer: MAX_BYTES, windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

const messages = {
  invalid_arguments: "Unsupported or out-of-range arguments. Use --help. Never pass credentials as arguments.",
  missing: "No Colosseum PAT is configured. Complete local setup first.",
  unauthorized401: "Authentication was rejected. Check the token in Colosseum Arena; no replacement was attempted.",
  forbidden403: "Access was forbidden. This alone does not establish that the token is invalid.",
  rate_limited429: "Rate limit reached. Wait before making another request; no retry was attempted.",
  payment_required402: "The service requested payment. No payment or retry was attempted.",
  not_found404: "The requested resource was not found.",
  redirect_refused: "The service returned a redirect. Credentials were not forwarded to another location.",
  invalid_response: "The service returned an unexpected response; its contents were not displayed.",
  unavailable: "The request could not complete. No conclusion about token validity is available."
};

function failure(operation, checkedAt, code, httpStatus = null, phase = "request") {
  return {
    ok: false, operation, operation_verified: false,
    checked_at: checkedAt, http_status: httpStatus, phase,
    verification_scope: "Setup status confirms authentication only; it does not establish that this data operation works.",
    error: { code, message: messages[code] }
  };
}

function validResponse(operation, body) {
  if (!object(body)) return false;
  if (operation.startsWith("search-")) return Array.isArray(body.results);
  if (operation === "filters") return Array.isArray(body.hackathons);
  if (operation === "project") return typeof body.slug === "string";
  if (operation === "archive") return typeof body.documentId === "string";
  return typeof body.key === "string";
}

// A server must not be able to echo the selected credential into stdout.
function redact(value, token) {
  if (typeof value === "string") return value.replaceAll(token, "[redacted]");
  if (Array.isArray(value)) return value.map(item => redact(item, token));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replaceAll(token, "[redacted]"), redact(item, token)]));
  return value;
}

/** Always performs a fresh status check, then at most one bounded read operation. */
export function readColosseum(args, options = {}) {
  const checkedAt = new Date(options.now ?? new Date()).toISOString();
  let request;
  try { request = buildColosseumReadRequest(args); }
  catch { return failure(null, checkedAt, "invalid_arguments", null, "arguments"); }
  try {
    const credential = resolveColosseumCredential(options);
    if (!credential.configured) return failure(request.operation, checkedAt, "missing", null, "authentication");
    // Resolve once and pin this token for both requests, even if its file changes.
    const env = { ...(options.env ?? process.env), COLOSSEUM_COPILOT_PAT: credential.token };
    const statusRunner = options.statusRunner ?? (options.spawn
      ? (token, transport) => runColosseumCurl(token, { ...transport, spawn: options.spawn }) : undefined);
    const status = checkColosseum({ ...options, env, runner: statusRunner });
    if (status.colosseum.status !== "verified" || status.colosseum.live_check_performed !== true) {
      const code = status.colosseum.http_status === 402 ? "payment_required402"
        : Object.hasOwn(messages, status.colosseum.status) ? status.colosseum.status : "invalid_response";
      return failure(request.operation, checkedAt, code, status.colosseum.http_status ?? null, "authentication");
    }
    const response = (options.runner ?? runColosseumReadCurl)(credential.token, args, { env, spawn: options.spawn });
    if (response.error || response.status !== 0 || typeof response.stdout !== "string" || Buffer.byteLength(response.stdout, "utf8") > MAX_BYTES) {
      return failure(request.operation, checkedAt, "unavailable");
    }
    const boundary = response.stdout.lastIndexOf(MARKER);
    const codeText = boundary >= 0 ? response.stdout.slice(boundary + MARKER.length).trim() : "";
    if (!/^[1-5]\d{2}$/.test(codeText)) return failure(request.operation, checkedAt, "invalid_response");
    const httpStatus = Number(codeText);
    if (httpStatus !== 200) {
      const code = ({ 401: "unauthorized401", 402: "payment_required402", 403: "forbidden403", 404: "not_found404", 429: "rate_limited429" })[httpStatus]
        ?? (httpStatus >= 300 && httpStatus < 400 ? "redirect_refused" : "unavailable");
      return failure(request.operation, checkedAt, code, httpStatus);
    }
    let body;
    try { body = JSON.parse(response.stdout.slice(0, boundary)); }
    catch { return failure(request.operation, checkedAt, "invalid_response", httpStatus); }
    if (!validResponse(request.operation, body)) return failure(request.operation, checkedAt, "invalid_response", httpStatus);
    return {
      ok: true, operation: request.operation, operation_verified: true, checked_at: checkedAt,
      http_status: httpStatus, authentication_checked_at: status.colosseum.checked_at,
      data: redact(body, credential.token)
    };
  } catch { return failure(request.operation, checkedAt, "unavailable"); }
}

export function runColosseumReadCli(args = process.argv.slice(2), options = {}) {
  const output = options.stdout ?? process.stdout;
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    output.write("Usage: colosseum-read.js <operation> [options] [--json]\n  filters\n  search-projects --query <text> [--limit 1..20] [--offset 0..1000000]\n  search-archives --query <text> [--limit 1..10] [--offset 0..1000000]\n  project --slug <slug>\n  archive --id <UUID> [--offset 0..1000000] [--max-chars 200..20000]\n  cluster --key <vN-cN>\nEach operation checks authentication, then makes one read request. Uses the configured Colosseum key; never pass a token here. No retries, redirects, payments, or remote writes.\n");
    return 0;
  }
  const result = readColosseum(args, options);
  output.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1]) {
  let invoked = path.resolve(process.argv[1]);
  try { invoked = fs.realpathSync(invoked); } catch { /* Not this entrypoint. */ }
  if (invoked === fileURLToPath(import.meta.url)) process.exitCode = runColosseumReadCli();
}
