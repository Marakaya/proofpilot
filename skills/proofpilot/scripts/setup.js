#!/usr/bin/env node

// Portable onboarding: offline by default; credentials never appear in CLI output.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const COLOSSEUM_STATUS_URL = "https://copilot.colosseum.com/api/v1/status";
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const REQUIRED_SCOPE = "colosseum_copilot:read";
const MAX_FILE_BYTES = 64 * 1024;
const MARKER = "\nPROOFPILOT_HTTP_STATUS:";
const validObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fingerprint = token => crypto.createHash("sha256").update(token).digest("hex");

function context(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const configDir = env.PROOFPILOT_CONFIG_DIR || path.join(home, ".config", "proofpilot");
  return { ...options, env, home, configDir, fs: options.fs ?? fs, now: options.now ?? new Date() };
}

function readObject(file, io) {
  let descriptor;
  try {
    descriptor = io.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
    const stat = io.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { value: null, error: "invalid_file" };
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = io.readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_FILE_BYTES) return { value: null, error: "invalid_file" };
    const value = JSON.parse(buffer.subarray(0, length).toString("utf8"));
    return validObject(value) ? { value, error: null } : { value: null, error: "invalid_json" };
  } catch (error) {
    return { value: null, error: error.code === "ENOENT" ? null : "unreadable_or_invalid_json" };
  } finally {
    if (descriptor !== undefined) io.closeSync(descriptor);
  }
}

function safeToken(value) {
  // Reject header/config injection. PATs are non-whitespace printable ASCII.
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 8192 && /^[\x21-\x7e]+$/.test(trimmed) ? trimmed : null;
}

// Internal helper: its result contains a secret. Never serialize or log it.
export function resolveColosseumCredential(options = {}) {
  const ctx = context(options);
  const warnings = [];
  const candidates = [["environment", ctx.env.COLOSSEUM_COPILOT_PAT]];
  if (!safeToken(ctx.env.COLOSSEUM_COPILOT_PAT)) {
    const own = readObject(path.join(ctx.configDir, "credentials.json"), ctx.fs);
    if (own.error) warnings.push("proofpilot_credentials_unreadable");
    candidates.push(["proofpilot_config", own.value?.colosseum_copilot_pat]);
    if (!safeToken(own.value?.colosseum_copilot_pat)) {
      const legacy = readObject(path.join(ctx.home, ".superstack", "config.json"), ctx.fs);
      if (legacy.error) warnings.push("legacy_credentials_unreadable");
      candidates.push(["legacy_superstack", legacy.value?.copilotToken]);
    }
  }
  for (const [source, value] of candidates) {
    const token = safeToken(value);
    if (token) return { configured: true, source, token, warnings };
    if (typeof value === "string" && value.trim()) warnings.push(`${source}_token_invalid_format`);
  }
  return { configured: false, source: null, token: null, warnings };
}

const reasons = {
  missing: "Colosseum is required for complete ProofPilot setup. No usable PAT is configured.",
  configured_unverified: "A PAT is configured. Verify access; do not ask for the token again.",
  verified: "The documented status endpoint confirmed authentication and read scope.",
  unauthorized401: "The server rejected authentication. Check token expiration or replacement in Colosseum Arena.",
  forbidden403: "The request was forbidden. This alone does not prove an invalid token; inspect the service access path.",
  rate_limited429: "The server rate-limited this check. Retry later; do not replace the token on this evidence.",
  unavailable: "The status request could not complete. No conclusion about token validity is available.",
  invalid_response: "The response did not confirm authenticated access with the required read scope."
};

function summary(credential, status, details = {}) {
  return {
    schema_version: "1",
    setup_required: status !== "verified",
    colosseum: {
      required: true,
      configured: credential.configured,
      credential_required: !credential.configured,
      credential_source: credential.source,
      status,
      checked_at: details.checked_at ?? null,
      expires_at: details.expires_at ?? null,
      verification_basis: "none",
      live_check_performed: false,
      reason: reasons[status],
      next_action: status === "missing" ? "configure_colosseum" : status === "verified" ? "ready" : "check_colosseum",
      verification_scope: "Authentication and colosseum_copilot:read only; project search is not tested by setup.",
      ...details
    },
    warnings: credential.warnings
  };
}

function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Offline: presence + bounded cached status. Does not start a network process. */
export function getSetupStatus(options = {}) {
  const ctx = context(options);
  const credential = resolveColosseumCredential(ctx);
  if (!credential.configured) return summary(credential, "missing");
  const saved = readObject(path.join(ctx.configDir, "setup-state.json"), ctx.fs).value?.colosseum;
  if (!validObject(saved) || saved.credential_fingerprint !== fingerprint(credential.token)) {
    return summary(credential, "configured_unverified");
  }
  const checkedAt = isoDate(saved.checked_at);
  const expiresAt = isoDate(saved.expires_at);
  const age = checkedAt ? new Date(ctx.now).getTime() - new Date(checkedAt).getTime() : Infinity;
  const expired = expiresAt && new Date(expiresAt).getTime() <= new Date(ctx.now).getTime();
  const fresh = age >= 0 && age < VERIFICATION_TTL_MS && !expired;
  const status = fresh && Object.hasOwn(reasons, saved.status) && saved.status !== "missing"
    ? saved.status : "configured_unverified";
  return summary(credential, status, {
    checked_at: checkedAt,
    expires_at: expiresAt,
    verification_cached: fresh,
    verification_basis: fresh ? "cached" : "none",
    recheck_reason: expired ? "recorded_expiration_reached" : !fresh ? "verification_stale" : null
  });
}

function atomicPrivateJson(file, value, ctx) {
  const directory = path.dirname(file);
  ctx.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!ctx.fs.lstatSync(directory).isDirectory()) throw new Error("Setup directory is not a regular directory.");
  ctx.fs.chmodSync(directory, 0o700);
  try {
    if (!ctx.fs.lstatSync(file).isFile()) throw new Error("Refusing to replace a non-regular setup file.");
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Refusing to replace a non-regular setup file.");
  }
  const temporary = path.join(directory, `.proofpilot-${crypto.randomBytes(12).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = ctx.fs.openSync(temporary, "wx", 0o600);
    ctx.fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    ctx.fs.fchmodSync(descriptor, 0o600);
    ctx.fs.fsyncSync(descriptor);
    ctx.fs.closeSync(descriptor);
    descriptor = undefined;
    ctx.fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) ctx.fs.closeSync(descriptor);
    try { ctx.fs.unlinkSync(temporary); } catch { /* Already renamed, or never created. */ }
  }
}

function writeState(credential, result, ctx) {
  const file = path.join(ctx.configDir, "setup-state.json");
  const previous = readObject(file, ctx.fs);
  // Never erase malformed or unrelated settings just to cache a check.
  if (previous.error) throw new Error("Cannot preserve existing setup state.");
  atomicPrivateJson(file, {
    ...(previous.value || {}),
    colosseum: {
      status: result.colosseum.status,
      checked_at: result.colosseum.checked_at,
      expires_at: result.colosseum.expires_at,
      credential_fingerprint: fingerprint(credential.token)
    }
  }, ctx);
}

const curlQuote = value => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const officialBase = env => !env.COLOSSEUM_COPILOT_API_BASE ||
  env.COLOSSEUM_COPILOT_API_BASE.replace(/\/$/, "") === "https://copilot.colosseum.com/api/v1";

/** One ordinary curl GET. Secret header is passed on stdin, never in argv. */
export function runColosseumCurl(token, options = {}) {
  const env = { ...(options.env ?? process.env) };
  if (!officialBase(env)) throw new Error("Only the documented Colosseum HTTPS API base is supported.");
  if (!token || safeToken(token) !== token) throw new Error("Invalid token format.");
  delete env.COLOSSEUM_COPILOT_PAT;
  const input = [
    `url = ${curlQuote(COLOSSEUM_STATUS_URL)}`,
    'request = "GET"',
    `header = ${curlQuote(`Authorization: Bearer ${token}`)}`,
    'header = "Accept: application/json"',
    "silent", "show-error", "max-time = 15", "connect-timeout = 10",
    'proto = "=https"',
    'write-out = "\\nPROOFPILOT_HTTP_STATUS:%{http_code}"'
  ].join("\n") + "\n";
  return (options.spawn ?? spawnSync)("curl", ["--disable", "--config", "-"], {
    input, encoding: "utf8", env, timeout: 16000, maxBuffer: 128 * 1024,
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
  });
}

/** Explicit online check; no retries, redirects, searches, writes, or billing calls. */
export function checkColosseum(options = {}) {
  const ctx = context(options);
  const credential = resolveColosseumCredential(ctx);
  if (!credential.configured) return summary(credential, "missing");
  if (!officialBase(ctx.env)) {
    credential.warnings.push("unsupported_colosseum_api_base");
    return summary(credential, "unavailable");
  }
  const checkedAt = new Date(ctx.now).toISOString();
  let status = "unavailable";
  let httpStatus = null;
  let expiresAt = null;
  try {
    const result = (ctx.runner ?? runColosseumCurl)(credential.token, { env: ctx.env });
    // Never surface curl stderr, arbitrary server fields, or subprocess errors.
    if (!result.error && result.status === 0 && typeof result.stdout === "string") {
      const boundary = result.stdout.lastIndexOf(MARKER);
      const code = boundary >= 0 ? result.stdout.slice(boundary + MARKER.length).trim() : "";
      if (/^[1-5]\d{2}$/.test(code)) {
        httpStatus = Number(code);
        if (httpStatus === 401) status = "unauthorized401";
        else if (httpStatus === 403) status = "forbidden403";
        else if (httpStatus === 429) status = "rate_limited429";
        else if (httpStatus === 200) {
          status = "invalid_response";
          let body;
          try { body = JSON.parse(result.stdout.slice(0, boundary)); } catch { /* Keep invalid_response. */ }
          const scopes = typeof body?.scope === "string" ? body.scope.split(/\s+/) : Array.isArray(body?.scope) ? body.scope : [];
          expiresAt = isoDate(body?.expiresAt);
          const expirationValid = body?.expiresAt == null || (expiresAt && new Date(expiresAt) > new Date(ctx.now));
          if (body?.authenticated === true && scopes.includes(REQUIRED_SCOPE) && expirationValid) status = "verified";
        }
      }
    }
  } catch { /* Generic unavailable; never expose an injected subprocess error. */ }
  const result = summary(credential, status, {
    checked_at: checkedAt, expires_at: expiresAt, http_status: httpStatus,
    verification_cached: false, verification_basis: "live", live_check_performed: true
  });
  try { writeState(credential, result, ctx); }
  catch { result.warnings.push("verification_state_not_saved"); }
  return result;
}

/** Local-only save. The CLI obtains token from a masked TTY, never an argument. */
export function configureColosseum(token, options = {}) {
  const ctx = context(options);
  const safe = safeToken(token);
  if (!safe) throw new Error("Invalid token format. Enter the PAT only, without spaces or control characters.");
  const file = path.join(ctx.configDir, "credentials.json");
  const previous = readObject(file, ctx.fs);
  if (previous.error) throw new Error("Existing ProofPilot credentials are unreadable or invalid; they were preserved.");
  atomicPrivateJson(file, { ...(previous.value || {}), colosseum_copilot_pat: safe }, ctx);
  const result = getSetupStatus(ctx);
  result.configuration_saved = true;
  if (safeToken(ctx.env.COLOSSEUM_COPILOT_PAT)) result.warnings.push("environment_token_takes_precedence_over_saved_token");
  return result;
}

function readMaskedToken(input = process.stdin, output = process.stderr) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Secure setup requires an interactive terminal. Run --configure-colosseum there; never paste a token into chat or a command argument."));
  }
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw);
    const wasFlowing = input.readableFlowing;
    const finish = (error) => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onError);
      input.setRawMode(wasRaw);
      if (!wasFlowing) input.pause();
      output.write("\n");
      error ? reject(error) : resolve(value);
      value = "";
    };
    const onEnd = () => finish(new Error("Token entry cancelled."));
    const onError = () => finish(new Error("Token entry failed."));
    const onData = chunk => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003" || char === "\u0004") { finish(new Error("Token entry cancelled.")); return; }
        if (char === "\r" || char === "\n") { finish(); return; }
        if (char === "\u007f" || char === "\b") { value = value.slice(0, -1); continue; }
        if (char < " " || char > "~" || value.length >= 8192) { finish(new Error("Invalid token input.")); return; }
        value += char;
      }
    };
    output.write("Colosseum PAT (input hidden; Enter to save, Ctrl-C to cancel): ");
    input.setRawMode(true);
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    input.resume();
  });
}

export async function runSetupCli(args = process.argv.slice(2), options = {}) {
  const output = options.stdout ?? process.stdout;
  const errors = options.stderr ?? process.stderr;
  if (args.includes("--help") && args.length === 1) {
    output.write("Usage: setup.js [--status | --configure-colosseum | --check-colosseum] [--json]\nDefault/--status: offline JSON presence and cached status.\n--configure-colosseum: hidden interactive input; private local save, no network.\n--check-colosseum: one authenticated GET /status using curl; no retries or redirects.\nDo not pass tokens in arguments or chat. Existing credentials are reused.\n");
    return 0;
  }
  const actions = args.filter(arg => arg !== "--json");
  if (actions.length > 1 || (actions.length === 1 && !["--status", "--configure-colosseum", "--check-colosseum"].includes(actions[0])) || args.filter(arg => arg === "--json").length > 1) {
    errors.write("Unsupported arguments. Use --help; never pass a token as an argument.\n");
    return 1;
  }
  try {
    const action = actions[0] ?? "--status";
    const result = action === "--configure-colosseum"
      ? configureColosseum(await readMaskedToken(options.stdin ?? process.stdin, errors), options)
      : action === "--check-colosseum" ? checkColosseum(options) : getSetupStatus(options);
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return action === "--check-colosseum" && result.colosseum.status !== "verified" ? 1 : 0;
  } catch (error) {
    // Only errors created by the local interface are allowed out; no raw filesystem diagnostics.
    const safeMessages = ["Secure setup requires", "Token entry", "Invalid token", "Existing ProofPilot credentials"];
    errors.write(safeMessages.some(prefix => error.message?.startsWith(prefix)) ? `${error.message}\n` : "ProofPilot setup could not save private configuration. Existing settings were preserved.\n");
    return 1;
  }
}

if (process.argv[1]) {
  let invoked = path.resolve(process.argv[1]);
  try { invoked = fs.realpathSync(invoked); } catch { /* Nonexistent path is not this entrypoint. */ }
  if (invoked === fileURLToPath(import.meta.url)) process.exitCode = await runSetupCli();
}
