# First Use And Service Access

Colosseum Copilot is ProofPilot's required research foundation. Normal setup is complete only after an authenticated API V2 status response confirms evidence read access. Connect with the official Copilot Connect helper using browser PKCE or device sign-in; no PAT is required. Other services are optional and requested only for a selected capability. This is ProofPilot's product policy, not a requirement imposed by Colosseum.

## Recommended Model Quality

Alongside the Colosseum setup explanation, tell the user that ProofPilot recommends models in the **SOL or Opus 5 class or higher** for higher-quality recommendations and assessments, where available in their host. This is ProofPilot's recommended usage level, not a verified comparative benchmark or a guarantee of correctness. Use the model names available in the host; do not invent a model identifier, claim to detect an unknown current model, or switch models automatically.

Suggested notice in Russian (translate for other users):

> Для более качественных рекомендаций используйте модели уровня SOL или Opus 5 и выше. Более простые модели могут пропускать важные детали и ошибаться в выводах; встроенные проверки помогают находить ошибки, но не компенсируют полностью ограничения модели.

Include this notice on first use or in an agent's installation-completion reply, even if a Colosseum connection is already configured. Model choice is a recommendation, not an authentication/setup gate: continue if the user chooses a weaker model, preserving the same evidence and review requirements. Do not repeat the warning on every request. Model availability, usage limits and costs depend on the host's current plan; do not promise free access or a specific price.

## When To Run

First route the task. Local capability inventory and scoped implementation, debugging, or testing from an existing specification do not need Colosseum research. Skip account inspection for these tasks and continue the requested work; use current official technical docs when needed. This does not mark research setup complete. If the task also needs project/market research, apply onboarding to that research.

At the first research invocation of the main skill or any stage profile, explain setup in the user's language and inspect local status. All profiles use the same official helper account/storage. Reuse a working connection without repeating browser approval.

Repository installers print setup instructions. A skill copied by an arbitrary installer cannot initiate an agent message by itself. An agent performing installation includes setup in its completion reply; otherwise the user invokes the skill. Do not claim an automatic account connection exists.

Keep the first message compact: include the model-quality notice, Colosseum's role, secure sign-in if missing, and one sentence that other connections are optional and host/API costs are separate. Explain optional services when selected. Preserve the original task during connection.

## Welcome And Connection Flow

Use a two-message welcome in the user's language: explain the included Colosseum skill and authorize access first; after verified access, describe the installed package and continue the original task. Show this introduction once in the conversation, on installation completion by an agent or the first relevant invocation. A returning user with working access skips the sign-in invitation. Do not repeat the welcome for every request or create a new readiness cache.

Check the actual support inventory before saying Colosseum Copilot is included. A full installation includes it already; do not ask the user to install it again. A core-only, incomplete or no-install copy must describe its actual state and follow [installation.md](installation.md) without overriding that preference. Local capability questions and scoped work from provided materials remain available without sign-in; do not withhold the catalog until authorization.

The project-count wording below is a dated coverage claim: on 2026-10-02 the [official Copilot page](https://colosseum.com/copilot) listed 8,286 Colosseum hackathon projects. Use "more than 8,000" in the welcome while that source remains applicable. Do not treat the separate The Grid product count as this corpus, suggest comprehensive global competitor coverage, or infer market demand from project records. Refresh or omit the number if later evidence contradicts it; do not make a network request solely to repeat the welcome on every invocation.

### Before Authorization

For a full installation with missing access, use this Russian example, adapting only the actual installation/access state and language:

> **В пакет ProofPilot входит скилл Colosseum Copilot**, который открывает доступ к базе **более 8 000 проектов с хакатонов Colosseum**.
>
> Рекомендуем использовать его для поиска идей и анализа конкурентов. Он поможет найти похожие решения, изучить подходы других команд и понять, чем твой продукт может отличаться. Особенно полезна эта база для Solana и web3.
>
> **Чтобы скилл начал работать, нужно зарегистрироваться в Colosseum и авторизовать доступ для Copilot.** Если аккаунт уже есть, достаточно войти в него и подтвердить подключение.
>
> Напиши **«Подключи Colosseum»** — я запущу официальный помощник и открою страницу авторизации в браузере. Ты войдёшь или зарегистрируешься, ознакомишься с запрашиваемым доступом и подтвердишь его. После этого я проверю подключение и продолжу твою задачу. Копировать ключи в чат не потребуется.
>
> Для сложных исследований и оценок рекомендуются модели уровня SOL или Opus 5 и выше. Другие подключения нужны только для отдельных задач; тарифы агента и внешних API зависят от их провайдеров.

If the user already authorized connection, explain that the browser will open and run the approved helper instead of asking them to repeat the phrase. The helper command below owns authorization; never approve the browser consent on the user's behalf. Leave optional question/answer sharing to the user's choice and do not upload conversations from this connector. Run one login and wait for it to finish; do not start another login or run status while that login is pending. Remote/device sign-in follows the same user approval and final verification requirements. Preserve the user's goal throughout.

Do not announce connection based on installation, stored credentials or browser approval alone. Use the authenticated V2 check below. A transport/service failure does not justify deleting credentials or restarting login. A declined connection leads to the explicitly limited/offline scope, with research setup still incomplete.

### After Verified Access

Before describing included skills, resolve the absolute installed main/profile directory and its parent skill root, then run the account-free inventory:

```bash
node "<absolute installed skill directory>/scripts/discover-sources.js" --root "<absolute parent skill root>" --capabilities
```

Use `support_bundle.skills` and their installed statuses for the actual names and count. The main ProofPilot router supports five venture stages; its five separately installable profiles are not part of the 36 support skills. Installed guidance does not establish availability of a compiler, API connection or host plugin. Use the full-package example only when that package is present, and adapt it for core-only or incomplete installations.

> **Colosseum подключён! Теперь расскажу, что ещё умеет ProofPilot.**
>
> В полной установке есть **36 вспомогательных скиллов**, которые помогают пройти путь от идеи до разработки и подготовки к запуску:
>
> - **Найти и проверить идею:** изучить конкурентов, определить целевую аудиторию и спланировать проверку спроса.
> - **Спланировать MVP:** выбрать функции первой версии, составить план работ и определить критерии успеха.
> - **Разработать продукт на Solana:** подготовить проект, написать смарт-контракт, приложение, DeFi-протокол или систему обработки данных.
> - **Улучшить дизайн:** разработать визуальный стиль, интерфейс и анимации.
> - **Проверить продукт и код:** найти ошибки, оценить удобство, выявить риски безопасности и недостающие подтверждения готовности.
> - **Подготовить материалы:** собрать питч, презентацию, заявку на грант или хакатон, сценарий демо и маркетинговое видео.
> - **Разобраться в технологии:** изучить основы Solana и сохранить выводы, полезные для дальнейшей работы.
>
> Обращайся обычным языком — я выберу подходящие скиллы под задачу. Например: **«Проверь мою идею»**, **«Спланируй MVP на две недели»** или **«Помоги написать смарт-контракт»**.
>
> Чтобы посмотреть названия и назначение всех скиллов, напиши **«Покажи состав ProofPilot»**.

If the task is already known, immediately continue it after this overview rather than asking the user to restate it or choose a stage. If access was already verified, use a short existing-connection acknowledgment in place of a new-connection claim; include the model recommendation once if it has not yet been shown. For a catalog request, group the actual installed names by user-facing capability, and distinguish skills from source catalogs, methodological references and optional services. Read [solana-new.md](solana-new.md) for discovery paths and implementation routing. Do not imply that a skill named `build-with-claude` authorizes another AI provider or that installation authorizes payments, deployment or final submission.

## Connection Commands

Resolve the absolute installed skill directory from its SKILL.md:

```bash
node "<absolute installed skill directory>/scripts/setup.js" --status
```

This is offline: it invokes official helper `status --local`, without refreshing or revealing credentials. Saved credentials and `configured_unverified` do not prove server access. There is no ProofPilot verification cache. Check an existing connection:

```bash
node "<absolute installed skill directory>/scripts/setup.js" --check-colosseum
```

ProofPilot first checks for trusted curl. The helper then privately obtains/renews access, and ProofPilot makes a fixed-host API V2 GET `/status`. Require `authenticated: true`, current `scope` containing `evidence:read` (legacy alias `copilot:retrieval`), and no expired or malformed reported expiry. An explicitly disabled evidence capability blocks readiness. Saved helper scopes alone are insufficient. The packaged research helper checks this before each bounded corpus read.

## If A Connection Is Missing

Give the actual installed command path:

```bash
node "<absolute installed skill directory>/scripts/setup.js" --connect-colosseum
```

The command uses official `@colosseum-org/copilot-connect@0.2.2 login` from an isolated directory with independent empty npm configuration. Caller-project packages and npmrc files cannot select a different helper. The managed helper path must have a non-symlinked, non-writable directory chain owned by the current user; an unsafe preseeded tree is rejected. It may download that pinned helper through npm, opens a browser, and uses PKCE with a local callback. The user signs in to their Colosseum account and reviews the requested access. Browser approval alone is insufficient; the command checks authenticated V2 evidence access afterward.

For SSH, remote environments, or a blocked browser callback, use `--connect-colosseum --device`. Show its device link/code only to the signed-in user; never ask them to paste a code or token into chat. The user completes approval in the browser. Node.js 20+, npm and curl are required. The full support installer prepares a validated managed copy of the helper without sign-in or lifecycle scripts. Offline status only inspects and directly runs an existing validated copy; for a standalone copy, complete [installation.md](installation.md) first or give the connect command above.

Credentials and refresh rotation belong to the official helper's OS credential store or its supported protected file fallback. Do not invent a plaintext store, inspect saved contents, copy credentials to another environment, or collect secrets in chat, logs, argv or environment variables. ProofPilot transfers bearer authorization privately between helper and curl; no token is returned to the agent.

Live requests accept curl only through the verified system search path. On POSIX, every directory in the resolved PATH entry's ancestor chain must be root-owned and not writable by group or others; defaults include `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin` when they pass these checks. User-bin, project `node_modules/.bin`, and user-owned Homebrew/Conda directories are not accepted. On Windows, eligible directories are anchored to loaded OS modules rather than caller-supplied `SystemRoot`/`WINDIR`. The resolved curl executable must be a regular file and, on POSIX, executable. If none is found, `transport_missing` and setup `next_action: prepare_curl` identify the missing prerequisite before token retrieval or renewal. Prepare system curl in an accepted location, then retry `--check-colosseum`; preserve the connection and do not repeat sign-in on this evidence. ProofPilot does not install curl automatically.

Follow the [official V2 connection guide](https://github.com/ColosseumOrg/colosseum-copilot/blob/079bd44b0d4d221d6a893764d8ec6f5f4845707e/skills/colosseum-copilot/references/connection.md). Ignore leftover V1 PAT settings and legacy ProofPilot/Superstack credential files; preserve them without reading or reusing secrets. ProofPilot status and corpus requests never fall back to V1. Official V1 support ends 2026-10-28 00:00 UTC; that date does not extend V1 access to V2.

Without verified access, say **“Настройка ProofPilot не завершена: нужен доступ к Colosseum”** (or translate), offer the next step, and preserve the task. If the user explicitly declines connection or requests limited/offline work, do that scope, label missing research coverage, and keep setup incomplete. Do not repeatedly nag or block unrelated narrow edits.

For uncertain/interrupted refresh, preserve credentials and check later; the official helper resumes renewal. Reconnect only for a missing connection or a definitively expired/revoked grant. A 401 calls for one official helper status check before proposing reconnection. A 403 requires inspecting granted scopes/account permissions; it does not prove expiry. An unavailable evidence capability calls for public sources and disclosure, not repeated login. Network failures, invalid responses, 429 and 402 leave verification incomplete; no automatic retries, payment, client impersonation or credential redirects.

Revoke access through [Arena connected agents](https://colosseum.com/arena/copilot/connections) or the official helper's `revoke` command when the user requests it. Do not log out before revoke: revocation needs the saved credential. Local logout alone does not revoke server access. Feedback, source suggestions and conversation sharing require their own user authorization; this connector performs none of them.

## What Costs Money

Use [service-access.json](service-access.json) for the selected service. The Colosseum V2 connection contract was reviewed on 2026-10-01; other service pricing cards retain their individual dates.

| Access | Needed for research setup? | Cost boundary |
|---|---|---|
| Colosseum account via Copilot Connect | **Required** | Review account terms at sign-in. The public FAQ still describes free V1 PAT access; it does not verify V2 pricing. |
| GitHub, Kaggle, Hugging Face | Optional | Public research first; scoped account access for specific resources. Paid compute and other products are separate. |
| DefiLlama | Optional, no key for Free API | Public analytics are free; Pro API is separate. |
| ETHGlobal Skills | Optional, no key for free reads | Published free rate allowance; stop at 402. No automatic wallet/payment setup. |
| OpenAI / Claude API | Optional | Separate API billing. No extra key is needed merely to use ProofPilot in an authenticated host. |
| Gemini API | Optional | Model-specific free tiers; verify paid features and data-use terms. |
| Replit MCP | Optional OAuth | Account plan and Agent/cloud usage apply. Use `list_apps` for access checking; Agent questions may be billable. |

Agent/model subscriptions and usage remain separate from Colosseum access. A connection does not authorize spending. Before a cost-sensitive recommendation, check current terms. For an optional service, explain its purpose, minimum scope, secure connection/revocation route, free alternative and paid boundary. Do not request every catalogued key.

## Use Colosseum As The Foundation

After setup, begin relevant project/precedent/archive research with Colosseum, then add market and technical sources. Solana is its deepest evidence base, with uneven coverage elsewhere; it is not a comprehensive global competitor database. For an unrelated market, prioritize domain evidence and do not force irrelevant searches.

Use `scripts/colosseum-read.js` (`--help` lists fixed operations). It uses the official helper connection and supports bounded project/archive search, filters, categories and project/archive detail. It does not implement every upstream research, analytics or Deep Dive feature. Do not invoke an older installed PAT wrapper.

Keep user artifacts authoritative for demand, retention and economics. Verify current program rules on official pages. A winner, empty search or successful access check cannot prove demand, product activity or no competitors. Respect sensitivity and evaluator source restrictions before sending any research query. Setup does not authorize uploading private material or sharing conversations.
