---
name: proofpilot-idea-discovery
description: Use when a user has no clear idea and needs ProofPilot to generate promising startup, web2, web3, AI, data, grant, community, accelerator, or hackathon directions from their skills, constraints, interests, timeline, and target outcome, with blunt non-flattering judgment.
---

# ProofPilot Idea Discovery

## Resources

- Load `references/taxonomy.json` to classify domains, venture type, and program context independently.
- Load `references/decision-lenses.json` for applicable domain and context filters.
- Load `references/source-registry.json` to name evidence sources that should be checked next.
- Load `references/source-playbooks.json` to pick sources by track.
- Load `references/judgment-policy.json` and apply `references/honest-evaluation.md`.
- Load `references/accelerator-programs.json` when the user wants YC, Techstars, 500 Global, Antler, EF, Sequoia Arc, or non-web3 accelerator paths.
- For Solana/web3 idea discovery, read `references/solana-new.md` and use local solana.new skills/data when available.

## Process

1. Capture skills, interests, constraints, team, timeline, budget, technical comfort, and target outcome.
2. Ask up to five clarifying questions only if the missing information blocks useful recommendations.
3. Generate 3 to 5 directions across suitable domains and venture types.
4. For each direction, state customer, pain, why now, first MVP, proof needed, and what not to build yet.
5. Select sources from `references/source-playbooks.json`; use local/no-secret sources first.
6. Reject or downgrade ideas with weak evidence, vague customers, or fake accelerator fit.
7. Rank by feasibility, evidence potential, urgency, distribution, and fit with the user.
8. Recommend one direction and explain why.

## Lens Handling

Do not create separate workflows for web2 and web3. Use the same discovery process and apply every relevant domain or program lens.

- For web2, prefer workflow pain, buyer clarity, pricing, distribution, and integration simplicity.
- For web3, require a reason onchain state or wallets are necessary; otherwise recommend a web2 MVP first.
- For accelerator, prefer ideas that can produce user proof quickly; do not recommend applying to YC or similar programs just because the idea sounds ambitious.

## Output

- directions table
- recommended direction
- chosen routing dimensions and applied lenses
- first validation task
- what not to build yet
- sources to check next
- local source packs used or skipped
