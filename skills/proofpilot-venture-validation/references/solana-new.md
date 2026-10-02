# Solana Development And solana.new Sources

Use this reference when the task is Solana-specific or when a web3/hackathon idea may be better implemented on Solana.

## What ProofPilot Includes

ProofPilot includes this routing reference and the local discovery helper. Its installers now add `solana-dev`, 32 solana.new journey skills and shared data by default, alongside official Colosseum V2, ETHGlobal and OpenAI documentation skills. The locked set and standalone-copy bootstrap are described in [installation.md](installation.md). Development toolchains and project-specific protocol candidates are separate.

| Skill | Use |
|---|---|
| `solana-dev` | Solana programs, SDKs, clients and local tests |
| `scaffold-project` | Solana project scaffolding |
| `review-and-iterate` | Code and production-readiness review |
| `debug-program` | Solana program debugging |
| `deploy-to-mainnet` | Deployment guidance after authorization |

`solana-dev` comes from the Solana Foundation and is installed alongside the solana.new journey pack. Discover actual installation paths rather than assuming that every listed skill is present.

## Direct Implementation Route

When the user asks to write, implement, fix, or test a Solana smart contract/program or app, take this route immediately. For example, “давай напишем свой смарт контракт для этого решения. используй для этого пруфпайлот” is an implementation request when the existing solution is on Solana.

1. Read the existing solution, specification and repository. Identify the requested behavior, accounts/state, permissions, custody and acceptance checks. Clarify only requirements that materially affect correctness; do not restart venture validation.
2. Run the capability inventory below. If `solana-dev` is installed, read its reported `skill_file` and apply relevant guidance within the user's task. Use scaffolding, review or debugging skills only when needed and installed. Finding a skill file does not prove its toolchain works.
3. If a skill is absent, state that briefly and continue implementation with the current host agent, available local tools and current official Solana/Anchor/SDK documentation. Do not claim Solana development is unsupported, demand installation, or stop at an MVP plan. If a required compiler or dependency is missing, report that concrete verification limit.
4. Implement the authorized local changes and run appropriate builds/tests. Report what works and what remains unverified. A program test should cover its important permission and state transitions, including failure paths.
5. Apply [safety.md](safety.md) to external writes, paid services, wallets and deployment, honoring authorization already given. Local implementation does not authorize signing or mainnet deployment. Do not invoke a different agent/provider merely because an optional skill is named `build-with-claude`; obtain the user's explicit authorization for that provider first.

Colosseum setup is not a prerequisite for local inventory or scoped implementation from an existing specification. Follow [onboarding.md](onboarding.md) for any separate project/market research the user requests.

## What solana.new Provides

The upstream `sendaifun/solana-new` project describes itself as the open-source platform behind `solana.new`: journey skills, ecosystem skills, MCPs, curated ideas, starter repositories, and a Solana knowledge base.

Treat `solana.new` as an upstream source pack, not just as a scaffold URL.

## Local Discovery

Resolve the installed ProofPilot skill directory from the location of its `SKILL.md`, then run or inspect its sibling script. The path is relative to the skill directory, not the user's working directory:

```bash
node "<absolute ProofPilot skill directory>/scripts/discover-sources.js" --root "<absolute parent skill root>" --capabilities
```

Use the result to find:

- `support_bundle`: the complete 36-skill catalog and shared guidance file inventory; it does not check helper/account/toolchain execution
- `solana_development`: bundled guidance and a catalog with `installed` / `not_found` statuses and exact `skill_file` paths for separate developer skills
- installed solana.new skills in project-local `.agents/skills`, `.codex/skills`, `.claude/skills`, beside the invoked installed skill/profile, and global `~/.codex/skills` (or `$CODEX_HOME/skills`), `~/.agents/skills`, `~/.claude/skills`. An explicit `--root` is checked first, so its copy wins; project-local roots are the fallback when it lacks a skill. Without `--root`, project-local copies take precedence over sibling and global roots
- shared Solana data in `data/solana-knowledge/`, `data/ideas/`, `data/guides/`, `data/colosseum/`, and `data/defi/`
- local shared data paths; `--capabilities` omits credential checks, account calls and setup writes

Run without `--capabilities` only when a research task also needs credential-availability booleans. A `not_found` entry means the helper did not find its `SKILL.md` in the checked roots; it does not mean ProofPilot lacks an implementation route. The support inventory covers the locked bundle; protocol-specific candidates and third-party extensions are discovered when needed.

If local solana.new data is unavailable, fall back to the upstream GitHub repo and official Solana docs/templates.

## Stage Routing

| ProofPilot Stage | solana.new Skills/Data To Prefer |
|---|---|
| idea discovery | `find-next-crypto-idea`, `data/ideas/`, `data/solana-knowledge/`, `navigate-skills` |
| venture validation | `validate-idea`, `competitive-landscape`, `data/colosseum/`, `data/defi/`, `data/solana-knowledge/04-protocols-and-sdks.md` |
| MVP planning | `scaffold-project`, `build-with-claude`, `data/guides/rpc-wallet-guide.md`, `data/guides/security-checklist.md`, `data/solana-knowledge/04-protocols-and-sdks.md` |
| explicit implementation | `solana-dev` when installed, then the current host agent with official docs; `scaffold-project` when scaffolding is needed |
| readiness review | `review-and-iterate`, `product-review`, `cso`, `debug-program`, `data/guides/security-checklist.md` |
| submission builder | `submit-to-hackathon`, `create-pitch-deck`, Colosseum/ETHGlobal source data |

## Build Path Rules

- Prefer integration before custom programs when existing Solana protocols can solve the need.
- Recommend `scaffold-project` or `create-solana-dapp` for Solana app scaffolding.
- For new frontends, prefer `@solana/kit`, Kit plugins, Wallet Standard discovery through the wallet plugin, and `@solana/react` when using React. Select generated program clients compatible with the chosen stack. The [official frontend guide](https://solana.com/docs/frontend), checked 2026-09-05, identifies web3.js v1 and wallet-adapter as legacy; refresh this choice before a future build.
- For an existing app, inspect its SDK versions, wallet integration and required protocol clients first. Preserve a working compatible stack unless migration has a concrete benefit and bounded scope. Do not prescribe a rewrite based on a new-project default.
- A documentation check establishes the recommendation only. Verify the chosen scaffold and required wallet/program integration locally before claiming that they work.
- When recommending custom onchain logic, explain the reason: new state machine, custody, settlement, composability, token/account logic, or verifiable execution. An explicit request to implement a chosen custom program follows the direct implementation route.
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
- Colosseum Copilot is the required ProofPilot research foundation; complete [onboarding.md](onboarding.md) for project research, reuse its official Copilot Connect connection, and use its current corpus alongside dated local data. Local inventory and scoped implementation need no Colosseum account connection.
- RPC providers such as Helius may need keys for development.
- Wallet/private-key flows are out of scope until explicit permission gates exist.

## Output Requirements

When using solana.new sources, mention:

- which local solana.new skills/data were used
- whether Colosseum/DefiLlama/GitHub were also checked
- whether the recommendation is integration-first or custom-program-first
- what exact next skill or scaffold path should be used
