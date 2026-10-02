# Decisions

Use these meanings in stage profiles, human answers, and structured responses. Human answers can use ordinary language; the enum names are for machine output.

## Target And Action

`recommendation.target` identifies the decision: `test` gathers evidence through a bounded experiment; `build` implements or expands a product; `apply` sends an application to a named program; `artifact` finishes a report, scorecard, pitch, or draft.

`recommendation.decision` describes the next action:

- `proceed`: justified at this scope; not a prediction of eventual success.
- `revise`: change the customer, scope, approach, product, or program.
- `pause`: wait for a named dependency or missing information; specify how to unblock it.
- `stop`: evidence supports ending this approach; explain what could change that decision.
- `complete`: the requested artifact is finished. Only valid for `artifact`.

An artifact uses `complete`, `revise`, `pause`, or `stop`, never `proceed`. A completed draft can document an ineligible application. Completion does not authorize sending it.

Keep the deadline separate from the decision. Set success, inconclusive, and stop conditions before interpreting a test; choose its duration from the natural usage cycle, access, and budget. A cheap test can be justified while a build or application is premature. Recruiting participants can be the next useful test when the problem is still uncertain.

## Blocking Checks

Record each mandatory condition as `{id, target, requirement, status, evidence_ids}`. The target is `test`, `build`, or `apply`; status is `passed`, `failed`, or `unknown`.

- A failed or unknown condition blocks `proceed` for that target, not unrelated research or drafting.
- A first bounded test may proceed with no mandatory conditions when none applies. Keep actual prerequisites separate from the unknown customer behavior the test will measure; do not create a demand gate merely to fill the schema. The quality helper uses the same rule.
- `build` + `proceed` requires at least one relevant passed build prerequisite backed by current supporting observed evidence. Checks for a separate test do not establish build readiness.
- `apply` + `proceed` requires passed checks with IDs `program_eligibility` and `required_materials`, backed by evidence. Eligibility includes the current submission window and the actual program's mandatory rules.
- Traction, a cofounder, or market size is a gate only when the named program requires it.
- Unknown differs from failed. Founder confidence and a methodology article cannot establish that a mandatory condition passed.
- Passed conditions require current primary or inspected artifact evidence supporting the check. Failed conditions also require observed grounds for incompatibility; an unchecked condition stays unknown. Historical or secondary sources alone cannot establish a current mandatory condition. The validator checks labels and references; the reviewer must inspect relevance, freshness, and whether the evidence actually establishes the condition.
- Lead an application verdict with failed or unknown mandatory checks. A numerical quality label must not be presented as overall readiness when a check blocks the action.

A recommendation is not permission. Honor existing scoped authorization and the boundaries in [safety.md](safety.md).

## Structured Validation

Substantial prose assessments also use [quality.md](quality.md): freeze the evidence, check the draft, review source support and bound repairs. The full response schema below is only for structured output; it is not a substitute for source-grounded review.

Use [response.schema.json](response.schema.json). Resolve `scripts/validate-response.js` from the loaded skill directory and pass the absolute response JSON path. The portable checker uses the co-installed registries and checks structure and semantic consistency. In the repository, `proofpilot validate-response <file>` also uses Ajv. Never invent facts to satisfy validation.
