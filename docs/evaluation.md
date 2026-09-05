# Behavioral Evaluation

Schema checks establish data validity. They do not establish that ProofPilot improves a model's decisions. The six synthetic cases in `examples/evals/behavioral-cases.json` separate user inputs from reviewer criteria and exercise eligibility, evidence, economics, task scope, and justified positive recommendations.

## Prepare And Execute

```sh
node scripts/eval-behavior.js prepare --out /tmp/proofpilot-candidate --skill /absolute/path/to/skills/proofpilot
```

Use a new, empty output directory. This writes prompts and a manifest containing case, prompt, and skill-tree hashes. It does **not** call a model. The prompts contain the synthetic user artifacts and skill location; reviewer criteria are not included.

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

If the run directory and its immutable skill snapshot are archived elsewhere, pass `--skill /new/path/to/identical/snapshot` to `report`. Its tree hash must still match the original manifest. Do not rewrite manifests, prompts, or judgments to simulate an original execution at the new location. Name AI-assisted reviews explicitly; aggregation does not turn them into human judgments.
