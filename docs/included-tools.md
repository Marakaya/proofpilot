# Included Tools

This document explains what is included in ProofPilot and why.

ProofPilot has four tool types:

| Type | Meaning | Default Behavior |
|---|---|---|
| Internal skill | A local ProofPilot workflow that runs inside the agent runtime | Enabled by default |
| Source | A public or platform-owned knowledge base used for research and comparison | Enabled by default when public |
| Connector | An external API or account-backed tool | Optional; asks for credentials only when needed |
| Gated action tool | A connector that can deploy, spend money, submit final work, or use wallets/private keys | Disabled until explicit permission gates exist |

The product rule is simple: **users can get value before connecting any key**.

## Internal ProofPilot Skills

These are the core modules included in the repository.

| Skill | What It Does | When To Use | Output |
|---|---|---|---|
| `proofpilot` | Main router. Reads the user's goal, constraints, team, timeline, and target outcome, then selects the right focused skill. | Every session starts here. | Track recommendation, selected workflow, required sources, credential needs. |
| `proofpilot-idea-discovery` | Helps a user who does not know what to build. Turns skills, interests, constraints, and trends into possible venture directions. | "I do not know what to build." | 3 to 5 directions, ranked recommendation, first validation task, what not to build yet. |
| `proofpilot-venture-validation` | Tests an idea against customer pain, alternatives, market logic, comparable projects, and feasibility. | User has an idea but does not know if it is worth building. | Customer hypothesis, alternatives, evidence map, risk list, go/pivot/pause recommendation. |
| `proofpilot-mvp-planner` | Converts a direction into the smallest credible MVP and build path. | User chose an idea and needs a realistic plan. | MVP promise, non-goals, feature scope, timeline, dependencies, demo script. |
| `proofpilot-readiness-review` | Scores an idea, MVP, pitch, grant, repo, or submission using ProofPilot's rubric. | Before mentor review, launch, grant application, or hackathon deadline. | Red/yellow/green scorecard, blockers, quick wins, missing evidence. |
| `proofpilot-submission-builder` | Drafts pitches, grant applications, accelerator answers, Devpost/Colosseum-style submissions, and demo narratives. | User needs a structured application or pitch. | Draft answers, missing fields, asset checklist, final-submit warning. |

## Core Source Catalog

These sources make ProofPilot useful before credentials are connected.

| Source | Used For | Tracks | Credential |
|---|---|---|---|
| Local community archive | Past projects, event history, mentor feedback, judging outcomes, recurring local needs. | `startup`, `community`, `hackathon`, `grant` | Platform-owned in hosted deployments |
| GitHub public repos | Similar projects, README quality, implementation proof, traction signals, open-source patterns. | All technical tracks | None for public repos; token for private repos or higher limits |
| YC Library and Startup School | Startup basics, customer discovery, MVP scope, launch, founder discipline. | `startup` | None |
| `garrytan/gstack` | Founder/operator skill-pack reference, specialist role patterns, startup workflow primitives. | `startup` | None |
| Founder Institute frameworks | Founder readiness, idea validation, market sizing, structured startup curriculum. | `startup` | None |
| Sequoia Arc / First Round / a16z / Techstars / 500 / Antler / EF frameworks | PMF thinking, go-to-market, fundraising readiness, founder-market fit, cofounder formation. | `startup`, `grant` | None |
| Public hackathon pages | Rules, judging criteria, deadlines, prizes, required assets, sponsor tracks. | `hackathon` | None |
| Security guides | OpenZeppelin and Trail of Bits readiness practices. | `web3` | None |

## Startup And Founder Tools

These tools shape founder-quality output even when the user is not technical.

| Tool | What ProofPilot Uses It For | Product Decision |
|---|---|---|
| `garrytan/gstack` | Reference for founder roles, operating cadence, and startup assistant workflows. | Include as inspiration/source, not as a hard dependency. |
| YC Startup School | Customer discovery, MVP discipline, launch basics, fundraising context. | Use as general startup framework source. |
| YC Library | Founder lessons, startup heuristics, pitch clarity, market reasoning. | Use for validation and pitch review. |
| Founder Institute | Structured founder/idea validation and curriculum-style progress. | Use for beginner founder guidance. |
| Sequoia Arc PMF Framework | PMF diagnosis and market clarity. | Use in readiness review for startup track. |
| First Round PMF Method | Early customer signal and product-market fit thinking. | Use in validation prompts and rubric checks. |
| Techstars / Startup Weekend | Short-cycle startup formation and weekend-style MVP scope. | Use for beginner and hackathon-style startup paths. |
| Antler / Entrepreneur First | Founder-market fit and cofounder/team formation. | Use when the user's issue is team or founder fit. |

## Web2, AI, And Data Tools

These support founders who are building SaaS, AI apps, data products, no-code workflows, or startup submissions.

| Tool | What It Is For | When ProofPilot Uses It | Credential |
|---|---|---|---|
| GitHub | Repo readiness, similar projects, implementation proof, issue/activity signal. | Readiness review, MVP planning, technical proof. | Optional token for private repos or higher limits. |
| Devpost | Public hackathon/project examples and submission format. | Submission drafts and hackathon comparison. | No official public API assumed; public pages only. |
| Major League Hacking | Organizer patterns, rules, beginner-friendly hackathon expectations. | Hackathon workflow design and participant guidance. | None. |
| Lablab.ai | AI hackathon formats, project examples, AI/ML challenge patterns. | AI app and hackathon track. | Public pages no key; provider APIs may require keys. |
| Kaggle | Datasets, notebooks, ML competitions, benchmark examples. | Data/ML ideas and validation. | Optional user API key. |
| Hugging Face | Models, datasets, Spaces, demos, competitions. | AI app and data/ML tracks. | Optional user token. |
| NASA APIs / Space Apps | Open-data project ideas, public APIs, civic/open-data submission patterns. | Data, civic, and hackathon tracks. | API key for `api.nasa.gov`; public rules need no key. |
| Hack Club | Student builder culture, project inspiration, community examples. | Beginner and community tracks. | None. |
| OpenAI | LLM review, idea synthesis, pitch feedback, AI app provider option. | Hosted review worker or local BYOK mode. | Platform key first; user BYOK optional. |
| Anthropic | Alternative LLM provider for review and writing workflows. | Provider-agnostic inference. | Platform key first; user BYOK optional. |
| Google Gemini | AI app provider option, multimodal workflows, Gemini ecosystem projects. | AI app planning and provider comparison. | API key or Google Cloud identity. |
| Meta Llama API | Llama-hosted or provider-hosted open model workflow. | AI app provider comparison. | Provider-specific key. |
| ElevenLabs | Voice agents, speech demos, audio product ideas. | Voice app track. | API key. |
| Databricks | Data/AI platform, enterprise data workflows, agent/data apps. | Data/ML or enterprise AI track. | Workspace host plus PAT or cloud identity. |
| Elastic | Search, retrieval, RAG, observability, AI search products. | RAG/search app planning. | API key or cloud credentials. |
| Replit | Beginner-friendly build/deploy environment and existing AI builder workflows. | No-code/low-code or beginner build path. | Prefer manual/link path first. |
| Bolt.new | Fast prototype path for web apps. | MVP planning when speed matters more than custom infra. | No stable public API connector assumed. |

## Deployment And Cloud Tools

These tools are useful after the idea and MVP path are clear.

| Tool | What It Is For | ProofPilot Use | Credential Policy |
|---|---|---|---|
| Vercel | Web app deployment, preview URLs, frontend/serverless demos. | Deployment checklist and public URL verification. | Access token/OAuth only when automating. |
| Supabase | Postgres, auth, storage, realtime for fast prototypes. | Stack recommendation and deployment checks. | Publishable key can be public; service role is high risk. |
| Cloudflare | Workers, D1, R2, Workers AI, edge deployments. | AI/web app stack option and deployment checks. | Scoped API token and account ID. |
| AWS / Bedrock / Amplify | Cloud infrastructure, AI providers, app hosting. | Larger startup or sponsored cloud track. | IAM role or access keys; use after cost guardrails. |
| Azure / Microsoft Foundry | Azure OpenAI, cloud app stack, Microsoft startup/hackathon paths. | Enterprise/web2/AI provider track. | API key, Entra ID, or service principal. |
| Google Cloud / Firebase | AI Studio, Vertex, Firebase app stack. | AI/web app stack option. | API key or service account depending action. |

## Web3 And Onchain Tools

ProofPilot includes web3 tools, but wallet/action tools are gated by default.

| Tool | What It Is For | ProofPilot Use | Credential Policy |
|---|---|---|---|
| Colosseum Copilot | Solana project archive, winners, project search, gap analysis. | Solana/hackathon research and differentiation. | User PAT; read-only connector. |
| `solana.new` | Solana starter templates and scaffold discovery. | Recommend starter path. | No key for scaffold selection. |
| Solana Agent Kit | Agentic Solana actions, wallet/RPC/plugin workflows. | Future action connector. | Requires wallet/private key or wallet interface; deferred. |
| ETHGlobal Skills | Ethereum project corpus, sponsor docs, bounties, winner context. | EVM/hackathon research. | Free limited lookup; x402 paid overage possible. |
| Scaffold-ETH 2 | EVM dapp scaffold and learning path. | EVM stack planning. | No key for local planning; deploy needs wallet/RPC/Etherscan keys. |
| Base Skills / OnchainKit | Base app patterns, app config, onchain UX. | Base app planning and UI stack recommendation. | Some app integrations need Coinbase Developer Platform key. |
| Coinbase AgentKit | Agentic wallet/onchain actions across Coinbase-supported flows. | Future wallet/action track. | CDP keys plus wallet provider credentials; deferred. |
| OpenZeppelin Skills | Smart contract security, contracts, readiness practices. | Security/readiness review. | No API key. |
| Trail of Bits Skills | Security review procedures and local analysis guidance. | Security/readiness review. | No API key; local tools may be optional. |
| Sui Dev Skills | Sui build guidance and ecosystem-specific path. | Sui stack recommendation. | No key for guidance; deployment uses local keys. |
| Aptos Agent Skills | Aptos build guidance and agent examples. | Aptos stack recommendation. | No key for guidance; deployment uses local config/private keys. |
| BNB Ask AI MCP | Hosted read-only BNB Chain knowledge. | BNB Chain research. | No key; read-only. |
| BNBChain MCP | BNB read/write chain operations. | Future action connector. | Private key for write actions; deferred. |
| BNBAgent SDK | BNB agent workflows and wallet/RPC operations. | Future action connector. | Private key, wallet password, RPC URL; deferred. |
| Avalanche Starter Kit | Avalanche app scaffold and ecosystem path. | Avalanche planning. | No key for scaffold; deploy needs wallet/RPC. |
| TON Blueprint / Acton | TON local scaffold, tests, and deployment path. | TON planning. | Avoid mnemonic storage; deploy via explicit wallet flow. |
| TON Connect | Wallet connection and signing UX. | Future wallet UX. | No API key; wallet session/signing is gated. |
| Stellar `stellar-build` | Stellar skill workflow and build path. | Second-wave ecosystem support. | No obvious key for guidance; actions may require wallet secret. |
| Polkadot Agent Mesh | Early signal for Polkadot agent/skill ecosystem. | Watch list. | Not stable enough for first-wave automation. |

## What Is Enabled First

ProofPilot's first practical release should enable:

1. Internal skills.
2. Public source catalog.
3. Startup/founder frameworks.
4. Public GitHub and public hackathon/project pages.
5. No-secret web3 guidance tools.
6. Optional read connectors: Colosseum Copilot, GitHub, Kaggle, Hugging Face.

## What Is Deferred

These should not run automatically in the first release:

- wallet signing
- private-key ingestion
- contract deployment
- paid API overage
- cloud resource creation
- final submission to an external platform
- sponsor credit spending

Each deferred action needs explicit approval, audit logs, spending limits, and a clear owner.
