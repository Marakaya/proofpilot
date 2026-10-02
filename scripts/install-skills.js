#!/usr/bin/env node

import path from "node:path";
import { installPackage, printInstallNotice, defaultSkillRoots, requireAbsoluteInstallPath } from "./install-package.js";

function parseArgs(argv) {
  const options = { target: null, mode: "symlink", profiles: true };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (seen.has(flag)) throw new Error("Duplicate installation option.");
    seen.add(flag);
    if (flag === "--target") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--target requires a skill-root path.");
      options.target = requireAbsoluteInstallPath(argv[++index], "--target");
    } else if (flag === "--copy") options.mode = "copy";
    else if (flag === "--force") options.force = true;
    else if (flag === "--adopt-legacy-core") options.adoptLegacyCore = true;
    else if (flag === "--core-only") options.coreOnly = true;
    else if (flag === "--update-dependencies") options.updateDependencies = true;
    else if (flag === "--offline") options.offline = true;
    else throw new Error("Unsupported installation option.");
  }
  if (options.coreOnly && (options.updateDependencies || options.offline)) throw new Error("--core-only cannot be combined with dependency options.");
  if (options.offline && options.updateDependencies) throw new Error("--offline and --update-dependencies are mutually exclusive.");
  if (options.adoptLegacyCore && !options.force) throw new Error("--adopt-legacy-core requires --force.");
  options.target ??= defaultSkillRoots().codex;
  options.destination = path.join(options.target, "proofpilot");
  return options;
}

try {
  const result = installPackage(parseArgs(process.argv.slice(2)), { progress: message => console.error(message) });
  printInstallNotice(result);
} catch (error) {
  console.error("ProofPilot: " + error.message);
  process.exitCode = 1;
}
