# Evidence

Use evidence to support decisions, not to decorate an answer.

## Source Priority

Prefer sources in this order when available:

1. user-provided artifacts and observed behavior
2. current primary sources: official documentation, program rules, repositories, product pages, filings, datasets, or direct customer evidence
3. historical primary sources
4. reputable secondary analysis
5. inference, clearly labelled

Use [source-registry.json](source-registry.json) to select sources. Use [tool-registry.json](tool-registry.json) only when the selected tool is available and appropriate for the run.

## Evidence Item

For each material external claim, record:

- `claim`: the decision-relevant statement
- `source_id`: registry source or `user_artifact`
- `source_url`: direct URL when external
- `retrieved_at`: ISO date or timestamp
- `evidence_type`: `user_verified`, `primary_current`, `primary_historical`, `secondary`, or `inference`
- `stance`: `supports`, `contradicts`, or `neutral`
- `confidence`: `low`, `medium`, or `high`
- `summary`: concise explanation of what the source establishes

## Evidence Floors

- Market or competitor claims require at least one current primary source.
- Program eligibility, deadline, bounty, or submission claims require the current official program source.
- Technical recommendations require current official documentation for the relevant framework, chain, API, or provider.
- A `go_to_next_test` recommendation requires evidence about both the problem and access to test users.
- Formal evaluation requires artifact evidence for every scored dimension above zero.

When a floor is not met, mark the conclusion provisional and state the missing check.

## Conflicts And Gaps

- Include evidence that contradicts the preferred direction.
- Do not average away a material conflict; explain its effect on the decision.
- Distinguish `not_checked`, `unavailable`, and `no_evidence_found`.
- Do not claim that a source was checked when the runtime could not access it.
- Do not interpret `no_evidence_found` as evidence that no competitor, demand, or risk exists.
