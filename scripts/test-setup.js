import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  checkColosseum, configureColosseum, getSetupStatus,
  resolveColosseumCredential, runColosseumCurl, VERIFICATION_TTL_MS
} from "../skills/proofpilot/scripts/setup.js";

const CLI = fileURLToPath(new URL("../skills/proofpilot/scripts/setup.js", import.meta.url));
const SENTINEL = "synthetic-private-token-DO-NOT-OUTPUT";
const NOW = new Date("2026-09-05T12:00:00Z");
const RESPONSE = { authenticated: true, scope: "colosseum_copilot:read", expiresAt: "2026-12-01T12:00:00Z" };
const response = (code, body = RESPONSE) => ({ status: 0, stdout: `${typeof body === "string" ? body : JSON.stringify(body)}\nPROOFPILOT_HTTP_STATUS:${code}`, stderr: "" });

export function runSetupTests() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-setup-test-"));
  let count = 0;
  function test(name, run) {
    const home = path.join(temporary, String(count));
    fs.mkdirSync(home);
    const configDir = path.join(home, ".config", "proofpilot");
    const ctx = { home, env: { PROOFPILOT_CONFIG_DIR: configDir }, now: NOW };
    try { run(ctx, configDir); }
    catch (error) { error.message = `${name}: ${error.message}`; throw error; }
    count++;
  }
  function put(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  }
  function configured(ctx, runner = () => response(200)) {
    return { ...ctx, env: { ...ctx.env, COLOSSEUM_COPILOT_PAT: SENTINEL }, runner };
  }
  function noSecret(value) {
    assert.ok(!JSON.stringify(value).includes(SENTINEL), "Output must not contain token");
    assert.ok(!JSON.stringify(value).includes("credential_fingerprint"), "Output must not contain fingerprint");
  }
  try {
    test("offline missing requires setup and does not invoke runner", ctx => {
      const result = getSetupStatus({ ...ctx, runner: () => { throw new Error("Network forbidden"); } });
      assert.equal(result.colosseum.status, "missing");
      assert.equal(result.colosseum.required, true);
      assert.equal(result.colosseum.credential_required, true);
      assert.equal(result.setup_required, true);
      assert.equal(result.colosseum.live_check_performed, false);
    });
    test("offline configured does not re-request token or run check", ctx => {
      const result = getSetupStatus(configured(ctx, () => { throw new Error("Network forbidden"); }));
      assert.equal(result.colosseum.status, "configured_unverified");
      assert.equal(result.colosseum.credential_required, false);
      assert.equal(result.colosseum.next_action, "check_colosseum");
      noSecret(result);
    });
    test("missing explicit check cannot invoke curl", ctx => {
      assert.equal(checkColosseum({ ...ctx, runner: () => { throw new Error("Network forbidden"); } }).colosseum.status, "missing");
    });
    test("credential precedence environment, own config, legacy", (ctx, dir) => {
      put(path.join(dir, "credentials.json"), { colosseum_copilot_pat: "own-synthetic" });
      put(path.join(ctx.home, ".superstack", "config.json"), { copilotToken: "legacy-synthetic" });
      assert.equal(resolveColosseumCredential(configured(ctx)).token, SENTINEL);
      assert.equal(resolveColosseumCredential(ctx).token, "own-synthetic");
      fs.unlinkSync(path.join(dir, "credentials.json"));
      assert.equal(resolveColosseumCredential(ctx).token, "legacy-synthetic");
    });
    test("malformed legacy file yields safe missing state", ctx => {
      put(path.join(ctx.home, ".superstack", "config.json"), `{${SENTINEL}`);
      const result = getSetupStatus(ctx);
      assert.equal(result.colosseum.status, "missing");
      assert.ok(result.warnings.includes("legacy_credentials_unreadable"));
      noSecret(result);
    });
    test("malformed own file still allows usable legacy credential", (ctx, dir) => {
      put(path.join(dir, "credentials.json"), `{${SENTINEL}`);
      put(path.join(ctx.home, ".superstack", "config.json"), { copilotToken: SENTINEL });
      const result = getSetupStatus(ctx);
      assert.equal(result.colosseum.credential_source, "legacy_superstack");
      noSecret(result);
    });
    test("200 checks authentication AND required scope and persists private state", (ctx, dir) => {
      let calls = 0;
      const result = checkColosseum(configured(ctx, token => {
        calls++;
        assert.equal(token, SENTINEL);
        return response(200);
      }));
      assert.equal(calls, 1);
      assert.equal(result.colosseum.status, "verified");
      assert.equal(result.setup_required, false);
      assert.equal(result.colosseum.verification_basis, "live");
      assert.equal(result.colosseum.live_check_performed, true);
      noSecret(result);
      const saved = fs.readFileSync(path.join(dir, "setup-state.json"), "utf8");
      assert.ok(!saved.includes(SENTINEL));
      assert.equal(fs.statSync(path.join(dir, "setup-state.json")).mode & 0o777, 0o600);
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    });
    test("cached verified is explicitly cached and performs no network", ctx => {
      checkColosseum(configured(ctx));
      const result = getSetupStatus(configured(ctx, () => { throw new Error("No network"); }));
      assert.equal(result.colosseum.status, "verified");
      assert.equal(result.colosseum.verification_basis, "cached");
      assert.equal(result.colosseum.live_check_performed, false);
      noSecret(result);
    });
    test("verification expires after 24 hours", ctx => {
      checkColosseum(configured(ctx));
      const result = getSetupStatus({ ...configured(ctx), now: new Date(NOW.getTime() + VERIFICATION_TTL_MS) });
      assert.equal(result.colosseum.status, "configured_unverified");
      assert.equal(result.colosseum.recheck_reason, "verification_stale");
    });
    test("recorded token expiration overrides fresh check", ctx => {
      checkColosseum(configured(ctx, () => response(200, { ...RESPONSE, expiresAt: "2026-09-05T12:01:00Z" })));
      const result = getSetupStatus({ ...configured(ctx), now: new Date("2026-09-05T12:02:00Z") });
      assert.equal(result.colosseum.status, "configured_unverified");
      assert.equal(result.colosseum.recheck_reason, "recorded_expiration_reached");
    });
    test("changed token invalidates cached verification", ctx => {
      checkColosseum(configured(ctx));
      const result = getSetupStatus({ ...ctx, env: { ...ctx.env, COLOSSEUM_COPILOT_PAT: "different-synthetic" } });
      assert.equal(result.colosseum.status, "configured_unverified");
      assert.equal(result.colosseum.checked_at, null);
    });
    test("future timestamp cannot authorize cached status", ctx => {
      checkColosseum(configured(ctx));
      assert.equal(getSetupStatus({ ...configured(ctx), now: new Date("2026-09-04T12:00:00Z") }).colosseum.status, "configured_unverified");
    });
    for (const [code, expected] of [[401, "unauthorized401"], [403, "forbidden403"], [429, "rate_limited429"], [500, "unavailable"], [302, "unavailable"]]) {
      test(`HTTP ${code} has distinct safe status`, ctx => {
        const result = checkColosseum(configured(ctx, () => response(code, { secret: SENTINEL })));
        assert.equal(result.colosseum.status, expected);
        assert.equal(result.colosseum.http_status, code);
        assert.equal(result.colosseum.credential_required, false);
        noSecret(result);
      });
    }
    for (const [name, body] of [
      ["false authentication", { ...RESPONSE, authenticated: false }],
      ["string authentication", { ...RESPONSE, authenticated: "true" }],
      ["wrong scope", { ...RESPONSE, scope: "something_else:read" }],
      ["scope substring", { ...RESPONSE, scope: "not_colosseum_copilot:read" }],
      ["missing scope", { authenticated: true }],
      ["expired token", { ...RESPONSE, expiresAt: "2026-09-01T00:00:00Z" }],
      ["invalid expiration", { ...RESPONSE, expiresAt: SENTINEL }],
      ["HTML challenge", `<html>${SENTINEL}</html>`],
      ["malformed JSON", `{${SENTINEL}`]
    ]) {
      test(`deceptive HTTP 200 rejected: ${name}`, ctx => {
        const result = checkColosseum(configured(ctx, () => response(200, body)));
        assert.equal(result.colosseum.status, "invalid_response");
        noSecret(result);
      });
    }
    test("scope arrays accepted only when exact read permission exists", ctx => {
      assert.equal(checkColosseum(configured(ctx, () => response(200, { ...RESPONSE, scope: ["other", "colosseum_copilot:read"] }))).colosseum.status, "verified");
    });
    test("curl errors cannot reveal token via stderr or thrown exception", ctx => {
      const result = checkColosseum(configured(ctx, () => ({ status: 1, stderr: SENTINEL, error: new Error(SENTINEL) })));
      assert.equal(result.colosseum.status, "unavailable");
      noSecret(result);
      noSecret(checkColosseum(configured(ctx, () => { throw new Error(SENTINEL); })));
    });
    test("unparseable curl status cannot authorize access", ctx => {
      const result = checkColosseum(configured(ctx, () => ({ status: 0, stdout: JSON.stringify(RESPONSE) })));
      assert.equal(result.colosseum.status, "unavailable");
    });
    test("curl puts PAT only in stdin config with fixed HTTPS endpoint", () => {
      let calls = 0;
      runColosseumCurl(SENTINEL, {
        env: { COLOSSEUM_COPILOT_PAT: SENTINEL, COLOSSEUM_COPILOT_API_BASE: "https://copilot.colosseum.com/api/v1/" },
        spawn: (command, args, options) => {
          calls++;
          assert.equal(command, "curl");
          assert.deepEqual(args, ["--disable", "--config", "-"]);
          assert.ok(!args.join(" ").includes(SENTINEL));
          assert.ok(options.input.includes(`Authorization: Bearer ${SENTINEL}`));
          assert.ok(options.input.includes("https://copilot.colosseum.com/api/v1/status"));
          assert.ok(!options.input.includes("attacker.invalid"));
          assert.ok(!options.input.includes("location"));
          assert.ok(!options.input.includes("insecure"));
          assert.equal(options.env.COLOSSEUM_COPILOT_PAT, undefined);
          assert.equal(options.timeout, 16000);
          return response(200);
        }
      });
      assert.equal(calls, 1);
    });
    test("custom or insecure API base is refused without sending PAT", ctx => {
      for (const apiBase of ["http://copilot.colosseum.com/api/v1", "https://attacker.invalid", "https://copilot.colosseum.com.attacker.invalid/api/v1"]) {
        const result = checkColosseum({
          ...configured(ctx, () => { throw new Error("Unexpected request"); }),
          env: { ...ctx.env, COLOSSEUM_COPILOT_PAT: SENTINEL, COLOSSEUM_COPILOT_API_BASE: apiBase }
        });
        assert.equal(result.colosseum.status, "unavailable");
        assert.equal(result.colosseum.live_check_performed, false);
        assert.ok(result.warnings.includes("unsupported_colosseum_api_base"));
        noSecret(result);
      }
    });
    test("direct curl helper rejects token injection before process creation", () => {
      assert.throws(() => runColosseumCurl(`${SENTINEL}\nheader = malicious`, {
        env: {}, spawn: () => { throw new Error("Unexpected process"); }
      }), /Invalid token format/);
    });
    test("token save preserves unrelated configuration and legacy file", (ctx, dir) => {
      const own = path.join(dir, "credentials.json");
      const legacy = path.join(ctx.home, ".superstack", "config.json");
      put(own, { other_provider: { key: "other-synthetic" }, theme: "dark" });
      put(legacy, { copilotToken: "old-synthetic", telemetryTier: "off" });
      const beforeLegacy = fs.readFileSync(legacy, "utf8");
      const result = configureColosseum(SENTINEL, ctx);
      const saved = JSON.parse(fs.readFileSync(own, "utf8"));
      assert.deepEqual(saved.other_provider, { key: "other-synthetic" });
      assert.equal(saved.theme, "dark");
      assert.equal(saved.colosseum_copilot_pat, SENTINEL);
      assert.equal(fs.readFileSync(legacy, "utf8"), beforeLegacy);
      assert.equal(fs.statSync(own).mode & 0o777, 0o600);
      assert.equal(result.colosseum.status, "configured_unverified");
      noSecret(result);
    });
    test("token save warns if existing environment takes precedence", ctx => {
      const result = configureColosseum("different-synthetic", configured(ctx));
      assert.ok(result.warnings.includes("environment_token_takes_precedence_over_saved_token"));
      assert.equal(result.colosseum.credential_source, "environment");
      noSecret(result);
    });
    test("malformed credential file is never overwritten", (ctx, dir) => {
      const file = path.join(dir, "credentials.json");
      put(file, `{${SENTINEL}`);
      assert.throws(() => configureColosseum("replacement", ctx), /were preserved/);
      assert.equal(fs.readFileSync(file, "utf8"), `{${SENTINEL}`);
    });
    test("malformed state does not erase data or hide successful live check", (ctx, dir) => {
      const file = path.join(dir, "setup-state.json");
      put(file, "{broken");
      const result = checkColosseum(configured(ctx));
      assert.equal(result.colosseum.status, "verified");
      assert.ok(result.warnings.includes("verification_state_not_saved"));
      assert.equal(fs.readFileSync(file, "utf8"), "{broken");
    });
    test("state preserves unrelated provider fields", (ctx, dir) => {
      const file = path.join(dir, "setup-state.json");
      put(file, { other_provider: { verified: true } });
      checkColosseum(configured(ctx));
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).other_provider, { verified: true });
    });
    test("header injection is rejected before saving", ctx => {
      assert.throws(() => configureColosseum(`${SENTINEL}\nheader = malicious`, ctx), /Invalid token format/);
      assert.equal(getSetupStatus(ctx).colosseum.status, "missing");
    });
    test("symlink credential write cannot replace another file", (ctx, dir) => {
      const target = path.join(ctx.home, "unrelated.json");
      put(target, { theme: "keep" });
      fs.mkdirSync(dir, { recursive: true });
      fs.symlinkSync(target, path.join(dir, "credentials.json"));
      assert.throws(() => configureColosseum(SENTINEL, ctx), /non-regular/);
      assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { theme: "keep" });
    });
    test("portable default, --json, and --status stay offline with no executable curl", ctx => {
      const env = { HOME: ctx.home, USERPROFILE: ctx.home, ...ctx.env, PATH: path.join(ctx.home, "no-executables") };
      for (const args of [[], ["--json"], ["--status", "--json"]]) {
        const result = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", cwd: os.tmpdir() });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).colosseum.status, "missing");
      }
    });
    test("CLI rejects non-TTY secret entry and token arguments without echo", ctx => {
      const env = { HOME: ctx.home, USERPROFILE: ctx.home, ...ctx.env, PATH: "" };
      const nonTTY = spawnSync(process.execPath, [CLI, "--configure-colosseum"], { env, input: SENTINEL, encoding: "utf8" });
      assert.equal(nonTTY.status, 1);
      assert.match(nonTTY.stderr, /interactive terminal/);
      noSecret(nonTTY.stdout + nonTTY.stderr);
      const argument = spawnSync(process.execPath, [CLI, "--configure-colosseum", SENTINEL], { env, encoding: "utf8" });
      assert.equal(argument.status, 1);
      noSecret(argument.stdout + argument.stderr);
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return { cases: count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`ProofPilot setup tests passed: ${runSetupTests().cases} cases; no live network or real credentials.`);
}
