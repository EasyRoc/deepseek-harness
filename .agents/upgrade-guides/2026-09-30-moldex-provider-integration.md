# Moldex provider integration

## New config surfaces

### `@deepseek-ai/dsh-llm-openai-compatible`

| Field | Default | Description |
|---|---|---|
| `baseURL` | *(required)* | Chat-completions root including version path |
| `provider` | `openai-compatible` | Registered route id |
| `displayName` | `OpenAI Compatible` | Selector display name |
| `apiKeyEnv` | `OPENAI_COMPATIBLE_API_KEY` | Credential reference, resolved per request |
| `models` | `[]` | Static catalog; discovery from `/v1/models` when empty |
| `retryPolicy` | *(llm-retry defaults)* | Provider-owned retry policy |

The row is mounted dormant in the base bundle: a configuration without `baseURL` registers nothing.

### `@deepseek-ai/dsh-moldex-account`

| Field | Default | Description |
|---|---|---|
| `accountOrigin` | `https://www.moldex.top` | Tenant API and portal origin |
| `apiKeyEnv` | `MOLDEX_API_KEY` | Credential reference for the created inference key |
| `requestTimeoutMs` | `30_000` | Per-request deadline |

Activates via a Moldex profile patch that disables `deepseek-account`, `llm-deepseek-account`, `web-search-deepseek`, and `product-analytics`, then inserts the moldex rows.

## Migration

No existing behavior changes: the base-bundle default remains DeepSeek. Moldex deployments activate by supplying a profile patch. Existing stored DeepSeek grants are unaffected.
