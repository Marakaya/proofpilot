# solana.new Source Pack

Use this reference when the task is Solana-specific or when a web3/hackathon idea may be better implemented on Solana.

## What solana.new Provides

The upstream `sendaifun/solana-new` project describes itself as the open-source platform behind `solana.new`: journey skills, ecosystem skills, MCPs, curated ideas, starter repositories, and a Solana knowledge base.

Treat `solana.new` as an upstream source pack, not just as a scaffold URL.

## Local Discovery

Run or inspect:

```bash
node scripts/discover-sources.js
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
- For frontend-first dapps, prefer starter paths with wallet adapter, RPC setup, and protocol SDK integration.
- For custom onchain logic, require an explicit reason: new state machine, custody, settlement, composability, token/account logic, or verifiable execution.
- For DeFi, check DefiLlama/protocol health before recommending integrations.
- For mainnet, require security review, devnet tests, RPC/wallet setup, and explicit deployment approval.

## Source Use By Need

### Ideas

Use bundled ideas as archetypes, not as final recommendations. Combine them with fresh competitor research.

### Competitors

Use `competitive-landscape`, Colosseum Copilot, GitHub, and public project pages. Include substitutes, not only direct competitors.

### Scaffold

Use `scaffold-project` guidance first. Recommend specific starting points and explain why they fit:

- frontend-only integration
- Anchor program
- mobile app
- data/indexing pipeline
- DeFi protocol
- token launch

### Skills And MCPs

Use `navigate-skills` or local skill folder inspection to identify relevant installed skills and MCP candidates. Recommend installation commands only for missing community skills with known repositories.

### Credentials

- No key is needed for local solana.new guidance/data.
- Colosseum Copilot needs a read-only PAT.
- RPC providers such as Helius may need keys for development.
- Wallet/private-key flows are out of scope until explicit permission gates exist.

## Output Requirements

When using solana.new sources, mention:

- which local solana.new skills/data were used
- whether Colosseum/DefiLlama/GitHub were also checked
- whether the recommendation is integration-first or custom-program-first
- what exact next skill or scaffold path should be used
