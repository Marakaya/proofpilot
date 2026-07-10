---
name: proofpilot-mvp-planner
description: Use when a user needs the smallest buildable ProofPilot MVP plan for a startup, web2, web3, AI, data, community, grant, accelerator, or hackathon idea, including scope, stack, timeline, non-goals, dependencies, risks, proof targets, and demo script.
---

# ProofPilot MVP Planner

## Resources

- Load `references/taxonomy.json` to confirm domains, venture type, and program context.
- Load `references/decision-lenses.json` for relevant domain and context MVP defaults.
- Load `references/source-playbooks.json` to select stack/scaffold sources.
- Load `references/judgment-policy.json` and apply `references/honest-evaluation.md`.
- Load `references/accelerator-programs.json` when the MVP is meant to strengthen a YC, Techstars, 500 Global, Antler, EF, or Sequoia Arc application.
- Load `references/tool-registry.json` for optional tools and connector constraints.
- Load `references/credential-registry.json` before recommending credentials.
- For Solana MVPs, read `references/solana-new.md` and prefer solana.new/scaffold-project guidance.

## Process

1. Define the user outcome.
2. Separate must-have behavior from later features.
3. Choose the simplest build path: manual concierge, no-code, web app, AI workflow, data notebook, web3 app, community workflow, or submission-only.
4. Apply every relevant domain and program-context lens.
5. Select scaffold/source guidance from `references/source-playbooks.json`.
6. Produce a timeline based on team, deadline, and risk.
7. Identify dependencies, credentials, and approval gates.
8. Write a short demo script.

## MVP Rule

The MVP should prove the riskiest assumption, not implement the full product vision.

For web3 products, keep onchain scope narrow. Use offchain or web2 infrastructure for everything that does not need verifiable settlement, custody, ownership, identity, or composability.

For Solana products, use solana.new as the first scaffold/source pack: choose integration-first when existing protocols can solve the job, and only recommend custom programs when the product needs new onchain logic.

For accelerator-focused MVPs, scope the MVP to create proof, not polish. A simple demo plus customer pull usually beats a broader product without usage evidence.

## Output

- MVP promise
- chosen build path
- non-goals
- feature list
- stack options
- timeline
- risks and dependencies
- credential requirements
- sources and scaffold path used
- demo script
