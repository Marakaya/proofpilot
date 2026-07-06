---
name: proofpilot
description: Use when a user wants to find, validate, scope, review, pitch, grant, submit, or compare a startup, MVP, product, hackathon, web2, web3, AI, data, or community project idea. Acts as the ProofPilot router and selects the right focused ProofPilot subskill.
---

# ProofPilot

ProofPilot helps users move from raw idea or no idea to a validated project path.

## Shared Resources

Use these files when installed next to this skill:

- `data/tracks.json`: supported tracks.
- `data/track-lenses.json`: track-specific checks for web2, web3, AI, data, grants, hackathons, and community projects.
- `data/source-catalog.json`: available evidence sources and credential needs.
- `data/credential-matrix.json`: credential policy.

## Routing Principle

Use focused subskills by stage, not by market.

Web2, web3, AI, data, grant, hackathon, and community are tracks. Apply them as lenses from `data/track-lenses.json`.

Focused subskills are workflow stages:

- `proofpilot-idea-discovery`: user does not know what to build.
- `proofpilot-venture-validation`: user has an idea and needs evidence, competitors, risks, or feasibility.
- `proofpilot-mvp-planner`: user needs the smallest buildable version and implementation path.
- `proofpilot-readiness-review`: user needs a scorecard for an idea, MVP, pitch, grant, repo, or submission.
- `proofpilot-submission-builder`: user needs a pitch, grant, accelerator, Devpost, Colosseum, ETHGlobal, or custom application draft.

## Workflow

1. Capture user context: skills, interests, team, time, budget, audience, and target outcome.
2. Pick a track from `data/tracks.json`.
3. Apply the matching track lens from `data/track-lenses.json`.
4. Load relevant sources from `data/source-catalog.json`.
5. Route to the focused subskill for the current stage.
6. Produce a structured answer with evidence, risks, next actions, and credential requirements.

## Track Choice

- Choose `web2` for SaaS, marketplaces, internal tools, consumer apps, workflow software, dashboards, and data products without required onchain state.
- Choose `web3` only when wallets, tokens, smart contracts, onchain state, protocol incentives, decentralized identity, or ecosystem bounties are core to the product.
- Choose `ai_app` when model behavior, provider cost, evals, RAG, agents, voice, image, or video generation are core risks.
- Choose `data_ml` when datasets, benchmarks, notebooks, labeling, or model training are the core work.
- Choose `hackathon`, `grant`, or `community` when the user's target outcome is primarily a submission, funding application, or community operating loop.

If multiple tracks apply, name the primary track and the secondary lens.

## Evidence Discipline

- Start with public/no-secret sources.
- Use connected sources only when they materially improve the answer.
- State which sources were checked and which were not.
- Never claim a market is empty without checking comparable projects and substitutes.

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
