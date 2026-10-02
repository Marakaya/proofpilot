# Included Tools

> Generated from the ProofPilot source and tool registries. Run `npm run generate:docs` after registry changes.

ProofPilot distinguishes public references from connector specifications and implemented integrations. A listed tool is not automatically an active API connector.

## Status Meanings

| Status | Meaning |
|---|---|
| `available_public` | A public access route is documented; check the selected page and host availability before use. |
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
| Runtime-selected primary project, competitor or provider source | runtime_selected | `runtime_input` | Specific primary claims absent from the named registry. Separate self-reported vendor claims from observed project behavior; broad provider benchmarks do not establish project quality or demand. |
| Local community archive | platform | `platform_only` | Local demand, repeated project patterns, prior feedback, and ecosystem-specific context. |
| [GitHub](https://github.com/) | public_or_connected | `available_public` | Comparable implementations, repository activity, shipped proof, documentation quality, issues, and licenses. |
| [DefiLlama](https://defillama.com/) | public | `available_public` | DeFi market health, protocol traction, chain comparison, and ecosystem context. |
| [YC Library and Startup School](https://www.ycombinator.com/library) | public | `available_public` | Founder operating principles, customer discovery, MVP discipline, launch, and fundraising context. |
| [garrytan/gstack](https://github.com/garrytan/gstack) | public | `available_public` | Founder-role decomposition and specialist workflow patterns. |
| [Sequoia Capital public PMF and founder methods](https://sequoiacap.com/article/pmf-framework-2) | public | `available_public` | Choose and interpret experiments. Never use investor authority, portfolio examples or macro forecasts as evidence of this project's demand, retention, economics or eligibility. |
| [Founder Institute](https://fi.co/) | public | `available_public` | Founder readiness, idea validation, market framing, and structured progression. |
| [Devpost](https://devpost.com/) | public | `available_public` | Project patterns, judging criteria, prize tracks, required fields, and public demos. |
| [Colosseum Copilot](https://github.com/ColosseumOrg/colosseum-copilot/blob/079bd44b0d4d221d6a893764d8ec6f5f4845707e/README.md) | connected | `implemented` | Solana project similarity, winner patterns, archive evidence, gap analysis, and accelerator context. |
| [ETHGlobal](https://ethglobal.com/) | public | `available_public` | Ethereum hackathon projects, event requirements, sponsors, prizes, and submission patterns. |
| [Kaggle](https://www.kaggle.com/) | public_or_connected | `available_public` | Dataset availability, benchmark conventions, notebooks, and competition requirements. |
| [Hugging Face](https://huggingface.co/) | public_or_connected | `available_public` | Model and dataset availability, licenses, benchmarks, demos, and comparable AI products. |
| [OpenZeppelin](https://docs.openzeppelin.com/) | public | `available_public` | Smart-contract patterns, security controls, upgradeability, and implementation readiness. |
| [Trail of Bits](https://github.com/trailofbits) | public | `available_public` | Threat modeling, secure development, smart-contract analysis, and review procedures. |
| [Official Solana developer documentation](https://solana.com/docs/frontend) | public | `available_public` | Frontend stack and integration guidance; documentation does not prove a scaffold builds, a wallet works or a deployment is safe. |

## Freshness Review

A review date includes partial or blocked checks. The last verified date covers only verification.claims and reference_checks. An isolated successful API request does not mean a packaged adapter or every capability works.

| Tool | Reviewed | Page access | Content | Last verified | API probe status |
|---|---|---|---|---|---|
| GitHub | 2026-09-05 | reachable | confirmed | 2026-09-05 | verified; recorded probes: 2026-09-05T13:41:31.397448+00:00: HTTP 200, GET https://api.github.com/repos/Marakaya/proofpilot |
| YC Library and Startup School | 2026-09-05 | partial | partial | 2026-09-05 | not_applicable |
| garrytan/gstack | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Founder Institute | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_applicable |
| Sequoia public methods and Arc program | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_applicable |
| First Round Review | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_applicable |
| Andreessen Horowitz | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_applicable |
| 500 Global | 2026-09-05 | reachable | partial | 2026-09-05 | not_applicable |
| Techstars and Startup Weekend | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_applicable |
| Antler | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_applicable |
| Entrepreneurs First | 2026-09-05 | reachable | corrected | 2026-09-05 | not_applicable |
| Devpost | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Major League Hacking | 2026-09-05 | reachable | corrected | 2026-09-05 | not_applicable |
| Lablab.ai | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_applicable |
| Kaggle | 2026-09-05 | partial | partial | 2026-09-05 | not_tested |
| Hugging Face | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| NASA Open APIs and Space Apps | 2026-09-05 | partial | confirmed | 2026-09-05 | not_tested |
| Hack Club | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_applicable |
| OpenAI | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Anthropic | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Google Gemini | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Meta Llama | 2026-09-05 | partial | partial | 2026-09-05 | not_tested |
| ElevenLabs | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Databricks | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Elastic | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Replit | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Bolt.new | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Vercel | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Supabase | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Cloudflare | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| AWS, Bedrock, and Amplify | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Azure and Microsoft Foundry | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Google Cloud and Firebase | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| solana.new | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| DefiLlama | 2026-09-05 | reachable | corrected | 2026-09-05 | verified; recorded probes: 2026-09-05: HTTP 200, GET https://api.llama.fi/v2/chains |
| Colosseum Copilot | 2026-10-01 | reachable | corrected | 2026-10-01 | not_tested; recorded probes: 2026-09-05T13:57:08.305165+00:00: HTTP 403, GET https://copilot.colosseum.com/api/v1/status; 2026-09-05: HTTP 403, GET https://copilot.colosseum.com/api/v1/filters; 2026-09-05T15:31:28.996288+00:00: HTTP 200, GET https://copilot.colosseum.com/api/v1/status; 2026-09-05: HTTP 200, GET https://copilot.colosseum.com/api/v1/filters; 2026-09-05T16:09:57.823Z: HTTP 200, GET https://copilot.colosseum.com/api/v1/status |
| ETHGlobal Skills | 2026-09-05 | reachable | confirmed | 2026-09-05 | verified; recorded probes: 2026-09-05: HTTP 200, GET https://ethglobalskills.vercel.app/api/sponsors?keyword=uniswap |
| Scaffold-ETH 2 | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Base developer tools and legacy OnchainKit migration | 2026-09-05 | partial | corrected | 2026-09-05 | not_tested |
| Coinbase AgentKit | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Solana Agent Kit | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| OpenZeppelin | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Trail of Bits | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Sui developer tools | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Aptos developer tools | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| BNB Chain AI and MCP tools | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Avalanche developer tools | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| TON Acton and TON Connect (Blueprint legacy) | 2026-09-05 | reachable | corrected | 2026-09-05 | not_tested |
| Stellar developer tools | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |
| Polkadot developer tools | 2026-09-05 | reachable | confirmed | 2026-09-05 | not_tested |

Read the entry's reference_checks, runtime_probes and freshness_review.limitations before using a claim. Runtime-selected project artifacts and target programs require a fresh check during the actual task.

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
| [Sequoia public methods and Arc program](https://sequoiacap.com/arc) | Public PMF diagnosis through product-market-fit.md; Arc program selection through accelerator-programs.json. | `framework_reference`: available_public; no_secret; read_only | Use source sequoia_pmf for methodology. Keep Arc open-call eligibility separate from PMF guidance; do not treat guidance as project proof or an internal investment rubric. |
| [First Round Review](https://review.firstround.com/) | Early customer signals, product-market fit, hiring, and operating practices. | `framework_reference`: available_public; no_secret; read_only | Use as secondary framework guidance with attribution. |
| [Andreessen Horowitz](https://a16z.com/) | Company building, go-to-market, fundraising context, and domain-specific founder guidance. | `framework_reference`: available_public; no_secret; read_only | Use as an attributed framework source, not as primary evidence of customer demand. |
| [500 Global](https://500.co/founders) | Founder education, accelerator preparation, startup evaluation context, and global program discovery. | `program_reference`: available_public; no_secret; read_only | Use current regional program pages for applications and general material for coaching. |
| [Techstars and Startup Weekend](https://www.techstars.com/) | Mentor-driven validation, weekend-style MVP scope, and accelerator preparation. | `program_reference`: available_public; no_secret; read_only | Use current program pages for applications and general material for coaching. |
| [Antler](https://www.antler.co/) | Founder-market fit, team formation, and accelerator context. | `program_reference`: available_public; no_secret; read_only | Use current regional program pages for application requirements. |
| [Entrepreneurs First](https://www.joinef.com/) | Founder edge, cofounder formation, and pre-idea accelerator preparation. | `program_reference`: available_public; no_secret; read_only | Use as an attributed framework and verify current cohort requirements separately. |

## Hackathon Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Devpost](https://devpost.com/) | Public project comparisons, event criteria, prize tracks, submission fields, and demo patterns. | `public_research`: available_public; no_secret; read_only<br>`submission`: deferred; oauth; final_submit | Draft and review submissions; keep final submission manual and user-controlled. |
| [Major League Hacking](https://www.mlh.com/) | Beginner hackathon expectations, event rules, organizer patterns, and participant guidance. | `program_reference`: available_public; no_secret; read_only | Use current event rules for submissions and general guidance for workflow design. |
| [Lablab.ai](https://lablab.ai/) | AI hackathon formats, provider-driven challenges, public projects, and submission patterns. | `public_research`: available_public; no_secret; read_only | Use public pages first; treat provider access as a separate capability. |

## Data Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Kaggle](https://www.kaggle.com/) | Datasets, notebooks, benchmarks, competitions, and reproducible ML examples. | `public_research`: available_public; no_secret; read_only<br>`account_api`: connector_spec; api_token; read_only | Use read-only public data first and request a user token only for a named account task. Current official CLI is Kaggle/kaggle-cli (the kaggle-api repository redirects there). Select OAuth, a current API token, or legacy credentials as documented; selected public dataset flows work without login. A configured credential is not a verified session. |
| [NASA Open APIs and Space Apps](https://api.nasa.gov/) | Open-data ideas, scientific datasets, civic and space challenges, and public API feasibility. | `public_reference`: available_public; no_secret; read_only<br>`api_access`: connector_spec; api_token; read_only | Use official challenge and dataset pages; request an API key only for execution. |
| [Databricks](https://docs.databricks.com/) | Enterprise data, ML, lakehouse, and agent or data application planning. | `platform_guidance`: available_public; no_secret; read_only<br>`workspace_access`: deferred; service_identity; read_only | Recommend only when the data scale or sponsor context justifies the platform. |
| [Elastic](https://www.elastic.co/docs) | Search, retrieval, RAG, observability, and AI search product planning. | `platform_guidance`: available_public; no_secret; read_only<br>`connected_cluster`: deferred; api_token; read_only | Use when search or retrieval is core to the MVP, not as default infrastructure. |

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
| [OpenAI](https://developers.openai.com/api/docs) | AI architecture planning, provider comparison, model inference, and evaluation design. | `provider_guidance`: available_public; no_secret; read_only<br>`inference`: connector_spec; paid_api; wallet_or_paid_action | Keep ProofPilot provider-agnostic. Read current official evaluation, pricing and data-handling docs only when relevant; public docs are not an inference permission or project-quality proof. Disclose cost and data scope before authorized inference. |
| [Anthropic](https://platform.claude.com/docs/en/home) | AI architecture planning, provider comparison, model inference, and evaluation design. | `provider_guidance`: available_public; no_secret; read_only<br>`inference`: connector_spec; paid_api; wallet_or_paid_action | Keep ProofPilot provider-agnostic. Read current official evaluation, pricing and data-handling docs only when relevant; public docs are not an inference permission or project-quality proof. Disclose cost and data scope before authorized inference. |
| [Google Gemini](https://ai.google.dev/) | Multimodal and Gemini ecosystem planning, provider comparison, and model inference. | `provider_guidance`: available_public; no_secret; read_only<br>`inference`: connector_spec; paid_api; wallet_or_paid_action | Keep ProofPilot provider-agnostic. Read current official evaluation, pricing and data-handling docs only when relevant; public docs are not an inference permission or project-quality proof. Disclose cost and data scope before authorized inference. For Gemini, verify the project's free or paid tier and its data-use terms. Use the current authorization-key guidance; standard-key rejection is documented for September 2026, with no exact day specified. |
| [Meta Llama](https://developer.meta.com/ai/) | Open-model strategy, Llama ecosystem planning, provider comparison, and hosted inference options. | `provider_guidance`: available_public; no_secret; read_only<br>`inference`: catalogued; paid_api; wallet_or_paid_action | Keep ProofPilot provider-agnostic. Read current official evaluation, pricing and data-handling docs only when relevant; public docs are not an inference permission or project-quality proof. Disclose cost and data scope before authorized inference. Public model resources were verified in the official meta-llama/llama-models repository. The hosted Llama API, current access conditions and pricing could not be verified from the JavaScript-only developer landing page; resolve them before planning this connector. |
| [ElevenLabs](https://elevenlabs.io/docs) | Voice agents, speech products, audio demos, and provider feasibility. | `provider_guidance`: available_public; no_secret; read_only<br>`generation`: connector_spec; paid_api; wallet_or_paid_action | Keep ProofPilot provider-agnostic. Read current official evaluation, pricing and data-handling docs only when relevant; public docs are not an inference permission or project-quality proof. Disclose cost and data scope before authorized inference. |

## Build Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Replit](https://docs.replit.com/) | Beginner-friendly prototyping and deployment when speed matters. | `platform_guidance`: available_public; no_secret; read_only<br>`account_build`: deferred; oauth; write_nonfinal | Use the documented optional Replit MCP at https://replit-mcp.com/server/mcp with Streamable HTTP and OAuth discovery when account automation is needed. Verify access with list_apps(limit: 1) after workspace authorization; a successful read does not verify or authorize creation, Agent work, publication or charges. Keep account_build deferred until its exact action is requested. |
| [Bolt.new](https://bolt.new/) | Fast web prototype paths for non-technical or time-constrained teams. | `manual_prototype`: catalogued; oauth; write_nonfinal | Treat as a manual user tool until a stable supported connector exists. |

## Deployment

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [Vercel](https://vercel.com/docs) | Web deployment planning, public preview verification, and demo readiness. | `deployment_guidance`: available_public; no_secret; read_only<br>`deploy`: deferred; oauth; write_nonfinal | Verify public URLs without credentials first; defer automated deployment. |
| [Supabase](https://supabase.com/docs) | Fast prototype stacks using managed Postgres, auth, storage, and realtime. | `stack_guidance`: available_public; no_secret; read_only<br>`project_access`: deferred; oauth; write_nonfinal | Treat secret keys and legacy service_role keys as high risk: they bypass RLS and must stay out of client code. Prefer current publishable/secret keys. For project management, use the Management API's scoped OAuth2 or explicitly approved access-token flow; do not substitute a data-plane service_role key. |
| [Cloudflare](https://developers.cloudflare.com/) | Edge applications, storage, databases, AI workloads, and deployment checks. | `platform_guidance`: available_public; no_secret; read_only<br>`resource_write`: deferred; api_token; write_nonfinal | Use scoped tokens per resource and defer automated resource creation. |

## Cloud Platforms

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [AWS, Bedrock, and Amplify](https://docs.aws.amazon.com/) | Cloud architecture, sponsored tracks, enterprise workloads, and managed AI services. | `architecture_guidance`: available_public; no_secret; read_only<br>`resource_access`: deferred; service_identity; wallet_or_paid_action | Use only after cost, region, IAM, and resource boundaries are explicit. |
| [Azure and Microsoft Foundry](https://learn.microsoft.com/azure/) | Enterprise applications, Microsoft ecosystem tracks, cloud AI, and deployment planning. | `architecture_guidance`: available_public; no_secret; read_only<br>`resource_access`: deferred; service_identity; wallet_or_paid_action | Use least-privilege Entra identities and defer automated resource creation. |
| [Google Cloud and Firebase](https://docs.cloud.google.com/docs) | Firebase prototypes, Google Cloud workloads, Gemini Enterprise Agent Platform (formerly Vertex AI), and sponsored tracks. | `architecture_guidance`: available_public; no_secret; read_only<br>`resource_access`: deferred; service_identity; wallet_or_paid_action | Separate public API keys from service identities and apply cost guardrails. |

## Web3 Scaffolds

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [solana.new](https://solana.new/) | Solana idea discovery, ecosystem research, local source-pack routing, starter templates, and scaffold selection. | `source_pack`: catalogued; no_secret; read_only<br>`scaffold_selection`: available_public; no_secret; read_only | Discover installed skills and data first. For new frontends consult source solana_docs and solana-new.md for Kit defaults; inspect existing dependency compatibility before migration. Keep execution in separately authorized tools. |
| [Scaffold-ETH 2](https://scaffoldeth.io/) | EVM application scaffolding, learning, local development, and demo planning. | `scaffold_guidance`: available_public; no_secret; write_nonfinal<br>`deploy`: deferred; wallet_session; wallet_or_paid_action | Enable local planning and scaffolding; keep deployment behind wallet and cost approval. |
| [Base developer tools and legacy OnchainKit migration](https://github.com/coinbase/onchainkit) | Base application architecture, wallet UX, identity, payments, and Coinbase ecosystem integration. | `stack_guidance`: available_public; no_secret; read_only<br>`connected_app`: deferred; api_token; write_nonfinal | Use current Base guidance for new plans. Treat OnchainKit as an existing-stack migration/reference path; inspect official wagmi/viem migration guidance before selecting it. Request credentials only for a selected account-backed service. |
| [Sui developer tools](https://docs.sui.io/) | Sui architecture, Move development, local testing, and ecosystem-specific planning. | `developer_guidance`: available_public; no_secret; read_only<br>`deploy`: deferred; wallet_session; wallet_or_paid_action | Use official guidance and current gRPC or GraphQL data interfaces. Foundation Mainnet JSON-RPC is disabled; verify provider compatibility. Keep signing and deployment external and gated. |
| [Aptos developer tools](https://aptos.dev/) | Aptos architecture, Move development, local testing, and ecosystem-specific planning. | `developer_guidance`: available_public; no_secret; read_only<br>`deploy`: deferred; wallet_session; wallet_or_paid_action | Use official guidance; keep signing and deployment external and gated. |
| [Avalanche developer tools](https://build.avax.network/) | Avalanche application planning, local development, and ecosystem-specific architecture. | `developer_guidance`: available_public; no_secret; read_only<br>`deploy`: deferred; wallet_session; wallet_or_paid_action | Use official guidance and defer wallet or deployment actions. |
| [TON Acton and TON Connect (Blueprint legacy)](https://docs.ton.org/) | TON local development, contract testing, deployment planning, and wallet UX. | `developer_guidance`: available_public; no_secret; read_only<br>`wallet_connect`: deferred; wallet_session; wallet_or_paid_action | Prefer current Tolk/Acton guidance for new TON contracts; retain Blueprint for compatible existing projects. Never store a mnemonic; use explicit external wallet signing for actions. |
| [Stellar developer tools](https://developers.stellar.org/) | Stellar application planning, payments, assets, Soroban development, and ecosystem fit. | `developer_guidance`: available_public; no_secret; read_only<br>`onchain_action`: deferred; wallet_session; wallet_or_paid_action | Use official guidance first and keep secret-key handling outside ProofPilot. |
| [Polkadot developer tools](https://docs.polkadot.com/) | Polkadot application planning, SDK selection, interoperability, and ecosystem fit. | `developer_guidance`: available_public; no_secret; read_only<br>`onchain_action`: deferred; wallet_session; wallet_or_paid_action | Use official documentation and treat emerging agent-specific tooling as catalogued until verified. |

## Web3 Intelligence

| Tool | Used For | Capabilities | Decision |
|---|---|---|---|
| [DefiLlama](https://defillama.com/) | DeFi market health, chain and category comparison, protocol traction, and integration risk context. | `public_market_data`: available_public; no_secret; read_only<br>`research_skill`: catalogued; no_secret; read_only | Use documented free endpoints on api.llama.fi for public research; distinguish paid Pro-only endpoints. Treat TVL as one signal rather than proof of demand or safety. |
| [Colosseum Copilot](https://github.com/ColosseumOrg/colosseum-copilot/blob/079bd44b0d4d221d6a893764d8ec6f5f4845707e/README.md) | Solana project similarity, winner patterns, archive research, gap analysis, and ecosystem context. | `project_research`: implemented; oauth; read_only | Colosseum is required for completed research setup. Use official Copilot Connect browser/device sign-in, setup.js and the fixed-route V2 read helper. Saved local state does not prove evidence access. Local contract/transport tests passed; authenticated V2 operations remain untested. Historical V1 probes do not verify V2. Conversational scope is the default; broader upstream features and optional service connections are separate. |
| [ETHGlobal Skills](https://ethglobal.com/) | Ethereum hackathon project research, event requirements, sponsor tracks, and winner context. | `public_research`: available_public; no_secret; read_only<br>`external_skill`: connector_spec; no_secret; read_only<br>`paid_research`: deferred; wallet_session; wallet_or_paid_action | Use current official event pages for rules. An installed skill may use only the free read path within its documented limit. On HTTP 402/payment required, stop or use public pages; never install AgentCash, fund a wallet or pay automatically. API responses are research leads; verify binding rules on the named official event page. The corpus repository governance was not independently established. Live version header 1.1.0 differs from upstream/local SKILL 1.0.0; inspect the current contract instead of assuming reinstall fixes it. |
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
