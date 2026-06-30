# Credential Model

ProofPilot should be useful before any key is connected.

## Progressive Connection

1. Run no-secret workflows first.
2. Show "Connect tool" only when it unlocks a specific action.
3. Explain why the key is needed and which scope is enough.
4. Prefer read-only tokens.
5. Never ask users to paste keys into chat.
6. Never pass raw secrets into prompts, telemetry, frontend JSON, or job payloads.

## Credential Owners

| Owner | Use Case |
|---|---|
| `user` | Personal GitHub, Kaggle, Hugging Face, or BYOK LLM quota |
| `team` | Shared repository, deployment project, cloud account, deployer wallet |
| `organization` | Sponsor credits, workspace resources, grant partner APIs |
| `platform` | Default LLM review key, public indexing, link validation |
| `local_open_source` | `.env` credentials for a local developer runtime |

## Secret Kinds

```text
api_key
pat
oauth_token
refresh_token
service_account_json
client_secret
wallet_private_key
mnemonic
rpc_url
publishable_key
secret_key
x402_wallet
connection_string
```

## Risk Levels

- `low`: public or publishable config
- `medium`: read-only token
- `high`: write token, deploy token, service account
- `critical`: wallet private key, mnemonic, payment credential, final submission authority
