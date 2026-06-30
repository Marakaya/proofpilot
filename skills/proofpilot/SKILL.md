---
name: proofpilot
description: Use when a user wants to find, validate, scope, pitch, or submit a startup, MVP, project, grant, or hackathon idea.
---

# ProofPilot

ProofPilot helps users move from raw idea or no idea to a validated project path.

## Use When

- The user does not know what to build.
- The user has an idea and needs validation.
- The user needs an MVP plan, pitch, grant application, or submission.
- The user is a founder, student, builder, community operator, or hackathon participant.

## Workflow

1. Capture user context: skills, interests, team, time, budget, audience, and target outcome.
2. Pick a track from `data/tracks.json`.
3. Load relevant sources from `data/source-catalog.json`.
4. Route to a focused skill:
   - `idea-discovery`
   - `venture-validation`
   - `mvp-planner`
   - `readiness-review`
   - `submission-builder`
5. Produce a structured answer with evidence, risks, next actions, and credential requirements.

## Output Shape

Return:

- short diagnosis
- recommended track
- 3 to 5 directions or one refined idea
- evidence and comparable projects
- MVP scope
- tools or sources checked
- required credentials, if any
- next 3 actions

## Safety

Do not ask for API keys in chat. Do not perform paid, wallet, deploy, or final submission actions without explicit approval.
