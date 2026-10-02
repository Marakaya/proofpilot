import fs from "node:fs";
import path from "node:path";

/** Read the limited name scalar used by installed skills, including YAML comments. */
export function readSkillName(text) {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (frontmatter === undefined) return undefined;
  const names = frontmatter.split(/\r?\n/).filter(line => line.startsWith("name:"));
  if (names.length !== 1) return undefined;
  const scalar = names[0].match(/^name:[ \t]*(?:([a-z0-9-]+)|"([a-z0-9-]+)"|'([a-z0-9-]+)')(?:[ \t]+#.*)?[ \t]*$/);
  return scalar?.[1] ?? scalar?.[2] ?? scalar?.[3];
}

/** Ignore only ordinary files that npm or the OS adds outside packaged content. */
export function isInstallMetadata(file) {
  const name = path.basename(file).toLowerCase();
  if (!(name === ".ds_store" || name.startsWith("._") || name === ".npmrc" || name.endsWith(".orig"))) return false;
  try { return fs.lstatSync(file).isFile(); } catch { return false; }
}
