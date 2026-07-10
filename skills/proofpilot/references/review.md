# Review

Use this workflow for readiness feedback or formal evaluation.

## Coach Mode

1. Identify the artifact and decision it must support.
2. Select the closest rubric from [rubrics.json](rubrics.json).
3. Score only dimensions that apply and explain `not_applicable` values.
4. Prioritize blockers and improvements by decision impact and effort.
5. Re-score only after the user provides revised evidence or artifacts.

## Evaluator Mode

1. Freeze the rubric ID, version, evidence cutoff, and allowed sources before scoring.
2. Evaluate the submitted artifact without rewriting it.
3. Cite artifact locations or external evidence for every scored dimension.
4. Record missing evidence separately from contrary evidence.
5. Calculate the weighted score and evidence coverage.
6. Flag conflicts of interest, policy exceptions, and low-confidence dimensions.
7. Produce an audit-friendly result that another reviewer can reproduce.

## Required Output

- rubric ID and version
- artifact and evidence snapshot
- dimension scores from 0 to 4, `insufficient_evidence`, or `not_applicable`
- evidence and confidence per dimension
- weighted score and evidence coverage
- blockers, quick wins, and unresolved unknowns
- evaluator notes or coaching actions, depending on mode

Map scores to red, yellow, and green only for display. Preserve the underlying anchored score and evidence coverage.
