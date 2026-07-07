---
name: proofpilot-venture-validation
description: Use when a user has a startup, product, web2, web3, AI, data, grant, community, accelerator, or hackathon idea and needs market, customer, competitor, evidence, risk, feasibility, or go/pivot/pause validation with blunt non-flattering judgment.
---

# ProofPilot Venture Validation

## Resources

- Load `data/tracks.json` to confirm the primary track.
- Load `data/track-lenses.json` and apply the matching validation checks.
- Load `data/source-catalog.json` to select public and connected evidence sources.
- Load `data/source-playbooks.json` to choose source order by track and stage.
- Load `data/judgment-policy.json` and apply `references/honest-evaluation.md`.
- Load `data/accelerator-rubrics.json` and `data/accelerator-programs.json` for accelerator readiness or application validation.
- Load `data/credential-matrix.json` before requesting or using any connector.
- For Solana/web3 validation, read `references/solana-new.md` and use local solana.new data/skills before generic research.

## Process

1. Restate the idea in one concrete sentence.
2. Identify the customer and painful job-to-be-done.
3. Confirm the primary track and apply its validation lens.
4. Select sources from `data/source-playbooks.json` and check no-secret/local sources first.
5. Map direct competitors, substitutes, and adjacent projects.
6. Score evidence quality and name missing evidence.
7. Identify the riskiest assumptions.
8. Design the smallest validation test.
9. Recommend go, pivot, pause, wait, stop, apply_now, or apply_after_7_day_sprint.

## Track Handling

- Web2 validation checks buyer, workflow urgency, current workaround, willingness to pay, distribution, integrations, privacy, and operations.
- Web3 validation checks why onchain is necessary, wallet friction, security risk, token/incentive design, ecosystem fit, composability, regulatory exposure, and deploy/audit readiness.
- AI validation checks model capability, evals, cost per task, latency, data access, failure handling, and provider dependence.
- Accelerator validation checks founder edge, plain description, people-want-it evidence, speed, market scale, differentiated insight, program fit, and interview readiness.

If the idea is web3 but the onchain reason is weak, recommend a web2 MVP with optional onchain proof later.

If the idea is aimed at YC or another accelerator but lacks credible proof, say not ready and prescribe a focused proof sprint.

## Output

- idea summary
- primary track and applied lens
- customer hypothesis
- alternatives and competitors
- evidence map
- sources checked and skipped
- risk list
- validation plan
- go, pivot, or pause recommendation
