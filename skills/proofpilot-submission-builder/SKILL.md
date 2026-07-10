---
name: proofpilot-submission-builder
description: Use when a user needs ProofPilot to draft or improve a pitch, grant application, YC application, Techstars application, 500 Global application, Antler application, EF application, accelerator application, Devpost, Colosseum, ETHGlobal, hackathon submission, demo narrative, reviewer notes, or application asset checklist with blunt feedback.
---

# ProofPilot Submission Builder

## Resources

- Load `references/taxonomy.json` to identify domains, venture type, and program context.
- Load `references/decision-lenses.json` for relevant proof and risk requirements.
- Load `references/source-playbooks.json` for sponsor, hackathon, grant, and ecosystem source order.
- Load `references/judgment-policy.json` and apply `references/honest-evaluation.md`.
- Load `references/accelerator-programs.json`, `references/accelerator-checklist.json`, and `references/accelerators.md` for accelerator applications.
- Load `references/presentation-decks.json`, `references/presentation-checklist.json`, and `references/presentations.md` for pitch decks, hackathon decks, investor decks, angel decks, and Google Slides/PPTX deliverables.
- Load `references/source-registry.json` to identify relevant sponsor, hackathon, grant, or ecosystem sources.
- Load `references/credential-registry.json` before using connected sources.
- For Solana hackathon or grant submissions, read `references/solana-new.md` and use solana.new submission/build context before drafting.

## Process

1. Identify the target format: pitch deck, angel deck, investor deck, hackathon deck, grant, accelerator application, Devpost, Colosseum, ETHGlobal, Google Slides, PPTX, or custom.
2. Map required fields and judging criteria.
3. Check required source playbooks for precedent, sponsor, ecosystem, or grant proof.
4. If the application is not ready, say so before drafting and provide a proof sprint or rewrite plan.
5. Draft concise answers with proof, demo links, team strengths, traction, risks, and next milestones.
6. Flag missing assets and weak claims.
7. Keep final submission under human control.

## Safety

Do not final-submit, spend credits, deploy, sign, or publish without explicit user approval.

## Output

- completed draft
- blunt readiness verdict
- missing fields
- asset checklist
- reviewer notes
- sources checked and proof gaps
- final-submit warning if relevant
