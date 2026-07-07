# ProofPilot

Open-source AI guide for turning raw ideas into validated ventures, MVPs, pitches, and submissions.

ProofPilot is not a hackathon-only tool. It helps a student, founder, web2 developer, web3 builder, community operator, or non-technical entrepreneur move from "I do not know what to build" to a concrete plan with evidence, risks, stack options, and next actions.

## What It Does

ProofPilot routes a user's request through focused skills:

- discover a promising direction from interests, constraints, skills, and market signals
- validate an idea against public sources, startup frameworks, and similar projects
- choose the right track: startup, web2, web3, AI app, data/ML, grant, community, or hackathon
- scope an MVP that can be built with the available team, time, and budget
- prepare a pitch, application, demo script, or hackathon submission
- review readiness with a rubric before a founder talks to users, mentors, judges, or investors

ProofPilot uses subskills by workflow stage, not by market. Web2, web3, AI, data, grant, hackathon, and community are tracks defined in `data/tracks.json` and checked with `data/track-lenses.json`.

Sources are selected with `data/source-playbooks.json`. For Solana tasks, ProofPilot uses `solana.new` as a source pack: local journey skills, shared knowledge, guides, idea datasets, and scaffold guidance first; connected sources only when they add evidence.

ProofPilot uses `data/judgment-policy.json` as a core rule: it must be honest before it is encouraging. For accelerator work, it adds `data/accelerator-programs.json`, `data/accelerator-rubrics.json`, and `references/accelerators.md` to judge YC, Techstars, 500 Global, Antler, Entrepreneur First, Sequoia Arc, and similar applications.

For presentation work, ProofPilot uses `data/presentation-decks.json`, `data/presentation-rubrics.json`, and `references/presentations.md` to choose between hackathon, investor, angel, accelerator, grant, and partner decks before drafting or generating slides.

## Recent Upgrade

The current version is stronger in five practical ways:

- **Installable skills:** `npm run install:skills` installs six discoverable `proofpilot-*` skills into Codex, with shared `data/`, `references/`, `docs/`, and `scripts/` available beside each skill.
- **Source playbooks:** `data/source-playbooks.json` tells the agent which sources to use by stage and track, so it can prioritize local/no-secret sources before asking for credentials.
- **Solana-first web3 research:** Solana tasks now use `solana.new` as a local source pack first: journey skills, shared knowledge, guides, idea datasets, Colosseum notes, DefiLlama notes, and scaffold guidance.
- **Blunt evaluation:** `data/judgment-policy.json` and `references/honest-evaluation.md` make honest, non-flattering assessment a core rule. The agent should say `wait`, `pivot`, `stop`, or `do not apply yet` when the evidence calls for it.
- **Accelerator and deck readiness:** ProofPilot now includes program profiles and rubrics for YC, Techstars, 500 Global, Antler, Entrepreneur First, and Sequoia Arc, plus deck profiles for hackathon, investor, angel, accelerator, grant, and partner presentations.

## Example Request

```text
I do not know what to build.
I am good at sales and community, but I am not a developer.
I have 2 weeks and one technical friend.
Help me find a startup idea, check similar projects, pick an MVP, and prepare a pitch.
```

ProofPilot should answer with:

- clarifying questions only when required
- 3 to 5 venture directions
- evidence and comparable projects
- recommended idea and why
- MVP scope
- stack or no-code path
- risks and validation tasks
- pitch/submission outline
- connected tools needed, if any

## Tracks

ProofPilot supports these default tracks:

- `startup`: customer problem, market, MVP, GTM, pitch
- `web2`: SaaS, marketplace, internal tool, consumer app, data product
- `web3`: wallet, onchain actions, protocol integrations, security readiness
- `ai_app`: LLM apps, copilots, workflows, RAG, voice/image/video tools
- `data_ml`: datasets, notebooks, benchmarks, competitions
- `hackathon`: rules, rubric, bounty fit, submission quality, demo readiness
- `grant`: ecosystem fit, milestones, budget, impact proof
- `community`: events, learning, memberships, reputation, achievements
- `accelerator`: YC, Techstars, 500 Global, Antler, Entrepreneur First, Sequoia Arc readiness
- `presentation`: hackathon, investor, angel, accelerator, grant, and partner decks

## Credential Policy

ProofPilot works without API keys first.

It only asks for credentials when a selected connector unlocks a concrete action. Keys must never be pasted into chat or prompts. Any hosted implementation should store secrets through an encrypted credential layer.

Default rollout:

1. No-secret sources: public docs, public hackathon pages, startup libraries, security guides.
2. Read connectors: GitHub, Kaggle, Hugging Face, Colosseum Copilot, public APIs.
3. Provider keys: OpenAI, Gemini, Anthropic, Llama, ElevenLabs, Vercel, Cloudflare, AWS, Azure.
4. Wallet/action connectors: only after explicit permission gates, audit logs, spending limits, and sandbox wallets.

See [docs/credential-model.md](docs/credential-model.md).

## Included Tools

ProofPilot includes internal skills, public source catalogs, optional API connectors, and gated wallet/action tools.

Start with [docs/included-tools.md](docs/included-tools.md) for the full tool map: what each tool does, when ProofPilot uses it, which tracks it supports, and whether it needs credentials.

## Repository Layout

```text
skills/                 Agent skill definitions
data/                   Source, tool, track, credential, and rubric registries
docs/                   Runtime, workflow, and security model
references/             Source orchestration and ecosystem-specific guidance
examples/               Example user requests and expected responses
schemas/                JSON schema for registries
scripts/                Validation and CLI helpers
```

## Quick Start

```bash
npm test
node scripts/discover-sources.js
npm run install:skills
node scripts/cli.js
```

`npm run install:skills` installs discoverable skill folders into `${CODEX_HOME:-~/.codex}/skills` using symlinks by default. To overwrite copied or manually edited installed folders, run `npm run install:skills -- --force`. New Codex sessions can then see:

- `proofpilot`
- `proofpilot-idea-discovery`
- `proofpilot-venture-validation`
- `proofpilot-mvp-planner`
- `proofpilot-readiness-review`
- `proofpilot-submission-builder`

To use ProofPilot in a portable/manual agent runtime, start with [skills/proofpilot/SKILL.md](skills/proofpilot/SKILL.md), then load the focused skill that matches the user's current stage.

## Status

Alpha. The current repo is a portable skill/router package and reference registry. It does not yet include a hosted UI, secret vault, or live connector execution server.

## License

MIT
