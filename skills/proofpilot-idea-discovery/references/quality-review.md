# Source-Grounded Review

Review the actual task, source text, frozen facts, draft and mechanical results. Do not reward length, harshness, a famous framework, or the writer's confidence. A well-supported positive decision and an accurate negative decision meet the same standard. Do not manufacture criticism to justify a loop.

Application judgments, all evaluator tasks and explicitly flagged source conflicts require a separate review context. Self-review can find defects but cannot complete that required review. Report the actual mode; no model label, score or role-play can substitute for the missing review. If evidence remains contradictory, preserve the exact competing statements and limit the conclusion to the independently supported conditions.

Check the required packet `decision_context` against the original task. An application judgment, application claim or completed application report declares `application`, including `artifact/complete` with no apply gates; the helper then requires independent review automatically. `general` must match a general task. Missing context is invalid for new policy-v4 runs, and natural-language task classification remains a writer/reviewer responsibility. A false optional review flag cannot disable application review. Policy-v1/v2/v3 archives preserve their recorded history read-only and cannot supply a current acceptance.

Fill all eight checks in the generated review template with `pass`, `fail`, `not_applicable`, or `unassessed`, and a concrete note. `not_applicable` needs a task-specific reason; missing evidence or missing reviewer access is not a pass. Verify coverage against the original task and source text, not just the author's selected claims.

| ID | Inspect |
|---|---|
| `fact_fidelity` | Who said what, which population/time period, and what is actually unknown. No unknown-to-absent conversion; no invented attribution. |
| `arithmetic` | Source inputs, units, denominator, all applicable costs/interventions, and reproducible results. Use actual code output for numbers and word counts. |
| `evidence_support` | Does the quoted passage support this particular claim? Inspect contrary passages, qualifiers and source scope. Distinguish observed facts, reported claims and deductions. |
| `constraints` | Every material condition in the task/rules is represented and respected. Compare conflicting versions per field: apply explicit applicable updates, retain unrelated rules, and do not count a superseded restriction as a failure. A high score cannot waive an eligibility or resource constraint. |
| `verdict` | The action and confidence match the stage, goal and evidence. Interest is not payment or repeat demand. Strong small-business evidence does not require venture scale. |
| `next_step` | The smallest useful next action has an observable result; experiments distinguish success, failure and uncertainty where applicable. Do not demand another experiment when the task/evidence already justifies the requested action. |
| `task_scope` | Requested language, format, length and scope. No unnecessary business audit for a copyedit; no omitted deliverable. |
| `action_bounds` | No invented source access, model runs, payments, messages, submissions or deployment. Honor the actual authorized scope. |

For each defect record a stable `id`, criterion, severity, exact draft `quote`, source-based `basis`, and concrete `repair`. Explain its effect on the decision in `basis`. `critical`/`material` errors can change an action, materially misrepresent evidence, or violate a required constraint. `minor` errors do not change the decision. Style preferences are not material defects.

For an omission, quote the sentence containing the affected decision and name the missing source condition in `basis`. For an unsupported causal or exclusive claim, try a counterexample compatible with all supplied facts; do not infer the author's unstated calculation or motive.

Do not mark a check failed without an issue. Conversely, a material issue must not disappear behind all-pass labels. Leave disputed or unassessed content explicit. A source gap can be accurately communicated in a passing answer; a false claim that it was checked cannot.

On a repaired draft, retain prior IDs. Provide `resolutions: [{"id":"...","status":"fixed","basis":"exact changed wording and supporting source"}]`, or `disputed` with evidence. Reusing a prior material issue ID signals that the material problem recurred and stops the run; do not relabel it minor to get a pass. After verifying that the material problem is fixed, a genuinely different residual minor defect gets its own ID and explanation. A failed criterion still requests repair even if its listed issue is minor; record a harmless residual as a passing check with the minor issue visible.

Recheck the changed claims and decision for regressions. Do not accept a repair merely because the author says it is fixed. Bind the review to `packet_sha256`, `policy_version`, `draft_sha256` and `assessment_sha256` from the generated template. The first review uses `resolutions: []`. Changing an assessment to `artifact/complete` cannot remove an earlier requirement for independent review, including review of previous issue resolutions.
