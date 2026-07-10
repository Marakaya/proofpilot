# Workflow

ProofPilot uses an ordered stage pipeline with independent classification dimensions.

## 1. Intake And Safety

Capture only context that can change the recommendation: user access, skills, team, time, budget, outcome, constraints, and existing proof. Ask at most three high-impact questions; otherwise state assumptions and continue.

Classify sensitivity before external research. Confidential or restricted artifacts are not sent to external connectors without explicit approval and appropriate processing controls.

## 2. Routing

Build the run context:

```text
mode
stages[]
domains[]
venture_type
program_context
sensitivity
```

Stages are ordered and composable:

```text
discover -> validate -> plan -> review -> submit
```

Domains and program context do not replace stages. A project can be `ai + web3`, a `startup`, and in a `grant` context while running `validate + plan + submit`.

## 3. Source Plan

Choose only sources that can affect the current decision. Start with user artifacts and public primary sources. Add a connector only when it unlocks a named task.

Use focused source playbooks for Solana, accelerator, presentation, or multi-ecosystem research. Treat local installed skill packs as optional sources and refresh current rules, terms, protocol health, and technical recommendations from official sources before final advice.

For every material claim, record the source, direct URL, retrieval date, evidence type, stance, and confidence. Keep checked, unavailable, not-checked, and no-evidence-found states separate.

## 4. Stage Execution

- `discover`: generate materially different directions from founder access and observed jobs
- `validate`: test the riskiest assumptions with behavioral evidence
- `plan`: select the thinnest delivery model and measurable MVP
- `review`: apply an anchored rubric with evidence coverage
- `submit`: map verified program requirements to a human-controlled draft

When several stages apply, preserve their dependency order. Do not prepare a confident build plan before exposing unresolved validation assumptions.

## 5. Recommendation

Return the next defensible decision, not a promise that the venture will work. Include:

- supporting and contradictory evidence
- unresolved assumptions
- confidence and evidence coverage
- the smallest next experiment
- success threshold
- kill or pivot condition
- sources checked and not checked
- credentials needed, if any
- one to five ordered next actions

## 6. Evaluation

Formal evaluation uses `evaluator` mode. Freeze the rubric version, evidence cutoff, and allowed sources before scoring. Keep private coaching context outside the evaluation unless the published policy allows it equally for every participant.
