# Included Tools

> Generated from the ProofPilot source and tool registries. Run `npm run generate:docs` after registry changes.

ProofPilot distinguishes public references from connector specifications and implemented integrations. A listed tool is not automatically an active API connector.

## Status Meanings

| Status | Meaning |
|---|---|
| `available_public` | The agent can use current public material without a secret. |
| `connector_spec` | The access model is documented, but ProofPilot does not ship a live adapter yet. |
| `implemented` | A tested runtime adapter ships with ProofPilot. |
| `catalogued` | Useful candidate that must be verified before runtime use. |
| `deferred` | Intentionally disabled pending permission, security, cost, or product controls. |
| `deprecated` | Retained only for migration or historical context. |

## Evidence Sources

| Source | Access | Status | Used For |
|---|---|---|---|
| User-provided artifacts | user_provided | `runtime_input` | Claims about the project, shipped work, user behavior, repository state, and submitted assets. |
| Current official target program | runtime_selected | `runtime_input` | Eligibility, deadlines, judging criteria, required assets, bounties, and submission format. |
| Local community archive | platform | `platform_only` | Local demand, repeated project patterns, prior feedback, and ecosystem-specific context. |
| [GitHub](https://github.com/) | public_or_connected | `available_public` | Comparable implementations, repository activity, shipped proof, documentation quality, issues, and licenses. |
| [DefiLlama](https://defillama.com/) | public | `available_public` | DeFi market health, protocol traction, chain comparison, and ecosystem context. |
| [YC Library and Startup School](https://www.ycombinator.com/library) | public | `available_public` | Founder operating principles, customer discovery, MVP discipline, launch, and fundraising context. |
| [garrytan/gstack](https://github.com/garrytan/gstack) | public | `available_public` | Founder-role decomposition and specialist workflow patterns. |
| [Founder Institute](https://fi.co/) | public | `available_public` | Founder readiness, idea validation, market framing, and structured progression. |
| [Devpost](https://devpost.com/) | public | `available_public` | Project patterns, judging criteria, prize tracks, required fields, and public demos. |
| [Colosseum Copilot](https://docs.colosseum.com/copilot/getting-started) | connected | `connector_spec` | Solana project similarity, winner patterns, archive evidence, gap analysis, and accelerator context. |
| [ETHGlobal](https://ethglobal.com/) | public | `available_public` | Ethereum hackathon projects, event requirements, sponsors, prizes, and submission patterns. |
| [Kaggle](https://www.kaggle.com/) | public_or_connected | `available_public` | Dataset availability, benchmark conventions, notebooks, and competition requirements. |
| [Hugging Face](https://huggingface.co/) | public_or_connected | `available_public` | Model and dataset availability, licenses, benchmarks, demos, and comparable AI products. |
| [OpenZeppelin](https://docs.openzeppelin.com/) | public | `available_public` | Smart-contract patterns, security controls, upgradeability, and implementation readiness. |
| [Trail of Bits](https://github.com/trailofbits) | public | `available_public` | Threat modeling, secure development, smart-contract analysis, and review procedures. |

## Sources And Connectors

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [GitHub](https://github.com/) | Comparable projects, implementation proof, repository readiness, README quality, activity, issues, and licenses. | `public_research`: available_public; no_secret; read_only<br>`connected_repository`: connector_spec; api_token; read_only<br>`repository_write`: deferred; oauth; write_nonfinal | Use public access first. Keep write access outside the first ProofPilot connector release. |

## Founder Frameworks

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [YC Library and Startup School](https://www.ycombinator.com/library) | Customer discovery, MVP discipline, launch, founder operations, and fundraising context. | `framework_reference`: available_public; no_secret; read_only | Use stage-specific guidance; do not present heuristics as market evidence. |
| [garrytan/gstack](https://github.com/garrytan/gstack) | Founder-role decomposition and specialist workflow design. | `workflow_reference`: available_public; no_secret; read_only | Keep as an attributed reference, not a runtime dependency. Verify license and revision before reusing implementation material. |
| [Founder Institute](https://fi.co/) | Founder readiness, idea validation, market framing, and structured founder progression. | `framework_reference`: available_public; no_secret; read_only | Use as a framework source, not as proof that a particular idea has demand. |
| [Sequoia Arc](https://www.sequoiacap.com/arc/) | Product-market fit framing, company building, and pitch readiness. | `framework_reference`: available_public; no_secret; read_only | Use as an attributed framework source. |
| [First Round Review](https://review.firstround.com/) | Early customer signals, product-market fit, hiring, and operating practices. | `framework_reference`: available_public; no_secret; read_only | Use as secondary framework guidance with attribution. |
| [Andreessen Horowitz](https://a16z.com/) | Company building, go-to-market, fundraising context, and domain-specific founder guidance. | `framework_reference`: available_public; no_secret; read_only | Use as an attributed framework source, not as primary evidence of customer demand. |
| [500 Global](https://500.co/founders) | Founder education, accelerator preparation, startup evaluation context, and global program discovery. | `program_reference`: available_public; no_secret; read_only | Use current regional program pages for applications and general material for coaching. |
| [Techstars and Startup Weekend](https://www.techstars.com/) | Mentor-driven validation, weekend-style MVP scope, and accelerator preparation. | `program_reference`: available_public; no_secret; read_only | Use current program pages for applications and general material for coaching. |
| [Antler](https://www.antler.co/) | Founder-market fit, team formation, and accelerator context. | `program_reference`: available_public; no_secret; read_only | Use current regional program pages for application requirements. |
| [Entrepreneur First](https://www.joinef.com/) | Founder edge, cofounder formation, and pre-idea accelerator preparation. | `program_reference`: available_public; no_secret; read_only | Use as an attributed framework and verify current cohort requirements separately. |

## Hackathon Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Devpost](https://devpost.com/) | Public project comparisons, event criteria, prize tracks, submission fields, and demo patterns. | `public_research`: available_public; no_secret; read_only<br>`submission`: deferred; oauth; final_submit | Draft and review submissions; keep final submission manual and user-controlled. |
| [Major League Hacking](https://mlh.io/) | Beginner hackathon expectations, event rules, organizer patterns, and participant guidance. | `program_reference`: available_public; no_secret; read_only | Use current event rules for submissions and general guidance for workflow design. |
| [Lablab.ai](https://lablab.ai/) | AI hackathon formats, provider-driven challenges, public projects, and submission patterns. | `public_research`: available_public; no_secret; read_only | Use public pages first; treat provider access as a separate capability. |

## Data Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Kaggle](https://www.kaggle.com/) | Datasets, notebooks, benchmarks, competitions, and reproducible ML examples. | `public_research`: available_public; no_secret; read_only<br>`account_api`: connector_spec; api_token; read_only | Use read-only public data first and request a user token only for a named account task. |
| [NASA Open APIs and Space Apps](https://api.nasa.gov/) | Open-data ideas, scientific datasets, civic and space challenges, and public API feasibility. | `public_reference`: available_public; no_secret; read_only<br>`api_access`: connector_spec; api_token; read_only | Use official challenge and dataset pages; request an API key only for execution. |
| [Databricks](https://docs.databricks.com/) | Enterprise data, ML, lakehouse, and agent or data application planning. | `platform_guidance`: available_public; no_secret; read_only<br>`workspace_access`: deferred; service_identity; read_only | Recommend only when the data scale or sponsor context justifies the platform. |
| [Elastic](https://www.elastic.co/guide/) | Search, retrieval, RAG, observability, and AI search product planning. | `platform_guidance`: available_public; no_secret; read_only<br>`connected_cluster`: deferred; api_token; read_only | Use when search or retrieval is core to the MVP, not as default infrastructure. |

## Community Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Hack Club](https://hackclub.com/) | Beginner-friendly project inspiration, community programs, and student builder workflows. | `community_reference`: available_public; no_secret; read_only | Use as community context, not as market validation. |

## AI And Data

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Hugging Face](https://huggingface.co/) | Model and dataset discovery, licenses, benchmarks, demos, and comparable AI products. | `public_research`: available_public; no_secret; read_only<br>`connected_hub`: connector_spec; api_token; read_only | Prefer public artifacts and read-only tokens. |

## AI Providers

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [OpenAI](https://developers.openai.com/api/docs) | AI architecture planning, provider comparison, model inference, and evaluation design. | `provider_guidance`: available_public; no_secret; read_only<br>`inference`: connector_spec; paid_api; wallet_or_paid_action | Keep ProofPilot provider-agnostic; disclose cost and data handling before inference. |
| [Anthropic](https://docs.anthropic.com/) | AI architecture planning, provider comparison, model inference, and evaluation design. | `provider_guidance`: available_public; no_secret; read_only<br>`inference`: connector_spec; paid_api; wallet_or_paid_action | Keep ProofPilot provider-agnostic; disclose cost and data handling before inference. |
| [Google Gemini](https://ai.google.dev/) | Multimodal and Gemini ecosystem planning, provider comparison, and model inference. | `provider_guidance`: available_public; no_secret; read_only<br>`inference`: connector_spec; paid_api; wallet_or_paid_action | Keep ProofPilot provider-agnostic and separate AI Studio keys from cloud service identities. |
| [Meta Llama](https://developer.meta.com/ai/) | Open-model strategy, Llama ecosystem planning, provider comparison, and hosted inference options. | `provider_guidance`: available_public; no_secret; read_only<br>`inference`: connector_spec; paid_api; wallet_or_paid_action | Separate open-weight model evaluation from hosted API access, licensing, and inference cost. |
| [ElevenLabs](https://elevenlabs.io/docs) | Voice agents, speech products, audio demos, and provider feasibility. | `provider_guidance`: available_public; no_secret; read_only<br>`generation`: connector_spec; paid_api; wallet_or_paid_action | Use only for voice-specific plans and disclose consent, cost, and data risks. |

## Build Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Replit](https://docs.replit.com/) | Beginner-friendly prototyping and deployment when speed matters. | `platform_guidance`: available_public; no_secret; read_only<br>`account_build`: deferred; oauth; write_nonfinal | Recommend as a manual path first; do not assume stable automation APIs. |
| [Bolt.new](https://bolt.new/) | Fast web prototype paths for non-technical or time-constrained teams. | `manual_prototype`: catalogued; oauth; write_nonfinal | Treat as a manual user tool until a stable supported connector exists. |

## Deployment

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Vercel](https://vercel.com/docs) | Web deployment planning, public preview verification, and demo readiness. | `deployment_guidance`: available_public; no_secret; read_only<br>`deploy`: deferred; oauth; write_nonfinal | Verify public URLs without credentials first; defer automated deployment. |
| [Supabase](https://supabase.com/docs) | Fast prototype stacks using managed Postgres, auth, storage, and realtime. | `stack_guidance`: available_public; no_secret; read_only<br>`project_access`: deferred; service_identity; write_nonfinal | Treat service-role credentials as high risk and keep them out of client code. |
| [Cloudflare](https://developers.cloudflare.com/) | Edge applications, storage, databases, AI workloads, and deployment checks. | `platform_guidance`: available_public; no_secret; read_only<br>`resource_write`: deferred; api_token; write_nonfinal | Use scoped tokens per resource and defer automated resource creation. |

## Cloud Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [AWS, Bedrock, and Amplify](https://docs.aws.amazon.com/) | Cloud architecture, sponsored tracks, enterprise workloads, and managed AI services. | `architecture_guidance`: available_public; no_secret; read_only<br>`resource_access`: deferred; service_identity; wallet_or_paid_action | Use only after cost, region, IAM, and resource boundaries are explicit. |
| [Azure and Microsoft Foundry](https://learn.microsoft.com/azure/) | Enterprise applications, Microsoft ecosystem tracks, cloud AI, and deployment planning. | `architecture_guidance`: available_public; no_secret; read_only<br>`resource_access`: deferred; service_identity; wallet_or_paid_action | Use least-privilege Entra identities and defer automated resource creation. |
| [Google Cloud and Firebase](https://cloud.google.com/docs) | Firebase prototypes, Google Cloud workloads, Vertex AI, and sponsored tracks. | `architecture_guidance`: available_public; no_secret; read_only<br>`resource_access`: deferred; service_identity; wallet_or_paid_action | Separate public API keys from service identities and apply cost guardrails. |

## Web3 Scaffolds

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [solana.new](https://solana.new/) | Solana idea discovery, ecosystem research, local source-pack routing, starter templates, and scaffold selection. | `source_pack`: catalogued; no_secret; read_only<br>`scaffold_selection`: available_public; no_secret; read_only | Discover installed local skills and data first, refresh decision-relevant claims from current official sources, and keep execution in separately gated tools. |
| [Scaffold-ETH 2](https://scaffoldeth.io/) | EVM application scaffolding, learning, local development, and demo planning. | `scaffold_guidance`: available_public; no_secret; write_nonfinal<br>`deploy`: deferred; wallet_session; wallet_or_paid_action | Enable local planning and scaffolding; keep deployment behind wallet and cost approval. |
| [Base and OnchainKit](https://github.com/coinbase/onchainkit) | Base application architecture, wallet UX, identity, payments, and Coinbase ecosystem integration. | `stack_guidance`: available_public; no_secret; read_only<br>`connected_app`: deferred; api_token; write_nonfinal | Use guidance first; request developer credentials only for a selected integration. |
| [Sui developer tools](https://docs.sui.io/) | Sui architecture, Move development, local testing, and ecosystem-specific planning. | `developer_guidance`: available_public; no_secret; read_only<br>`deploy`: deferred; wallet_session; wallet_or_paid_action | Use official guidance; keep signing and deployment external and gated. |
| [Aptos developer tools](https://aptos.dev/) | Aptos architecture, Move development, local testing, and ecosystem-specific planning. | `developer_guidance`: available_public; no_secret; read_only<br>`deploy`: deferred; wallet_session; wallet_or_paid_action | Use official guidance; keep signing and deployment external and gated. |
| [Avalanche developer tools](https://build.avax.network/) | Avalanche application planning, local development, and ecosystem-specific architecture. | `developer_guidance`: available_public; no_secret; read_only<br>`deploy`: deferred; wallet_session; wallet_or_paid_action | Use official guidance and defer wallet or deployment actions. |
| [TON Blueprint and TON Connect](https://docs.ton.org/) | TON local development, contract testing, deployment planning, and wallet UX. | `developer_guidance`: available_public; no_secret; read_only<br>`wallet_connect`: deferred; wallet_session; wallet_or_paid_action | Never store a mnemonic. Use explicit external wallet signing for actions. |
| [Stellar developer tools](https://developers.stellar.org/) | Stellar application planning, payments, assets, Soroban development, and ecosystem fit. | `developer_guidance`: available_public; no_secret; read_only<br>`onchain_action`: deferred; wallet_session; wallet_or_paid_action | Use official guidance first and keep secret-key handling outside ProofPilot. |
| [Polkadot developer tools](https://docs.polkadot.com/) | Polkadot application planning, SDK selection, interoperability, and ecosystem fit. | `developer_guidance`: available_public; no_secret; read_only<br>`onchain_action`: deferred; wallet_session; wallet_or_paid_action | Use official documentation and treat emerging agent-specific tooling as catalogued until verified. |

## Web3 Intelligence

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [DefiLlama](https://defillama.com/) | DeFi market health, chain and category comparison, protocol traction, and integration risk context. | `public_market_data`: available_public; no_secret; read_only<br>`research_skill`: catalogued; no_secret; read_only | Check current public data before recommending a DeFi integration; treat TVL as one signal rather than proof of product demand or safety. |
| [Colosseum Copilot](https://docs.colosseum.com/copilot/getting-started) | Solana project similarity, winner patterns, archive research, gap analysis, and ecosystem context. | `project_research`: connector_spec; api_token; read_only | First-wave optional read connector. Use the documented read scope and honor rate and concurrency limits. |
| [ETHGlobal Skills](https://ethglobal.com/) | Ethereum hackathon project research, event requirements, sponsor tracks, and winner context. | `public_research`: available_public; no_secret; read_only<br>`external_skill`: connector_spec; no_secret; read_only | Use official event pages as the authority for current rules. Treat external skill availability as optional. |
| [BNB Chain AI and MCP tools](https://docs.bnbchain.org/) | BNB Chain research, architecture, and future agent or MCP workflows. | `official_guidance`: available_public; no_secret; read_only<br>`mcp_read`: catalogued; no_secret; read_only<br>`mcp_write`: deferred; wallet_session; wallet_or_paid_action | Use official docs now. Require source verification before enabling a third-party MCP and keep write actions deferred. |

## Web3 Action Tools

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Coinbase AgentKit](https://github.com/coinbase/agentkit) | Future agentic wallet and onchain action workflows. | `architecture_guidance`: available_public; no_secret; read_only<br>`onchain_action`: deferred; wallet_session; wallet_or_paid_action | Keep execution deferred until external signing, policy, limits, and audit logs exist. |
| [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) | Solana agent architecture, RPC, plugin, and future action workflows. | `architecture_guidance`: available_public; no_secret; read_only<br>`onchain_action`: deferred; wallet_session; wallet_or_paid_action | Use for planning only until external signing and explicit action policies exist. |

## Security

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [OpenZeppelin](https://docs.openzeppelin.com/) | Smart-contract patterns, controls, upgradeability, and security readiness. | `security_guidance`: available_public; no_secret; read_only | Enable by default for relevant EVM plans and reviews. |
| [Trail of Bits](https://github.com/trailofbits) | Threat modeling, secure development, smart-contract analysis, and security review procedures. | `security_guidance`: available_public; no_secret; read_only<br>`local_analysis`: catalogued; no_secret; read_only | Use relevant guidance and run local tools only when the artifact and environment permit it. |

## Safety Boundary

ProofPilot never asks for a private key, seed phrase, mnemonic, or raw secret in chat. Wallet, paid, deployment, resource-creation, and final-submission capabilities remain deferred until a specific action receives explicit approval and the runtime can enforce scope, limits, and audit logs.
