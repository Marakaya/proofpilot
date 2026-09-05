# Review

Use this workflow for readiness feedback or formal evaluation.

For hackathon/workshop submissions, event rubric/intake design or participant self-review, first follow [event-assessment.md](event-assessment.md). Its profiles, scorecard and checker replace the generic rubric/score arithmetic/response-schema instructions below for that event task. Event totals retain the full 100-point denominator and remain null while criteria are unresolved. Continue the shared evidence, safety and quality-review requirements. Ordinary venture/readiness reviews retain the workflow below.

## Coach Mode

1. Identify the artifact and decision it must support.
2. Select the closest rubric from [rubrics.json](rubrics.json).
3. Score only dimensions that apply and explain `not_applicable` values.
4. Prioritize blockers and improvements by decision impact and effort.
5. Re-score only after the user provides revised evidence or artifacts.

Separate mandatory conditions from package quality using [decisions.md](decisions.md). Lead with failed or unknown conditions that block the proposed action. Evaluate PMF through stage-appropriate behavior and economics, not a pitch score.

## Evaluator Mode

1. Freeze the rubric ID, version, evidence cutoff, and allowed sources before scoring.
2. Evaluate the submitted artifact without rewriting it.
3. Cite artifact locations or external evidence for every scored dimension.
4. Record missing evidence separately from contrary evidence.
5. Calculate the weighted score and evidence coverage.
6. Flag conflicts of interest, policy exceptions, and low-confidence dimensions.
7. Produce an audit-friendly result that another reviewer can reproduce.

For structured evaluator output, include `run.evaluation_snapshot` with an RFC3339 `evidence_cutoff`, `allowed_source_ids`, and `artifacts` containing `id`, `location`, and `version`. Use a real hash or an explicit supplied input/fixture version, never an invented hash. Include every rubric dimension once, including explained non-applicable and unknown dimensions. Zero means observed failure; missing evidence is not zero. Raw user claims and methodology-only sources cannot justify a project score.

Calculate weighted score over scored weights; calculate coverage as scored weight divided by applicable weight. Exclude non-applicable weights; retain unknown applicable weights in coverage. Return a null score if nothing is scored. Unknown applicable dimensions make the result provisional. Complete [quality.md](quality.md) before delivering a substantial verdict; also run the response validator for structured output. Calibrate reviewers on shared artifacts and control order effects before publishing comparative rankings.

## Required Output

- rubric ID and version
- artifact and evidence snapshot
- dimension scores from 0 to 4, `insufficient_evidence`, or `not_applicable`
- evidence and confidence per dimension
- weighted score and evidence coverage
- blockers, quick wins, and unresolved unknowns
- evaluator notes or coaching actions, depending on mode

Map scores to red, yellow, and green only for numerical quality display. Preserve the underlying anchored score and evidence coverage. A high quality label does not mean an application is eligible or ready when mandatory checks block it.
