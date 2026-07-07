#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const skillNames = [
  "proofpilot",
  "proofpilot-idea-discovery",
  "proofpilot-venture-validation",
  "proofpilot-mvp-planner",
  "proofpilot-readiness-review",
  "proofpilot-submission-builder"
];

const sharedDirs = ["data", "docs", "references", "schemas", "examples", "scripts"];

function parseArgs(argv) {
  const args = {
    target: process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, "skills")
      : path.join(os.homedir(), ".codex", "skills"),
    mode: "symlink",
    force: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      args.target = path.resolve(argv[i + 1]);
      i += 1;
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

function removeExisting(dest, force) {
  if (!fs.existsSync(dest)) {
    return;
  }

  const stat = fs.lstatSync(dest);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(dest);
    return;
  }

  if (!force) {
    throw new Error(`Refusing to overwrite existing path without --force: ${dest}`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
}

function installPath(source, dest, mode, force) {
  removeExisting(dest, force);
  if (mode === "copy") {
    fs.cpSync(source, dest, { recursive: true });
    return;
  }

  const stat = fs.statSync(source);
  fs.symlinkSync(source, dest, stat.isDirectory() ? "dir" : "file");
}

function installSkill(skillName, targetRoot, mode, force) {
  const sourceSkillDir = path.join(root, "skills", skillName);
  if (!fs.existsSync(path.join(sourceSkillDir, "SKILL.md"))) {
    throw new Error(`Missing skill: ${skillName}`);
  }

  const destSkillDir = path.join(targetRoot, skillName);
  fs.mkdirSync(destSkillDir, { recursive: true });

  installPath(
    path.join(sourceSkillDir, "SKILL.md"),
    path.join(destSkillDir, "SKILL.md"),
    mode,
    force
  );

  for (const dir of sharedDirs) {
    installPath(path.join(root, dir), path.join(destSkillDir, dir), mode, force);
  }
}

const args = parseArgs(process.argv.slice(2));
fs.mkdirSync(args.target, { recursive: true });

for (const skillName of skillNames) {
  installSkill(skillName, args.target, args.mode, args.force);
}

console.log(`Installed ${skillNames.length} ProofPilot skills into ${args.target}`);
for (const skillName of skillNames) {
  console.log(`- ${skillName}`);
}
