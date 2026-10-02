import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncProfiles } from "./sync-profiles.js";
import { trustedNpmCli } from "../skills/proofpilot/scripts/connection-helper.js";
import { isInstallMetadata } from "../skills/proofpilot/scripts/install-metadata.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const pkg = read("package.json");
const lock = read("package-lock.json");
const taxonomy = read("skills/proofpilot/references/taxonomy.json");
if (pkg.name !== lock.name || pkg.version !== lock.version || pkg.version !== lock.packages?.[""]?.version || pkg.version !== taxonomy.version) {
  throw new Error("Release package, lockfile and taxonomy versions must agree.");
}
syncProfiles({ check: true });
const { validateRepository } = await import("./validate.js");
validateRepository();
const expected = new Set(["package.json", "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md"]);
for (const file of expected) {
  const stat = fs.lstatSync(path.join(root, file));
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Release root files must be regular independent files: ${file}`);
}
function collect(relative) {
  const file = path.join(root, relative);
  if (isInstallMetadata(file)) return;
  if (fs.lstatSync(file).isDirectory()) for (const name of fs.readdirSync(file)) collect(`${relative}/${name}`);
  else expected.add(relative);
}
for (const tree of ["skills", "scripts", "docs", "examples"]) collect(tree);
const npmCli = trustedNpmCli();
if (!npmCli) throw new Error("A trusted npm CLI tied to the running Node installation is required to verify the release.");
const result = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--ignore-scripts", "--json", "--offline"], {
  cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024
});
if (result.status !== 0) throw new Error("The offline npm package inventory could not be verified.");
const actual = new Set(JSON.parse(result.stdout)[0].files.map(file => file.path));
const missing = [...expected].filter(file => !actual.has(file));
const extra = [...actual].filter(file => !expected.has(file));
if (missing.length || extra.length) throw new Error(`Release inventory mismatch: ${JSON.stringify({ missing, extra })}`);
console.error(`Release verified: ${pkg.version}, ${actual.size} packaged files.`);
