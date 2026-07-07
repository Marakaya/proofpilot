# Source Orchestration

Use this reference when a ProofPilot task needs evidence, source selection, connector choice, or credential guidance.

## Order Of Operations

1. Classify the task by stage: idea discovery, venture validation, MVP planning, readiness review, or submission building.
2. Classify the primary track from `data/tracks.json` and apply `data/track-lenses.json`.
3. Load `data/source-playbooks.json` and choose sources by matching track and stage.
4. Prefer no-secret local sources first.
5. Use connected or paid sources only when they materially improve the answer.
6. State which sources were checked and which were not checked.

## Default Source Policy

- Use local bundled data before asking for credentials.
- Use public web/GitHub pages before API tokens.
- Use read-only connectors before write/deploy/wallet actions.
- Never request raw secrets in chat.
- Do not perform final submissions, deployments, paid calls, or wallet actions without explicit approval.

## Track Defaults

| Track | First Sources | Secondary Sources |
|---|---|---|
| startup | YC Library, Founder Institute, GitHub, public competitor pages | Devpost, local community archive |
| web2 | GitHub, public competitor pages, YC Library | Devpost, deployment docs |
| accelerator | Accelerator program profiles, YC Library, official accelerator pages, GitHub, customer evidence | public competitor pages, founder frameworks |
| presentation | Presentation frameworks, create-pitch-deck, Presentations plugin, Google Slides connector | design-taste, brand-design, source-specific market research |
| web3 | solana.new or ecosystem-specific skill pack, GitHub, Colosseum/ETHGlobal, DefiLlama, security guides | protocol docs, live web research |
| ai_app | Hugging Face, GitHub, Kaggle, Lablab.ai | provider docs, Devpost |
| data_ml | Kaggle, Hugging Face, GitHub | public datasets, papers, benchmarks |
| hackathon | solana.new for Solana, ETHGlobal for Ethereum, Devpost/MLH, sponsor pages | Colosseum Copilot, GitHub |
| grant | ecosystem docs, grant pages, GitHub, prior funded projects | YC/Founder frameworks for narrative |
| community | local archive, public community examples, GitHub, grant/ecosystem sources | social/public web research |

## Stage Defaults

| Stage | Source Goal |
|---|---|
| idea discovery | Find opportunity spaces, prior attempts, constraints, and first wedge. |
| venture validation | Map competitors, substitutes, demand signals, feasibility, and risks. |
| MVP planning | Pick the smallest build path, scaffold, dependencies, credentials, and non-goals. |
| readiness review | Score evidence, scope, demo, security, distribution, and missing assets. |
| submission builder | Match required fields, judging criteria, proof, demo narrative, and reviewer expectations. |

## Solana/Web3 Escalation

For Solana tasks, read `references/solana-new.md`.

For YC, Techstars, 500 Global, Antler, Entrepreneur First, Sequoia Arc, or non-web3 accelerator tasks, read `references/honest-evaluation.md` and `references/accelerators.md` before drafting or recommending.

For hackathon, investor, angel, accelerator, grant, or partner decks, read `references/presentations.md` before drafting or reviewing.

For EVM/hackathon tasks, use ETHGlobal Skills when available.

For DeFi tasks, use DefiLlama before recommending a protocol. If protocol health is relevant, check TVL, volume, SDK freshness, hack history, and recent activity.

For smart-contract or token work, use security guides before recommending deployment.

## Evidence Output

Every substantial ProofPilot answer should include:

- sources checked
- sources skipped and why
- credential requirements, if any
- next source to connect if the user wants deeper verification

Keep this concise unless the user asks for a full research log.
