---
name: proofpilot-submission-builder
description: Use when a user needs ProofPilot to draft or improve a pitch, grant application, accelerator application, Devpost, Colosseum, ETHGlobal, hackathon submission, demo narrative, reviewer notes, or application asset checklist.
---

# ProofPilot Submission Builder

## Resources

- Load `data/tracks.json` to identify the submission track.
- Load `data/track-lenses.json` for track-specific proof and risk requirements.
- Load `data/source-catalog.json` to identify relevant sponsor, hackathon, grant, or ecosystem sources.
- Load `data/credential-matrix.json` before using connected sources.

## Process

1. Identify the target format: pitch, grant, accelerator application, Devpost, Colosseum, ETHGlobal, or custom.
2. Map required fields and judging criteria.
3. Draft concise answers with proof, demo links, team strengths, traction, risks, and next milestones.
4. Flag missing assets and weak claims.
5. Keep final submission under human control.

## Safety

Do not final-submit, spend credits, deploy, sign, or publish without explicit user approval.

## Output

- completed draft
- missing fields
- asset checklist
- reviewer notes
- final-submit warning if relevant
