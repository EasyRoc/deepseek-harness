---
description: "Moldex tenant account provider: form login, JWT refresh, and key management."
kind: "package-reference"
---

# @deepseek-ai/dsh-moldex-account

English | [中文](README.zh.md)

## Summary

Implement the account Service Definition for Moldex deployments: the dedicated `moldexAccount` Remote namespace carries the sign-in form and key creation, the account namespace exposes state, profile, and balance, and the stored grant never crosses to the Client.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

`accountOrigin` names the tenant API and portal origin (default `https://www.moldex.top`; production serves the tenant API on the portal origin, while inference runs on a separate gateway host the LLM provider owns). `apiKeyEnv` names the credential reference the created inference key is stored under (default `MOLDEX_API_KEY`). Sign-in posts the form credentials once per attempt through the dedicated namespace; the password is never persisted, logged, or returned. Access tokens live 24 hours and refresh reactively with a single-flight guard; a failed refresh expires the login and emits the shared session-expired notification. The stored grant records its issuing origin and is discarded when the configured origin changes.

```yaml
- id: moldex-account
  name: '@deepseek-ai/dsh-moldex-account'
  config:
    accountOrigin: https://www.moldex.top
    apiKeyEnv: MOLDEX_API_KEY
```

Activate through a profile patch (see `moldex-profile.patch.example.yml` in this directory); do not change the shipped `dsh-base` composition. For Desktop, merge the example into `$DSH_HOME/profiles/desktop/cordis.patch.yml` (development default: `apps/desktop/.desktop-build/development/home/profiles/desktop/`), run `pnpm --filter @deepseek-ai/dsh-client-ui-account-moldex bundle`, then `pnpm run start:desktop` or `dev:desktop`. The `desktop` profile is Electron-only; `pnpm dsh desktop --patch` is not supported. Sign in from the sidebar **More → Sign in** (Moldex form overlay) or **Settings → Models**. After sign-in, the provider creates and stores an inference key under `apiKeyEnv` when none exists.

Also **disable `llm-deepseek`** in the patch so **Settings → Models** does not list the DeepSeek official route. Keep a single Moldex inference route via **`llm-openai-compatible` with `provider: moldex`**; do not add a parallel **`llm-pi-ai` DeepSeek route** in the same patch (two key surfaces and two DeepSeek entries in the picker). The example leaves `models` empty so `/models` discovery keeps picker wire ids aligned with the gateway; point `agent-default-model` at your wire id (for example `glm-5.2`). Set **`requireAccountSession: true`** on the Moldex route so unsigned sessions fail with `ACCOUNT_SIGN_IN_REQUIRED`; sign-out and session expiry clear `MOLDEX_API_KEY` so leftover keys cannot bypass the login gate.

Mount **`@deepseek-ai/dsh-client-ui-account-moldex`** for Moldex **`sidebar.brand.*`** occupants. Set **`DSH_CLIENT_TITLE=Moldex`** when building the Desktop client bundle so the window and document title show Moldex instead of the localized local-build fallback.

When **DeepSeek models on the Moldex route work but GLM or Qwen fail**, the example sets **`streamUsage: false`** because some upstreams reject `stream_options.include_usage`. The OpenAI-compatible stream translator must **prefer `choices[].delta` over `message`** on each SSE frame; some GLM/Qwen gateways emit an empty `message` alongside a populated `delta`, and reading `message` first drops the stream body. Rebuild (`pnpm run build`) before Desktop so Host changes take effect.

Bonus operations answer the contract's absent outcomes: Moldex grants no promotional bonus notifications. `getPlatformSession` resolves null because Moldex has no embedded-platform document semantics, and `resolveToken` resolves undefined because inference authenticates with the tenant API key owned by the credentials store.

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider subclasses the shared account Service Definition, so the account Remote namespace and Client surfaces work unchanged. Sign-in attempts arbitrate through the authorization registry's flow for the credential key; the form submission resolves the waiting attempt, and the grant commits through the authorization session. Expiry removes the stored grant once, notifies live subscribers, and renders absence on dependent reads. No invariant companion is published: the provider holds no state beyond the credential-store grant and the in-memory attempt, both owned by the credential and authorization seams it composes.

<a id="further-exploration"></a>
## Further Exploration

The [credentials subsystem](../../../docs/subsystems/credentials.md) owns storage APIs; the [account decision note](../../../.agents/notes/implemented/architecture/2026-09-14-deepseek-account-login.md) records the cancellation and storage ownership the shared contract inherits.

<a id="model-experience"></a>
## Model Experience

None, as ` — account credentials affect HTTP authentication and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Reactive refresh only** — tokens refresh on the first rejected request after expiry, not proactively; an idle client settles its next operation instead.
- **No server-side revocation** — Moldex exposes no logout endpoint, so sign-out is local deletion; a leaked refresh token stays valid until its seven-day expiry.
- **Key creation only** — existing tenant keys cannot be re-read in plaintext (the platform stores bcrypt hashes), so the client creates a dedicated key instead of selecting an existing one.

<a id="dev-note"></a>
### Dev Note

The tenant-API contract tests run against a loopback server shaped by the production envelope; the real-gateway round trip is exercised by the repository e2e lane when ambient credentials are present.
