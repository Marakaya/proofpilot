# Credential Model

Colosseum read access is required to complete normal ProofPilot setup. All other account connections are optional. See [onboarding](../skills/proofpilot/references/onboarding.md) for the secure first-use flow and explicit limited/offline-work exception.

## Progressive Connection

1. Check existing Colosseum credentials without revealing them; verify read scope before marking setup complete.
2. For other services, prefer public/local evidence and request a connection only for a selected capability.
3. Explain the reason, minimum scope, owner, storage location, expected cost, and revocation path.
4. Prefer read-only OAuth or short-lived scoped tokens.
5. Keep raw secrets out of prompts, chat, URLs, logs, telemetry, frontend state, and job payloads.
6. Require explicit approval for final submission, paid calls, deployment, or wallet signing.

## Credential Classes

The canonical classes live in `skills/proofpilot/references/credential-registry.json`:

- `no_secret`
- `api_token`
- `oauth`
- `service_identity`
- `paid_api`
- `wallet_session`

A tool can have multiple capabilities. For example, public GitHub research uses `no_secret`, private repository inspection uses a scoped `api_token`, and the catalog selects `oauth` for repository writes. These are chosen integration flows, not assertions that a provider supports only one authentication mechanism. Verify the current capability-specific documentation.

## Wallet Policy

ProofPilot does not ingest wallet private keys, seed phrases, or mnemonics. Wallet actions require an external wallet session, short-lived delegated signer, or isolated development wallet. Authorization must cover the network, target, asset, action, and maximum amount; reuse an existing grant while within its scope.

## Credential Owners

| Owner | Use Case |
|---|---|
| `user` | Personal repository, dataset, model, or wallet access |
| `team` | Shared repository, deployment project, or team workspace |
| `organization` | Sponsor credits, program systems, and organization services |
| `platform` | Default inference allowance and public indexing infrastructure |
| `local_open_source` | Environment variables used by a local self-hosted runtime |

The official Copilot Connect helper owns Colosseum OAuth storage and refresh rotation through its OS credential store or supported protected file fallback. ProofPilot stores no Colosseum credentials or verification cache. Offline `status --local` only describes saved state; setup needs a live V2 status response confirming authentication and evidence read scope. Bearer authorization travels privately from the helper to curl, never through model context, argv or environment variables. Legacy PAT files/settings are preserved and ignored. All profiles use the same helper connection; no optional service credentials are collected.

Hosted implementations should encrypt credentials server-side, support rotation and revocation, isolate organization access, and audit every high-risk action.
