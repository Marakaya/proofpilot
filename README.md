# ProofPilot

Evidence-first open-source guidance for turning uncertainty into a defensible venture decision.

ProofPilot helps a founder, small-business owner, student, community operator, technical builder, or non-technical entrepreneur discover an opportunity, validate it, plan the smallest useful test, review readiness, and prepare a pitch or application. It is not limited to software or hackathons.

## What Makes It Different

ProofPilot is designed to resist confident but unsupported startup advice:

- facts, user claims, assumptions, inferences, and unknowns stay separate
- material external claims require direct sources and retrieval dates
- missing evidence produces a provisional conclusion, not a fabricated opportunity
- every recommendation includes a success threshold and a kill or pivot condition
- public and no-secret workflows run before optional connectors
- coaching and formal evaluation use separate modes

## How It Routes Work

ProofPilot classifies a request across independent dimensions instead of forcing it into one track:

- `mode`: `coach` or `evaluator`
- `stages`: `discover`, `validate`, `plan`, `review`, `submit`
- `domains`: web2, AI, web3, data/ML, community, no-code, physical-world business, or deep tech
- `venture_type`: startup, small business, public good, nonprofit, internal tool, or open source
- `program_context`: none, hackathon, grant, accelerator, incubator, or competition
- `sensitivity`: public, team, confidential, or restricted

A single request can run several stages. An AI and web3 startup preparing for a grant is no longer reduced to one ambiguous track.

## Example Request

```text
I do not know what to build.
I am good at sales and community, but I am not a developer.
I have two weeks and one technical friend.
Find directions I can test, check the riskiest assumptions, and plan the smallest MVP.
```

The response should include evidence and unknowns, three to five distinct directions, one recommended test, a measurable threshold, a stop condition, sources checked and not checked, credential requirements, and the next actions.

## Install And Inspect

Clone the repository and install dependencies:

```bash
npm install
npm test
node scripts/cli.js inspect
```

Install the self-contained skill for a supported agent runtime:

```bash
node scripts/cli.js install --target codex
node scripts/cli.js install --target claude
```

Use `--dir <path>` for an exact custom destination and `--force` only when replacing an existing installation intentionally.

The CLI installs and validates the skill package. The selected agent runtime executes [skills/proofpilot/SKILL.md](skills/proofpilot/SKILL.md).

The repository also ships five opt-in stage profiles. They are not installed by the default CLI because the main skill already routes every stage and broad implicit triggers can compete. Install them deliberately when a runtime benefits from direct stage invocation:

```bash
npm run install:profiles
npm run validate:profiles
```

The profiles share the canonical references from `skills/proofpilot/references`; they do not maintain a second registry.

## Focused Extensions

The self-contained skill includes additional playbooks merged into the v0.2 evidence model:

- Solana tasks can use `solana-new.md` to discover installed journey skills, local knowledge, scaffold guidance, Colosseum context, and DefiLlama research paths.
- Accelerator work uses current program profiles for YC, Techstars, 500 Global, Antler, Entrepreneur First, and Sequoia Arc, while requiring official-page refresh before final advice.
- Pitch and presentation work selects a hackathon, investor, angel, accelerator, grant, or partner deck before drafting.
- `honest-evaluation.md` requires explicit `wait`, `pivot`, `stop`, or not-ready verdicts when evidence does not justify encouragement.
- Source playbooks prioritize local and public evidence before optional account connections.

## Coach And Evaluator Modes

`coach` mode helps improve a project and plan the next experiment.

`evaluator` mode freezes the rubric, evidence cutoff, and allowed sources before scoring. It does not silently rewrite a submission or use private coaching history. Scores are reported with evidence coverage and confidence so Superteam or another operator can audit the result.

## Tools And Credentials

ProofPilot delivers value from public sources first. A tool can expose several capabilities with different controls: public research may need no secret, private repository access may need a scoped token, and deployment may remain deferred.

The generated [tool catalog](docs/included-tools.md) distinguishes:

- public references available now
- connector specifications that do not yet ship a live adapter
- implemented adapters
- catalogued candidates requiring verification
- deferred actions requiring stronger permission, cost, or security controls

ProofPilot never asks for a private key, seed phrase, mnemonic, or raw API secret in chat.

## Repository Layout

```text
skills/proofpilot/
  SKILL.md                 Canonical routing and safety instructions
  agents/openai.yaml       Agent UI metadata
  references/              Workflows, registries, rubrics, and schemas
docs/                      Human-facing architecture and generated tool catalog
examples/                  Requests, structured output, and evaluation cases
scripts/                   CLI, documentation generator, and validator
```

The `skills/proofpilot` directory is self-contained and can be installed without copying sibling skills or repository-level data files.

## Development

```bash
npm run generate:docs
npm test
npm pack --dry-run
```

`npm test` validates JSON Schemas, cross-registry references, unique IDs, rubric weights, workflow links, example responses, evaluation contracts, and generated documentation.

## Status

Alpha. Version 0.2 is a portable skill and evidence contract. Public research is usable through the host agent's tools, but ProofPilot does not yet ship a hosted UI, secret vault, persistence layer, or live external API adapters.

## License

MIT
