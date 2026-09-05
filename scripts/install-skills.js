#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mainSkillName = "proofpilot";
const profileNames = [
  "proofpilot-idea-discovery",
  "proofpilot-venture-validation",
  "proofpilot-mvp-planner",
  "proofpilot-readiness-review",
  "proofpilot-submission-builder"
];

function parseArgs(argv) {
  const args = {
    target: process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, "skills")
      : path.join(os.homedir(), ".codex", "skills"),
    mode: "symlink",
    force: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      if (!argv[index + 1]) throw new Error("--target requires a path");
      args.target = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--copy") {
      args.mode = "copy";
    } else if (arg === "--force") {
      args.force = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function removeExisting(destination, force) {
  if (!fs.existsSync(destination)) return;
  if (!force) {
    throw new Error(`Refusing to overwrite existing path without --force: ${destination}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
}

function installPath(source, destination, mode) {
  if (mode === "copy") {
    fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
    return;
  }
  const type = fs.statSync(source).isDirectory() ? "dir" : "file";
  fs.symlinkSync(source, destination, type);
}

function installMain(targetRoot, mode, force) {
  const source = path.join(root, "skills", mainSkillName);
  const destination = path.join(targetRoot, mainSkillName);
  removeExisting(destination, force);
  installPath(source, destination, mode);
}

function installProfile(profileName, targetRoot, mode, force) {
  const source = path.join(root, "skills", profileName);
  const destination = path.join(targetRoot, profileName);
  const sharedReferences = path.join(root, "skills", mainSkillName, "references");
  const sharedScripts = path.join(root, "skills", mainSkillName, "scripts");

  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    throw new Error(`Missing profile: ${profileName}`);
  }

  removeExisting(destination, force);
  fs.mkdirSync(destination, { recursive: true });
  installPath(path.join(source, "SKILL.md"), path.join(destination, "SKILL.md"), mode);
  installPath(sharedReferences, path.join(destination, "references"), mode);
  installPath(sharedScripts, path.join(destination, "scripts"), mode);
}

const args = parseArgs(process.argv.slice(2));
fs.mkdirSync(args.target, { recursive: true });

installMain(args.target, args.mode, args.force);
for (const profileName of profileNames) {
  installProfile(profileName, args.target, args.mode, args.force);
}

console.log(`Installed ProofPilot and ${profileNames.length} optional profiles into ${args.target}`);
console.log(`Mode: ${args.mode}`);
const setupPath = path.join(args.target, mainSkillName, "scripts", "setup.js");
const quotedSetupPath = `'${setupPath.replaceAll("'", "'\\''")}'`;
console.log("Next, ask your agent: $proofpilot: complete initial setup, explain the recommended model level, required Colosseum key and optional service costs.");
console.log("Colosseum is ProofPilot's core source. Its key is required; setup is complete only after access is verified.");
console.log("For higher-quality recommendations, use models in the SOL or Opus 5 class or higher, where available in your host.");
console.log("Weaker models may miss important details or draw incorrect conclusions; built-in checks cannot fully compensate for model limitations.");
console.log("Reuse an existing Colosseum key, or obtain one at https://colosseum.com/arena/copilot. Never paste a key into chat.");
console.log("Other service keys are optional. Review free access and paid usage before enabling a service.");
console.log(`Offline setup status: node ${quotedSetupPath} --status`);
console.log("Installing a skill does not start an agent conversation or verify accounts automatically.");
