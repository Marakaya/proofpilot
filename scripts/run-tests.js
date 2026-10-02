import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-test-home-"));
const homePath = path.join(temporary, "home");
const tmp = path.join(temporary, "tmp");
fs.mkdirSync(homePath, { mode: 0o700 });
fs.mkdirSync(tmp, { mode: 0o700 });
const home = fs.realpathSync(homePath);
const preload = new URL("./test-isolation.js", import.meta.url).href;
try {
  const result = spawnSync(process.execPath, ["--import", preload, fileURLToPath(new URL("./test.js", import.meta.url))], {
    stdio: "inherit", env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"),
      CLAUDE_HOME: path.join(home, ".claude"), CLAUDE_CONFIG_DIR: path.join(home, ".claude"), XDG_CONFIG_HOME: path.join(home, ".config"), PROOFPILOT_TEST_HOME: home,
      TMPDIR: tmp, TMP: tmp, TEMP: tmp, NODE_OPTIONS: `--import=${preload}` }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
