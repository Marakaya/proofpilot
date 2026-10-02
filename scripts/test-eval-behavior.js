import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), '..');
const runner = path.join(root, 'scripts/eval-behavior.js');
const sha = value => createHash('sha256').update(value).digest('hex');

export function runBehaviorCliTests() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proofpilot-behavior-test-'));
  const suite = JSON.parse(fs.readFileSync(path.join(root, 'examples/evals/behavioral-cases.json'), 'utf8'));
  const skill = path.join(temporaryRoot, 'synthetic-skill');
  const runs = path.join(temporaryRoot, 'prepared');
  const judgmentsFile = path.join(temporaryRoot, 'judgments.json');
  let cases = 0;
  const execute = (args, expectedStatus = 0) => {
    const result = spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus, `Behavior CLI failed: ${result.stderr || result.stdout}`);
    return result;
  };
  const rejectReport = expectedMessage => {
    const result = execute(['report', '--runs', runs, '--judgments', judgmentsFile], 1);
    assert.match(result.stderr, expectedMessage);
    assert.equal(result.stdout.trim(), '', 'Rejected input must not emit a measured report');
  };
  try {
    // This tiny skill and all response text below are harness fixtures, not model outputs.
    fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '# Synthetic CLI skill fixture\n');
    const referenceFile = path.join(skill, 'references/fixture.md');
    fs.writeFileSync(referenceFile, 'Initial immutable fixture.\n');
    const prepared = JSON.parse(execute(['prepare', '--out', runs, '--skill', skill]).stdout);
    const manifestFile = path.join(runs, 'manifest.json');
    const manifestBytes = fs.readFileSync(manifestFile);
    const manifest = JSON.parse(manifestBytes);
    assert.equal(prepared.status, 'prepared_only');
    assert.equal(prepared.cases, suite.cases.length);
    assert.deepEqual(new Set(manifest.cases.map(item => item.id)), new Set(suite.cases.map(item => item.id)));
    for (const item of suite.cases) {
      const entry = manifest.cases.find(candidate => candidate.id === item.id);
      const promptBytes = fs.readFileSync(path.join(runs, entry.prompt_file));
      const prompt = promptBytes.toString('utf8');
      assert.ok(prompt.includes(item.prompt), 'Prepared prompt must retain the raw user request');
      assert.ok(prompt.includes(`Use only the ProofPilot version at ${skill}`), 'Execution must pin the selected snapshot');
      assert.ok(prompt.includes('do not substitute another installation or version'), 'Missing helpers must not silently mix skill versions');
      assert.ok(prompt.includes('exact SKILL.md, reference and helper paths actually used'), 'Execution must request provenance beyond manifest hashes');
      assert.equal(sha(promptBytes), entry.prompt_sha256);
      for (const criterion of suite.cases.flatMap(candidate => candidate.criteria)) {
        assert.ok(!prompt.includes(criterion.description), 'Reviewer-only criteria leaked into an execution prompt');
      }
      assert.ok(!fs.existsSync(path.join(runs, entry.response_file)), 'Preparation must not fabricate model responses');
    }
    cases++;

    execute(['prepare', '--out', runs, '--skill', skill], 1);
    assert.deepEqual(fs.readFileSync(manifestFile), manifestBytes, 'A repeated preparation changed an existing manifest');
    cases++;

    const selected = suite.cases[0];
    const entry = manifest.cases.find(item => item.id === selected.id);
    const responseFile = path.join(runs, entry.response_file);
    const response = 'Synthetic CLI fixture only. No model was executed or evaluated.\n';
    const verdicts = ['pass', 'fail', 'unassessed'];
    const judgments = {
      manifest_sha256: sha(manifestBytes),
      reviewer: 'Synthetic CLI harness test, not a quality evaluation',
      reviewed_at: '2026-09-05T12:00:00Z',
      runs: [{
        case_id: selected.id,
        response_sha256: sha(response),
        criteria: Object.fromEntries(selected.criteria.map((criterion, index) => [criterion.id, {
          verdict: verdicts[index % verdicts.length],
          rationale: 'Artificial judgment used only to test CLI aggregation.',
          evidence: 'Synthetic CLI fixture only.'
        }]))
      }]
    };
    const writeJudgments = () => fs.writeFileSync(judgmentsFile, JSON.stringify(judgments));
    writeJudgments();
    rejectReport(/ENOENT/);
    cases++;

    fs.writeFileSync(responseFile, response);
    const report = JSON.parse(execute(['report', '--runs', runs, '--judgments', judgmentsFile]).stdout);
    assert.equal(report.judged_cases, 1);
    assert.deepEqual(new Set(report.unjudged_cases), new Set(suite.cases.slice(1).map(item => item.id)));
    assert.equal(report.results[0].response_sha256, sha(response));
    for (const verdict of verdicts) {
      assert.equal(report.results[0][verdict], Object.values(judgments.runs[0].criteria).filter(item => item.verdict === verdict).length);
    }
    assert.equal(report.cases_with_all_criteria_pass, 0, 'Incomplete or failing judgments must not become a passing case');
    assert.ok(report.limitation, 'Report must expose the limits of hash verification and manual grading');
    cases++;

    fs.writeFileSync(responseFile, `${response}Tampered response.\n`);
    rejectReport(/Response SHA mismatch/);
    fs.writeFileSync(responseFile, response);
    cases++;

    const criterion = judgments.runs[0].criteria[selected.criteria[0].id];
    criterion.evidence = 'An invented quotation absent from the saved response';
    writeJudgments();
    rejectReport(/verbatim response excerpt/);
    criterion.evidence = 'Synthetic CLI fixture only.';
    writeJudgments();
    cases++;

    const promptFile = path.join(runs, entry.prompt_file);
    const originalPrompt = fs.readFileSync(promptFile);
    fs.appendFileSync(promptFile, '\nInjected instructions after preparation.\n');
    rejectReport(/Prompt modified/);
    fs.writeFileSync(promptFile, originalPrompt);
    cases++;

    const archivedSkill = path.join(temporaryRoot, 'archived-snapshot');
    fs.cpSync(skill, archivedSkill, { recursive: true });
    const relocated = JSON.parse(execute(['report', '--runs', runs, '--judgments', judgmentsFile, '--skill', archivedSkill]).stdout);
    assert.equal(relocated.skill_sha256, manifest.skill_sha256);
    cases++;
    fs.appendFileSync(path.join(archivedSkill, 'SKILL.md'), 'Unrelated replacement.\n');
    assert.match(execute(['report', '--runs', runs, '--judgments', judgmentsFile, '--skill', archivedSkill], 1).stderr, /Skill snapshot differs/);
    cases++;

    const customFile = path.join(temporaryRoot, 'custom-cases.json');
    const customRuns = path.join(temporaryRoot, 'custom-runs');
    const customSuite = { cases: [{ id: 'custom-case', prompt: 'Independent custom input.', criteria: [{ id: 'custom-check', description: 'Hidden custom criterion.' }] }] };
    fs.writeFileSync(customFile, JSON.stringify(customSuite));
    execute(['prepare', '--out', customRuns, '--skill', skill, '--cases', customFile]);
    const customManifestBytes = fs.readFileSync(path.join(customRuns, 'manifest.json'));
    const customPrompt = fs.readFileSync(path.join(customRuns, 'custom-case.prompt.md'), 'utf8');
    assert.ok(customPrompt.includes('Independent custom input.'));
    assert.ok(!customPrompt.includes('Hidden custom criterion.'));
    cases++;
    const customJudgmentsFile = path.join(temporaryRoot, 'custom-judgments.json');
    fs.writeFileSync(path.join(customRuns, 'custom-case.response.md'), response);
    fs.writeFileSync(customJudgmentsFile, JSON.stringify({ ...judgments, manifest_sha256: sha(customManifestBytes), runs: [{ case_id: 'custom-case', response_sha256: sha(response), criteria: { 'custom-check': { verdict: 'pass', rationale: 'Harness fixture only.', evidence: 'Synthetic CLI fixture only.' } } }] }));
    const customArgs = ['report', '--runs', customRuns, '--judgments', customJudgmentsFile];
    assert.equal(JSON.parse(execute([...customArgs, '--cases', customFile]).stdout).judged_cases, 1);
    cases++;
    assert.match(execute(customArgs, 1).stderr, /Case suite differs/);
    cases++;
    customSuite.cases[0].criteria[0].description = 'Changed criterion';
    fs.writeFileSync(customFile, JSON.stringify(customSuite));
    assert.match(execute([...customArgs, '--cases', customFile], 1).stderr, /Case suite differs/);
    cases++;

    fs.appendFileSync(referenceFile, 'Changed after preparation.\n');
    rejectReport(/Skill snapshot differs/);
    cases++;
    return { cases };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(filename)) {
  const summary = runBehaviorCliTests();
  console.log(`Behavior CLI regression tests passed: ${summary.cases}. No model executed or evaluated.`);
}
