# First Use And Service Access

Colosseum Copilot is ProofPilot's required research foundation. Normal setup is complete only after a Colosseum PAT passes a read-scope authentication check. Other service connections are optional and requested only for a selected capability. This is ProofPilot's product policy, not a requirement imposed by Colosseum.

## Recommended Model Quality

Alongside the Colosseum setup explanation, tell the user that ProofPilot recommends models in the **SOL or Opus 5 class or higher** for higher-quality recommendations and assessments, where available in their host. This is ProofPilot's recommended usage level, not a verified comparative benchmark or a guarantee of correctness. Use the model names available in the host; do not invent a model identifier, claim to detect an unknown current model, or switch models automatically.

Suggested notice in Russian (translate for other users):

> Для более качественных рекомендаций используйте модели уровня SOL или Opus 5 и выше. Более простые модели могут пропускать важные детали и ошибаться в выводах; встроенные проверки помогают находить ошибки, но не компенсируют полностью ограничения модели.

Include this notice on first use or in an agent's installation-completion reply, even if a Colosseum key is already configured. Model choice is a recommendation, not an authentication/setup gate: continue if the user chooses a weaker model, preserving the same evidence and review requirements. Do not repeat the warning on every request. Model availability, usage limits and costs depend on the host's current plan; do not promise free access or a specific price.

## When To Run

At the first invocation of the main skill or any stage profile, explain setup in the user's language and inspect local setup status. All profiles share one credential store and verification state. On later invocations, reuse that state; do not repeat an account tutorial when access already works.

The repository installers print the setup instructions immediately after installation. A skill copied by an arbitrary installer cannot initiate an agent message by itself. If an agent is performing the installation, include the setup message in its completion reply; otherwise the conversation starts when the user invokes the skill. Do not claim a background hook or automatic account connection exists.

Keep the first message compact: include the model-quality notice above together with Colosseum's role and free member access, the Arena link and secure setup steps if missing, then one sentence that other services are optional and host/API costs are separate. Do not paste the whole service catalog. Explain optional services individually when the task selects them. Acknowledge the original idea, but defer its full research verdict until setup or the user's explicit limited-work choice.

Resolve the absolute installed skill directory from its SKILL.md. Run:

```bash
node "<absolute installed skill directory>/scripts/setup.js" --status
```

This command is offline and reports presence and verification state without revealing secrets. `configured` alone is insufficient. `verification_basis: cached` means a previous successful check, not a new API call. A cache is reusable for at most 24 hours, only for the same credential and before its reported expiry. Recheck stale, changed, rejected, or unverified access:

```bash
node "<absolute installed skill directory>/scripts/setup.js" --check-colosseum
```

This makes one read-only GET to the fixed official `/status` endpoint. It requires `authenticated: true`, scope `colosseum_copilot:read`, and no expired or malformed reported expiry. It does not search the corpus or prove every operation works. The packaged research helper checks status again before each corpus read.

## If A Key Is Missing

Give these steps with the actual installed command path, without collecting the token in the conversation:

1. Open [Colosseum Arena → Copilot](https://colosseum.com/arena/copilot), sign in or create an Arena account.
2. Generate a Personal Access Token. It is shown once. Keep it privately; do not paste it into chat.
3. In the user's interactive terminal, run the command below and paste the token into its hidden input. The agent may open a terminal, but the user types the secret directly; do not send it as a tool argument or shell command.
4. Run `--check-colosseum`. Once access is verified, continue the user's original task.

```bash
node "<absolute installed skill directory>/scripts/setup.js" --configure-colosseum
node "<absolute installed skill directory>/scripts/setup.js" --check-colosseum
```

The helper requires Node.js 20+; its live check needs curl. Configuration works only in an interactive TTY and performs no network call. It writes a private local file (mode 600), not an encrypted vault: `~/.config/proofpilot/credentials.json`. A user who needs managed storage can supply `COLOSSEUM_COPILOT_PAT` through their host's secret mechanism instead. `PROOFPILOT_CONFIG_DIR` overrides ProofPilot's own directory. Never put credentials in a repository or ask to inspect their contents in model context.

The command shown for the user's secret entry must run Node directly in their interactive terminal. Output-capturing wrappers or pipes can remove TTY support; if the helper refuses noninteractive input, preserve that boundary and show the direct command. Do not work around it by piping or passing the secret to an agent tool.

Existing credentials are reused in this order: `COLOSSEUM_COPILOT_PAT` → ProofPilot's own file → legacy `~/.superstack/config.json` (`copilotToken`). Do not overwrite the legacy file, run wrapper telemetry/setup, or rotate a working token. An environment credential takes precedence over a newly saved one. Configure in the same account/environment where the agent runs. Revoke or replace a token through Arena; observe actual `expiresAt`, rather than assuming a key remains valid indefinitely.

Without verified access, say **“Настройка ProofPilot не завершена: нужен доступ к Colosseum”** (or translate). Offer the next setup step and keep the original task pending. If the user explicitly declines connection or requests offline/limited work, do only that requested limited work, label the missing research coverage, and keep setup incomplete. Do not silently treat public browsing as completed onboarding, repeatedly nag after an explicit choice, or block unrelated narrow edits.

For 401, request checking/replacing the unauthorized credential through Arena. A 403 is an access rejection with an unresolved cause; do not call it token expiry. For 429, wait within the documented rate policy; do not retry automatically or pay. Network failure and non-JSON responses leave verification incomplete. Use the documented ordinary curl transport; do not spoof clients, bypass access controls, or redirect a Bearer token to another host.

For persistent 403, confirm the reported credential source and documented fixed-host helper were used, then consult the official [authentication guide](https://docs.colosseum.com/copilot/authentication) and [FAQ](https://docs.colosseum.com/copilot/faq). If provider help is needed, prepare only the endpoint, UTC timestamp, HTTP status and transport used; exclude the token, config contents and authorization headers. Do not invent a support address or replace the key merely because access is forbidden.

## What Costs Money

Explain this short overview on first use, then load only the relevant service card from [service-access.json](service-access.json) for exact acquisition steps and official links. Pricing and access review: 2026-09-05; refresh current terms before a future cost-sensitive recommendation or paid action.

| Access | Needed for setup? | Cost boundary |
|---|---|---|
| Colosseum Arena Copilot PAT | **Required** | Free for Arena members, subject to rate limits. |
| GitHub, Kaggle, Hugging Face | Optional | Public research first; scoped account access for specific resources. Paid compute and other products are separate. |
| DefiLlama | Optional, no key for Free API | Public analytics are free; Pro API is a separate paid service. |
| ETHGlobal Skills | Optional, no key for free reads | Published free rate allowance; stop at 402. No automatic wallet/payment setup. |
| OpenAI / Claude API | Optional | Separate API billing. No extra API key is needed merely to use ProofPilot inside an already authenticated Codex/Claude Code host. |
| Gemini API | Optional | Some model-specific free tiers; paid features and data-use terms must be checked. |
| Replit MCP | Optional OAuth | Account plan and Agent/cloud usage apply. Use `list_apps` for access checking; Agent questions may be billable. |

The [official Colosseum FAQ](https://docs.colosseum.com/copilot/faq) confirms free member access. Claude Code/Codex host subscriptions, limits, and model usage are separate. Do not promise the complete agent session is free because the research API is free. A configured key never grants permission to spend money.

For a selected optional service, state why it is needed, the minimum scope, secure setup/storage and revocation route, free alternative, and paid boundary. Do not ask the user to obtain all catalogued keys. Web references such as Sequoia, YC and official program pages require no extra service key.

## Use Colosseum As The Foundation

After setup, begin relevant project/precedent/archival research with Colosseum, then add sources suited to the actual market and technology. Colosseum is especially useful for Solana ventures, projects, past attempts and ecosystem context. It is not a comprehensive global competitor database. For an unrelated market, explain the coverage limitation and prioritize relevant domain evidence; do not force irrelevant corpus searches just to check a box.

Use the packaged `scripts/colosseum-read.js` (`--help` lists its fixed read operations), which resolves the same local credential without exposing it to the model. The upstream skill does not automatically understand ProofPilot's private credential file. Both paths use Colosseum's official API; no separate proprietary client is needed. The helper implements bounded reads, not every upstream Deep Dive feature.

Keep the user's artifacts authoritative for their actual demand, retention and economics. Verify current program rules on official program pages. A hackathon listing, winner, empty search, or successful token check cannot prove demand, current product activity, or an absence of competitors. Respect sensitivity and evaluator source restrictions before sending any research query. Setup does not authorize uploading private project material.
