# Runtime Model

ProofPilot is a self-contained agent skill. The host agent performs reasoning and public research; a future hosted implementation can add persistence and live connectors without changing the core contracts.

## Layers

1. `intake`: goals, constraints, assets, and sensitivity
2. `router`: mode, ordered stages, domains, venture type, and program context
3. `source_planner`: smallest useful set of public or connected sources
4. `evidence_normalizer`: facts, claims, conflicts, confidence, and retrieval metadata
5. `stage_pipeline`: discover, validate, plan, review, and submit workflows
6. `rubric_engine`: anchored score, evidence coverage, and provisional state
7. `artifact_writer`: human response or structured response schema
8. `permission_gate`: explicit boundary for writes, payment, wallets, deployment, and final submission

## Portable Skill

All files required by the agent live under `skills/proofpilot`:

- `SKILL.md` contains core routing and decision rules
- `references/*.md` contain stage workflows and safety rules
- `references/*.json` contain machine-readable taxonomy, sources, tools, credentials, rubrics, and output schema
- `agents/openai.yaml` exposes installable skill metadata

The root CLI can copy this folder into Codex, Claude, or a generic agent skill directory.

## Connector Boundary

The registry describes capabilities, not promises that integrations are live. Each capability declares its status, permission class, and credential class. A public research capability and a wallet or deployment capability are represented separately even when they belong to the same tool.

Live adapters should normalize responses before model use, store evidence links and timestamps, redact secrets, honor rate limits, and record explicit permission grants. Long external checks belong in a background worker in hosted deployments.

## Superteam Integration

Use `coach` mode in the participant workspace and `evaluator` mode in the judging pipeline. Keep their evidence stores and access policies separate. Evaluations should persist the rubric version, project artifact hash or version, evidence cutoff, dimension findings, coverage, and reviewer overrides for reproducibility.
