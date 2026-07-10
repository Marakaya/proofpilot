# Contributing

ProofPilot is an evidence-first agent skill, not a collection of vague prompts or an unverified directory of links.

Useful contributions include:

- a stage workflow that changes a real founder decision
- a primary source with a clear query strategy and evidence purpose
- a tool capability with explicit status, permission, and credential requirements
- an anchored rubric with weights and evidence rules
- a structured example or evaluation case
- validation, packaging, safety, or connector work

## Source Of Truth

Canonical skill files live under `skills/proofpilot`. Edit the JSON registries there and regenerate `docs/included-tools.md`; do not maintain a second registry in repository-level documentation.

Represent public research, private access, write actions, and wallet or paid actions as separate capabilities. Do not create compound credential classes such as `no_secret_or_wallet_later`.

## Contribution Rules

- Keep workflows useful for technical and non-technical founders.
- Separate facts, assumptions, inference, and unknowns.
- Add direct official URLs and a verification date where applicable.
- Prefer public and read-only paths before account connections.
- Never add private-key or mnemonic ingestion.
- Keep final submission, deployment, payment, and wallet actions human-controlled.
- Check source licenses and terms before copying external skill or framework material.
- Do not present medical, legal, tax, financial, or investment conclusions as professional advice.

## Validation

```bash
npm run generate:docs
npm test
npm pack --dry-run
```
