# Security Policy

ProofPilot may be used with API keys, OAuth tokens, service accounts, and wallet credentials in future hosted implementations.

The core rule is simple:

```text
Raw secrets never go into prompts, chat logs, telemetry, frontend JSON, or job payloads.
```

## Credential Handling

- Use no-secret workflows first.
- Ask for a credential only when a selected connector requires it.
- Prefer read-only scopes.
- Store secrets in an encrypted credential store.
- Show the owner of every credential: user, team, organization, platform, or local open-source runtime.
- Let users revoke credentials.
- Treat wallets, private keys, mnemonics, payment actions, and final submissions as high-risk flows.

## Reporting

Open a private security advisory or contact the maintainer before filing public issues for credential leaks, unsafe connector execution, prompt injection risks, or wallet-action vulnerabilities.
