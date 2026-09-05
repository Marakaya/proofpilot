import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), "..");
const discoveryUrl = pathToFileURL(path.join(root, "skills/proofpilot/scripts/discover-sources.js")).href;

export function runDiscoveryCredentialTests() {
  const token = "synthetic-kaggle-token-must-not-appear";
  const username = "synthetic-kaggle-user-must-not-appear";
  const key = "synthetic-kaggle-key-must-not-appear";
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
    { name: "oversized credential file", files: { ".kaggle/access_token": token + "x".repeat(64 * 1024) }, configured: false }
  ];

  // Isolate discovery from real home directories and credentials without changing HOME.
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-discovery-test-"));
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const isolatedHome = path.join(temporaryRoot, String(index));
      fs.mkdirSync(isolatedHome, { mode: 0o700 });
      for (const directory of scenario.directories || []) {
        fs.mkdirSync(path.join(isolatedHome, directory), { recursive: true, mode: 0o700 });
      }
      for (const [relativePath, contents] of Object.entries(scenario.files || {})) {
        const fixture = path.join(isolatedHome, relativePath);
        fs.mkdirSync(path.dirname(fixture), { recursive: true, mode: 0o700 });
        fs.writeFileSync(fixture, contents, { mode: 0o600 });
      }
      const script = `import os from "node:os"; os.homedir = () => ${JSON.stringify(isolatedHome)}; Object.defineProperty(process, "platform", { value: ${JSON.stringify(scenario.platform || "darwin")} }); await import(${JSON.stringify(discoveryUrl)});`;
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
        cwd: root,
        env: typeof scenario.env === "function" ? scenario.env(isolatedHome) : scenario.env || {},
        encoding: "utf8",
        timeout: 15000
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `Discovery failed for ${scenario.name}`);
      for (const secret of [token, username, key]) {
        assert.ok(!result.stdout.includes(secret), "Discovery leaked a credential to stdout");
        assert.ok(!result.stderr.includes(secret), "Discovery leaked a credential to stderr");
      }
      const output = JSON.parse(result.stdout);
      assert.equal(output.credentials.kaggle_configured, scenario.configured, scenario.name);
      assert.ok(Object.values(output.credentials).every(value => typeof value === "boolean"),
        "Discovery credential hints must contain booleans only");
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  return { cases: 1, scenarios: scenarios.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  const summary = runDiscoveryCredentialTests();
  console.log(`Discovery credential regression test passed: ${summary.scenarios} scenarios. No account API called.`);
}
