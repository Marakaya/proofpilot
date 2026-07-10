import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateRepository } from "./validate.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "scripts", "cli.js");

function runCli(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== expectedStatus) {
    throw new Error(
      `CLI ${args.join(" ")} exited ${result.status}; expected ${expectedStatus}. ` +
        `${result.stderr || result.stdout}`
    );
  }
  return result;
}

const summary = validateRepository();
const inspectResult = runCli(["inspect", "--json"]);
const manifest = JSON.parse(inspectResult.stdout);

if (manifest.version !== "0.2.0" || manifest.tools !== summary.tools) {
  throw new Error("CLI inspect output does not match the validated registries");
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-test-"));
const destination = path.join(temporaryRoot, "proofpilot");

try {
  runCli(["install", "--target", "codex", "--dir", destination]);
  for (const relativePath of [
    "SKILL.md",
    "agents/openai.yaml",
    "references/taxonomy.json",
    "references/response.schema.json"
  ]) {
    if (!fs.existsSync(path.join(destination, relativePath))) {
      throw new Error(`Installed skill is missing ${relativePath}`);
    }
  }

  const overwriteResult = runCli(
    ["install", "--target", "codex", "--dir", destination],
    1
  );
  if (!overwriteResult.stderr.includes("Destination already exists")) {
    throw new Error("CLI install did not explain how to handle an existing destination");
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(
  `ProofPilot tests passed: ${summary.tools} tools, ${summary.capabilities} capabilities, ` +
    `${summary.rubrics} rubrics, ${summary.evalCases} eval contracts.`
);
