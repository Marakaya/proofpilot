// Local adaptations of downloaded guidance. No upstream workflow is executed.
import fs from "node:fs";
import path from "node:path";
import { isUtf8 } from "node:buffer";
import { fileURLToPath } from "node:url";
import { isInstallMetadata } from "./install-metadata.js";

export const SUPPORT_POLICY_VERSION = 1;
const marker = "<!-- proofpilot-support-policy:v1 -->";
const boundary = `${marker}\n\nThis installed copy has ProofPilot's local safety adaptations. Resolve bundled paths from this file's directory, not the shell's working directory. Do not run telemetry or rewrite host settings. External AI agents, account/MCP changes, paid calls, wallets, uploads and final submissions require the user's current scoped authorization; reuse authorization already given for that task.\n`;
const grantPhase = `### Phase 0 — Optional project session export\n\nSession logs are optional evidence. Export them only when the user requests the project logs. Resolve the installed skill directory and run its \`export-session.sh\` with a new output directory. The helper selects only sessions whose metadata matches the current project, preserves existing exports, and never falls back to another project or the latest global session. If none matches, report that limitation; a user-selected manual export may be used instead. Review any selected copy privately before attaching it. Exporting does not authorize uploading or publishing it.\n\n`;
const paymentFlow = `### If you receive a 402:\n\nStop automatic retries. Report the concrete quota/cost returned by the service. Continue within free limits or wait for the limit to reset. A 402 does not authorize installing AgentCash, setting up a wallet, transferring funds or issuing a paid retry. If the user already authorized that exact paid query and its budget/tool setup, reuse that scoped authorization and the available tool; otherwise obtain the missing authorization for the concrete action before proceeding. Never run \`agentcash@latest onboard\` as an automatic rate-limit fallback.\n\n`;

/** Deterministic original-content path for an installed single-file support asset. */
export function supportPolicySidecarPath(file) {
  return path.join(path.dirname(file), ".proofpilot-upstream", `${path.basename(file)}.txt`);
}

function filesBelow(location) {
  const stat = fs.lstatSync(location);
  if (stat.isSymbolicLink()) throw new Error("Support adaptation refuses a source symlink.");
  if (stat.isFile()) return [location];
  if (!stat.isDirectory()) throw new Error("Support adaptation needs regular files or directories.");
  return fs.readdirSync(location).flatMap(name => filesBelow(path.join(location, name)));
}
function policyMarkdownFiles(location) {
  const directory = fs.lstatSync(location).isDirectory();
  return filesBelow(location).filter(file => {
    const relative = directory ? path.relative(location, file) : path.basename(file);
    const first = relative.split(path.sep)[0];
    const foldedFirst = first.normalize("NFKC").toLowerCase().replaceAll("ß", "ss");
    if (foldedFirst === ".proofpilot-upstream") {
      if (first !== ".proofpilot-upstream") throw new Error("A reserved support-policy path uses an unsafe case or Unicode alias.");
      if (isInstallMetadata(file)) return false;
      if (!file.endsWith(".txt")) throw new Error("Preserved upstream originals must be regular .txt files.");
      return false;
    }
    return /\.(?:md|markdown|mdx)$/i.test(file);
  });
}
function assertExactEntrypoint(location, skillId) {
  if (!skillId || !fs.lstatSync(location).isDirectory()) return;
  const entries = fs.readdirSync(location);
  if (!entries.includes("SKILL.md") || entries.some(name => name !== "SKILL.md" && name.normalize("NFKC").toLowerCase() === "skill.md")) {
    throw new Error("Support skill entrypoint must be the exact regular file SKILL.md.");
  }
  const entry = fs.lstatSync(path.join(location, "SKILL.md"));
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Support skill entrypoint must be the exact regular file SKILL.md.");
}
function preserve(staging, file, original) {
  const directory = fs.statSync(staging).isDirectory();
  const backup = directory
    ? path.join(staging, ".proofpilot-upstream", `${path.relative(staging, file)}.txt`)
    : supportPolicySidecarPath(staging);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { flag: "wx" });
}
function readUtf8(file) {
  const bytes = fs.readFileSync(file);
  if (!isUtf8(bytes)) throw new Error(`Support policy only adapts valid UTF-8 text: ${file}`);
  return { bytes, text: bytes.toString("utf8") };
}
function resolveBundledPath(root, relative) {
  const parts = relative.split("/");
  if (parts.some(part => part === "." || part === "..")) {
    throw new Error("Bundled support path traversal is not allowed.");
  }
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts.filter(Boolean));
  const inside = path.relative(base, target);
  if (inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new Error("Bundled support path escapes the selected skill root.");
  }
  return target;
}
function relocatedPaths(content, finalFile, root, manifest) {
  const directory = path.dirname(finalFile);
  const toRelative = value => path.relative(directory, value).split(path.sep).join("/") || ".";
  const bundled = new Set(["data", "SKILL_ROUTER.md", "tone-guide.md", ...manifest.sources.flatMap(source => source.skills.map(skill => skill.id))]);
  return content.replace(/~\/\.(?:claude|codex|agents)\/skills(?:\/([A-Za-z0-9_.\/-]*))?/g, (match, suffix = "") => {
    return bundled.has(suffix.split("/")[0]) ? toRelative(resolveBundledPath(root, suffix)) : match;
  })
    .replace(/(?<![A-Za-z0-9_.\/-])cli\/data\/(clonable-repos|solana-skills|solana-mcps)\.json\b/g, (_, name) => toRelative(path.join(root, "data/catalogs", `${name}.json`)))
    .replace(/(?<![A-Za-z0-9_./])(?:\.\.\/)+data\/(?:solana-knowledge|guides|ideas|colosseum|defi|specs|catalogs)\/[A-Za-z0-9_.\/-]+/g,
      match => {
        const index = match.indexOf("data/");
        return toRelative(resolveBundledPath(root, `data/${match.slice(index + "data/".length)}`));
      });
}
function fencedRanges(content) {
  const ranges = [];
  // Comment examples do not open or close a real Markdown code block.
  const visible = content.replace(/<!--[\s\S]*?(?:-->|$)/g, comment => comment.replace(/[^\r\n]/g, " "));
  let open = null;
  for (const match of visible.matchAll(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/gm)) {
    if (!open) {
      // CommonMark forbids backticks in the info string of a backtick fence.
      if (match[1][0] === "`" && match[2].includes("`")) continue;
      open = { start: match.index, character: match[1][0], length: match[1].length };
      continue;
    }
    if (match[1][0] === open.character && match[1].length >= open.length && !match[2].trim()) {
      const newline = content.indexOf("\n", match.index + match[0].length);
      ranges.push([open.start, newline < 0 ? content.length : newline + 1]);
      open = null;
    }
  }
  // An unmatched opener cannot safely hide the rest of the document from policy
  // checks. Leave that tail outside the fenced ranges so it is scanned as active
  // Markdown; benign template text remains installable, while unsafe commands fail.
  return ranges;
}
function insideRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}
function outsideMatches(content, pattern, ranges = fencedRanges(content)) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...content.matchAll(new RegExp(pattern.source, flags))].filter(match => !insideRanges(match.index, ranges));
}
function nextOutsideMatch(content, pattern, start, ranges) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const expression = new RegExp(pattern.source, flags);
  expression.lastIndex = start;
  for (let match = expression.exec(content); match; match = expression.exec(content)) {
    if (!insideRanges(match.index, ranges)) return match;
    if (!match[0].length) expression.lastIndex++;
  }
  return null;
}
function removeOwnedSections(content, headingPattern, terminatorPattern, maximumHeadingLevel) {
  const ranges = [];
  const fences = fencedRanges(content);
  for (const heading of outsideMatches(content, headingPattern, fences)) {
    const bodyStart = content.indexOf("\n", heading.index) + 1;
    if (!bodyStart) continue;
    const end = nextOutsideMatch(content, terminatorPattern, bodyStart, fences);
    if (!end) continue;
    const nextHeading = nextOutsideMatch(content, new RegExp(`^#{1,${maximumHeadingLevel}}[ \\t]+`, "gm"), bodyStart, fences);
    if (nextHeading && nextHeading.index < end.index) continue;
    let rangeEnd = content.indexOf("\n", end.index + end[0].length);
    rangeEnd = rangeEnd < 0 ? content.length : rangeEnd + 1;
    ranges.push([heading.index, rangeEnd]);
  }
  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) content = content.slice(0, start) + content.slice(end);
  return content;
}
function replaceOwnedSection(content, headingPattern, nextBoundaryPattern, replacement) {
  const ranges = [];
  const fences = fencedRanges(content);
  const allHeadings = [...content.matchAll(new RegExp(headingPattern.source, headingPattern.flags.includes("g") ? headingPattern.flags : `${headingPattern.flags}g`))];
  if (allHeadings.some(heading => insideRanges(heading.index, fences))) throw new Error("An owned support-policy heading appears inside a fenced code block.");
  for (const heading of allHeadings) {
    const afterHeading = content.indexOf("\n", heading.index + heading[0].length) + 1;
    if (!afterHeading) continue;
    const next = nextOutsideMatch(content, nextBoundaryPattern, afterHeading, fences);
    ranges.push([heading.index, next?.index ?? content.length]);
  }
  const ordered = ranges.toSorted((left, right) => left[0] - right[0]);
  if (ordered.some(([start], index) => index && start < ordered[index - 1][1])) throw new Error("Overlapping support-policy sections; active text was preserved.");
  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) content = content.slice(0, start) + replacement + content.slice(end);
  return content;
}
function removeTelemetry(content) {
  let updated = removeOwnedSections(content, /^## Preamble \(run first\)[ \t]*$/gm,
    /^This only happens once\.[^\r\n]*$/m, 2);
  updated = removeOwnedSections(updated, /^## Preamble \(run first\)[ \t]*$/gm,
    /^If `TEL_PROMPTED` is `no`: Before starting the skill workflow, ask the user about telemetry\. Options: A\) Sure \(anonymous\) B\) No thanks\. This only happens once\.[ \t]*$/m, 2);
  updated = removeOwnedSections(updated, /^## Telemetry \(run last\)[ \t]*$/gm,
    /^Replace `OUTCOME` with success\/error\/abort based on the workflow result\.[ \t]*$/m, 2);
  if (/^## (?:Preamble \(run first\)|Telemetry \(run last\))/m.test(updated) || /telemetry:track|_TEL_TIER|_CONVEX_URL/.test(updated)) {
    throw new Error("Unsupported upstream telemetry instructions; do not install them unchanged.");
  }
  return updated;
}
// Soft wraps belong to the same instruction, but neighboring Markdown items do
// not. Keep original bytes outside the exact connection clause being adapted.
function instructionBlocks(content) {
  const blocks = [];
  let pending = "";
  const flush = () => { if (pending) blocks.push(pending); pending = ""; };
  for (const line of content.match(/[^\r\n]+(?:\r?\n|$)|\r?\n/g) ?? []) {
    const single = /^[ \t]*(?:$|\||#{1,6}[ \t]|>|`{3}|~{3}|<\/?h[1-6]\b|(?:=+|-+|\*{3,}|_{3,})[ \t]*$)/i.test(line.trimEnd());
    const item = /^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+)/.test(line);
    if (single || item) flush();
    if (single) blocks.push(line);
    else pending += line;
  }
  flush();
  return blocks;
}
function colosseumPatContext(block, index) {
  const clause = block.slice(index).split(/[.;](?:\s|$)|\|/, 1)[0];
  if (/\b(?:github|hugging(?:[ \t\r\n]+|-)?face|kaggle)\b/i.test(clause)) return false;
  const prefix = block.slice(0, index);
  const mentions = [...prefix.matchAll(/\b(?:colosseum(?:-copilot|[ \t\r\n]+copilot)?|github|hugging(?:[ \t\r\n]+|-)?face|kaggle)\b/gi)];
  if (mentions.length) return /^colosseum/i.test(mentions.at(-1)[0]);
  // Existing standalone locator clauses may identify the service by its URL.
  return /\b(?:arena\.)?colosseum\.(?:com|org)\b/i.test(clause);
}
function activeColosseum(content) {
  const replacedEnvironment = content.replace(/^([ \t]*)# COLOSSEUM_COPILOT_PAT=.*/gim,
    "$1# Colosseum uses official Copilot Connect V2 sign-in; do not configure a legacy token environment variable.");
  return instructionBlocks(replacedEnvironment).map(block => {
    const requirements = block.replace(/\b(?:It[ \t\r\n]+)?requires[ \t\r\n]+a[ \t\r\n]+free[ \t\r\n]+PAT[^|]*?(?=[ \t]*\||[.;](?:\s|$)|$)/gi, (match, index) => {
      if (!colosseumPatContext(block, index)) return match;
      return /^It\b/i.test(match)
        ? "It uses official Copilot Connect V2 sign-in; use the installed colosseum-copilot connection guide"
        : "Requires official Copilot Connect V2 sign-in; use the installed colosseum-copilot connection guide";
    });
    return requirements.replace(/\(requires[ \t\r\n]+PAT\)/gi, (match, index) =>
      colosseumPatContext(requirements, index) ? "(requires Copilot Connect V2 sign-in)" : match);
  }).join("");
}
function hasLegacyColosseumInstructions(content) {
  return /COLOSSEUM_COPILOT_PAT/i.test(content) || instructionBlocks(content).some(block =>
    [...block.matchAll(/\bPAT\b/gi)].some(match => colosseumPatContext(block, match.index)));
}

function withCanonicalBoundary(content) {
  const frontmatter = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/)?.[1];
  if (!frontmatter) throw new Error("Support skill entrypoint lacks canonical frontmatter.");
  const canonicalPrefix = `${frontmatter}\n${boundary}\n`;
  const markerCount = content.split(marker).length - 1;
  if (markerCount) {
    const normalized = value => value.replace(/\r\n/g, "\n").replace(/[ \t]+(?=\n)/g, "");
    if (markerCount === 1 && normalized(content).startsWith(normalized(canonicalPrefix))) return content;
    throw new Error("Support policy marker is outside the canonical safety boundary.");
  }
  return `${canonicalPrefix}${content.slice(frontmatter.length)}`;
}

function hasUnnegatedMatch(pattern, content, { inlinePackageProhibition = false } = {}) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const directNegation = /\b(?:do not|don't|never|must not|may not|cannot|can't|does not|is not)(?:[\s,]+(?:let|allow|the|agent|agents|automatically|however|yet|use|run|install|execute|ever)){0,7}[\s,]*$/i;
  // Look ahead so a negated action cannot consume and hide a later positive one.
  for (const match of content.matchAll(new RegExp(`(?=${pattern.source})`, flags))) {
    const lineStart = content.lastIndexOf("\n", match.index - 1) + 1;
    let clauseStart = Math.max(lineStart, ...[".", "!", "?", ";", ":", ",", "—", "–", "|"].map(separator => content.lastIndexOf(separator, match.index - 1) + 1));
    if (inlinePackageProhibition) {
      const prefix = content.slice(clauseStart, match.index);
      // Shell dequoting also removes apostrophes from prose contractions.
      const prohibition = /\b(?:do not|don't|dont|never|must not|may not|cannot|can't|cant)[ \t]+(?:run|use|execute)[ \t]+(`+)(?:command[ \t]+)?(?:npx|npm[ \t]+exec|pnpm[ \t]+dlx|bunx|yarn[ \t]+dlx)[ \t]+(?:--?[A-Za-z0-9_-]+(?:=[A-Za-z0-9_.-]+)?[ \t]+)*$/i.exec(prefix);
      const commandEnd = /^[^`\r\n;&|]*(`+)/.exec(content.slice(match.index));
      if (prohibition && commandEnd?.[1] === prohibition[1]) continue;
    }
    const recentPrefix = content.slice(Math.max(lineStart, match.index - 160), match.index).replace(/[`*_]/g, "");
    if (directNegation.test(recentPrefix)) continue;
    if (/\b(?:do not|don't|never|must not|may not|cannot|can't)[^\r\n.;!?|—–,]{0,100}\b(?:or|nor)\s+(?:automatically\s+)?$/i.test(recentPrefix) && !/\b(?:but|however|yet)\b/i.test(recentPrefix)) continue;
    const prefixLine = content.slice(clauseStart, match.index);
    for (const boundary of prefixLine.matchAll(/\b(?:but|however|yet)\b[\s,:-]*/gi)) {
      if (directNegation.test(prefixLine.slice(0, boundary.index))) continue;
      clauseStart += boundary.index + boundary[0].length;
      break;
    }
    const prefix = content.slice(clauseStart, match.index);
    if (/\b(?:(?:do not|don't)\s+hesitate\s+to|never\s+forget\s+to)\s*$/i.test(prefix)) return true;
    if (!directNegation.test(prefix)) return true;
  }
  return false;
}

function assertNoUnsafeInstructions(content, { skillId, sourceId }) {
  const deobfuscateShell = value => value.replace(/\\\r?\n[ \t]*/g, "").replace(/''|""/g, "");
  const normalized = deobfuscateShell(content.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\r\n/g, "\n").replace(/[ \t]+(?=\n)/g, ""));
  const block = "(?:[-*+][ \\t]|\\d+[.)][ \\t]|\\||#{1,6}[ \\t]|>|`{3}|~{3})";
  const normalizedProse = normalized.replace(new RegExp(`(^[ \\t]*${block}[^\\n]*)\\n`, "gm"), "$1.\n")
    .replace(new RegExp(`[ \\t]*\\n(?=[ \\t]*${block})`, "g"), ".\n")
    .replace(/[ \t]*\n(?![ \t]*\n)/g, " ");
  const unquoteShell = value => value.replace(/["']/g, "").replace(/\\([A-Za-z])/g, "$1");
  const commands = unquoteShell(normalized);
  const unsafePaymentCommand = /(?:^|[\r\n;&|])[ \t]*(?:[$>]\s*)?(?:(?:command\s+)?(?:npx|npm\s+exec|pnpm\s+dlx|bunx)\s+[^\r\n]*\bagentcash\b|(?:command\s+)?agentcash\b[^\r\n]*(?:onboard|fetch|pay)\b)/im;
  const suspiciousPackageRunner = /(?:^|[\r\n;&|])[ \t]*(?:[$>]\s*)?(?:command\s+)?(?:npx|npm\s+exec|pnpm\s+dlx|bunx|yarn\s+dlx)\s+(?:--[^\s;&|]+\s+)*[^\s;&|]*[\\'"$][^\s;&|]*/im;
  const automaticSensitiveAction = /\b(?:automatically|without\s+(?:asking|authorization|confirmation|consent))\b[^\r\n.;!?|—–]{0,100}(?:\b(?:pay|purchase|upload|attach|publish|submit)\b|\b(?:install|configure|create|set\s+up)\b[^\r\n.;!?|—–]{0,60}\b(?:agentcash|payment\s+tool(?:ing)?|wallet|account|MCP|claude(?:\s+code)?|external\s+AI\s+agent)\b)|\b(?:pay|purchase|upload|attach|publish|submit|install|configure|create|set\s+up)\b[^\r\n.;!?|—–]{0,60}\b(?:agentcash|payment\s+tool(?:ing)?|wallet|account|MCP|claude(?:\s+code)?|external\s+AI\s+agent|project\s+material|session\s+(?:log|transcript))\b[^\r\n.;!?|—–]{0,60}\b(?:automatically|without\s+(?:asking|authorization|confirmation|consent))\b/i;
  const bypassedSensitiveAction = /\b(?:pay|purchase|upload|attach|publish|submit)\b[^\r\n.;!?|—–]{0,80}\bwithout\s+(?:asking|authorization|confirmation|consent)\b/i;
  const telemetryImplementation = /telemetry\s*:\s*track|_TEL_TIER|_CONVEX_URL|\.superstack\/(?:telemetry(?:\.jsonl)?|config\.json)|(?:^|[\r\n;&|])[ \t]*(?:[$>]\s*)?(?:command\s+)?(?:curl|wget)\b[^\r\n]*(?:telemetry|convex)/im;
  const automaticGrantPattern = /\b(?:before anything else|automatically|auto-export(?:ed)?|always)\b[^\r\n.;!?]{0,100}\b(?:export|upload|attach|publish|submit)\b/i;
  if (unsafePaymentCommand.test(commands)) throw new Error("Unsupported active payment command; do not install it unchanged.");
  if (suspiciousPackageRunner.test(commands)) throw new Error("Unsupported dynamic package runner command; do not install it unchanged.");
  if (hasUnnegatedMatch(automaticSensitiveAction, normalizedProse) || hasUnnegatedMatch(bypassedSensitiveAction, normalizedProse)) {
    throw new Error("Unsupported automatic external action; do not install it unchanged.");
  }
  if (telemetryImplementation.test(commands)) throw new Error("Unsupported active telemetry instructions; do not install them unchanged.");
  if (skillId === "apply-grant" && hasUnnegatedMatch(automaticGrantPattern, normalizedProse)) {
    throw new Error("Unsupported automatic export instructions; do not install them unchanged.");
  }
  const residue = [boundary, paymentFlow, grantPhase].reduce((text, owned) => text.replaceAll(owned, ""), normalized);
  if (hasUnnegatedMatch(/\bagent[\s_-]?cash\b/i, unquoteShell(residue), { inlinePackageProhibition: true })) throw new Error("Unsupported residual payment instructions; do not install them unchanged.");
  if (/\b_?TEL_(?:TIER|PROMPTED|EVENT|START|END)\b|telemetry\s*:\s*track|telemetry\.jsonl|telemetryTier|_?CONVEX_URL\b|convex\.(?:cloud|site)\b|\/api\/mutation\b|\.superstack\/(?:config\.json|\.telemetry-prompted)/i.test(residue) ||
      /^[ \t>*+-]*(?:<h[1-6][^>]*>|#{1,6})?[ \t]*(?:\*\*|__)?[ \t]*(?:preamble|telemetry)\b[^\n]*\(run (?:first|last)\)/im.test(residue)) {
    throw new Error("Unsupported residual telemetry instructions; do not install them unchanged.");
  }
  if (skillId === "apply-grant" && /(?:~|\$\{?HOME\}?)\/\.(?:claude\/projects|codex\/sessions|codex\/history\.jsonl)|\$\{?CODEX_HOME\}?\/(?:sessions|history\.jsonl)|\bauto-?export/i.test(unquoteShell(residue))) {
    throw new Error("Unsupported residual global session export; do not install it unchanged.");
  }
  if (sourceId === "solana-new" && hasLegacyColosseumInstructions(residue)) {
    throw new Error("Unsupported residual Colosseum PAT instruction; do not install it unchanged.");
  }
}

function adaptedMarkdown(original, finalFile, root, sourceId, skillId, manifest, destination) {
  let content = relocatedPaths(original, finalFile, root, manifest);
  if (sourceId === "solana-new") content = activeColosseum(removeTelemetry(content));
  const entrypoint = skillId && finalFile === path.join(destination, "SKILL.md");
  if (skillId === "apply-grant" && entrypoint) {
    const phaseZeroHeading = /^(?: {0,3}#{1,6}[ \t]+phase[ \t]+0(?:[ \t]*(?:[:.—–-]).*)?| {0,3}(?:\*\*|__)[ \t]*phase[ \t]+0(?:[ \t]*(?:[:.—–-]).*)?[ \t]*(?:\*\*|__)| {0,3}<h[1-6][^>]*>[ \t]*phase[ \t]+0(?:[ \t]*(?:[:.—–-]).*)?[ \t]*<\/h[1-6]>| {0,3}phase[ \t]+0[^\r\n]*\r?\n {0,3}(?:=+|-+))[ \t]*$/gmi;
    const nextHeading = /^(?: {0,3}#{1,6}[ \t]+[^\r\n]*| {0,3}(?:\*\*|__)[^\r\n]*(?:\*\*|__)[ \t]*| {0,3}<h[1-6][^>]*>[^\r\n]*<\/h[1-6]>[ \t]*)$/gmi;
    const hadPhaseZero = outsideMatches(content, phaseZeroHeading).length > 0;
    const setextHeading = /^(?:[^\r\n]+\r?\n {0,3}(?:=+|-+)[ \t]*$)/gm;
    const phaseBoundary = new RegExp(`(?:${nextHeading.source}|${setextHeading.source})`, "gmi");
    content = replaceOwnedSection(content, phaseZeroHeading, phaseBoundary, grantPhase)
      .replace(/^\| \*\*AI Session Transcript\*\* \|[^\n]*$/gm,
        "| **AI Session Transcript** | Check current form | If the form requests a transcript, ask the user to select and authorize an export for this project. Use its actual output path; do not claim an automatic export occurred. Attachment or publication requires the user's scoped authorization. |")
      .replaceAll("3. Remind the user about the exported session file(s) in the project root.",
        "3. If the user requested an export and it succeeded, report the actual project session file(s) created. Otherwise say no session was exported.")
      .replaceAll("   - Session transcript (`./claude-session.jsonl` or `./codex-session.jsonl`)",
        "   - A user-selected current-project session transcript, only if the current form requires it and the export was authorized.")
      .replaceAll("in `skills/data/specs/`", `in \`${path.relative(path.dirname(finalFile), path.join(root, "data/specs")).split(path.sep).join("/")}/\``);
    const withoutGrant = content.replace(grantPhase, "");
    if ((content.split(grantPhase).length - 1) !== (hadPhaseZero ? 1 : 0) || outsideMatches(withoutGrant, phaseZeroHeading).length || /\bexport-session\.sh\b/i.test(withoutGrant)) {
      throw new Error("Unsupported apply-grant Phase 0 instructions; do not install them unchanged.");
    }
  }
  if (skillId === "ethglobal-skills") {
    const paymentWords = "(?:if[ \\t]+you[ \\t]+receive|when[ \\t]+the[ \\t]+api[ \\t]+returns?)[ \\t]+a?[ \\t]*402:?";
    const paymentHeading = new RegExp(`^(?: {0,3}#{1,6}[ \\t]+${paymentWords}[ \\t]*| {0,3}(?:\\*\\*|__)[ \\t]*${paymentWords}[ \\t]*(?:\\*\\*|__)| {0,3}<h[1-6][^>]*>[ \\t]*${paymentWords}[ \\t]*<\\/h[1-6]>|${paymentWords}\\r?\\n {0,3}(?:=+|-+))[ \\t]*$`, "gmi");
    const hadPaymentHeading = outsideMatches(content, paymentHeading).length > 0;
    content = replaceOwnedSection(content, paymentHeading,
      /^(?: {0,3}#{1,6}[ \t]+| {0,3}<h[1-6][^>]*>|[^\r\n]+\r?\n {0,3}(?:=+|-+)[ \t]*$|(?:---|\*\*\*|___)[ \t]*$)/gmi, paymentFlow);
    const withoutPayment = content.replace(paymentFlow, "");
    const paymentScan = withoutPayment.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, "");
    if ((content.split(paymentFlow).length - 1) !== (hadPaymentHeading ? 1 : 0) || outsideMatches(paymentScan,
      /^(?:(?: {0,3}#{1,6}[ \t]+| {0,3}<h[1-6][^>]*>| {0,3}(?:\*\*|__))[^\r\n]*\b402\b[^\r\n]*|[^\r\n]*\b402\b[^\r\n]*\r?\n {0,3}(?:=+|-+)[ \t]*)$/gmi).length) {
      throw new Error("Unsupported active payment command or 402 fallback instructions; do not install them unchanged.");
    }
  }
  // Router rows can be user-owned. Without recorded row provenance, policy migration preserves them.
  if (entrypoint) content = withCanonicalBoundary(content);
  assertNoUnsafeInstructions(content, { skillId, sourceId });
  return content;
}

/** Read-only: old compatible instructions still need the local adaptations. */
export function inspectSupportPolicy({ location, destination = location, root, sourceId, skillId, manifest }) {
  try {
    const directory = fs.lstatSync(location).isDirectory();
    assertExactEntrypoint(location, skillId);
    const changes = policyMarkdownFiles(location).flatMap(file => {
      const original = readUtf8(file).text;
      const finalFile = directory ? path.join(destination, path.relative(location, file)) : destination;
      return adaptedMarkdown(original, finalFile, root, sourceId, skillId, manifest, destination) !== original ? [directory ? path.relative(location, file) : path.basename(file)] : [];
    });
    if (!directory && location.endsWith(".md")) {
      const sidecar = supportPolicySidecarPath(location);
      const stat = (() => { try { return fs.lstatSync(sidecar); } catch { return null; } })();
      if (!stat?.isFile()) changes.push(path.relative(path.dirname(location), sidecar));
    }
    if (skillId === "apply-grant") {
      const script = path.join(location, "export-session.sh");
      const helper = path.join(location, "export-project-sessions.mjs");
      if (!fs.existsSync(script) || fs.readFileSync(script, "utf8") !== grantWrapper) changes.push("export-session.sh");
      if (!fs.existsSync(helper) || !fs.readFileSync(helper).equals(fs.readFileSync(fileURLToPath(new URL("./export-project-sessions.js", import.meta.url))))) changes.push("export-project-sessions.mjs");
    }
    if (sourceId === "solana-new" && path.basename(destination) === "colosseum" && directory) {
      const api = path.join(location, "copilot-api.json");
      if (fs.existsSync(api)) {
        const data = JSON.parse(fs.readFileSync(api, "utf8"));
        if (data.openapi && data.servers?.some(server => /\/api\/v1\b/.test(server.url))) changes.push("copilot-api.json");
      }
    }
    return { version: SUPPORT_POLICY_VERSION, complete: changes.length === 0, changes: [...new Set(changes)] };
  } catch { return { version: SUPPORT_POLICY_VERSION, complete: false, changes: [], error: "unsafe_or_unreadable_support_path" }; }
}

const grantWrapper = '#!/usr/bin/env bash\nset -euo pipefail\nscript_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"\nexec node "$script_dir/export-project-sessions.mjs" "$@"\n';

/** Stage a compatible existing copy; activating it belongs to the installer transaction. */
export function stageExistingSupportBundle({ location, staging, destination = location, ...options }) {
  filesBelow(location); // Reject links/devices before copying or adapting content.
  try { fs.lstatSync(staging); throw new Error("Policy staging path already exists."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  fs.cpSync(location, staging, { recursive: true, errorOnExist: true, force: false });
  if (fs.lstatSync(location).isFile()) {
    const existingSidecar = supportPolicySidecarPath(location);
    const stagedSidecar = supportPolicySidecarPath(staging);
    if (fs.existsSync(existingSidecar)) {
      fs.mkdirSync(path.dirname(stagedSidecar), { recursive: true });
      fs.copyFileSync(existingSidecar, stagedSidecar, fs.constants.COPYFILE_EXCL);
    }
  }
  adaptSupportBundle({ staging, destination, ...options });
  const policy = inspectSupportPolicy({ location: staging, destination, ...options });
  if (!policy.complete) throw new Error("Existing support guidance could not be adapted safely; active files were preserved.");
  return { staging, policy };
}

export function adaptSupportBundle({ staging, destination, root, sourceId, skillId, manifest }) {
  assertExactEntrypoint(staging, skillId);
  for (const file of policyMarkdownFiles(staging)) {
    const { bytes: originalBytes, text: original } = readUtf8(file);
    const directory = fs.statSync(staging).isDirectory();
    const relative = directory ? path.relative(staging, file) : path.basename(file);
    const finalFile = directory ? path.join(destination, relative) : destination;
    let content;
    try { content = adaptedMarkdown(original, finalFile, root, sourceId, skillId, manifest, destination); }
    catch (error) {
      error.message += ` Support file: ${sourceId}/${skillId ?? path.basename(destination)}/${relative}.`;
      throw error;
    }
    if (!directory || content !== original) preserve(staging, file, originalBytes);
    if (content !== original) fs.writeFileSync(file, content);
  }
  if (skillId === "apply-grant") {
    const script = path.join(staging, "export-session.sh");
    if (fs.existsSync(script) && fs.readFileSync(script, "utf8") !== grantWrapper) preserve(staging, script, fs.readFileSync(script));
    const helper = path.join(staging, "export-project-sessions.mjs");
    const bundledHelper = fs.readFileSync(fileURLToPath(new URL("./export-project-sessions.js", import.meta.url)));
    if (fs.existsSync(helper) && !fs.readFileSync(helper).equals(bundledHelper)) preserve(staging, helper, fs.readFileSync(helper));
    fs.writeFileSync(script, grantWrapper, { mode: 0o755 });
    fs.chmodSync(script, 0o755);
    fs.writeFileSync(helper, bundledHelper);
  }
  if (sourceId === "solana-new" && path.basename(destination) === "colosseum" && fs.statSync(staging).isDirectory()) {
    const api = path.join(staging, "copilot-api.json");
    if (fs.existsSync(api)) {
      const originalBytes = fs.readFileSync(api);
      if (!isUtf8(originalBytes)) throw new Error("Colosseum support data must be valid UTF-8 JSON.");
      const original = JSON.parse(originalBytes.toString("utf8"));
      if (original.openapi && original.servers?.some(server => /\/api\/v1\b/.test(server.url))) {
        preserve(staging, api, originalBytes);
        const historical = path.join(staging, "copilot-api-v1.historical.json");
        if (!fs.existsSync(historical)) fs.writeFileSync(historical, JSON.stringify({ status: "historical_only", usable_for_current_requests: false, contract: original }, null, 2) + "\n");
        const guide = {
          version: "2.0.0", status: "current_contract_guidance", api_base: "https://copilot.colosseum.com/api/v2",
          authentication: "Official Copilot Connect; no PAT input or legacy config reuse.",
          connection_guide: "../../colosseum-copilot/references/connection.md",
          api_reference: "../../colosseum-copilot/references/api-reference.md",
          contract_scope: "Read the installed official V2 references for operation schemas. This file is guidance, not a fabricated replacement OpenAPI specification.",
          historical_contract: "copilot-api-v1.historical.json"
        };
        fs.writeFileSync(api, JSON.stringify(guide, null, 2) + "\n");
      }
    }
  }
}
