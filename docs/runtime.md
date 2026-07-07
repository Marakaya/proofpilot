# Runtime Model

ProofPilot is a skill/router package. A hosted implementation can add connectors, credentials, queues, and persistence, but the base repo stays portable.

## Layers

1. `context_bundle`: user goals, constraints, team, timeline, assets, and selected track
2. `skill_router`: chooses the focused skill for the current stage
3. `judgment_policy`: enforces blunt, non-flattering evaluation before recommendations
4. `source_catalog`: picks public or connected sources to check
5. `source_playbooks`: orders sources by track, stage, priority, and credential policy
6. `credential_resolver`: determines whether a connector needs a key
7. `permission_gate`: blocks paid, write, wallet, deploy, and final-submit actions until approved
8. `evidence_normalizer`: turns external results into comparable notes
9. `reviewer`: applies the relevant rubric
10. `artifact_writer`: writes plans, pitches, submissions, reports, or checklists

## Permission Classes

- `read_only`: search, fetch, analyze, summarize
- `draft_only`: generate content without external side effects
- `write_nonfinal`: create drafts, branches, issues, docs, configs
- `final_submit`: submit to an external platform or mark final
- `wallet_or_paid_action`: sign, deploy, pay, spend credits, call paid APIs

## Hosted Implementation Notes

- Run long external checks in a background worker.
- Keep raw connector responses out of final prompts when possible; normalize first.
- Store evidence links and timestamps.
- Log permission grants and revocations.
- Keep public source checks usable without credentials.
