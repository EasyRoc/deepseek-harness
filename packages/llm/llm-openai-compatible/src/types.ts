/** Connection settings and catalog shapes for one OpenAI-compatible gateway route. */
import type { ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** One optional model entry advertised for the gateway. */
export interface OpenAICompatCatalogModel {
  /** Wire model id accepted by the configured endpoint. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail for deployments with similar model variants. */
  description?: string
  /** Known combined request/response context capacity in tokens. */
  contextWindow?: number
}

/** Validated connection settings captured for one request operation. */
export interface OpenAICompatConnectionOptions {
  /** HTTP(S) chat-completions root, including any version path (for example `https://gateway.example/v1`). */
  baseURL: string
  /** Provider route id this adapter is registered under. */
  provider: string
  /** Human-readable provider name shown in selectors. */
  providerName: string
  /** Positive per-request output cap materialized when the request omits one. */
  maxTokens: number
  /** Positive context capacity used when a model has no exact value. */
  defaultContextWindow: number
  /** Validated advisory catalog; discovery extends it only when empty. */
  models: OpenAICompatCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: number
  /** Provider-owned retry policy resolved for `llm-retry`. */
  retryPolicy: ResolvedRetryPolicy
  /** Credential reference resolved per request. */
  apiKeyEnv: CredentialRef
}

/** Request-local dependencies the plugin binds to one adapter instance. */
export interface OpenAICompatAdapterOptions<C extends OpenAICompatConnectionOptions = OpenAICompatConnectionOptions> {
  /** Read the current validated connection snapshot; called per operation. */
  options(): C
  /** Resolve request authentication; called for every HTTP request. */
  resolveAuth(connection: C): Promise<{ headers: Record<string, string> }>
  /** Replace catalog discovery; omission uses the configured `models` only. */
  discoverModels?(provider: string): Promise<readonly OpenAICompatCatalogModel[]>
}
