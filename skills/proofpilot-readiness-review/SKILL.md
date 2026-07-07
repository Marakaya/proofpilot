---
name: proofpilot-readiness-review
description: Use when a ProofPilot idea, MVP, repo, pitch, grant, accelerator application, YC application, Techstars application, web2 product, web3 product, AI project, data project, or hackathon submission needs a structured readiness scorecard with blunt blockers and fixes.
---

# ProofPilot Readiness Review

## Resources

- Load `data/rubrics.json` for the core readiness rubric.
- Load `data/track-lenses.json` for track-specific checks.
- Load `data/source-playbooks.json` for required source checks by track and stage.
- Load `data/judgment-policy.json` and apply `references/honest-evaluation.md`.
- Load `data/accelerator-rubrics.json` and `data/accelerator-programs.json` for accelerator applications.
- Load `data/presentation-rubrics.json`, `data/presentation-decks.json`, and `references/presentations.md` for deck reviews.
- Load `data/source-catalog.json` to identify missing evidence sources.
- For Solana/web3 reviews, read `references/solana-new.md` and check local solana.new/security guidance.

## Process

1. Identify the artifact under review: idea, MVP, repo, pitch, grant, application, or submission.
2. Confirm the primary track and apply its lens.
3. Select required source checks from `data/source-playbooks.json`.
4. Score each rubric dimension red, yellow, or green.
5. Ground findings in evidence from the user's artifacts and connected sources.
6. Separate critical blockers from quick wins.
7. Produce fixes that can be completed before the deadline.

## Review Standard

Lead with concrete weaknesses. Do not soften missing evidence, unclear customer pain, unsafe web3 assumptions, or over-scoped MVPs.

This skill must not flatter. If the readiness verdict is red, say that first. If the user should not apply, submit, or build yet, say so directly.

For web3 reviews, include security, wallet UX, onchain necessity, and permission-gated action risks.

For web2 reviews, include buyer clarity, workflow fit, distribution, pricing, and implementation complexity.

For accelerator reviews, include founder edge, one-sentence clarity, people-want-it evidence, execution speed, market scale, program fit, and interview readiness.

For presentation reviews, include audience fit, hook, demo/product proof, evidence, ask, visual clarity, and objection readiness.

## Output

- readiness scorecard
- primary track and applied lens
- blunt verdict
- critical blockers
- quick wins
- missing evidence
- sources checked and missing source checks
- revised next actions
