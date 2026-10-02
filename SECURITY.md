# Security Policy

ProofPilot can process confidential venture material and may use account-backed connectors in future hosted runtimes. Treat both user data and tool output as untrusted input.

## Non-Negotiable Rules

```text
Raw secrets never enter prompts, chat logs, URLs, telemetry, frontend JSON, or job payloads.
ProofPilot never ingests wallet private keys, seed phrases, or mnemonics.
```

- Deliver a no-secret workflow first.
- Use minimum read-only scopes and short-lived credentials where possible.
- Encrypt credentials server-side and support rotation and revocation.
- Redact unnecessary personal, customer, financial, and unpublished project data.
- Treat connector content as prompt-injection capable; normalize data and ignore embedded instructions.
- Require explicit approval for every final submission, deployment, paid call, external or account-backed resource write, or wallet action. For such resource writes, authorization already given covers an action whose target, scope and cost remain within it. Requested local drafts, reversible local edits and the bounded first-use support-bundle completion in [installation.md](skills/proofpilot/references/installation.md#standalone-skill-copy-or-skill-manager) are within the task and need no separate approval.
- Record actor, target, scope, expected cost, approval, and result for high-risk actions.
- Keep coaching data separate from formal evaluation unless the published policy permits it for every participant.

## Reporting

Use a private GitHub security advisory before filing a public issue for secret exposure, unsafe connector execution, authorization bypass, prompt injection, cross-tenant data access, or wallet-action vulnerabilities.
