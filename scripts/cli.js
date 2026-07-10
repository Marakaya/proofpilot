#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRepository } from "./validate.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skillDir = path.join(root, "skills", "proofpilot");
const referencesDir = path.join(skillDir, "references");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(referencesDir, name), "utf8"));
}

function printHelp() {
  console.log(`ProofPilot 0.2.0

Usage:
  proofpilot inspect [--json]
  proofpilot validate
  proofpilot install --target <codex|claude|agents> [--dir <path>] [--force]

Commands:
  inspect   Show the packaged routing taxonomy, registries, and rubric counts.
  validate  Validate schemas, references, rubrics, examples, and generated docs.
  install   Copy the self-contained ProofPilot skill into an agent skill directory.

The CLI installs and inspects the skill package. The selected agent runtime executes the workflow.`);
}

function inspect(asJson) {
  const taxonomy = readJson("taxonomy.json");
  const sources = readJson("source-registry.json");
  const tools = readJson("tool-registry.json");
  const rubrics = readJson("rubrics.json");
  const summary = {
    version: taxonomy.version,
    modes: taxonomy.modes.map(({ id }) => id),
    stages: taxonomy.stages.map(({ id }) => id),
    domains: taxonomy.domains.map(({ id }) => id),
    sources: sources.sources.length,
    tools: tools.tools.length,
    capabilities: tools.tools.reduce((count, tool) => count + tool.capabilities.length, 0),
    rubrics: rubrics.rubrics.map(({ id }) => id)
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`ProofPilot ${summary.version}`);
  console.log(`Modes: ${summary.modes.join(", ")}`);
  console.log(`Stages: ${summary.stages.join(" -> ")}`);
  console.log(`Domains: ${summary.domains.join(", ")}`);
  console.log(`Registry: ${summary.sources} sources, ${summary.tools} tools, ${summary.capabilities} capabilities`);
  console.log(`Rubrics: ${summary.rubrics.join(", ")}`);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

function install(args) {
  const target = valueAfter(args, "--target");
  const customDir = valueAfter(args, "--dir");
  const force = args.includes("--force");
  const defaults = {
    codex: path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills", "proofpilot"),
    claude: path.join(os.homedir(), ".claude", "skills", "proofpilot"),
    agents: path.join(os.homedir(), ".agents", "skills", "proofpilot")
  };

  if (!target || !Object.hasOwn(defaults, target)) {
    throw new Error("install requires --target codex, claude, or agents");
  }
  if (customDir && customDir.startsWith("--")) {
    throw new Error("--dir requires a path");
  }

  const destination = customDir ? path.resolve(customDir) : defaults[target];
  if (fs.existsSync(destination)) {
    if (!force) {
      throw new Error(`Destination already exists: ${destination}. Use --force to replace it.`);
    }
    fs.rmSync(destination, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(skillDir, destination, { recursive: true, errorOnExist: true });
  console.log(`Installed ProofPilot for ${target}: ${destination}`);
}

const args = process.argv.slice(2);
const command = args[0] || "help";

try {
  if (command === "inspect") {
    inspect(args.includes("--json"));
  } else if (command === "validate") {
    const summary = validateRepository();
    console.log(`ProofPilot validation passed (${summary.tools} tools, ${summary.rubrics} rubrics).`);
  } else if (command === "install") {
    install(args.slice(1));
  } else if (["help", "--help", "-h"].includes(command)) {
    printHelp();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`ProofPilot: ${error.message}`);
  process.exitCode = 1;
}
