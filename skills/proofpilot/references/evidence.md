# Evidence

Use evidence to support a decision, not decorate an answer.

## Source And Claim

Prefer inspected user artifacts and observed behavior, then current primary sources, historical primary sources, reputable secondary analysis, and clearly labelled inference. A user's statement is a `user_claim` until a relevant artifact or observation is inspected; it is not automatically `user_verified`.

Use [source-registry.json](source-registry.json). The user-artifact source ID is `user_artifacts`. Use `current_primary` for a relevant official source not otherwise listed, recording the actual direct URL and what was inspected. Registry membership does not establish the truth of a claim or that a connector is installed.

For each material claim record the fields in [response.schema.json](response.schema.json): claim, source ID, direct external URL, retrieval timestamp, evidence type, stance, confidence, and summary. Formal evaluation also pins artifact references to the frozen snapshot. Use real retrieval times; never invent them or turn a supplied statement into observed evidence.

Methodology, ecosystem context, program requirements, and project evidence have different roles. Sequoia's framework can shape a question; it cannot prove this project's demand. Several articles repeating one original report are not independent confirmation. Explain how each source supports the specific conclusion.

## Evidence Floors

- Current market and competitor claims need current primary evidence; lack of search results proves neither absence nor opportunity.
- Eligibility, deadlines, bounties, and submission claims need the current official program and relevant cohort or event rules.
- Technical recommendations need official documentation for the actual stack and version.
- A next experiment must have a feasible way to obtain participants or artifacts. Recruiting participants may itself be the test when problem evidence is still missing.
- Every scored evaluator dimension, including zero, needs relevant observed evidence. Missing evidence uses `insufficient_evidence`, not zero. Raw user claims and methodology-only evidence cannot establish a score or passed mandatory check.

A source's `last_verified_at` records the stated verification scope, not perpetual freshness. Check current terms, deadlines, prices, APIs, and stack recommendations at use time. Preserve publication date separately from retrieval date; historical methods can remain useful without being recent. API availability is unverified unless actually tested.

Use [freshness.md](freshness.md) to interpret review dates, content status, access limits, and individual runtime probes. Discovery of a local source pack does not refresh the facts inside it.

## Conflicts, Snapshots, And Gaps

Include contradictory evidence and explain material conflicts rather than averaging them away. Distinguish checked, not checked, unavailable, and no evidence found; never claim access that failed. State the missing check and make affected conclusions provisional.

Resolve version conflicts **one requirement or field at a time** before assigning gates:

- Compare the source's authority, applicable cohort, effective/publication date and the exact scope of the newer statement. Retrieval date alone does not make an older rule current.
- A newer applicable official statement that explicitly changes a requirement supersedes the older statement for that requirement. The older document being longer or complete is not a reason to keep an explicitly replaced restriction as a failed gate.
- A partial update changes only the fields it actually addresses. Its silence on another requirement does not cancel that requirement. For example, an official update changing the accepted locations does not by itself remove an unchanged staffing rule.
- If authority, applicability or effective date cannot be resolved, mark the affected requirement unknown and name the needed check. Do not silently turn this uncertainty into a confirmed failure or preserve all old restrictions indiscriminately.

Evaluator runs use the cutoff, allowed sources, and versioned artifacts in [review.md](review.md). Do not add later evidence silently or use private coaching context unavailable to other participants. Validate the structured response using [decisions.md](decisions.md); consistency checks cannot verify that a claim is true.
