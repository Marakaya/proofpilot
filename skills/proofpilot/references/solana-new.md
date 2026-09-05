# solana.new Source Pack

Use this reference when the task is Solana-specific or when a web3/hackathon idea may be better implemented on Solana.

## What solana.new Provides

The upstream `sendaifun/solana-new` project describes itself as the open-source platform behind `solana.new`: journey skills, ecosystem skills, MCPs, curated ideas, starter repositories, and a Solana knowledge base.

Treat `solana.new` as an upstream source pack, not just as a scaffold URL.

## Local Discovery

Resolve the installed ProofPilot skill directory from the location of its `SKILL.md`, then run or inspect its sibling script. The path is relative to the skill directory, not the user's working directory:

```bash
node "<absolute ProofPilot skill directory>/scripts/discover-sources.js"
```

Use the result to find:

- installed solana.new skills in `~/.codex/skills`, `~/.agents/skills`, or `~/.claude/skills`
- shared Solana data in `data/solana-knowledge/`, `data/ideas/`, `data/guides/`, `data/colosseum/`, and `data/defi/`
- credential availability booleans without exposing secrets

If local solana.new data is unavailable, fall back to the upstream GitHub repo and official Solana docs/templates.

## Stage Routing

| ProofPilot Stage | solana.new Skills/Data To Prefer |
|---|---|
| idea discovery | `find-next-crypto-idea`, `data/ideas/`, `data/solana-knowledge/`, `navigate-skills` |
| venture validation | `validate-idea`, `competitive-landscape`, `data/colosseum/`, `data/defi/`, `data/solana-knowledge/04-protocols-and-sdks.md` |
| MVP planning | `scaffold-project`, `build-with-claude`, `data/guides/rpc-wallet-guide.md`, `data/guides/security-checklist.md`, `data/solana-knowledge/04-protocols-and-sdks.md` |
| readiness review | `review-and-iterate`, `product-review`, `cso`, `debug-program`, `data/guides/security-checklist.md` |
| submission builder | `submit-to-hackathon`, `create-pitch-deck`, Colosseum/ETHGlobal source data |

## Build Path Rules

- Prefer integration before custom programs when existing Solana protocols can solve the need.
- Recommend `scaffold-project` or `create-solana-dapp` for Solana app scaffolding.
- For new frontends, prefer `@solana/kit`, Kit plugins, Wallet Standard discovery through the wallet plugin, and `@solana/react` when using React. Select generated program clients compatible with the chosen stack. The [official frontend guide](https://solana.com/docs/frontend), checked 2026-09-05, identifies web3.js v1 and wallet-adapter as legacy; refresh this choice before a future build.
- For an existing app, inspect its SDK versions, wallet integration and required protocol clients first. Preserve a working compatible stack unless migration has a concrete benefit and bounded scope. Do not prescribe a rewrite based on a new-project default.
- A documentation check establishes the recommendation only. Verify the chosen scaffold and required wallet/program integration locally before claiming that they work.
- For custom onchain logic, require an explicit reason: new state machine, custody, settlement, composability, token/account logic, or verifiable execution.
- For DeFi, check DefiLlama/protocol health before recommending integrations.
- For mainnet, require security review, devnet tests, RPC/wallet setup, and explicit deployment approval.

## Source Use By Need

### Ideas

Use bundled ideas as archetypes, not as final recommendations. Combine them with fresh competitor research.

Bundled protocol guides and winner lists are dated snapshots too. Check current official SDK, maintenance, migration, security, and program information before using them for a build or readiness decision; a fresh installation does not make their contents current.

### Competitors

Start with Colosseum Copilot; complement it with `competitive-landscape`, GitHub, and public project pages. Include substitutes, not only direct competitors.

### Scaffold

Use `scaffold-project` guidance first. Recommend specific starting points and explain why they fit:

- frontend-only integration
- Anchor program
- mobile app
- data/indexing pipeline
- DeFi protocol
- token launch

### Skills And MCPs

Use `navigate-skills` or local skill folder inspection to identify relevant installed skills and MCP candidates. Verify host availability before invocation. Pass a bounded task, input scope, allowed actions and cost budget as described in `source-orchestration.md`. Recommend installation commands only for missing community skills with known repositories; research does not authorize installing or activating them.

### Credentials

- No key is needed for local solana.new guidance/data.
- Colosseum Copilot is the required ProofPilot foundation; complete [onboarding.md](onboarding.md), reuse its read-only PAT, and use its current corpus alongside dated local data.
- RPC providers such as Helius may need keys for development.
- Wallet/private-key flows are out of scope until explicit permission gates exist.

## Output Requirements

When using solana.new sources, mention:

- which local solana.new skills/data were used
- whether Colosseum/DefiLlama/GitHub were also checked
- whether the recommendation is integration-first or custom-program-first
- what exact next skill or scaffold path should be used
