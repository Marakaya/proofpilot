#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installPackage, printInstallNotice, defaultSkillRoots, requireAbsoluteInstallPath } from "./install-package.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skillDir = path.join(root, "skills", "proofpilot");
const referencesDir = path.join(skillDir, "references");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(referencesDir, name), "utf8"));
}

function printHelp() {
  console.log(`ProofPilot 0.3.0

Usage:
  proofpilot inspect [--json]
  proofpilot capabilities [--root <absolute-skill-root>]
  proofpilot validate
  proofpilot validate-response <file>
  proofpilot install --target <codex|claude|agents> [--dir <absolute-main-skill-directory>] [--force] [--profiles] [--adopt-legacy-core]
      [--core-only | --update-dependencies | --offline]
  proofpilot dependencies --root <skill-root> [--status | --update | --offline]
  proofpilot setup [--status|--prepare-colosseum-helper|--check-colosseum|--connect-colosseum [--device]] [--json]
  proofpilot quality <init|submit|review|status> ...
  proofpilot event <list|init|check> ...

Commands:
  inspect   Show the packaged routing taxonomy, registries, and rubric counts.
  capabilities  List Solana development guidance and locally installed skills, offline.
  validate  Validate schemas, references, rubrics, examples, and generated docs.
  validate-response  Check response structure, evidence, score arithmetic, and gates.
  install   Install ProofPilot and its locked full support bundle.
  dependencies  Install, inspect or update support skills and shared guidance.
  setup     Show offline status; prepare the helper without login, or connect/verify when requested.
  quality   Track local evidence, checks, review and at most two draft repairs. No model API calls.
  event     Prepare and check hackathon/workshop/custom scorecards with fixed 100-point weights.

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

function install(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { printHelp(); return; }
  const options = { mode: "copy" };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (seen.has(flag)) throw new Error("Duplicate installation option.");
    seen.add(flag);
    if (["--target", "--dir"].includes(flag)) {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(flag + " requires a value.");
      options[flag === "--target" ? "target" : "directory"] = argv[++index];
    } else if (flag === "--force") options.force = true;
    else if (flag === "--profiles") options.profiles = true;
    else if (flag === "--adopt-legacy-core") options.adoptLegacyCore = true;
    else if (flag === "--core-only") options.coreOnly = true;
    else if (flag === "--update-dependencies") options.updateDependencies = true;
    else if (flag === "--offline") options.offline = true;
    else throw new Error("Unsupported installation option. Use --help.");
  }
  const roots = defaultSkillRoots(options.target);
  if (!Object.hasOwn(roots, options.target)) throw new Error("install requires --target codex, claude, or agents");
  if (options.coreOnly && (options.updateDependencies || options.offline)) throw new Error("--core-only cannot be combined with dependency options.");
  if (options.offline && options.updateDependencies) throw new Error("--offline and --update-dependencies are mutually exclusive.");
  if (options.adoptLegacyCore && !options.force) throw new Error("--adopt-legacy-core requires --force.");
  if (options.directory) {
    options.directory = requireAbsoluteInstallPath(options.directory, "--dir");
    const folded = value => path.resolve(value).normalize("NFKC").toLowerCase();
    const forbidden = Object.values(roots).flatMap(value => [value, path.dirname(value)]).map(folded);
    if (forbidden.includes(folded(options.directory))) throw new Error("--dir must name the ProofPilot skill directory, not a runtime skill root or configuration directory.");
  }
  options.destination = options.directory ?? path.join(roots[options.target], "proofpilot");
  const result = installPackage(options, { progress: message => console.error(message) });
  printInstallNotice(result);
}

function setup(args) {
  const result = spawnSync(process.execPath, [path.join(skillDir, "scripts", "setup.js"), ...args], {
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`setup was interrupted by ${result.signal}`);
  process.exitCode = result.status ?? 1;
}

const args = process.argv.slice(2);
const command = args[0] || "help";

try {
  if (command === "inspect") {
    if (args.length > 2 || (args.length === 2 && args[1] !== "--json")) throw new Error("inspect supports only --json");
    inspect(args.includes("--json"));
  } else if (command === "capabilities") {
    if (args.length !== 1 && !(args.length === 3 && args[1] === "--root")) throw new Error("capabilities supports only --root <absolute-skill-root>");
    if (args.length === 3) requireAbsoluteInstallPath(args[2], "--root");
    const result = spawnSync(process.execPath, [path.join(skillDir, "scripts", "discover-sources.js"), "--capabilities", ...args.slice(1)], {
      stdio: "inherit"
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`capabilities was interrupted by ${result.signal}`);
    process.exitCode = result.status ?? 1;
  } else if (command === "validate") {
    if (args.length !== 1) throw new Error("validate takes no arguments");
    const { validateRepository } = await import("./validate.js");
    const summary = validateRepository();
    console.log(`ProofPilot validation passed (${summary.tools} tools, ${summary.rubrics} rubrics).`);
  } else if (command === "validate-response") {
    if (args.length !== 2) throw new Error("validate-response requires exactly one JSON file path");
    const { validateResponseFile } = await import("./validate.js");
    validateResponseFile(path.resolve(args[1]));
    console.log("ProofPilot response validation passed.");
  } else if (command === "install") {
    install(args.slice(1));
  } else if (command === "dependencies") {
    const dependencyArgs = args.slice(1);
    if (!dependencyArgs.includes("--root") && !(dependencyArgs.length === 1 && dependencyArgs[0] === "--help")) {
      throw new Error("dependencies requires --root <skill-root>; choose the exact Codex, Claude, or Agents installation root");
    }
    const result = spawnSync(process.execPath, [path.join(skillDir, "scripts", "install-dependencies.js"), ...dependencyArgs], { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else if (command === "setup") {
    setup(args.slice(1));
  } else if (command === "quality") {
    const { runQuality } = await import("../skills/proofpilot/scripts/quality.js");
    console.log(JSON.stringify(runQuality(args.slice(1))));
  } else if (command === "event") {
    const { runEventScore } = await import("../skills/proofpilot/scripts/event-score.js");
    console.log(JSON.stringify(runEventScore(args.slice(1)), null, 2));
  } else if (["help", "--help", "-h"].includes(command)) {
    printHelp();
  } else {
    throw new Error("Unknown command. Use --help.");
  }
} catch (error) {
  console.error(`ProofPilot: ${error.message}`);
  process.exitCode = 1;
}
