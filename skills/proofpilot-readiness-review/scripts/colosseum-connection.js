// Official Copilot 2.0 connection helper. Tokens stay inside a private
// helper-to-curl transfer; callers receive only sanitized response data.
import { spawn, spawnSync } from "node:child_process";
import { CONNECTION_HELPER_VERSION, createHelperInvocation, helperEnvironment, helperEnvironmentDiagnostic, trustedSystemExecutable } from "./connection-helper.js";

export const COLOSSEUM_API_BASE = "https://copilot.colosseum.com/api/v2";
export const COLOSSEUM_HELPER_PACKAGE = "@colosseum-org/copilot-connect@0.2.2";
export const COLOSSEUM_HTTP_MARKER = "\nPROOFPILOT_HTTP_STATUS:";
export const COLOSSEUM_MAX_BYTES = 2 * 1024 * 1024;

export function connectionEnvironment(env = process.env) {
  return helperEnvironment(env);
}

/** Status only: never capture the token command through this interface. */
export function runConnectionHelper(args, options = {}) {
  if (![["status"], ["status", "--local"]].some(allowed => JSON.stringify(args) === JSON.stringify(allowed))) {
    throw new Error("Unsupported helper operation.");
  }
  const invocation = (options.createHelperInvocation ?? createHelperInvocation)(args, {
    env: connectionEnvironment(options.env), cache: options.helperCache
  });
  try {
    // Nothing is started for a rejected cache; the account backend is not consulted.
    if (invocation.helperCacheIssue) return { status: 1, stdout: "", stderr: "", helperCacheIssue: invocation.helperCacheIssue };
    return (options.spawnSync ?? spawnSync)(invocation.command, invocation.args, {
      env: invocation.env, cwd: invocation.cwd, encoding: "utf8", timeout: 45000,
      maxBuffer: 128 * 1024, windowsHide: true, shell: invocation.shell,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } finally { invocation.cleanup(); }
}

export function helperFailureCode(result) {
  if (result?.helperCacheIssue || /\bEHELPERCACHE\b/.test(result?.stderr ?? "")) return "helper_untrusted";
  if (result?.missing || ["ENOENT", "ENOTCACHED"].includes(result?.error?.code) ||
      /\bENOTCACHED\b|could not determine executable to run/i.test(result?.stderr ?? "")) return "helper_missing";
  // A transport/timeout error does not establish a trustworthy helper exit
  // state, even if a status value was also attached to the failed result.
  if (result?.error) return "unavailable";
  return ({ 2: "expired", 3: "revoked", 4: "unavailable", 5: "missing", 6: "refresh_pending", 7: "evidence_unavailable", 8: "forbidden403" })[result?.status] ?? "unavailable";
}

/** Prepare the pinned helper with a version check only; never inspect an account. */
export function prepareColosseumHelper(options = {}) {
  let invocation;
  try { invocation = (options.createHelperInvocation ?? createHelperInvocation)(["--version"], {
    online: true, env: connectionEnvironment(options.env), cache: options.helperCache
  }); }
  catch (error) { return { status: null, error: "helper_environment_unavailable", diagnostic: helperEnvironmentDiagnostic(error) }; }
  try {
    if (invocation.helperCacheIssue) return { status: null, error: "helper_untrusted", diagnostic: invocation.helperCacheIssue.diagnostic };
    if (invocation.helperPrerequisiteIssue) return { status: null, error: invocation.helperPrerequisiteIssue.code,
      diagnostic: invocation.helperPrerequisiteIssue.diagnostic };
    const result = (options.spawnSync ?? spawnSync)(invocation.command, invocation.args, {
      env: invocation.env, cwd: invocation.cwd, encoding: "utf8", timeout: 120000,
      maxBuffer: 128 * 1024, windowsHide: true, shell: invocation.shell, stdio: ["ignore", "pipe", "pipe"]
    });
    return !result.error && result.status === 0 && typeof result.stdout === "string" && result.stdout.trim() === CONNECTION_HELPER_VERSION ?
      { status: 0 } : { status: null, error: "helper_preparation_failed" };
  } catch { return { status: null, error: "helper_preparation_failed" }; }
  finally { invocation.cleanup(); }
}

/** Explicit user-triggered browser/device sign-in; official helper owns storage. */
export async function loginColosseum(options = {}) {
  let invocation;
  try { invocation = createHelperInvocation(["login", ...(options.device ? ["--device"] : [])], { online: true, env: connectionEnvironment(options.env), cache: options.helperCache }); }
  catch (error) { return { status: null, error: "helper_environment_unavailable", diagnostic: helperEnvironmentDiagnostic(error) }; }
  if (invocation.helperCacheIssue) {
    invocation.cleanup();
    return { status: null, error: "helper_untrusted", helper_cache: invocation.helperCacheIssue.path, diagnostic: invocation.helperCacheIssue.diagnostic };
  }
  try { return await new Promise(resolve => {
    let child;
    let settled = false;
    let killTimer;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      process.removeListener("SIGINT", interrupted);
      process.removeListener("SIGTERM", interrupted);
      resolve(result);
    };
    const interrupted = () => {
      if (!child?.pid) { finish({ status: null, error: "interrupted" }); return; }
      try { if (process.platform === "win32") child.kill("SIGTERM"); else process.kill(-child.pid, "SIGTERM"); } catch { child.kill?.("SIGTERM"); }
      killTimer = setTimeout(() => {
        try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); } catch { child.kill?.("SIGKILL"); }
        finish({ status: null, error: "interrupted" });
      }, 1000);
    };
    try {
      child = (options.spawn ?? spawn)(invocation.command, invocation.args, {
        env: invocation.env, cwd: invocation.cwd, shell: invocation.shell,
        stdio: "inherit", windowsHide: false, detached: process.platform !== "win32"
      });
    } catch { finish({ status: null }); return; }
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    // A prerequisite diagnostic still prints to the terminal; callers also get its code.
    const prerequisite = invocation.helperPrerequisiteIssue ? { error: invocation.helperPrerequisiteIssue.code } : {};
    child.once("error", () => finish({ status: null }));
    child.once("close", status => finish({ status, ...prerequisite }));
  }); } finally { invocation.cleanup(); }
}

function collect(command, args, options, maxBytes, input, preparedEnvironment) {
  return new Promise(resolve => {
    let child;
    let output = "";
    let bytes = 0;
    let failed = false;
    let settled = false;
    let missing = false;
    let diagnostic = "";
    let timer;
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      resolve(result);
    };
    const stop = () => {
      if (child?.pid) {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch { try { child.kill("SIGKILL"); } catch { /* Already stopped. */ } }
      }
      child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy();
      finish({ status: null, stdout: "", failed: true, missing });
    };
    try {
      child = (options.spawn ?? spawn)(command, args, {
        env: preparedEnvironment ?? connectionEnvironment(options.env), cwd: options.cwd, shell: options.shell ?? false,
        detached: process.platform !== "win32",
        windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
      });
    } catch { finish({ status: null, failed: true }); return; }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const timeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.min(options.timeoutMs, 45000) : 45000;
    timer = setTimeout(stop, timeout);
    timer.unref?.();
    child.once("error", error => { missing = error.code === "ENOENT"; stop(); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) { failed = true; output = ""; stop(); }
      else if (!failed) output += chunk;
    });
    // Retain only the availability classification, never diagnostic contents.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      diagnostic = (diagnostic + chunk).slice(-512);
      if (/\bENOTCACHED\b|could not determine executable to run/i.test(diagnostic)) missing = true;
    });
    child.stdin.on("error", () => { failed = true; });
    child.once("close", status => finish({ status, stdout: failed ? "" : output, failed, missing }));
    child.stdin.end(input ?? "");
  });
}

function allowedRequest(request) {
  if (!request || typeof request.url !== "string" || /[\x00-\x1f\x7f]/.test(request.url)) return null;
  let url;
  try { url = new URL(request.url); } catch { return null; }
  if (url.origin !== "https://copilot.colosseum.com" || url.username || url.password || url.hash) return null;
  if (request.method === "POST") {
    return ["/api/v2/search/projects", "/api/v2/search/archives"].includes(url.pathname) && !url.search &&
      request.body !== null && typeof request.body === "object" && !Array.isArray(request.body) ? url : null;
  }
  if (request.method !== "GET" || request.body != null) return null;
  if (["/api/v2/status", "/api/v2/filters", "/api/v2/categories"].includes(url.pathname)) return !url.search ? url : null;
  if (/^\/api\/v2\/projects\/by-slug\/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(url.pathname)) return !url.search ? url : null;
  if (!/^\/api\/v2\/archives\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname)) return null;
  return [...url.searchParams].every(([key, value]) => ["offset", "maxChars"].includes(key) && /^\d+$/.test(value)) ? url : null;
}

const quote = value => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// The resolved target, not only the PATH directory that names it, must be trusted.
function trustedTransportExecutable(name, env) {
  return trustedSystemExecutable(process.platform === "win32" ? `${name}.exe` : name, env?.PATH);
}

function sanitizedResponse(stdout, token) {
  const boundary = stdout.lastIndexOf(COLOSSEUM_HTTP_MARKER);
  const code = boundary >= 0 ? stdout.slice(boundary + COLOSSEUM_HTTP_MARKER.length).trim() : "";
  if (!/^[1-5]\d{2}$/.test(code)) return "";
  // Error payloads are not exposed by the parser; discard them while private.
  if (code !== "200") return `${COLOSSEUM_HTTP_MARKER}${code}`;
  const redact = value => {
    if (typeof value === "string") return value.replaceAll(token, "[redacted]");
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redact(item)]));
    return value;
  };
  try { return `${JSON.stringify(redact(JSON.parse(stdout.slice(0, boundary))))}${COLOSSEUM_HTTP_MARKER}${code}`; }
  catch { return ""; }
}

/** No token is returned, saved, placed in argv/env, or exposed to the caller. */
export async function runColosseumRequest(request, options = {}) {
  const requestUrl = allowedRequest(request);
  if (!requestUrl) return { status: null, transport_error: "invalid_arguments" };
  let transportEnvironment;
  try { transportEnvironment = connectionEnvironment(options.env); }
  catch { return { status: null, helper_error: "helper_environment_unavailable" }; }
  const curl = trustedTransportExecutable("curl", transportEnvironment);
  // A missing transport must not trigger token retrieval or renewal.
  if (!curl) return { status: null, transport_error: "transport_missing" };
  let invocation;
  try { invocation = (options.createHelperInvocation ?? createHelperInvocation)(["token"], { env: transportEnvironment, cache: options.helperCache }); }
  catch { return { status: null, helper_error: "helper_environment_unavailable" }; }
  if (invocation.helperCacheIssue) { invocation.cleanup(); return { status: null, helper_error: "helper_untrusted" }; }
  let helper;
  let token = "";
  try {
    helper = await collect(invocation.command, invocation.args, { ...options, cwd: invocation.cwd, shell: invocation.shell }, 8193, undefined, invocation.env);
    if (helper.failed || helper.status !== 0) {
      return { status: null, helper_error: helper.missing ? "helper_missing" : helperFailureCode(helper) };
    }
    token = helper.stdout.trim();
    if (!/^[\x21-\x7e]{1,8192}$/.test(token)) return { status: null, helper_error: "invalid_response" };
    const lines = [
      `url = ${quote(requestUrl.href)}`, `request = ${quote(request.method)}`,
      `header = ${quote(`Authorization: Bearer ${token}`)}`,
      'header = "Accept: application/json"', "silent", "show-error",
      "max-time = 20", "connect-timeout = 10", 'proto = "=https"',
      'write-out = "\\nPROOFPILOT_HTTP_STATUS:%{http_code}"'
    ];
    if (request.body != null) {
      lines.push('header = "Content-Type: application/json"', `data-binary = ${quote(JSON.stringify(request.body))}`);
    }
    const result = await collect(curl, ["--disable", "--config", "-"],
      { ...options, cwd: invocation.cwd, shell: false }, COLOSSEUM_MAX_BYTES, `${lines.join("\n")}\n`, transportEnvironment);
    // Decode before redaction so JSON escapes cannot restore a private bearer.
    const stdout = sanitizedResponse(result.stdout || "", token);
    return { status: result.failed ? null : result.status, stdout };
  } finally {
    token = "";
    if (helper) helper.stdout = "";
    invocation.cleanup();
  }
}

export function parseColosseumResponse(response) {
  if (response?.helper_error) return { error: response.helper_error, http_status: null };
  if (response?.transport_error) return { error: response.transport_error, http_status: null };
  if (response?.error || response?.status !== 0 || typeof response?.stdout !== "string" || Buffer.byteLength(response.stdout) > COLOSSEUM_MAX_BYTES) {
    return { error: "unavailable", http_status: null };
  }
  const boundary = response.stdout.lastIndexOf(COLOSSEUM_HTTP_MARKER);
  const codeText = boundary >= 0 ? response.stdout.slice(boundary + COLOSSEUM_HTTP_MARKER.length).trim() : "";
  if (!/^[1-5]\d{2}$/.test(codeText)) return { error: "invalid_response", http_status: null };
  const http_status = Number(codeText);
  if (http_status !== 200) {
    const error = ({ 401: "unauthorized401", 402: "payment_required402", 403: "forbidden403", 404: "not_found404", 429: "rate_limited429" })[http_status]
      ?? (http_status >= 300 && http_status < 400 ? "redirect_refused" : "unavailable");
    return { error, http_status };
  }
  try { return { data: JSON.parse(response.stdout.slice(0, boundary)), http_status }; }
  catch { return { error: "invalid_response", http_status }; }
}
