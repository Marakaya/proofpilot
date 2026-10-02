# Runtime Model

ProofPilot is a self-contained agent skill. The host agent performs reasoning and public research; a future hosted implementation can add persistence and live connectors without changing the core contracts.

## Layers

0. `setup`: required Colosseum V2 evidence access, official helper connection, optional-service cost guidance
1. `intake`: goals, constraints, assets, and sensitivity
2. `router`: mode, ordered stages, domains, venture type, and program context
3. `source_planner`: smallest useful set of public or connected sources
4. `evidence_normalizer`: facts, claims, conflicts, confidence, and retrieval metadata
5. `stage_pipeline`: discover, validate, plan, review, and submit workflows
6. `rubric_engine`: anchored score, evidence coverage, and provisional state
7. `artifact_writer`: human response or structured response schema
8. `permission_gate`: explicit boundary for writes, payment, wallets, deployment, and final submission

## Portable Skill

The portable ProofPilot core lives under `skills/proofpilot`; its default supporting bundle is installed beside it:

- `SKILL.md` contains core routing and decision rules
- `references/*.md` contain stage workflows and safety rules
- `references/*.json` contain machine-readable taxonomy, sources, tools, credentials, rubrics, and output schema
- `agents/openai.yaml` exposes installable skill metadata
- `references/skill-dependencies.json` pins 36 supporting skills and shared guidance
- `scripts/install-dependencies.js` installs, repairs or inventories that bundle without account login
- `scripts/setup.js` provides offline connection status, official browser/device sign-in and a scoped live V2 check
- `scripts/colosseum-read.js` uses the official helper for bounded fixed-route API V2 reads
- `scripts/colosseum-connection.js` privately transfers authorization from the pinned Copilot Connect helper to curl

Installers print a setup prompt and command. Skill instructions run at invocation; copying a skill does not create an automatic agent turn. All stage profiles use the official helper account/storage. ProofPilot creates no credential store or readiness cache.

First-use instructions present a two-message welcome: explain the included Colosseum skill and obtain browser/device authorization if needed, verify current V2 evidence access, then describe the actual installed support capabilities and resume the user's task. Existing access skips a new login, and local capability inventory remains account-free. Counts and names come from the portable inventory; core-only copies must not claim that the full support bundle was installed. Localized examples are maintained in [onboarding](../skills/proofpilot/references/onboarding.md#welcome-and-connection-flow).

The root CLI copies the core into Codex, Claude, or a generic agent skill directory and installs the full support bundle by default. Standalone copies check the portable dependency helper on first use for actual work; a core-only preference is honored. See [installation.md](../skills/proofpilot/references/installation.md).

Claude paths honor `CLAUDE_CONFIG_DIR` before the legacy `CLAUDE_HOME` alias and the default home directory. Windows setup commands name PowerShell and preserve literal paths. A live V2 status check rejects impossible expiration dates; project and archive detail reads verify the returned resource identity before reporting success. Explicit local session exports inspect complete JSONL metadata, then validate and write the same bounded in-memory snapshot of each selected session. Ordinary changes during snapshot capture stop export; later source edits do not alter the captured bytes. Inspection limits still stop unreliable selection.

## Optional Stage Profiles

Five `proofpilot-*` stage profiles remain available for runtimes that benefit from direct stage invocation. They are opt-in and share the canonical `skills/proofpilot/references` directory in both symlink and copy installation modes. The default CLI installs the main router and 36 support skills; its five ProofPilot profiles remain opt-in.

Focused PMF, AI validation, accelerator, presentation, Solana, source-orchestration, and evidence-calibrated evaluation playbooks live inside the canonical skill and are loaded only when their trigger applies.

## Connector Boundary

The registry describes capabilities, not promises that integrations are live. Each capability declares its status, permission class, and credential class. A public research capability and a wallet or deployment capability are represented separately even when they belong to the same tool.

Live adapters should normalize responses before model use, store evidence links and timestamps, redact secrets, honor rate limits, and record explicit permission grants. Long external checks belong in a background worker in hosted deployments.

## Superteam Integration

Use `coach` mode in the participant workspace and `evaluator` mode in the judging pipeline. Keep their evidence stores and access policies separate. Evaluations should persist the rubric version, project artifact hash or version, evidence cutoff, dimension findings, coverage, and reviewer overrides for reproducibility.

## Executable Checks In 0.3

The portable response checker and repository Ajv validator enforce structure, evidence references, frozen evaluator artifacts, score arithmetic, coverage, provisional state, and action gates. They check internal consistency, not whether cited evidence is true or relevant. Host reasoning still owns source inspection and interpretation.

For substantial prose and structured assessments, `scripts/quality.js` adds a local run: frozen source text and fact bindings, recorded prerequisites, explicit arithmetic, draft versions, eight review criteria and stable issue resolutions. It permits an initial draft and at most two repairs; repeated material issues, disputed findings and unassessed review stop the run. A truthful limited or negative conclusion can meet the quality standard. See [quality.md](../skills/proofpilot/references/quality.md).

The helper makes no model/API calls. The host performs the review with a separate context when available and authorized, or records self-review. Its labels are supplied by that host, not runtime attestation. Hashes detect changed local artifacts against the stored run; they are not a signature or proof of truthful source collection. The helper cannot enforce claims omitted by the writer, semantic entailment, completeness of prerequisites, or replies that bypass it. Without local execution the agent must disclose which mechanical checks were not run. No equality with a stronger model is implied.

New policy-v4 packets declare `mode: coach|evaluator` and `decision_context: general|application`. Application context, application targets or any frozen application gate require separate-context review; a completed report cannot bypass this. Evaluator mode also requires separate review even if the optional `requires_independent_review` flag is omitted or false. The flag adds review for material source conflicts. Self-review in these runs yields `needs_review`, even with all-pass check labels. Policy-v1/v2/v3 runs remain readable as archives with their recorded disposition, but cannot be appended or newly certified by the current helper. These controls do not prove that the host's mode/reviewer labels are truthful or that another model is more capable.

`recommendation.target` distinguishes test, build, apply, and artifact; `decision` is proceed, revise, pause, stop, or artifact-only complete. A failed or unknown mandatory condition blocks proceed for its target even with a high rubric score. Build proceed also requires at least one matching prerequisite with current supporting observed evidence; a first bounded test may have none when no mandatory condition applies. Existing 0.2 responses need evidence-aware migration; no automatic fabricated defaults are supplied.

Source verification metadata records exactly what was checked. Documentation inspection is distinct from a live API test. The package includes a bounded Colosseum read helper and local setup state, but no hosted persistence. A status check proves authentication/read scope only; each data operation has its own evidence and limits. Behavioral comparisons use actual saved model responses and separately recorded judgments; see [evaluation.md](evaluation.md).
