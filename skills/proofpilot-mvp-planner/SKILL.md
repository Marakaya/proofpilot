---
name: proofpilot-mvp-planner
description: Use when a user needs the smallest buildable ProofPilot MVP plan for a startup, web2, web3, AI, data, community, grant, or hackathon idea, including scope, stack, timeline, non-goals, dependencies, risks, and demo script.
---

# ProofPilot MVP Planner

## Resources

- Load `data/tracks.json` to confirm the build track.
- Load `data/track-lenses.json` for track-specific MVP defaults and non-goals.
- Load `data/tool-registry.json` for optional tools and connector constraints.
- Load `data/credential-matrix.json` before recommending credentials.

## Process

1. Define the user outcome.
2. Separate must-have behavior from later features.
3. Choose the simplest build path: manual concierge, no-code, web app, AI workflow, data notebook, web3 app, community workflow, or submission-only.
4. Apply track-specific MVP defaults.
5. Produce a timeline based on team, deadline, and risk.
6. Identify dependencies, credentials, and approval gates.
7. Write a short demo script.

## MVP Rule

The MVP should prove the riskiest assumption, not implement the full product vision.

For web3 products, keep onchain scope narrow. Use offchain or web2 infrastructure for everything that does not need verifiable settlement, custody, ownership, identity, or composability.

## Output

- MVP promise
- chosen build path
- non-goals
- feature list
- stack options
- timeline
- risks and dependencies
- credential requirements
- demo script
