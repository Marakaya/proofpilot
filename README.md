# ProofPilot

Evidence-first open-source guidance for turning uncertainty into a defensible venture decision.

ProofPilot helps a founder, small-business owner, student, community operator, technical builder, or non-technical entrepreneur discover an opportunity, validate it, plan the smallest useful test, review readiness, and prepare a pitch or application. It is not limited to software or hackathons.

## What Makes It Different

ProofPilot is designed to resist confident but unsupported startup advice:

- facts, user claims, assumptions, inferences, and unknowns stay separate
- material external claims require direct sources and retrieval dates
- missing evidence produces a provisional conclusion, not a fabricated opportunity
- each experiment specifies success, inconclusive, and stop or pivot conditions
- Colosseum is the required research foundation; other service connections are optional
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

Requirements: Node.js 20 or later, npm and Git. First full installation needs network access; live Colosseum access also requires curl in a trusted system location (see [onboarding](skills/proofpilot/references/onboarding.md)).

Clone the repository and install dependencies:

```bash
npm install
npm test
node scripts/cli.js inspect
```

Install the self-contained skill for a supported agent runtime. Choose one target:

```bash
node scripts/cli.js install --target codex
node scripts/cli.js install --target claude
node scripts/cli.js install --target agents
```

Use `--dir <absolute-path>` for an exact custom main-skill destination; supporting skills are installed beside it. Relative paths, shell-style `~`, runtime skill roots and runtime configuration directories are rejected. Add `--profiles` for the five stage profiles. `--force` can replace a changed ProofPilot core/profile only when compatible ProofPilot bundle state records that exact destination and inode identity and the entry's `SKILL.md` declares the expected name. It refuses an unowned foreign directory even with `--force`. To recover a ProofPilot installation created before inode ownership was recorded, explicitly use `--force --adopt-legacy-core`; the old entries are preserved in backups.

The CLI installs and validates the skill package. The selected agent runtime executes [skills/proofpilot/SKILL.md](skills/proofpilot/SKILL.md). Restart or reopen the runtime after installation so it discovers the new skill.

Installation now includes the **full support bundle by default: 36 supporting skills**, shared Solana data/guides/catalogs, and the cached official Colosseum connection helper. It includes 32 solana.new skills plus official `solana-dev`, Colosseum Copilot V2, `ethglobal-skills` and `openai-docs`. Sources are pinned in [skill-dependencies.json](skills/proofpilot/references/skill-dependencies.json) and downloaded directly at installation time. Declared upstream license files are retained; the manifest also records proprietary or unknown license status when an upstream source publishes no license file. Owned entries remain upgradable when a later release changes its bundle id or pinned commit; changed managed content is preserved in a reported backup.

Compatible support entries already owned by this ProofPilot installation are preserved. Ownership pairs bundle state with a per-entry managed marker, so stale provenance cannot adopt a replacement personal skill. Missing required internal files in owned entries are repaired; known versions below a required minimum are upgraded with backups. Installed guidance removes telemetry commands, uses Copilot V2, and scopes transcript exports and paid requests to the user's authorization. Local adaptations preserve exact upstream originals and custom text. Use `--update-dependencies` to explicitly replace the managed support set, `--core-only` to deliberately omit it, or `--offline` to require an already complete bundle; offline/update modes conflict. A full install holds one exclusive lock for the target skill root while dependencies, core, optional profiles and bundle state are activated as one transaction. Replacements are staged before backups; failures roll back activated entries and restore backups when their path identity is still owned by the transaction. A durable journal recovers an interrupted activation on the next run and distinguishes an uncommitted activation from a state file that was already durably committed.

The repository `dependencies` command requires the exact skill root explicitly; it never guesses a runtime from the current directory. `--status` is a read-only local inventory. Run the command without `--status` to repair an owned incomplete bundle; unowned or incompatible collisions must be moved aside first.

```bash
node scripts/cli.js dependencies --root /absolute/path/to/skills --status
node scripts/cli.js dependencies --root /absolute/path/to/skills
```

See [installation.md](skills/proofpilot/references/installation.md) for repeat installation, status meanings, backups and standalone skill-manager bootstrap. Account connections, host plugins and project toolchains use their own setup.

## First-Use Setup

Both repository installers print the next setup step. A plain skill installation cannot initiate an agent conversation on its own: invoke `$proofpilot` for research after installation, and the agent will check existing access and explain setup in your language. All six entrypoints share the same setup. A standalone skill-manager copy checks its support bundle on first use for actual work and adds missing dependencies unless core-only was chosen; a file copy alone cannot run installation hooks. Local capability lookup and scoped implementation/debugging/testing from an existing specification do not require Colosseum setup; normal research setup remains incomplete until verified.

For higher-quality recommendations and assessments, ProofPilot recommends models in the **SOL or Opus 5 class or higher**, where available in your host. Weaker models may miss important details or draw incorrect conclusions; built-in checks cannot fully compensate for model limitations. This is a usage recommendation, not a benchmark guarantee or a setup requirement. Model access and costs depend on your host's plan.

Colosseum Copilot V2 access is required for completed research setup. Sign in with the official Copilot Connect helper through your browser; no PAT entry is needed. Existing official helper connections are reused:

```bash
# Replace the directory with your actual installed skill path.
node "<installed skill directory>/scripts/setup.js" --connect-colosseum
node "<installed skill directory>/scripts/setup.js" --check-colosseum
```

For remote environments or blocked callbacks, add `--device` to the connect command. Connection uses pinned `@colosseum-org/copilot-connect@0.2.2` (Node.js 20+ and npm); live requests also need curl. ProofPilot prepares the exact package without lifecycle scripts, rejects writable or symlinked managed-store paths, validates its local copy, and runs its JavaScript entrypoint directly with the current Node executable. The official helper owns protected credential storage and renewal.

`proofpilot setup --status` also works with the repository CLI. It is offline and describes saved state only. `--check-colosseum` privately obtains helper authorization and checks authenticated evidence scope at the fixed API V2 status endpoint. ProofPilot creates no credential file or verification cache and ignores preserved V1 secrets. Read [onboarding](skills/proofpilot/references/onboarding.md) for connection, renewal and the limited/offline-work exception.

If no trusted curl is available, live checks return `transport_missing` with `next_action: prepare_curl` before token retrieval or renewal. Prepare system curl and retry the check; this does not establish an authorization failure. ProofPilot does not install curl automatically.

The [service access guide](skills/proofpilot/references/service-access.json) covers ten services and their cost boundaries. Review Colosseum account terms at sign-in: the public FAQ still describes free V1 PAT access and does not establish V2 pricing. Other connections are requested only for a concrete capability. Extra OpenAI/Claude API keys are unnecessary in an already authenticated agent; host/model usage has separate terms.

## Quick Start

In Codex, invoke ProofPilot explicitly with `$proofpilot`:

```text
$proofpilot

I do not know what to build. I have two weeks, access to university communities,
and no technical cofounder. Find directions worth testing and plan the smallest
experiment that could disprove the strongest idea.
```

Other supported runtimes can invoke the installed `proofpilot` skill through their normal skill picker or invocation syntax. ProofPilot may also activate from a matching founder, validation, MVP, review, pitch, grant, accelerator, or hackathon request.

## Optional Stage Profiles

The repository also ships five opt-in stage profiles. They are not installed by the default CLI because the main skill already routes every stage and broad implicit triggers can compete. Install them deliberately when a runtime benefits from direct stage invocation:

| Profile | Direct stage |
|---|---|
| `proofpilot-idea-discovery` | Discover opportunities from constraints and access |
| `proofpilot-venture-validation` | Test demand and risky assumptions |
| `proofpilot-mvp-planner` | Plan the smallest useful experiment or MVP |
| `proofpilot-readiness-review` | Review evidence and readiness with a rubric |
| `proofpilot-submission-builder` | Prepare a pitch, grant, accelerator, or hackathon application |

For a fresh Codex installation, use the profile installer instead of the main-only `install --target codex` command above. It installs the main router, all five profiles and the same 36 supporting skills together:

```bash
npm run install:profiles -- --copy
npm run validate:profiles
```

`validate:profiles` is a repository smoke test. It installs the main skill and profiles into fresh temporary targets in copy and symlink modes with `--core-only`, then checks those fixtures and the packaged profile mirrors. It does not inspect your installed target or its 36 supporting skills.

The profile installer targets `$CODEX_HOME/skills` or `~/.codex/skills` by default. Pass `--target <skill-root>` for another runtime. In `--copy` mode, the main skill and every profile root must be physical directories; a symlinked profile root is an installation-mode mismatch and is not reused. Add `--force` only when converting or replacing entries in a verified ProofPilot-managed root. The profiles share the canonical references from `skills/proofpilot/references`; they do not maintain a second registry.

## Focused Extensions

The self-contained skill includes focused playbooks in the v0.3 evidence model:

- Solana tasks use `solana-new.md` for explicit implementation routing, installed developer/journey skills, local knowledge, scaffold guidance, Colosseum context, and DefiLlama research paths.
- Accelerator work uses current program profiles for YC, Techstars, 500 Global, Antler, Entrepreneurs First, and Sequoia Arc, while requiring official-page refresh before final advice.
- Pitch and presentation work selects a hackathon, investor, angel, accelerator, grant, or partner deck before drafting.
- `honest-evaluation.md` calibrates positive and negative verdicts to evidence and the actual program stage.
- `product-market-fit.md` adapts Sequoia questions and archetypes into value, behavior, retention, and payment tests. Methodology is not project evidence.
- `ai-product-validation.md` checks accepted outcomes, repeated trials, human fallback, and full variable delivery cost.
- `decisions.md` separates test, build, application, and artifact decisions; mandatory gates remain independent of quality scores.
- `quality.md` applies to substantial prose assessments too: freeze source-backed facts, check arithmetic and gates, review exact claims, and permit at most two repairs. A narrow edit keeps only applicable checks.
- Source playbooks start relevant project/archive research with Colosseum, then add local, public and optional domain sources. Corpus coverage and the user's evidence remain explicit.

Inspect which supported local skills, shared source packs, and credential classes are available without printing secret values:

```bash
npm run discover:sources
```

## Solana Development

ProofPilot includes [Solana routing guidance](skills/proofpilot/references/solana-new.md) and installs `solana-dev`, `scaffold-project`, `review-and-iterate`, `debug-program`, `deploy-to-mainnet` and the other support skills by default. Anchor/Solana CLI, compilers and project packages are installed only for a concrete project.

Check the focused capability catalog and local installation paths without credential inspection or account calls:

```bash
node scripts/cli.js capabilities
# From an installed skill, use its absolute directory:
node "<installed skill directory>/scripts/discover-sources.js" --root "<absolute parent skill root>" --capabilities
```

The inventory searches project-local, installed sibling and global skill roots. It reports `installed` or `not_found` for each supported skill. A found `SKILL.md` does not verify compilers, dependencies or runtime access.

```text
$proofpilot Напиши Solana смарт-контракт для нашего решения по существующей спецификации и добавь тесты.
$proofpilot Какие навыки для разработки Solana входят в пакет и какие установлены у меня?
```

An explicit implementation request follows the development route immediately. If `solana-dev` is available, the agent reads it; otherwise the agent continues with its local tools and current official documentation. A missing optional skill does not reduce the task to planning or require account setup. Builds and tests establish what works; signing, paid services and deployment still require scoped authorization.

## Coach And Evaluator Modes

`coach` mode helps improve a project and plan the next experiment.

`evaluator` mode freezes the rubric, evidence cutoff, and allowed sources before scoring. It does not silently rewrite a submission or use private coaching history. Scores are reported with evidence coverage and confidence so Superteam or another operator can audit the result.

## Hackathons And Workshops

Use the same `$proofpilot` entrypoint for organizers, judges and participants. The agent selects `evaluator` for formal judging or `coach` for a participant's self-review. An organizer can ask for a rubric and submission form before any projects exist.

Two versioned ProofPilot defaults are included: `solana_hackathon` (product-focused, 25/25/15/10/10/10/5 points) and `learning_workshop` (working assignment, technology use, understanding, usability and task value: 40/20/20/10/10). A specific event's published or organizer-supplied rules take precedence. These presets are **not official Colosseum criteria**; unspecified official weights are never invented.

```text
$proofpilot Оцени проекты Solana-хакатона по нашему базовому профилю.
$proofpilot Подготовь форму заявки и правила оценки для учебного воркшопа по API.
$proofpilot Проверь мою заявку перед хакатоном в режиме coach по приложенным правилам.
```

See the [event workflow](skills/proofpilot/references/event-assessment.md) and [five-part intake](skills/proofpilot/references/event-intake.md). Event scorecards preserve evidence status and admission separately. Missing criteria keep their weight: partial results show earned points and unresolved coverage, with no final `/100` total or normalized ranking. Video transcripts, recorded demos and independently reproduced behavior are distinct evidence.

The agent handles the internal files. For a direct local check:

```bash
node scripts/cli.js event list
node scripts/cli.js event init learning_workshop /absolute/new-workshop-card.json
node scripts/cli.js event check /absolute/new-workshop-card.json
```

Fill the generated card from actual evidence before checking it. The portable installed helper is `scripts/event-score.js` and needs no additional API key. Mechanical checks verify consistency, not source authenticity or judging quality. Formal evaluation still requires the shared quality review. The event card is separate from the general venture response schema.

## Tools And Credentials

ProofPilot requires Colosseum read access for completed setup and uses public/local sources before other optional connections. A tool can expose several capabilities with different controls: public research may need no secret, private repository access may need a scoped token, and deployment may remain deferred.

The generated [tool catalog](docs/included-tools.md) distinguishes:

- public references available now
- connector specifications that do not yet ship a live adapter
- a bounded API V2 Colosseum read helper using the official Copilot Connect connection
- catalogued candidates requiring verification
- deferred actions requiring stronger permission, cost, or security controls

ProofPilot never asks for a private key, seed phrase, mnemonic, or raw API secret in chat.

## Repository Layout

```text
skills/proofpilot/
  SKILL.md                 Canonical routing and safety instructions
  agents/openai.yaml       Agent UI metadata
  references/              Workflows, registries, rubrics, and schemas
  scripts/                 Setup, Colosseum reads, discovery, response validation
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

`npm test` validates JSON Schemas, cross-registry references, unique IDs, rubric weights, workflow links, example responses, score arithmetic, evidence/gate semantics, routing contracts, installation modes, and generated documentation. These are deterministic checks, not a measurement of model quality.

Use `node scripts/cli.js validate-response response.json` for full Ajv and semantic validation. An installed skill can use its own `scripts/validate-response.js` with no npm dependencies. For actual model comparisons, see [evaluation.md](docs/evaluation.md); recorded outputs and explicit judgments are required.

Use `proofpilot quality --help` (or the installed `scripts/quality.js --help`) for the local quality workflow. It snapshots evidence, retains drafts and reviewer findings, checks source-quote bindings, arithmetic, word limits and recorded action prerequisites, and stops on unresolved review or the repair limit. Follow [quality.md](skills/proofpilot/references/quality.md) for the compact packet and review process. It does not call model APIs, certify source truth, or secretly switch models. Separate review uses the host's available, authorized resources; self-review is recorded as such.

New quality runs use policy v4 and declare `mode: coach` or `mode: evaluator` plus `decision_context: general` or `decision_context: application`. Application context requires separate-context review for drafts and readiness judgments, including `artifact` + `complete` without application gates. Evaluator mode and flagged source conflicts also require separate-context review; that requirement stays in the run across assessment changes. If only self-review is available, those runs return `needs_review`. Reviews bind to the frozen packet, policy, draft and assessment. A first bounded test can proceed without invented prerequisites; passed/failed gates require inspected evidence. Policy-v1/v2/v3 histories remain read-only, with their recorded disposition preserved. Ordinary bounded validation can still use explicitly labeled self-review.

The registries include a scoped freshness audit dated 2026-09-05: 50 tools, 18 sources and 6 accelerator profiles. Colosseum was separately migrated against official skill 2.0.0 and Copilot Connect 0.2.2 on 2026-10-01. Its V2 connector has local contract and private transport tests; authenticated V2 account checks remain required. Historical V1 probes retain their dates and do not prove V2 access. Replit has an optional MCP route; account access remains untested. Read [freshness.md](skills/proofpilot/references/freshness.md) and the per-entry evidence before reusing volatile claims.

Version 0.3 changes the response contract: scoped target/action decisions replace legacy verdicts; evaluator snapshots and evidence-backed mandatory checks are required. Regenerate old responses from their evidence rather than inventing missing fields.

## Status

Alpha. Version 0.3 is a portable skill with executable response validation, mandatory Colosseum setup and a bounded Colosseum read helper. Other research uses the host agent's tools. There is no hosted UI, encrypted secret vault or hosted persistence layer.

## License

MIT
