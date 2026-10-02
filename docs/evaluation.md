# Behavioral Evaluation

Schema checks establish data validity. They do not establish that ProofPilot improves a model's decisions. The six synthetic cases in `examples/evals/behavioral-cases.json` separate user inputs from reviewer criteria and exercise eligibility, evidence, economics, task scope, and justified positive recommendations. Date-sensitive eligibility cases explicitly specify their hypothetical request date and full cycle dates; use that supplied clock rather than the trial's execution date.

## Prepare And Execute

```sh
node scripts/eval-behavior.js prepare --out /tmp/proofpilot-candidate --skill /absolute/path/to/skills/proofpilot
```

Use a new, empty output directory. This writes prompts and a version 3 manifest containing case, prompt, and skill-tree hashes. It does **not** call a model. The prompts contain the synthetic user artifacts and skill location; reviewer criteria are not included. `skill_hash_scheme: sha256-json-tree-typed-utf8-v3` sorts names by their UTF-8 bytes at every directory level before recursively hashing JSON `[name, "directory"|"file", digest]` triples. A file digest covers its exact bytes; a directory digest covers its sorted child triples. The node type distinguishes a directory from a file containing that directory's serialized hash representation. The scheme is independent of the preparing or reporting locale. Names require valid UTF-8 and are not Unicode-normalized; renamed files are a changed snapshot. The root must be a real directory. Symbolic links and filesystem nodes other than regular files/directories are rejected. Record the Node/ICU version and locale with execution provenance, especially for historical version 1 evidence.

Cases, manifests, judgments, prepared prompts and saved responses require valid UTF-8; malformed bytes are rejected rather than replaced during decoding. JSON keys and string values also reject unpaired Unicode surrogates, so generating a prompt cannot silently replace an escaped invalid character. Response SHA-256 covers the exact saved file bytes. Valid UTF-8 responses retain their existing digests, including literal U+FFFD characters and multibyte text. The report states `response_encoding: strict-utf8` for every supported manifest version.

For a focused regression suite, pass `--cases /absolute/cases.json` to both `prepare` and `report`, using the same `{cases:[{id,prompt,criteria:[{id,description}]}]}` format. Its exact bytes are bound into the manifest. Keep new source-scope, attribution and cohort failures as regression cases; use fresh cases for later claims about generalization. A passing familiar suite alone cannot measure an improvement.

Run each selected prompt in an independent fresh model session, providing the referenced skill but withholding the expected criteria and prior conclusions. Follow each prompt's offline and no-external-action restrictions. Save the actual final response verbatim as the manifest's `<case-id>.response.md`. Keep the execution transcript separately when available, plus model/version, settings, runtime, and run time. A saved response alone is not proof of how it was produced.

For baseline/candidate comparison, prepare two directories against immutable skill snapshots and use the same cases, model, runtime permissions, and settings. Repeat trials if variability affects the conclusion; use a fresh prepared directory per trial. Do not tune on all cases and then describe the result as unseen-task performance. Keep diagnosed failures as regressions and add separate held-out cases over time.

Verify execution provenance before comparing results: the agent must actually read the selected snapshot and resolve its references/helpers there. A manifest hash proves which version was assigned, not which version was used. Retain exact paths from the tool trace and flag any cross-version fallback. A contaminated baseline/candidate pair is invalid for improvement claims, even if its responses and manifest pass hash checks. The preparation prompt requires version isolation and a separate path record; the harness does not enforce a filesystem sandbox, so inspect the record/trace rather than assuming compliance.

## Review Actual Responses

A reviewer reads the saved response against every criterion for the selected case. `pass` means the observable response meets the criterion, `fail` means it does not, and `unassessed` records an unresolved judgment. Use a verbatim excerpt plus reasoning for every pass/fail; for an omission, quote the relevant answer context and explain what is absent. Do not award credit for an intended behavior absent from the response.

Create a separate judgments file; use the SHA-256 of the exact manifest bytes and saved UTF-8 response. Example structure (placeholders must be replaced with actual review):

```json
{
  "manifest_sha256": "ACTUAL_MANIFEST_SHA256",
  "reviewer": "Reviewer or documented review process",
  "reviewed_at": "2026-09-05T12:00:00Z",
  "runs": [
    {
      "case_id": "preidea-program",
      "response_sha256": "ACTUAL_RESPONSE_SHA256",
      "criteria": {
        "stage-fit": {"verdict": "unassessed", "rationale": "Review pending."},
        "target": {"verdict": "unassessed", "rationale": "Review pending."},
        "bounded-action": {"verdict": "unassessed", "rationale": "Review pending."}
      }
    }
  ]
}
```

For an assessed criterion, add `"evidence": "Exact excerpt from the saved response"` and replace the rationale and verdict. Include every criterion for each judged case. Subsets of cases are supported; the report explicitly names unjudged cases.

```sh
node scripts/eval-behavior.js report --runs /tmp/proofpilot-candidate --judgments /tmp/candidate-judgments.json
```

The runner checks case identity, prompt integrity, response hashes, complete criterion IDs, and quoted evidence, then aggregates the supplied judgments. It rejects missing responses, unmatched hashes, and empty judgment sets. It does not supply semantic judgments or certify that a model actually ran. Report the exact cases, trials, limitations, and remaining uncertainty; no measured quality claim exists until real responses have been executed and reviewed.

If the run directory and its immutable skill snapshot are archived elsewhere, pass `--skill /new/path/to/identical/snapshot` to `report`. Its tree hash must still match the original manifest using that manifest's original scheme. Do not rewrite manifests, prompts, or judgments to simulate an original execution at the new location. Name AI-assisted reviews explicitly; aggregation does not turn them into human judgments.

Version 2 archives retain `sha256-json-tree-utf8-v2`, including their original byte-order sorting and untyped `[name, digest]` pairs. Versions 1 and 2 omit filesystem node types: a crafted file containing a directory's serialized hash representation can share its digest. Their reports explicitly set `typed_node_identity: false` and disclose this structural limitation. A matching historical checksum therefore requires the preserved original archive and execution provenance; it cannot establish unique directory/file identity. New version 3 reports set `typed_node_identity: true`. Historical manifests and judgments are read without modification, never relabeled or recomputed under the new scheme. All versions reject symlinks, unsupported filesystem nodes and invalid UTF-8 text/filenames.

Version 1 manifests retain their original `localeCompare` hash semantics. By default they are checked using the reporting runtime's locale, as the old harness did. For an identical archive prepared under a **known recorded** different locale, use an explicit BCP47 locale, for example:

```sh
node scripts/eval-behavior.js report --runs /archive/runs --judgments /archive/judgments.json --skill /archive/identical-snapshot --legacy-locale en-US
```

This recomputes the historical digest with that locale and preserves the exact old manifest, prompts, responses and judgment hashes. The report names `legacy-v1-localeCompare`, the resolved locale and whether it came from the explicit option or reporting runtime. The option is only valid for v1; unknown or mismatched v2/v3 hash schemes are rejected. The caller must establish the original locale from retained runtime evidence; a matching digest alone does not attest its historical provenance or uniquely identify node types. Do not guess an unknown locale or silently convert a v1/v2 hash into v3. Changes in ICU collation data can still affect old evidence even with the same locale: retain the original runtime when necessary, or prepare and execute a new v3 trial rather than relabeling the old one. Exact case-suite bytes remain required, so archive the old suite when reporting older trials.

## Controlled Welcome Trials

`examples/evals/welcome-cases.json` adds seven independent dialogue cases: full installation with missing access, verified access with the second message and task continuation, pending login, core-only local debugging, a partial local catalog without access, narrow pitch copyediting, and offline continuation after service failure. Each prompt supplies explicit **synthetic** inventory/account/tool results and conversation history. These are controlled states for assessing the selected skill's dialogue decisions, not evidence that a helper or real account behaves that way.

```sh
node scripts/eval-behavior.js prepare --out /tmp/proofpilot-welcome --skill /absolute/path/to/frozen/skills/proofpilot --cases /absolute/path/to/examples/evals/welcome-cases.json
```

Run each prepared prompt in a fresh, independent model session that can read only the selected frozen skill tree and supplied prompt. Read the skill and resolve its needed references there; generating an expected answer from the case title is not a trial. Keep reviewer criteria and other responses out of the model's accessible files. Do not execute helpers, inspect credentials, contact accounts, browse, open a browser, install software or perform external actions; use the supplied fixed driver results. Record actual tool paths and the final response separately. This controls service state and prevents a real sign-in from contaminating or blocking the trial; it does not test the connector's implementation.

An independent reviewer then assesses every criterion against each actual saved response and may inspect the retained trace for execution provenance. Use the same `--cases` file for `report`. Label omissions and uncertainty explicitly; preserve partial/unassessed results rather than converting them into passes. Harness regression tests only establish preparation, isolation of criteria and aggregation integrity. Preparing these seven prompts, reviewing their prose or passing the CLI tests measures **no model behavior**. Claim welcome success only for the exact independently executed and judged trials, naming the model/settings, controlled states, repetitions and remaining real-service coverage limits.
