#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const casesPath = path.join(root, 'examples/evals/behavioral-cases.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const treeHashScheme = 'sha256-json-tree-utf8-v2';
const canonicalNameOrder = (a, b) => Buffer.compare(Buffer.from(a.name, 'utf8'), Buffer.from(b.name, 'utf8'));

async function digestTree(directory, compare = canonicalNameOrder) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const parts = [];
  for (const entry of entries.sort(compare)) {
    const file = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Skill snapshot contains unsupported symlink: ${file}`);
    if (entry.isDirectory()) parts.push([entry.name, await digestTree(file, compare)]);
    else if (entry.isFile()) parts.push([entry.name, sha(await fs.readFile(file))]);
  }
  return sha(JSON.stringify(parts));
}

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    assert(['--out', '--skill', '--runs', '--judgments', '--cases', '--legacy-locale'].includes(key), `Unknown option: ${key}`);
    assert(argv[index + 1] && !argv[index + 1].startsWith('--'), `Missing value for ${key}`);
    assert(!result[key], `Duplicate option: ${key}`);
    result[key] = key === '--legacy-locale' ? argv[index + 1] : path.resolve(argv[index + 1]);
  }
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const opts = options(args);
  assert(['prepare', 'report'].includes(command), 'Usage: node scripts/eval-behavior.js prepare --out DIR [--skill DIR] [--cases FILE] | report --runs DIR --judgments FILE [--skill DIR] [--cases FILE] [--legacy-locale BCP47]');
  const suiteBytes = await fs.readFile(opts['--cases'] || casesPath);
  const suite = JSON.parse(suiteBytes);
  assert(Array.isArray(suite.cases) && suite.cases.length, 'Missing behavioral cases');
  const ids = new Set();
  for (const item of suite.cases) {
    assert(/^[a-z0-9-]+$/.test(item.id) && !ids.has(item.id), `Invalid/duplicate case ID: ${item.id}`);
    ids.add(item.id);
    assert(typeof item.prompt === 'string' && item.prompt.trim(), `Missing prompt: ${item.id}`);
    assert(Array.isArray(item.criteria) && item.criteria.length, `Missing criteria: ${item.id}`);
    assert(new Set(item.criteria.map(c => c.id)).size === item.criteria.length, `Duplicate criteria: ${item.id}`);
  }
  if (command === 'prepare') {
    assert(opts['--out'] && !opts['--runs'] && !opts['--judgments'] && !opts['--legacy-locale'], 'prepare requires --out and accepts optional --skill and --cases');
    const destination = opts['--out'];
    const skill = opts['--skill'] || path.join(root, 'skills/proofpilot');
    await fs.access(path.join(skill, 'SKILL.md'));
    const skillHash = await digestTree(skill);
    await fs.mkdir(destination, { recursive: true });
    assert((await fs.readdir(destination)).length === 0, 'Output directory must be empty; existing runs are never overwritten');
    const prepared = [];
    for (const item of suite.cases) {
      const prompt = `Use only the ProofPilot version at ${skill}, starting with its SKILL.md. This explicit path overrides any other installed ProofPilot entry in the skill catalog. Resolve all ProofPilot references and helpers within this snapshot; if one is absent, do not substitute another installation or version. Do not inspect other trials, responses, reviewer criteria or judgments. Complete the user request below with this skill and the supplied artifacts. Keep a separate execution record of the exact SKILL.md, reference and helper paths actually used, including any unavailable helper; do not put that record in the user-facing answer.\n\n${item.prompt}\n`;
      const filename = `${item.id}.prompt.md`;
      await fs.writeFile(path.join(destination, filename), prompt, { flag: 'wx' });
      prepared.push({ id: item.id, prompt_file: filename, prompt_sha256: sha(prompt), response_file: `${item.id}.response.md` });
    }
    const manifest = { version: 2, skill_hash_scheme: treeHashScheme, prepared_at: new Date().toISOString(), cases_sha256: sha(suiteBytes), skill_path: skill, skill_sha256: skillHash, cases: prepared };
    await fs.writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ status: 'prepared_only', directory: destination, cases: prepared.length, message: 'No model executed and no behavior measured. Run prompts independently, save actual responses, then supply reviewer judgments.' }, null, 2));
    return;
  }
  assert(opts['--runs'] && opts['--judgments'] && !opts['--out'], 'report requires --runs and --judgments; --skill can locate an identical archived snapshot');
  const directory = opts['--runs'];
  const manifestBytes = await fs.readFile(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const judgments = await readJson(opts['--judgments']);
  assert([1, 2].includes(manifest.version), 'Unsupported behavioral manifest version');
  assert(manifest.cases_sha256 === sha(suiteBytes), 'Case suite differs from prepared manifest');
  assert(judgments.manifest_sha256 === sha(manifestBytes), 'Judgments do not match the prepared manifest SHA');
  // Version 1 used the preparing runtime's default localeCompare ordering.
  // Preserve that meaning; never reinterpret an old digest as the v2 scheme.
  let compare = canonicalNameOrder;
  let legacyLocale;
  if (manifest.version === 1) {
    assert(manifest.skill_hash_scheme === undefined, 'Unexpected hash scheme for legacy v1 manifest');
    if (opts['--legacy-locale']) {
      let supported;
      try { supported = Intl.Collator.supportedLocalesOf([opts['--legacy-locale']]).length === 1; }
      catch { throw new Error('Invalid legacy locale; supply the known original BCP47 locale'); }
      assert(supported, 'Unsupported legacy locale; supply the known original BCP47 locale');
    }
    legacyLocale = new Intl.Collator(opts['--legacy-locale']).resolvedOptions().locale;
    compare = (a, b) => a.name.localeCompare(b.name, opts['--legacy-locale']);
  } else {
    assert(manifest.skill_hash_scheme === treeHashScheme, 'Unsupported skill hash scheme');
    assert(!opts['--legacy-locale'], '--legacy-locale is only valid for legacy v1 manifests');
  }
  const snapshotMismatch = manifest.version === 1
    ? 'Skill snapshot differs from preparation; legacy v1 used locale-sensitive ordering. Use an immutable snapshot and --legacy-locale with the known original BCP47 locale; do not rewrite the manifest or guess an unknown locale.'
    : 'Skill snapshot differs from preparation; use an immutable snapshot';
  assert(typeof manifest.skill_path === 'string' && await digestTree(opts['--skill'] || manifest.skill_path, compare) === manifest.skill_sha256, snapshotMismatch);
  assert(typeof judgments.reviewer === 'string' && judgments.reviewer.trim(), 'Name the reviewer or documented review process');
  assert(typeof judgments.reviewed_at === 'string' && Number.isFinite(Date.parse(judgments.reviewed_at)), 'A valid reviewed_at timestamp is required');
  assert(Array.isArray(judgments.runs) && judgments.runs.length > 0, 'No judgments: no measured report can be produced');
  assert(Array.isArray(manifest.cases) && manifest.cases.length === suite.cases.length, 'Invalid manifest cases');
  const seen = new Set();
  const results = [];
  for (const run of judgments.runs) {
    assert(ids.has(run.case_id) && !seen.has(run.case_id), `Unknown/duplicate judged case: ${run.case_id}`);
    seen.add(run.case_id);
    const item = suite.cases.find(c => c.id === run.case_id);
    const prepared = manifest.cases.find(c => c.id === run.case_id);
    assert(prepared && prepared.prompt_file === `${item.id}.prompt.md` && prepared.response_file === `${item.id}.response.md`, 'Unexpected manifest file path');
    const prompt = await fs.readFile(path.join(directory, prepared.prompt_file));
    assert(sha(prompt) === prepared.prompt_sha256, `Prompt modified: ${item.id}`);
    const response = await fs.readFile(path.join(directory, prepared.response_file), 'utf8');
    assert(response.trim(), `Empty actual response: ${item.id}`);
    assert(run.response_sha256 === sha(response), `Response SHA mismatch: ${item.id}`);
    assert(run.criteria && typeof run.criteria === 'object' && !Array.isArray(run.criteria), `Missing criteria judgments: ${item.id}`);
    assert(Object.keys(run.criteria).length === item.criteria.length && Object.keys(run.criteria).every(id => item.criteria.some(c => c.id === id)), `Criteria set mismatch: ${item.id}`);
    const counts = { pass: 0, fail: 0, unassessed: 0 };
    for (const criterion of item.criteria) {
      const judgment = run.criteria[criterion.id];
      assert(judgment && ['pass', 'fail', 'unassessed'].includes(judgment.verdict), `Invalid verdict: ${item.id}/${criterion.id}`);
      assert(typeof judgment.rationale === 'string' && judgment.rationale.trim(), `Missing rationale: ${item.id}/${criterion.id}`);
      if (judgment.verdict !== 'unassessed') {
        assert(typeof judgment.evidence === 'string' && judgment.evidence.trim() && response.includes(judgment.evidence), `Evidence must be a verbatim response excerpt: ${item.id}/${criterion.id}`);
      }
      counts[judgment.verdict]++;
    }
    results.push({ case_id: item.id, response_sha256: sha(response), ...counts, all_criteria_pass: counts.fail === 0 && counts.unassessed === 0 });
  }
  console.log(JSON.stringify({ status: 'reviewer_judgments_aggregated', reviewer: judgments.reviewer, reviewed_at: judgments.reviewed_at, manifest_version: manifest.version, skill_hash_scheme: manifest.version === 2 ? treeHashScheme : 'legacy-v1-localeCompare', ...(legacyLocale ? { legacy_locale: legacyLocale, legacy_locale_source: opts['--legacy-locale'] ? 'explicit_option' : 'report_runtime_default' } : {}), skill_sha256: manifest.skill_sha256, manifest_sha256: sha(manifestBytes), prepared_cases: suite.cases.length, judged_cases: results.length, unjudged_cases: suite.cases.filter(c => !seen.has(c.id)).map(c => c.id), cases_with_all_criteria_pass: results.filter(r => r.all_criteria_pass).length, results, limitation: 'Hashes bind prompts, saved responses, and judgments; they do not attest model execution or verify reviewer reasoning. No automated semantic grading was performed.' }, null, 2));
}

main().catch(error => { console.error(`Behavior evaluation: ${error.message}`); process.exitCode = 1; });
