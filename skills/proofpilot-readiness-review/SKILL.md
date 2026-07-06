---
name: proofpilot-readiness-review
description: Use when a ProofPilot idea, MVP, repo, pitch, grant, accelerator application, web2 product, web3 product, AI project, data project, or hackathon submission needs a structured readiness scorecard with blockers and fixes.
---

# ProofPilot Readiness Review

## Resources

- Load `data/rubrics.json` for the core readiness rubric.
- Load `data/track-lenses.json` for track-specific checks.
- Load `data/source-catalog.json` to identify missing evidence sources.

## Process

1. Identify the artifact under review: idea, MVP, repo, pitch, grant, application, or submission.
2. Confirm the primary track and apply its lens.
3. Score each rubric dimension red, yellow, or green.
4. Ground findings in evidence from the user's artifacts and connected sources.
5. Separate critical blockers from quick wins.
6. Produce fixes that can be completed before the deadline.

## Review Standard

Lead with concrete weaknesses. Do not soften missing evidence, unclear customer pain, unsafe web3 assumptions, or over-scoped MVPs.

For web3 reviews, include security, wallet UX, onchain necessity, and permission-gated action risks.

For web2 reviews, include buyer clarity, workflow fit, distribution, pricing, and implementation complexity.

## Output

- readiness scorecard
- primary track and applied lens
- critical blockers
- quick wins
- missing evidence
- revised next actions
