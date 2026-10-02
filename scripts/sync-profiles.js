import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const names = ["proofpilot-idea-discovery", "proofpilot-venture-validation", "proofpilot-mvp-planner", "proofpilot-readiness-review", "proofpilot-submission-builder"];
const resources = ["references", "scripts"];
const main = path.join(repository, "skills/proofpilot");
const ignoredNpmArtifact = name => name === ".DS_Store" || name.startsWith("._") || name === ".npmrc" || name.endsWith(".orig");
const forbiddenArtifact = name => name === "node_modules" || name === "coverage" || name === "dist" || name === ".idea" || name === ".vscode" ||
  /^\.env/i.test(name) || name.startsWith(".proofpilot") || /^npm-debug\.log(?:\.|$)/.test(name) ||
  [".npmignore", ".gitignore"].includes(name) || /^(?:audit-notes|fix-verification)(?:[.-]|$)/i.test(name);
function files(location, relative = "") {
  const stat = fs.lstatSync(location);
  if (stat.isSymbolicLink()) throw new Error("Profile resources must be regular copies.");
  if (stat.isFile()) {
    if (stat.nlink !== 1) throw new Error("Packaged files must not be hard linked.");
    return [relative];
  }
  if (!stat.isDirectory()) throw new Error("Unsupported profile resource.");
  return fs.readdirSync(location).filter(name => !ignoredNpmArtifact(name)).sort().flatMap(name => files(path.join(location, name), path.join(relative, name)));
}
function assertPackagedTree(location) {
  if (!fs.existsSync(location)) return;
  const walk = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Packaged paths must be regular copies: ${file}`);
    if (stat.isFile()) {
      if (stat.nlink !== 1) throw new Error(`Packaged files must not be hard linked: ${file}`);
      return;
    }
    for (const name of fs.readdirSync(file)) {
      if (ignoredNpmArtifact(name)) {
        if (!fs.lstatSync(path.join(file, name)).isFile()) throw new Error(`Ignored package metadata must be a regular file: ${path.join(file, name)}`);
        continue;
      }
      if (forbiddenArtifact(name)) throw new Error(`A local build or audit artifact would be published: ${path.join(file, name)}`);
      walk(path.join(file, name));
    }
  };
  walk(location);
}
export function syncProfiles({ check = false } = {}) {
  let count = 0;
  if (check) {
    const skillsRoot = path.join(repository, "skills");
    const expectedSkills = ["proofpilot", ...names].sort();
    const actualSkills = fs.readdirSync(skillsRoot).filter(name => !ignoredNpmArtifact(name)).sort();
    if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills) || actualSkills.some(name => !fs.lstatSync(path.join(skillsRoot, name)).isDirectory())) {
      throw new Error("The packaged skills directory contains missing, extra or unsupported entries.");
    }
    const mainEntries = fs.readdirSync(main).filter(name => !ignoredNpmArtifact(name)).sort();
    if (JSON.stringify(mainEntries) !== JSON.stringify(["SKILL.md", "agents", ...resources].sort()) ||
        !fs.lstatSync(path.join(main, "SKILL.md")).isFile() || fs.lstatSync(path.join(main, "SKILL.md")).nlink !== 1) {
      throw new Error("The main packaged skill contains missing, extra or linked root entries.");
    }
    for (const location of [path.join(repository, "skills"), path.join(repository, "scripts"), path.join(repository, "docs"), path.join(repository, "examples")]) {
      assertPackagedTree(location);
    }
    for (const name of names) {
      const profile = path.join(skillsRoot, name);
      const entries = fs.readdirSync(profile).filter(entry => !ignoredNpmArtifact(entry)).sort();
      if (JSON.stringify(entries) !== JSON.stringify(["SKILL.md", ...resources].sort())) throw new Error(`${name} has missing or extra root entries.`);
      const skillStat = fs.lstatSync(path.join(profile, "SKILL.md"));
      if (!skillStat.isFile() || skillStat.isSymbolicLink() || skillStat.nlink !== 1) throw new Error(`${name}/SKILL.md must be a regular independent file.`);
      const skill = fs.readFileSync(path.join(profile, "SKILL.md"), "utf8");
      if (!new RegExp(`^name:\\s*["']?${name}["']?\\s*$`, "m").test(skill)) throw new Error(`${name}/SKILL.md has the wrong skill name.`);
    }
  }
  for (const name of names) for (const resource of resources) {
    const source = path.join(main, resource);
    const destination = path.join(repository, "skills", name, resource);
    const expected = files(source);
    if (check) {
      let actual;
      try { actual = files(destination); } catch { throw new Error(`${name}/${resource} is missing or unsupported; run npm run sync:profiles.`); }
      if (JSON.stringify(actual) !== JSON.stringify(expected) || expected.some(relative =>
        !fs.readFileSync(path.join(source, relative)).equals(fs.readFileSync(path.join(destination, relative))) ||
        (fs.lstatSync(path.join(source, relative)).mode & 0o777) !== (fs.lstatSync(path.join(destination, relative)).mode & 0o777))) {
        throw new Error(`${name}/${resource} differs from the main skill; run npm run sync:profiles.`);
      }
    } else {
      // These canonical directories are generated from the shared source.
      const profileStat = fs.lstatSync(path.dirname(destination));
      if (!profileStat.isDirectory() || profileStat.isSymbolicLink()) throw new Error(`${name} must be a physical profile directory.`);
      fs.rmSync(destination, { recursive: true, force: true });
      fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true,
        filter: file => ignoredNpmArtifact(path.basename(file)) ? file === source : true });
    }
    count += expected.length;
  }
  return { profiles: names.length, files: count, checked: check };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv.slice(2).some(arg => arg !== "--check") || process.argv.slice(2).length > 1) throw new Error("Usage: sync-profiles.js [--check]");
  const result = syncProfiles({ check: process.argv.includes("--check") });
  (result.checked ? console.error : console.log)(JSON.stringify(result));
}
