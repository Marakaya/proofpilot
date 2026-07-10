# Credential Model

ProofPilot must be useful before any account is connected.

## Progressive Connection

1. Run user-artifact and public-source workflows first.
2. Request a connection only when it unlocks a named capability.
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

A tool can have multiple capabilities. For example, public GitHub research uses `no_secret`, private repository inspection uses a scoped `api_token`, and repository writes use `oauth`. This avoids ambiguous compound classes.

## Wallet Policy

ProofPilot does not ingest wallet private keys, seed phrases, or mnemonics. Wallet actions require an external wallet session, short-lived delegated signer, or isolated development wallet. The user must approve the network, target, asset, action, and maximum amount at the final action boundary.

## Credential Owners

| Owner | Use Case |
|---|---|
| `user` | Personal repository, dataset, model, or wallet access |
| `team` | Shared repository, deployment project, or team workspace |
| `organization` | Sponsor credits, program systems, and organization services |
| `platform` | Default inference allowance and public indexing infrastructure |
| `local_open_source` | Environment variables used by a local self-hosted runtime |

Hosted implementations should encrypt credentials server-side, support rotation and revocation, isolate organization access, and audit every high-risk action.
