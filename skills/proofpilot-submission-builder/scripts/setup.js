#!/usr/bin/env node

// Offline by default. Copilot Connect owns OAuth storage and token renewal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDateTime } from "./validate-response.js";
import {
  COLOSSEUM_API_BASE, runConnectionHelper,
  helperFailureCode, loginColosseum, runColosseumRequest, parseColosseumResponse
} from "./colosseum-connection.js";

export const COLOSSEUM_STATUS_URL = `${COLOSSEUM_API_BASE}/status`;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const knownScopes = new Set(["evidence:read", "self-data:read", "telemetry:write", "copilot:retrieval", "copilot:self-data", "copilot:telemetry"]);
const reasons = {
  helper_missing: "The official connection helper is not available locally. Run the installed setup.js --connect-colosseum command to prepare the pinned helper and sign in.",
  helper_untrusted: "The managed connection-helper cache exists but failed validation, so it was not run. Saved account credentials were not inspected or changed. Follow the diagnostic recovery step before retrying helper preparation; repeating sign-in alone cannot repair it.",
  missing: "No V2 connection is saved. Connect through the official browser or device login.",
  configured_unverified: "Saved helper credentials are present. A local check does not verify server access.",
  verified: "The V2 status endpoint confirmed authentication and evidence:read access.",
  expired: "The authorization expired. Reconnect with the official helper; no credentials were removed.",
  revoked: "The authorization was revoked. Reconnect with the official helper; no credentials were removed.",
  refresh_pending: "Renewal is pending. Preserve credentials and check again; do not restart login on this evidence.",
  evidence_unavailable: "The evidence capability is unavailable. Preserve the connection and use public sources.",
  unauthorized401: "Authentication was rejected. Check helper status once before reconnecting.",
  forbidden403: "Permission was denied. Check scopes and account permissions; this does not establish expiry.",
  rate_limited429: "Rate limit reached. Wait before another check; no retry was attempted.",
  payment_required402: "Payment was requested. No payment or retry was attempted.",
  redirect_refused: "A redirect was refused. Credentials were not forwarded.",
  not_found404: "The V2 endpoint was not found. No V1 fallback was attempted.",
  transport_missing: "No curl executable is available in trusted system locations. Prepare system curl, then retry --check-colosseum; see references/onboarding.md for accepted locations. The verification request did not retrieve or renew a token; this does not establish an authorization failure.",
  unavailable: "The check could not complete. No conclusion about authorization validity is available.",
  invalid_response: "The response did not establish authenticated evidence access."
};

function summary(status, details = {}) {
  const configured = details.configured ?? !["missing", "helper_missing"].includes(status);
  return {
    schema_version: "2", setup_required: status !== "verified",
    colosseum: {
      required: true, auth_method: "oauth_pkce", api_version: "v2",
      configured, credential_required: !configured,
      credential_source: configured ? "copilot_connect" : null,
      status, checked_at: null, expires_at: null, scopes: [],
      verification_basis: "none", live_check_performed: false,
      reason: reasons[status],
      next_action: status === "verified" ? "ready" : status === "transport_missing" ? "prepare_curl" : status === "helper_untrusted" ? "repair_helper_cache" :
        ["missing", "helper_missing", "expired", "revoked"].includes(status) ? "connect_colosseum" : "check_colosseum",
      verification_scope: "V2 authentication and evidence read access only; corpus operations need their own checks.",
      ...details
    }, warnings: []
  };
}

function isoDate(value) {
  if (!isDateTime(value)) return null;
  return new Date(value).toISOString();
}

/** Storage-only diagnostic: no refresh, account request, PAT read or own cache. */
export function getSetupStatus(options = {}) {
  let result;
  try { result = (options.helperRunner ?? runConnectionHelper)(["status", "--local"], options); }
  catch (error) { return summary("unavailable", { configured: false, reason: "helper_environment_unavailable",
    ...(/^The connection-helper config path is unsafe:/.test(error.message) ? { diagnostic: error.message } : {}) }); }
  if (result?.helperCacheIssue) {
    // Only helper trust failed: credential presence is unknown, not absent.
    return summary("helper_untrusted", { configured: false, credential_required: false, credentials_inspected: false,
      helper_cache: result.helperCacheIssue.path, diagnostic: result.helperCacheIssue.diagnostic });
  }
  if (!result || result.error || result.status !== 0) return summary(helperFailureCode(result), { configured: false });
  let data;
  try { data = JSON.parse(result.stdout); } catch { return summary(helperFailureCode(result), { configured: false }); }
  if (!object(data)) return summary("invalid_response", { configured: false });
  if (data.state === "not-logged-in") return summary("missing");
  if (data.state !== "stored credentials present (not verified)" || !["ready", "refresh-pending", "expired", "revoked"].includes(data.credentialState)) {
    return summary("invalid_response", { configured: false });
  }
  const status = ({ expired: "expired", revoked: "revoked", "refresh-pending": "refresh_pending" })[data.credentialState] ?? "configured_unverified";
  return summary(status, {
    configured: true, credential_state: data.credentialState,
    expires_at: isoDate(data.accessExpiresAt),
    scopes: Array.isArray(data.scopes) ? data.scopes.filter(scope => knownScopes.has(scope)) : []
  });
}

/** Live V2 check using a private helper-to-curl transfer; never falls back to V1. */
export async function checkColosseum(options = {}) {
  const local = getSetupStatus(options);
  if (!["configured_unverified", "refresh_pending"].includes(local.colosseum.status)) return local;
  const checkedAt = new Date(options.now ?? new Date()).toISOString();
  let response;
  try {
    response = parseColosseumResponse(await (options.statusRunner ?? options.runner ?? runColosseumRequest)(
      { url: COLOSSEUM_STATUS_URL, method: "GET", body: null }, options
    ));
  } catch { response = { error: "unavailable", http_status: null }; }
  let status = response.error ?? "invalid_response";
  const data = response.data;
  const scopes = typeof data?.scope === "string" ? data.scope.split(/\s+/).filter(scope => knownScopes.has(scope)) : [];
  const expiresAt = isoDate(data?.expiresAt);
  const validExpiration = data?.expiresAt == null || (expiresAt && new Date(expiresAt) > new Date(options.now ?? new Date()));
  if (!response.error && object(data) && data.authenticated === true && validExpiration &&
      scopes.some(scope => ["evidence:read", "copilot:retrieval"].includes(scope))) {
    status = data.capabilities?.evidence === false ? "evidence_unavailable" : "verified";
  }
  return summary(Object.hasOwn(reasons, status) ? status : "invalid_response", {
    configured: local.colosseum.configured, checked_at: checkedAt, expires_at: expiresAt,
    scopes, http_status: response.http_status,
    verification_basis: response.http_status !== null ? "live" : "none",
    live_check_performed: response.http_status !== null
  });
}

export async function runSetupCli(args = process.argv.slice(2), options = {}) {
  const output = options.stdout ?? process.stdout;
  const errors = options.stderr ?? process.stderr;
  if (args.length === 1 && args[0] === "--help") {
    output.write("Usage: setup.js [--status | --connect-colosseum [--device] | --check-colosseum] [--json]\nDefault/--status: offline helper status --local; never proves readiness.\n--connect-colosseum: official browser PKCE sign-in; --device for remote environments.\n--check-colosseum: authenticated V2 GET /status using the official helper.\nNo PAT input, own credential file, retries, payments or remote writes.\n");
    return 0;
  }
  const actions = args.filter(arg => !["--json", "--device"].includes(arg));
  if (actions.length > 1 || (actions.length === 1 && !["--status", "--connect-colosseum", "--check-colosseum"].includes(actions[0])) ||
      args.filter(arg => arg === "--json").length > 1 || args.filter(arg => arg === "--device").length > 1 ||
      (args.includes("--device") && actions[0] !== "--connect-colosseum")) {
    errors.write("Unsupported arguments. Use --connect-colosseum for V2 sign-in; never pass a token as an argument.\n");
    return 1;
  }
  const action = actions[0] ?? "--status";
  if (action === "--connect-colosseum") {
    const login = await (options.loginRunner ?? loginColosseum)({ ...options, device: args.includes("--device") });
    if (login.error === "helper_untrusted") {
      errors.write(`Colosseum sign-in was not started. ${login.diagnostic}\n`);
      return 1;
    }
    if (login.status !== 0) { errors.write("Colosseum sign-in did not complete. Existing credentials were preserved.\n"); return 1; }
  }
  const result = action === "--status" ? getSetupStatus(options) : await checkColosseum(options);
  output.write(`${JSON.stringify(result, null, 2)}\n`);
  return action !== "--status" && result.colosseum.status !== "verified" ? 1 : 0;
}

if (process.argv[1]) {
  let invoked = path.resolve(process.argv[1]);
  try { invoked = fs.realpathSync(invoked); } catch { /* Not this entrypoint. */ }
  if (invoked === fileURLToPath(import.meta.url)) process.exitCode = await runSetupCli();
}
