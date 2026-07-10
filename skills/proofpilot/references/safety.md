# Safety And Permissions

## Data Sensitivity

- `public`: may be checked against public sources
- `team`: share only with user-approved team or organization tools
- `confidential`: do not send raw material to external connectors without explicit approval
- `restricted`: regulated, secret, credential-bearing, or highly sensitive material; minimize, redact, and use approved local or organization-controlled processing

Classify the material before external research. Redact personal data, credentials, unpublished code, customer lists, and confidential deal terms when they are not needed for the task.

## Credentials

Use [credential-registry.json](credential-registry.json).

- Deliver no-secret value first.
- Ask the user to connect a tool only when it unlocks a named task.
- Explain the minimum scope, owner, storage location, and revocation path.
- Prefer read-only OAuth or short-lived tokens.
- Never ask a user to paste a secret into chat or place one in a prompt, log, URL, artifact, or frontend payload.
- Never ingest a wallet private key or seed phrase. Use an external wallet session or delegated signer.

## Permission Classes

- `read_only`: search, fetch, inspect, and summarize
- `draft_only`: generate work without an external side effect
- `write_nonfinal`: create a reversible draft, branch, issue, or configuration
- `final_submit`: submit or publish final work
- `wallet_or_paid_action`: sign, deploy, transfer, spend credits, or call a paid service

Require explicit approval at the point of every `final_submit` or `wallet_or_paid_action`. Record the actor, scope, target, expected cost, and result in hosted runtimes.

## Evaluation Isolation

Do not use private coaching conversations, hidden personal data, connected account history, or credentials to score a project unless the published evaluation policy explicitly permits that evidence for every participant.
