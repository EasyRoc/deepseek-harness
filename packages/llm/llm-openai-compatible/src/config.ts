/** Plugin configuration and complete request-local resolution for OpenAI-compatible gateways. */
import type { Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { DEFAULT_MAX_TOKENS, DEFAULT_CONTEXT_WINDOW, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from './defaults.ts'
import type { OpenAICompatCatalogModel, OpenAICompatConnectionOptions } from './types.ts'

/** Plugin configuration for one OpenAI-compatible provider route. */
export interface Config {
  /** Registered provider route id; distinct ids allow several gateways in one composition. */
  provider: Volatile<string>
  /** Human-readable provider name shown in selectors. */
  displayName: Volatile<string>
  /**
   * Chat-completions root including any version path. Absence keeps the
   * plugin mounted but inert — the dormant-row composition state — so an
   * unconfigured row is composition, not misconfiguration.
   */
  baseURL: Volatile<string | undefined>
  /** Credential reference resolved per request; defaults to OPENAI_COMPATIBLE_API_KEY. */
  apiKeyEnv: Volatile<string>
  /** Advisory models shown by discovery consumers; defaults to no static catalog. */
  models: Volatile<OpenAICompatCatalogModel[]>
  /** Default per-request output cap (default 8,192); an explicit request value wins. */
  maxTokens: Volatile<number>
  /** Positive context capacity used when the selected model has no exact value (default 128,000). */
  defaultContextWindow: Volatile<number>
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs: Volatile<number>
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy: Volatile<RetryPolicyConfig | undefined>
  /** When false, omit `stream_options.include_usage` for gateways that reject it on some models. */
  streamUsage: Volatile<boolean>
  /** When true, refuse inference until `deepseekAccount` reports a stored credential. */
  requireAccountSession: Volatile<boolean>
  /** Lowercase substrings; matching wire model ids omit the tools array on chat-completions requests. */
  toolOmitModelSubstrings: Volatile<string[]>
}

/** Plain options accepted by the provider resolver. */
export type Options = { [K in keyof Config]?: Config[K] extends Volatile<infer T> ? Exclude<T, undefined> : never }

/** Read the current value behind every reference of a validated Config.
 * @param config Parsed plugin Config.
 * @returns Plain options for the resolver.
 */
export function plainOptions(config: Config): Options {
  const entries: [string, unknown][] = Object.entries(config)
    .map(([key, value]) => [key, isVolatile(value) ? value.get() : value])
  return Object.fromEntries(entries)
}

const catalogModel: z<OpenAICompatCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
})

/** Schema fields shared by every OpenAI-compatible route. */
export const openAICompatConfigFields = {
  provider: z.string().default('openai-compatible').volatile(),
  displayName: z.string().default('OpenAI Compatible').volatile(),
  baseURL: z.string().volatile(),
  apiKeyEnv: z.string().role('credential-ref').default('OPENAI_COMPATIBLE_API_KEY').volatile(),
  models: z.array(catalogModel).default([]).volatile(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS).volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).volatile(),
  retryPolicy: RetryPolicySchema.volatile(),
  streamUsage: z.boolean().default(true).volatile(),
  requireAccountSession: z.boolean().default(false).volatile(),
  toolOmitModelSubstrings: z.array(z.string()).default([]).volatile(),
}

export const Config = z.object(openAICompatConfigFields)

/** Validate and detach the advisory model catalog. */
function resolveModels(models: readonly OpenAICompatCatalogModel[]): OpenAICompatCatalogModel[] {
  const seen = new Set<string>()
  return models.map((model) => {
    if (model.id.length === 0) throw new Error('llm-openai-compatible: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-openai-compatible: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(`llm-openai-compatible: catalog model "${model.id}" contextWindow must be a positive integer`)
    }
    if (seen.has(model.id)) throw new Error(`llm-openai-compatible: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    }
  })
}

/**
 * The one explicit resolve step from raw config to validated connection
 * settings. Programmatic construction may bypass Schemastery normalization, so
 * every default and bound is re-judged here — for the composition entry at
 * load (fail loud) and for each settings snapshot at its first use.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param _environment - application launch environment; reserved, the route
 *   reads no endpoint from ambient layers because a gateway URL is a
 *   deliberate per-composition choice.
 * @returns validated connection settings; `baseURL` is absent only in the
 *   dormant unconfigured state.
 */
export function resolveAdapterOptions(
  config: Options, _environment?: LaunchEnvironmentSnapshot,
): OpenAICompatConnectionOptions | undefined {
  if (config.baseURL === undefined) return undefined
  const provider = config.provider ?? 'openai-compatible'
  if (provider.length === 0) throw new Error('llm-openai-compatible: provider must be a non-empty route id')
  const baseURL = config.baseURL
  const parsed = new URL(baseURL)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('llm-openai-compatible: baseURL must be an HTTP(S) root without credentials, query, or fragment')
  }
  if (baseURL.endsWith('/')) throw new Error('llm-openai-compatible: baseURL must not end with a slash')
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('llm-openai-compatible: maxTokens must be a positive safe integer')
  }
  const defaultContextWindow = config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  if (!Number.isSafeInteger(defaultContextWindow) || defaultContextWindow <= 0) {
    throw new Error('llm-openai-compatible: defaultContextWindow must be a positive safe integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > Number.MAX_SAFE_INTEGER) {
    throw new Error('llm-openai-compatible: streamIdleTimeoutMs must be a positive finite number')
  }
  return {
    baseURL,
    provider,
    providerName: config.displayName ?? 'OpenAI Compatible',
    maxTokens,
    defaultContextWindow,
    models: resolveModels(config.models ?? []),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-openai-compatible: retryPolicy'),
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? 'OPENAI_COMPATIBLE_API_KEY'),
    streamUsage: config.streamUsage ?? true,
    requireAccountSession: config.requireAccountSession ?? false,
    toolOmitModelSubstrings: resolveToolOmitModelSubstrings(config.toolOmitModelSubstrings ?? []),
  }
}

/** Normalize configured tool-omit patterns for case-insensitive wire model matching. */
function resolveToolOmitModelSubstrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const trimmed = value.trim().toLowerCase()
    if (trimmed.length === 0) throw new Error('llm-openai-compatible: toolOmitModelSubstrings entries must be non-empty')
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}
