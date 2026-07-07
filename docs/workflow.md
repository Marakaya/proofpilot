# Workflow

ProofPilot uses a staged workflow instead of a single giant prompt.

Stages are implemented as focused subskills. Markets are not separate subskills: `web2`, `web3`, `ai_app`, `data_ml`, `hackathon`, `grant`, and `community` are tracks selected from `data/tracks.json` and applied through `data/track-lenses.json`.

Sources are selected through `data/source-playbooks.json`. For Solana/web3 work, use `references/solana-new.md` and the local solana.new source pack before generic research.

Judgment is governed by `data/judgment-policy.json` and `references/honest-evaluation.md`. The agent must prefer a hard, useful truth over a supportive but misleading answer.

Accelerator work uses `data/accelerator-programs.json`, `data/accelerator-rubrics.json`, and `references/accelerators.md`.

Presentation work uses `data/presentation-decks.json`, `data/presentation-rubrics.json`, and `references/presentations.md`.

## 1. Intake

Capture the minimum context:

- what the user wants
- skills and constraints
- team size
- time horizon
- budget
- market or audience interest
- technical comfort level
- target outcome: startup, MVP, pitch, grant, hackathon submission, or learning project

If the user does not know what to build, ask only a few useful questions and continue with assumptions.

## 2. Direction Search

Generate candidate directions from:

- user skills and constraints
- source catalog
- comparable projects
- ecosystem opportunities
- startup frameworks
- local/community context when available

## 3. Evidence Pass

For each direction, check:

- similar projects
- who the customer is
- painfulness and urgency
- current alternatives
- distribution channel
- build feasibility
- regulatory, privacy, cost, or security risks

Use `references/source-orchestration.md` to choose sources and record which sources were checked or skipped.

## 4. Recommendation

Return a short ranked set of options, then recommend one.

The recommendation must include:

- why this idea is worth testing
- what proof is missing
- what not to build yet
- first MVP scope
- next validation task

If the honest verdict is `wait`, `pivot`, or `stop`, lead with that verdict before suggestions.

## 5. Build Path

Pick a practical path:

- no-code
- web app
- AI app
- data/ML notebook
- web3 app
- community workflow
- submission/pitch only

## 6. Readiness Review

Run the rubric in `data/rubrics.json` and produce red/yellow/green findings with concrete next actions.

For YC, Techstars, 500 Global, Antler, Entrepreneur First, Sequoia Arc, or other accelerator work, also run `data/accelerator-rubrics.json` and produce an explicit `apply_now`, `apply_after_7_day_sprint`, `wait`, or `pivot` verdict.

For hackathon, investor, angel, accelerator, grant, or partner decks, also run `data/presentation-rubrics.json` and choose the correct deck type before drafting.
