# Workflow

ProofPilot uses a staged workflow instead of a single giant prompt.

Stages are implemented as focused subskills. Markets are not separate subskills: `web2`, `web3`, `ai_app`, `data_ml`, `hackathon`, `grant`, and `community` are tracks selected from `data/tracks.json` and applied through `data/track-lenses.json`.

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

## 4. Recommendation

Return a short ranked set of options, then recommend one.

The recommendation must include:

- why this idea is worth testing
- what proof is missing
- what not to build yet
- first MVP scope
- next validation task

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
