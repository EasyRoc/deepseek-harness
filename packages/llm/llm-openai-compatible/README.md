---
description: "OpenAI-compatible chat-completions provider for third-party gateways."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-openai-compatible

English | [中文](README.zh.md)

## Summary

Register one OpenAI-compatible chat-completions route with streaming, tool calls, and usage accounting. The plugin targets gateways that speak the OpenAI wire protocol — aggregation relays, self-hosted servers, and provider-compatible endpoints — and owns its transport; it shares no code with the DeepSeek Messages route.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

A row without `baseURL` is inert: composition may mount the plugin unconfigured, and a later configuration supplying `baseURL` activates the route. `apiKeyEnv` defaults to `OPENAI_COMPATIBLE_API_KEY` and resolves per request — the credentials service takes precedence, and only compositions without that service read the launch environment directly. Missing credentials fail with `MISSING_CREDENTIAL`.

```yaml
- id: llm-openai-compatible
  name: '@deepseek-ai/dsh-llm-openai-compatible'
  config:
    baseURL: https://gateway.example/v1
    provider: openai-compatible
    displayName: OpenAI Compatible
    models:
      - id: model-a
        contextWindow: 128000
```

`baseURL` includes the version path and must be an HTTP(S) root without credentials, query, fragment, or a trailing slash; validation fails at load. `provider` names the registered route, so distinct configurations can mount several gateways side by side. `models` is the advisory selector catalog; when it is empty and a gateway exposes `/v1/models`, list selection discovers from the listing with a five-minute cache. `retryPolicy` is provider-owned: the [retry plugin](../llm-retry/README.md) executes it against the stable failure codes below.

Status classification follows the OpenAI contract with one deliberate extension: an HTTP 402 — the exhausted-balance signal used by one-api family gateways — maps to the terminal `QUOTA` code and is never retried; 403 marks invalid, disabled, or scope-restricted keys as `AUTH`.

<a id="understand-the-implementation"></a>
## Understand the implementation

The adapter serializes the neutral conversation vocabulary onto chat-completions bodies, streams server-sent events with an idle watchdog, and closes every open content block at the stream end. Text and reasoning blocks close when a different kind starts, so interleaved tool calls keep first-seen block order; tool calls reassemble by wire index and synthesize `call_<index>` ids for gateways that omit them. Registrations and the volatile-update listener dispose with the plugin; a configuration change that alters the route or retry policy replaces the registration in place. No invariant companion is published: the adapter holds no service state beyond the registrations its composition supplies, and every connection fact re-resolves from configuration per request.

<a id="further-exploration"></a>
## Further Exploration

[LLM streaming](../../../docs/subsystems/llm-streaming.md) · [Adding an LLM adapter](../../../docs/cookbook/adding-an-llm-adapter.md)

<a id="model-experience"></a>
## Model Experience

### OpenAI chat-completions request projection

#### What the model sees

Requests serialize the neutral conversation vocabulary onto the OpenAI chat-completions wire: system and developer turns project to `system` messages, tool results to `tool` messages with their call ids, and assistant tool calls to `tool_calls` with raw JSON argument strings. Every request streams with usage accounting enabled.

#### Token effect

Data-dependent: usage mirrors the serialized conversation; the selected model and request content determine actual usage.

#### KV Cache effect

The projection sends the complete tool declaration list and a leading system turn on every request, so any mid-conversation change to either rewrites the request prefix; otherwise growth is append-only along the conversation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Text-and-tools only** — image and file blocks fail the request with `INVALID_REQUEST`; attachment projection is deferred until a gateway surface needs it.
- **No native replay** — responses carry no `replayState`, so follow-up calls resend ordinary history; providers that require response ids for replay are unsupported.
- **Developer turns become system turns** — the wire spelling maps developer text to `system`, and reasoning blocks in history are dropped; portability across gateways outranks preserving either.

<a id="dev-note"></a>
### Dev Note

Adapter coverage runs against a loopback chat-completions server; real-gateway behavior is exercised by the repository e2e lane when an ambient key is present.
