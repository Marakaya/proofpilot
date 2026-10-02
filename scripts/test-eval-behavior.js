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
  const execute = (args, expectedStatus = 0, env = {}) => {
    const result = spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, ...env } });
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
    assert.equal(manifest.version, 3);
    assert.equal(manifest.skill_hash_scheme, 'sha256-json-tree-typed-utf8-v3');
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

    const preideaPrompt = fs.readFileSync(path.join(runs, 'preidea-program.prompt.md'), 'utf8');
    assert.match(preideaPrompt, /hypothetical request date is 2026-09-10, regardless of the actual execution date/);
    assert.match(preideaPrompt, /Applications close 2026-09-30/);
    assert.match(preideaPrompt, /full-time 2026-11-01/);
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
    assert.equal(report.typed_node_identity, true);
    assert.equal(report.response_encoding, 'strict-utf8');
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

    const unicodeResponse = `${response}Valid Unicode glyphs: \ufffd \ud83d\ude80\n`;
    fs.writeFileSync(responseFile, unicodeResponse);
    judgments.runs[0].response_sha256 = sha(Buffer.from(unicodeResponse));
    writeJudgments();
    assert.equal(JSON.parse(execute(['report', '--runs', runs, '--judgments', judgmentsFile]).stdout).results[0].response_sha256, sha(fs.readFileSync(responseFile)));
    cases++;
    fs.writeFileSync(responseFile, Buffer.concat([Buffer.from(`${response}Valid Unicode glyphs: `), Buffer.from([0xff]), Buffer.from(' \ud83d\ude80\n')]));
    rejectReport(/Response .*valid UTF-8/);
    assert.notEqual(sha(fs.readFileSync(responseFile)), judgments.runs[0].response_sha256, 'Fixture must change raw bytes while preserving the old lossy-decoded text');
    fs.writeFileSync(responseFile, response);
    judgments.runs[0].response_sha256 = sha(response);
    writeJudgments();
    cases++;

    // Each input text domain rejects invalid UTF-8 before parsing or judging.
    judgments.reviewer += ' \ufffd';
    writeJudgments();
    const validJudgments = fs.readFileSync(judgmentsFile);
    fs.writeFileSync(judgmentsFile, Buffer.from(validJudgments.toString('utf8').replace('\ufffd', '\u0000')).map(byte => byte === 0 ? 0xff : byte));
    rejectReport(/judgments\.json must contain valid UTF-8/);
    judgments.reviewer = judgments.reviewer.slice(0, -2);
    writeJudgments();
    cases++;

    const invalidPrompt = Buffer.concat([fs.readFileSync(path.join(runs, entry.prompt_file)), Buffer.from([0xff])]);
    const promptManifest = { ...manifest, cases: manifest.cases.map(item => item.id === selected.id ? { ...item, prompt_sha256: sha(invalidPrompt) } : item) };
    const invalidPromptManifestBytes = Buffer.from(JSON.stringify(promptManifest));
    const originalPromptBytes = fs.readFileSync(path.join(runs, entry.prompt_file));
    fs.writeFileSync(path.join(runs, entry.prompt_file), invalidPrompt);
    fs.writeFileSync(manifestFile, invalidPromptManifestBytes);
    judgments.manifest_sha256 = sha(invalidPromptManifestBytes);
    writeJudgments();
    rejectReport(/Prompt .*valid UTF-8/);
    fs.writeFileSync(path.join(runs, entry.prompt_file), originalPromptBytes);
    fs.writeFileSync(manifestFile, manifestBytes);
    judgments.manifest_sha256 = sha(manifestBytes);
    writeJudgments();
    cases++;

    const invalidManifestBytes = Buffer.from(JSON.stringify({ ...manifest, fixture_note: '\ufffd' }).replace('\ufffd', '\u0000')).map(byte => byte === 0 ? 0xff : byte);
    fs.writeFileSync(manifestFile, invalidManifestBytes);
    judgments.manifest_sha256 = sha(invalidManifestBytes);
    writeJudgments();
    rejectReport(/manifest\.json must contain valid UTF-8/);
    fs.writeFileSync(manifestFile, manifestBytes);
    judgments.manifest_sha256 = sha(manifestBytes);
    writeJudgments();
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

    const replacedDirectory = path.join(temporaryRoot, 'directory-replaced-with-file');
    fs.cpSync(skill, replacedDirectory, { recursive: true });
    fs.rmSync(path.join(replacedDirectory, 'references'), { recursive: true });
    fs.writeFileSync(path.join(replacedDirectory, 'references'), JSON.stringify([['fixture.md', sha(fs.readFileSync(referenceFile))]]));
    assert.match(execute(['report', '--runs', runs, '--judgments', judgmentsFile, '--skill', replacedDirectory], 1).stderr, /Skill snapshot differs/);
    const replacedDirectoryRuns = path.join(temporaryRoot, 'replaced-directory-runs');
    execute(['prepare', '--out', replacedDirectoryRuns, '--skill', replacedDirectory]);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(replacedDirectoryRuns, 'manifest.json'))).skill_sha256, manifest.skill_sha256);
    cases++;

    const fileToDirectorySkill = path.join(temporaryRoot, 'file-to-directory-skill');
    fs.mkdirSync(fileToDirectorySkill);
    fs.writeFileSync(path.join(fileToDirectorySkill, 'SKILL.md'), '# Synthetic node-type fixture\n');
    fs.writeFileSync(path.join(fileToDirectorySkill, 'payload'), '[]');
    const beforeTypeRuns = path.join(temporaryRoot, 'before-type-runs');
    execute(['prepare', '--out', beforeTypeRuns, '--skill', fileToDirectorySkill]);
    fs.unlinkSync(path.join(fileToDirectorySkill, 'payload'));
    fs.mkdirSync(path.join(fileToDirectorySkill, 'payload'));
    const afterTypeRuns = path.join(temporaryRoot, 'after-type-runs');
    execute(['prepare', '--out', afterTypeRuns, '--skill', fileToDirectorySkill]);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(beforeTypeRuns, 'manifest.json'))).skill_sha256, JSON.parse(fs.readFileSync(path.join(afterTypeRuns, 'manifest.json'))).skill_sha256);
    cases++;

    const linkedSkill = path.join(temporaryRoot, 'symlink-skill');
    fs.symlinkSync(skill, linkedSkill, 'dir');
    assert.match(execute(['prepare', '--out', path.join(temporaryRoot, 'linked-runs'), '--skill', linkedSkill], 1).stderr, /real directory, not a symlink/);
    const childLink = path.join(skill, 'linked-reference');
    fs.symlinkSync(referenceFile, childLink);
    rejectReport(/unsupported symlink/);
    fs.unlinkSync(childLink);
    cases++;

    if (process.platform !== 'win32') {
      const fifo = path.join(skill, 'unsupported-fifo');
      const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
      assert.ifError(created.error);
      assert.equal(created.status, 0, created.stderr);
      rejectReport(/unsupported filesystem node/);
      assert.match(execute(['prepare', '--out', path.join(temporaryRoot, 'fifo-runs'), '--skill', skill], 1).stderr, /unsupported filesystem node/);
      fs.unlinkSync(fifo);
      cases++;

      const invalidName = Buffer.concat([Buffer.from(`${skill}${path.sep}`), Buffer.from([0xff])]);
      let invalidNameCreated = false;
      try { fs.writeFileSync(invalidName, 'Invalid filename fixture.'); invalidNameCreated = true; }
      catch (error) {
        // Some filesystems require Unicode names and refuse the fixture itself.
        assert.ok(['EILSEQ', 'EINVAL'].includes(error.code), `Unexpected filename creation failure: ${error.message}`);
      }
      if (invalidNameCreated) {
        assert.match(execute(['prepare', '--out', path.join(temporaryRoot, 'invalid-name-runs'), '--skill', skill], 1).stderr, /filename .*valid UTF-8/);
        fs.unlinkSync(invalidName);
      }
      cases++;
    }
    fs.appendFileSync(path.join(archivedSkill, 'SKILL.md'), 'Unrelated replacement.\n');
    assert.match(execute(['report', '--runs', runs, '--judgments', judgmentsFile, '--skill', archivedSkill], 1).stderr, /Skill snapshot differs/);
    cases++;

    const customFile = path.join(temporaryRoot, 'custom-cases.json');
    const customRuns = path.join(temporaryRoot, 'custom-runs');
    const customSuite = { cases: [{ id: 'custom-case', prompt: 'Independent custom input.', criteria: [{ id: 'custom-check', description: 'Hidden custom criterion.' }] }] };
    fs.writeFileSync(customFile, JSON.stringify(customSuite));
    const malformedSuiteFile = path.join(temporaryRoot, 'malformed-ids.json');
    const malformedRuns = path.join(temporaryRoot, 'malformed-id-runs');
    for (const id of [undefined, 123, null, false, ['custom-case']]) {
      fs.writeFileSync(malformedSuiteFile, JSON.stringify({ cases: [{ ...customSuite.cases[0], id }] }));
      assert.match(execute(['prepare', '--out', malformedRuns, '--skill', skill, '--cases', malformedSuiteFile], 1).stderr, /Invalid\/duplicate case ID/);
      assert.equal(fs.existsSync(malformedRuns), false, 'Invalid case IDs must fail before creating prompts or a manifest');
    }
    cases++;
    for (const id of [undefined, 123, null, false, [], ' ']) {
      fs.writeFileSync(malformedSuiteFile, JSON.stringify({ cases: [{ ...customSuite.cases[0], criteria: [{ id, description: 'Synthetic invalid criterion ID.' }] }] }));
      assert.match(execute(['prepare', '--out', malformedRuns, '--skill', skill, '--cases', malformedSuiteFile], 1).stderr, /Invalid criterion ID/);
      assert.equal(fs.existsSync(malformedRuns), false, 'Invalid criterion IDs must fail before creating prompts or a manifest');
    }
    cases++;
    const invalidCasesFile = path.join(temporaryRoot, 'invalid-cases.json');
    const invalidCasesBytes = Buffer.from(JSON.stringify({ cases: [{ ...customSuite.cases[0], prompt: '\ufffd' }] }).replace('\ufffd', '\u0000')).map(byte => byte === 0 ? 0xff : byte);
    fs.writeFileSync(invalidCasesFile, invalidCasesBytes);
    assert.match(execute(['prepare', '--out', path.join(temporaryRoot, 'invalid-case-runs'), '--skill', skill, '--cases', invalidCasesFile], 1).stderr, /invalid-cases\.json must contain valid UTF-8/);
    cases++;
    fs.writeFileSync(invalidCasesFile, JSON.stringify({ cases: [{ ...customSuite.cases[0], prompt: '\ud800' }] }));
    assert.match(execute(['prepare', '--out', path.join(temporaryRoot, 'surrogate-case-runs'), '--skill', skill, '--cases', invalidCasesFile], 1).stderr, /unpaired Unicode surrogate/);
    cases++;
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

    // Public prepare/report --skill flow must survive relocation AND a locale
    // change. The legacy comparator demonstrably orders these names differently.
    const unicodeSkill = path.join(temporaryRoot, 'unicode-skill');
    fs.mkdirSync(path.join(unicodeSkill, 'references'), { recursive: true });
    fs.writeFileSync(path.join(unicodeSkill, 'SKILL.md'), '# Unicode synthetic skill fixture\n');
    fs.writeFileSync(path.join(unicodeSkill, 'references/z.md'), 'ASCII reference.\n');
    fs.writeFileSync(path.join(unicodeSkill, 'references/ä.md'), 'Unicode reference.\n');
    const english = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
    const swedish = { LANG: 'sv_SE.UTF-8', LC_ALL: 'sv_SE.UTF-8' };
    const oldDigest = env => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs'; import path from 'node:path'; import {createHash} from 'node:crypto';
        const sha = value => createHash('sha256').update(value).digest('hex');
        function digest(dir) { return sha(JSON.stringify(fs.readdirSync(dir, {withFileTypes:true})
          .sort((a,b) => a.name.localeCompare(b.name)).map(entry => [entry.name,
            entry.isDirectory() ? digest(path.join(dir,entry.name)) : sha(fs.readFileSync(path.join(dir,entry.name)))]))); }
        console.log(JSON.stringify({hash:digest(process.argv[1]), locale:new Intl.Collator().resolvedOptions().locale}));
      `, unicodeSkill], { encoding: 'utf8', env: { ...process.env, ...env } });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const oldEnglish = oldDigest(english);
    const oldSwedish = oldDigest(swedish);
    assert.notEqual(oldEnglish.hash, oldSwedish.hash, 'Fixture must expose the former locale-dependent digest');
    cases++;
    const unicodeRuns = path.join(temporaryRoot, 'unicode-runs');
    execute(['prepare', '--out', unicodeRuns, '--skill', unicodeSkill, '--cases', customFile], 0, english);
    const unicodeManifestBytes = fs.readFileSync(path.join(unicodeRuns, 'manifest.json'));
    const unicodeManifest = JSON.parse(unicodeManifestBytes);
    const unicodeArchive = path.join(temporaryRoot, 'identical-unicode-archive');
    fs.cpSync(unicodeSkill, unicodeArchive, { recursive: true });
    const unicodeJudgmentsFile = path.join(temporaryRoot, 'unicode-judgments.json');
    const unicodeJudgments = { ...judgments, manifest_sha256: sha(unicodeManifestBytes), runs: [{ case_id: 'custom-case', response_sha256: sha(response), criteria: { 'custom-check': { verdict: 'pass', rationale: 'Artificial harness fixture only.', evidence: 'Synthetic CLI fixture only.' } } }] };
    fs.writeFileSync(path.join(unicodeRuns, 'custom-case.response.md'), response);
    fs.writeFileSync(unicodeJudgmentsFile, JSON.stringify(unicodeJudgments));
    const unicodeArgs = ['report', '--runs', unicodeRuns, '--judgments', unicodeJudgmentsFile, '--cases', customFile, '--skill', unicodeArchive];
    const crossLocaleReport = JSON.parse(execute(unicodeArgs, 0, swedish).stdout);
    assert.equal(crossLocaleReport.skill_sha256, unicodeManifest.skill_sha256);
    assert.equal(crossLocaleReport.manifest_version, 3);
    assert.equal(crossLocaleReport.skill_hash_scheme, 'sha256-json-tree-typed-utf8-v3');
    cases++;
    const swedishRuns = path.join(temporaryRoot, 'swedish-runs');
    execute(['prepare', '--out', swedishRuns, '--skill', unicodeArchive, '--cases', customFile], 0, swedish);
    assert.equal(JSON.parse(fs.readFileSync(path.join(swedishRuns, 'manifest.json'))).skill_sha256, unicodeManifest.skill_sha256);
    cases++;
    assert.match(execute([...unicodeArgs, '--legacy-locale', 'en-US'], 1).stderr, /only valid for legacy v1/);
    cases++;
    const unsupportedScheme = { ...unicodeManifest, skill_hash_scheme: 'unknown-scheme' };
    const replaceUnicodeManifest = value => {
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      fs.writeFileSync(path.join(unicodeRuns, 'manifest.json'), bytes);
      unicodeJudgments.manifest_sha256 = sha(bytes);
      fs.writeFileSync(unicodeJudgmentsFile, JSON.stringify(unicodeJudgments));
    };
    replaceUnicodeManifest(unsupportedScheme);
    assert.match(execute(unicodeArgs, 1).stderr, /Unsupported skill hash scheme/);
    cases++;
    // Artificial v2 archive retains its original untyped byte-order digest.
    const v2Digest = directory => sha(JSON.stringify(fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
      .map(entry => [entry.name, entry.isDirectory() ? v2Digest(path.join(directory, entry.name)) : sha(fs.readFileSync(path.join(directory, entry.name)))])));
    const v2Manifest = { ...unicodeManifest, version: 2, skill_hash_scheme: 'sha256-json-tree-utf8-v2', skill_sha256: v2Digest(unicodeSkill) };
    replaceUnicodeManifest(v2Manifest);
    const v2ManifestBytes = fs.readFileSync(path.join(unicodeRuns, 'manifest.json'));
    const v2JudgmentBytes = fs.readFileSync(unicodeJudgmentsFile);
    for (const env of [english, swedish]) {
      const v2Report = JSON.parse(execute(unicodeArgs, 0, env).stdout);
      assert.equal(v2Report.manifest_version, 2);
      assert.equal(v2Report.skill_hash_scheme, 'sha256-json-tree-utf8-v2');
      assert.equal(v2Report.skill_sha256, v2Manifest.skill_sha256);
      assert.equal(v2Report.typed_node_identity, false);
      assert.equal(v2Report.response_encoding, 'strict-utf8');
      assert.match(v2Report.skill_hash_limitation, /omit filesystem node types/);
    }
    assert.deepEqual(fs.readFileSync(path.join(unicodeRuns, 'manifest.json')), v2ManifestBytes);
    assert.deepEqual(fs.readFileSync(unicodeJudgmentsFile), v2JudgmentBytes);
    cases++;
    replaceUnicodeManifest({ ...v2Manifest, skill_hash_scheme: 'sha256-json-tree-typed-utf8-v3' });
    assert.match(execute(unicodeArgs, 1).stderr, /Unsupported skill hash scheme/);
    cases++;
    // This is an explicitly artificial v1 fixture produced by the old digest,
    // not a rewritten real trial or a claim that a model was executed.
    const legacyManifest = { ...unicodeManifest, version: 1, skill_sha256: oldEnglish.hash };
    delete legacyManifest.skill_hash_scheme;
    replaceUnicodeManifest(legacyManifest);
    const legacyManifestBytes = fs.readFileSync(path.join(unicodeRuns, 'manifest.json'));
    const legacyJudgmentBytes = fs.readFileSync(unicodeJudgmentsFile);
    assert.equal(JSON.parse(execute(unicodeArgs, 0, english).stdout).skill_hash_scheme, 'legacy-v1-localeCompare');
    cases++;
    assert.match(execute(unicodeArgs, 1, swedish).stderr, /--legacy-locale with the known original/);
    cases++;
    const recovered = JSON.parse(execute([...unicodeArgs, '--legacy-locale', oldEnglish.locale], 0, swedish).stdout);
    assert.equal(recovered.skill_sha256, oldEnglish.hash);
    assert.equal(recovered.legacy_locale, oldEnglish.locale);
    assert.equal(recovered.legacy_locale_source, 'explicit_option');
    assert.equal(recovered.typed_node_identity, false);
    assert.equal(recovered.response_encoding, 'strict-utf8');
    assert.match(recovered.skill_hash_limitation, /omit filesystem node types/);
    assert.deepEqual(fs.readFileSync(path.join(unicodeRuns, 'manifest.json')), legacyManifestBytes);
    assert.deepEqual(fs.readFileSync(unicodeJudgmentsFile), legacyJudgmentBytes);
    cases++;
    assert.match(execute([...unicodeArgs, '--legacy-locale', oldSwedish.locale], 1, swedish).stderr, /Skill snapshot differs/);
    cases++;
    assert.match(execute([...unicodeArgs, '--legacy-locale', 'not_a_BCP47_locale'], 1).stderr, /Invalid legacy locale/);
    cases++;
    fs.appendFileSync(path.join(unicodeArchive, 'references/ä.md'), 'Archive changed.\n');
    assert.match(execute([...unicodeArgs, '--legacy-locale', oldEnglish.locale], 1, swedish).stderr, /Skill snapshot differs/);
    cases++;

    const welcomeFile = path.join(root, 'examples/evals/welcome-cases.json');
    const welcomeSuite = JSON.parse(fs.readFileSync(welcomeFile, 'utf8'));
    const welcomeRuns = path.join(temporaryRoot, 'welcome-runs');
    execute(['prepare', '--out', welcomeRuns, '--skill', skill, '--cases', welcomeFile]);
    assert.equal(welcomeSuite.cases.length, 7);
    const welcomeManifest = JSON.parse(fs.readFileSync(path.join(welcomeRuns, 'manifest.json')));
    const supportManifest = JSON.parse(fs.readFileSync(path.join(root, 'skills/proofpilot/references/skill-dependencies.json'), 'utf8'));
    const expectedSupportIds = new Set(supportManifest.sources.flatMap(source => source.skills.map(skill => skill.id)));
    for (const item of welcomeSuite.cases) {
      const prompt = fs.readFileSync(path.join(welcomeRuns, `${item.id}.prompt.md`), 'utf8');
      assert.ok(prompt.includes(item.prompt));
      assert.match(prompt, /SYNTHETIC TOOL STATE/);
      assert.match(prompt, /do not execute helpers/);
      const stateText = item.prompt.split('SYNTHETIC TOOL STATE:\n')[1]?.split('\n\nSupplied conversation history:')[0];
      assert.ok(stateText, `Missing synthetic tool state in ${item.id}`);
      const state = JSON.parse(stateText);
      const bundle = state.inventory.support_bundle;
      assert.ok(['full', 'core_only', 'unknown'].includes(bundle.installation_mode), `${item.id}: installation mode must use the inventory enum`);
      assert.equal(new Set(bundle.skills.map(skill => skill.id)).size, bundle.skills.length, `${item.id}: duplicate support-skill IDs`);
      assert.deepEqual(new Set(bundle.skills.map(skill => skill.id)), expectedSupportIds, `${item.id}: synthetic inventory must enumerate the packaged support-skill IDs`);
      const installed = bundle.skills.filter(skill => skill.status === 'installed').map(skill => skill.id);
      if (bundle.guidance_complete === true) {
        assert.equal(bundle.installation_mode, 'full');
        assert.equal(installed.length, expectedSupportIds.size, `${item.id}: complete guidance cannot omit an installed support skill`);
      }
      if (item.id === 'welcome-core-only-local-fix') {
        assert.equal(bundle.installation_mode, 'core_only');
        assert.equal(bundle.guidance_complete, false);
        assert.equal(installed.length, 0);
      }
      if (item.id === 'welcome-catalog-without-access') {
        assert.equal(bundle.installation_mode, 'full');
        assert.equal(bundle.guidance_complete, false, 'Full installation intent cannot imply completed guidance in the partial catalog fixture');
        assert.deepEqual(new Set(installed), new Set(['brand-design', 'validate-idea', 'create-pitch-deck']));
      }
      for (const criterion of welcomeSuite.cases.flatMap(candidate => candidate.criteria)) assert.ok(!prompt.includes(criterion.description));
      assert.ok(!fs.existsSync(path.join(welcomeRuns, `${item.id}.response.md`)));
    }
    assert.equal(welcomeManifest.cases_sha256, sha(fs.readFileSync(welcomeFile)));
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
