import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), "..");
const discoveryUrl = pathToFileURL(path.join(root, "skills/proofpilot/scripts/discover-sources.js")).href;
const setupUrl = pathToFileURL(path.join(root, "skills/proofpilot/scripts/setup.js")).href;
const isolationUrl = pathToFileURL(path.join(root, "scripts/test-isolation.js")).href;
const connectionFields = ["colosseum_copilot_connection_stored", "colosseum_copilot_connection_status", "colosseum_copilot_connection_reason"];
const optionalCredentials = ["github_token_configured", "kaggle_configured", "hugging_face_token_configured",
  "openai_key_configured", "anthropic_key_configured", "gemini_key_configured"];

// Paths and file bytes, so a scenario proves inspection wrote, repaired or removed nothing.
function snapshot(directory) {
  const entries = [];
  const visit = (current, prefix = "") => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(file);
      entries.push(stat.isDirectory() ? `${relative}/` : `${relative}:${stat.isFile() ? fs.readFileSync(file, "base64") : "other"}`);
      if (stat.isDirectory()) visit(file, relative);
    }
  };
  visit(directory);
  return entries;
}

export function runDiscoveryCredentialTests() {
  const token = "synthetic-kaggle-token-must-not-appear";
  const username = "synthetic-kaggle-user-must-not-appear";
  const key = "synthetic-kaggle-key-must-not-appear";
  const connectionSecret = "synthetic-colosseum-token-must-not-appear";
  // The pinned helper's package digest cannot be reproduced offline, so these
  // scenarios replace only the helper process reply; setup.js parsing and the
  // discovery mapping run unchanged.
  const storedReply = credentialState => ({ status: 0, stderr: connectionSecret, stdout: JSON.stringify({
    state: "stored credentials present (not verified)", credentialState, scopes: ["evidence:read"], token: connectionSecret }) });
  const managedHelper = ".proofpilot/helpers/copilot-connect-0.2.2/node_modules/@colosseum-org/copilot-connect";
  const scenarios = [
    { name: "no credentials", env: {}, configured: false },
    { name: "API token only", env: { KAGGLE_API_TOKEN: token }, configured: true },
    { name: "empty API token", env: { KAGGLE_API_TOKEN: "" }, configured: false },
    { name: "legacy pair", env: { KAGGLE_USERNAME: username, KAGGLE_KEY: key }, configured: true },
    { name: "legacy username only", env: { KAGGLE_USERNAME: username }, configured: false },
    { name: "legacy key only", env: { KAGGLE_KEY: key }, configured: false },
    { name: "token file", files: { ".kaggle/access_token": `\n${token}\n` }, configured: true },
    { name: "token text file", files: { ".kaggle/access_token.txt": token }, configured: true },
    { name: "empty token file", files: { ".kaggle/access_token": " \n\t" }, configured: false },
    { name: "token file via environment", env: dir => ({ KAGGLE_API_TOKEN: path.join(dir, "token-file") }), files: { "token-file": token }, configured: true },
    { name: "empty token file via environment", env: dir => ({ KAGGLE_API_TOKEN: path.join(dir, "token-file") }), files: { "token-file": " \n" }, configured: false },
    { name: "legacy file", files: { ".kaggle/kaggle.json": JSON.stringify({ username, key }) }, configured: true },
    { name: "malformed legacy file", files: { ".kaggle/kaggle.json": `{${key}` }, configured: false },
    { name: "empty legacy key", files: { ".kaggle/kaggle.json": JSON.stringify({ username, key: " " }) }, configured: false },
    { name: "invalid legacy field types", files: { ".kaggle/kaggle.json": JSON.stringify({ username, key: 42 }) }, configured: false },
    { name: "partial legacy file plus environment", env: { KAGGLE_KEY: key }, files: { ".kaggle/kaggle.json": JSON.stringify({ username }) }, configured: true },
    { name: "custom legacy config directory", env: dir => ({ KAGGLE_CONFIG_DIR: path.join(dir, "custom") }), files: { "custom/kaggle.json": JSON.stringify({ username, key }) }, configured: true },
    { name: "custom directory excludes default legacy file", env: dir => ({ KAGGLE_CONFIG_DIR: path.join(dir, "custom") }), files: { ".kaggle/kaggle.json": JSON.stringify({ username, key }) }, configured: false },
    { name: "custom directory does not relocate default token file", env: dir => ({ KAGGLE_CONFIG_DIR: path.join(dir, "custom") }), files: { ".kaggle/access_token": token }, configured: true },
    { name: "custom directory token is not a default token source", env: dir => ({ KAGGLE_CONFIG_DIR: path.join(dir, "custom") }), files: { "custom/access_token": token }, configured: false },
    { name: "Linux XDG default", platform: "linux", files: { ".config/kaggle/kaggle.json": JSON.stringify({ username, key }) }, configured: true },
    { name: "Linux custom XDG", platform: "linux", env: dir => ({ XDG_CONFIG_HOME: path.join(dir, "xdg") }), files: { "xdg/kaggle/kaggle.json": JSON.stringify({ username, key }) }, configured: true },
    { name: "Linux prefers existing .kaggle", platform: "linux", files: { ".kaggle/kaggle.json": "{}", ".config/kaggle/kaggle.json": JSON.stringify({ username, key }) }, configured: false },
    { name: "credential paths must be regular files", directories: [".kaggle/access_token", ".kaggle/kaggle.json"], configured: false },
    { name: "oversized credential file", files: { ".kaggle/access_token": token + "x".repeat(64 * 1024) }, configured: false },
    { name: "optional credential whitespace", env: {
      GITHUB_TOKEN: " \n\t", GH_TOKEN: " ", HF_TOKEN: "\t", HUGGINGFACE_TOKEN: " ", OPENAI_API_KEY: " \n",
      ANTHROPIC_API_KEY: "\t", GEMINI_API_KEY: " ", GOOGLE_API_KEY: "\n"
    }, configured: false, credentials: { github_token_configured: false, hugging_face_token_configured: false,
      openai_key_configured: false, anthropic_key_configured: false, gemini_key_configured: false } },
    { name: "optional credential values", env: {
      GITHUB_TOKEN: token, HF_TOKEN: token, OPENAI_API_KEY: token, ANTHROPIC_API_KEY: token, GEMINI_API_KEY: token
    }, configured: false, credentials: { github_token_configured: true, hugging_face_token_configured: true,
      openai_key_configured: true, anthropic_key_configured: true, gemini_key_configured: true } },
    { name: "optional valid aliases after empty primary", env: {
      GITHUB_TOKEN: " ", GH_TOKEN: token, HF_TOKEN: "\t", HUGGINGFACE_TOKEN: token,
      GEMINI_API_KEY: "\n", GOOGLE_API_KEY: token
    }, configured: false, credentials: { github_token_configured: true, hugging_face_token_configured: true,
      openai_key_configured: false, anthropic_key_configured: false, gemini_key_configured: true } },
    { name: "optional blank aliases", env: { GH_TOKEN: "\t", HUGGINGFACE_TOKEN: " ", GOOGLE_API_KEY: "\n" },
      configured: false, credentials: { github_token_configured: false, hugging_face_token_configured: false,
        openai_key_configured: false, anthropic_key_configured: false, gemini_key_configured: false } },
    // Every scenario above runs the real offline probe in a home without a prepared helper.
    { name: "Colosseum helper not prepared", configured: false, colosseum: { stored: null, status: "helper_missing" } },
    { name: "Colosseum stored connection", configured: false, helper: storedReply("ready"),
      colosseum: { stored: true, status: "configured_unverified" } },
    { name: "Colosseum stored expired connection", configured: false, helper: storedReply("expired"),
      colosseum: { stored: true, status: "expired" } },
    { name: "Colosseum not logged in", configured: false, helper: { status: 5, stdout: JSON.stringify({ state: "not-logged-in" }), stderr: "" },
      colosseum: { stored: false, status: "missing" } },
    { name: "Colosseum not logged in with zero exit", configured: false, helper: { status: 0, stdout: JSON.stringify({ state: "not-logged-in" }), stderr: "" },
      colosseum: { stored: false, status: "missing" } },
    { name: "Colosseum untrusted helper cache", configured: false, helper: null, marker: "untrusted-helper-ran", files: dir => ({
      [`${managedHelper}/package.json`]: JSON.stringify({ name: "@colosseum-org/copilot-connect", version: "0.2.2", type: "module", bin: { "copilot-connect": "src/cli.js" } }),
      [`${managedHelper}/src/cli.js`]: `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(path.join(dir, "untrusted-helper-ran"))}, "");\n`
    }), colosseum: { stored: null, status: "helper_untrusted", reason: /repeating sign-in alone cannot repair it/ } },
    { name: "Colosseum helper environment unavailable", configured: false, helper: null,
      files: { ".config": "Synthetic file where the helper configuration directory belongs\n" },
      colosseum: { stored: null, status: "unavailable", reason: "helper_environment_unavailable" } },
    { name: "Colosseum helper failure", configured: false, helper: { status: 1, stdout: "", stderr: connectionSecret },
      colosseum: { stored: null, status: "unavailable" } },
    { name: "Colosseum expiry exit without a stored state", configured: false, helper: { status: 2, stdout: "", stderr: "" },
      colosseum: { stored: null, status: "expired" } },
    { name: "Colosseum invalid helper reply", configured: false, helper: { status: 0, stdout: JSON.stringify({ state: connectionSecret }), stderr: "" },
      colosseum: { stored: null, status: "invalid_response" } }
  ];

  // Inspection may start only the offline status probe: token and login use
  // spawn. A declared helper reply replaces spawnSync; null means no process may start.
  const prelude = (scenario, isolatedHome) => [
    'import os from "node:os";',
    'import childProcess from "node:child_process";',
    'import { syncBuiltinESMExports } from "node:module";',
    `os.homedir = () => ${JSON.stringify(isolatedHome)};`,
    `Object.defineProperty(process, "platform", { value: ${JSON.stringify(scenario.platform || "darwin")} });`,
    "childProcess.spawn = () => process.exit(98);",
    ...(Object.hasOwn(scenario, "helper") ? [
      `const reply = ${JSON.stringify(scenario.helper)};`,
      "let probes = 0;",
      "childProcess.spawnSync = (command, args, options) => {",
      "  if (reply === null || ++probes > 1 || command !== process.execPath || options?.shell !== false) process.exit(97);",
      "  return reply;",
      "};"
    ] : []),
    "syncBuiltinESMExports();"
  ].join("\n");

  // Minimal child environments still isolate both account and environment home lookups.
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-discovery-test-"));
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const isolatedHome = path.join(temporaryRoot, String(index));
      fs.mkdirSync(isolatedHome, { mode: 0o700 });
      for (const directory of scenario.directories || []) {
        fs.mkdirSync(path.join(isolatedHome, directory), { recursive: true, mode: 0o700 });
      }
      const files = typeof scenario.files === "function" ? scenario.files(isolatedHome) : scenario.files || {};
      for (const [relativePath, contents] of Object.entries(files)) {
        const fixture = path.join(isolatedHome, relativePath);
        fs.mkdirSync(path.dirname(fixture), { recursive: true, mode: 0o700 });
        fs.writeFileSync(fixture, contents, { mode: 0o600 });
      }
      const before = snapshot(isolatedHome);
      const scenarioEnv = typeof scenario.env === "function" ? scenario.env(isolatedHome) : scenario.env || {};
      const run = (label, entry) => {
        const result = spawnSync(process.execPath, ["--import", isolationUrl, "--input-type=module", "--eval", `${prelude(scenario, isolatedHome)}\n${entry}`], {
          cwd: root,
          env: { ...scenarioEnv, HOME: isolatedHome, USERPROFILE: isolatedHome, PROOFPILOT_TEST_HOME: isolatedHome,
            NODE_OPTIONS: `--import=${isolationUrl}` },
          encoding: "utf8",
          timeout: 15000
        });
        assert.ifError(result.error);
        assert.notEqual(result.status, 97, `${label} started an unexpected helper process for ${scenario.name}`);
        assert.notEqual(result.status, 98, `${label} started a token or login process for ${scenario.name}`);
        assert.equal(result.status, 0, `${label} failed for ${scenario.name}`);
        for (const secret of [token, username, key, connectionSecret]) {
          assert.ok(!result.stdout.includes(secret), `${label} leaked a credential to stdout`);
          assert.ok(!result.stderr.includes(secret), `${label} leaked a credential to stderr`);
        }
        if (scenario.marker) {
          assert.equal(fs.existsSync(path.join(isolatedHome, scenario.marker)), false, `${label} executed an untrusted helper cache`);
        }
        assert.deepEqual(snapshot(isolatedHome), before, `${label} changed the isolated home for ${scenario.name}`);
        return JSON.parse(result.stdout);
      };

      const { credentials } = run("Discovery", `await import(${JSON.stringify(discoveryUrl)});`);
      assert.deepEqual(Object.keys(credentials).sort(), [...connectionFields, ...optionalCredentials].sort(),
        `${scenario.name}: credential hints gained or lost a field`);
      assert.equal(credentials.kaggle_configured, scenario.configured, scenario.name);
      for (const [name, expected] of Object.entries(scenario.credentials || {})) {
        assert.equal(credentials[name], expected, `${scenario.name}: ${name}`);
      }
      assert.ok(optionalCredentials.every(name => typeof credentials[name] === "boolean"),
        "Optional credential hints must contain booleans only");

      // Presence is true or false only where setup.js established it; otherwise
      // null with setup's own status and reason, never an absent-looking false.
      const connection = scenario.colosseum ?? { stored: null, status: "helper_missing" };
      assert.equal(credentials.colosseum_copilot_connection_stored, connection.stored,
        `${scenario.name}: connection presence (tests must not observe the real account home)`);
      assert.equal(credentials.colosseum_copilot_connection_status, connection.status, `${scenario.name}: connection status`);
      assert.equal(typeof credentials.colosseum_copilot_connection_reason, "string", `${scenario.name}: connection reason`);
      if (connection.reason instanceof RegExp) assert.match(credentials.colosseum_copilot_connection_reason, connection.reason);
      else if (connection.reason) assert.equal(credentials.colosseum_copilot_connection_reason, connection.reason);
      if (scenario.colosseum) {
        const primary = run("Setup status",
          `const { getSetupStatus } = await import(${JSON.stringify(setupUrl)}); console.log(JSON.stringify(getSetupStatus()));`).colosseum;
        assert.equal(primary.status, connection.status, `${scenario.name}: setup status`);
        assert.equal(credentials.colosseum_copilot_connection_reason, primary.reason, `${scenario.name}: discovery must reuse setup's reason`);
        assert.equal(primary.configured, connection.stored === true, `${scenario.name}: presence must agree with setup configured`);
        if (connection.status === "helper_untrusted") assert.equal(primary.credentials_inspected, false);
      }
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  return { cases: 1, scenarios: scenarios.length };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(filename)) {
  const summary = runDiscoveryCredentialTests();
  console.log(`Discovery credential regression test passed: ${summary.scenarios} scenarios. No account API called.`);
}
