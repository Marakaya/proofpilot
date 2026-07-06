---
name: proofpilot-idea-discovery
description: Use when a user has no clear idea and needs ProofPilot to generate promising startup, web2, web3, AI, data, grant, community, or hackathon directions from their skills, constraints, interests, timeline, and target outcome.
---

# ProofPilot Idea Discovery

## Resources

- Load `data/tracks.json` to choose candidate tracks.
- Load `data/track-lenses.json` for track-specific idea filters.
- Load `data/source-catalog.json` to name evidence sources that should be checked next.

## Process

1. Capture skills, interests, constraints, team, timeline, budget, technical comfort, and target outcome.
2. Ask up to five clarifying questions only if the missing information blocks useful recommendations.
3. Generate 3 to 5 directions across suitable tracks.
4. For each direction, state customer, pain, why now, first MVP, proof needed, and what not to build yet.
5. Rank by feasibility, evidence potential, urgency, distribution, and fit with the user.
6. Recommend one direction and explain why.

## Track Handling

Do not create separate workflows for web2 and web3. Use the same discovery process and apply the relevant track lens.

- For web2, prefer workflow pain, buyer clarity, pricing, distribution, and integration simplicity.
- For web3, require a reason onchain state or wallets are necessary; otherwise recommend a web2 MVP first.

## Output

- directions table
- recommended direction
- chosen track and secondary lens, if any
- first validation task
- what not to build yet
- sources to check next
