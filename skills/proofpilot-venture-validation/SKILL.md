---
name: proofpilot-venture-validation
description: Use when a user has a startup, product, web2, web3, AI, data, grant, community, or hackathon idea and needs market, customer, competitor, evidence, risk, feasibility, or go/pivot/pause validation.
---

# ProofPilot Venture Validation

## Resources

- Load `data/tracks.json` to confirm the primary track.
- Load `data/track-lenses.json` and apply the matching validation checks.
- Load `data/source-catalog.json` to select public and connected evidence sources.
- Load `data/credential-matrix.json` before requesting or using any connector.

## Process

1. Restate the idea in one concrete sentence.
2. Identify the customer and painful job-to-be-done.
3. Confirm the primary track and apply its validation lens.
4. Map direct competitors, substitutes, and adjacent projects.
5. Score evidence quality and name missing evidence.
6. Identify the riskiest assumptions.
7. Design the smallest validation test.
8. Recommend go, pivot, or pause.

## Track Handling

- Web2 validation checks buyer, workflow urgency, current workaround, willingness to pay, distribution, integrations, privacy, and operations.
- Web3 validation checks why onchain is necessary, wallet friction, security risk, token/incentive design, ecosystem fit, composability, regulatory exposure, and deploy/audit readiness.
- AI validation checks model capability, evals, cost per task, latency, data access, failure handling, and provider dependence.

If the idea is web3 but the onchain reason is weak, recommend a web2 MVP with optional onchain proof later.

## Output

- idea summary
- primary track and applied lens
- customer hypothesis
- alternatives and competitors
- evidence map
- risk list
- validation plan
- go, pivot, or pause recommendation
