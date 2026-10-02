/** OpenAI-compatible chat-completions provider for third-party gateways. */
import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { MODEL_DISCOVERY_TTL_MS } from './defaults.ts'
import { Config, plainOptions, resolveAdapterOptions } from './config.ts'
import type { Options } from './config.ts'
import { OpenAICompatAdapter } from './adapter.ts'
import { fetchGatewayModels } from './models.ts'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { OpenAICompatAdapterOptions, OpenAICompatCatalogModel, OpenAICompatConnectionOptions } from './types.ts'

export { Config, plainOptions, resolveAdapterOptions } from './config.ts'
export type { Options } from './config.ts'
export { OpenAICompatAdapter } from './adapter.ts'
export { OpenAIStreamTranslator } from './translate.ts'
export { providerError } from './transport.ts'
export { serialize } from './serialize.ts'
export type { WireBody, WireMessage } from './serialize.ts'
export { fetchGatewayModels } from './models.ts'
export { catalogModelInfo, resolveModelInfo } from './model-info.ts'
export type { OpenAICompatAdapterOptions, OpenAICompatCatalogModel, OpenAICompatConnectionOptions } from './types.ts'

export const name = 'llm-openai-compatible'
export const inject = ['llm']

/** Mount or refresh one gateway route; an unconfigured `baseURL` keeps the plugin inert. */
export function apply(ctx: Context, config: Config): void {
  const options = (): Options => plainOptions(config)
  const resolved = (): OpenAICompatConnectionOptions | undefined => resolveAdapterOptions(options(), launchEnvironmentOf(ctx))
  resolved()
  const ensureAccountSession = async (connection: OpenAICompatConnectionOptions): Promise<void> => {
    if (!connection.requireAccountSession) return
    const account = ctx.get('deepseekAccount')
    if (account === undefined) {
      throw new LlmError(
        `llm-openai-compatible: provider route "${connection.provider}" requires a signed-in account, but no account service is mounted`,
        'ACCOUNT_SIGN_IN_REQUIRED',
      )
    }
    const state = await account.getState()
    if (state.status !== 'credential-stored') {
      throw new LlmError(
        `Sign in before using provider route "${connection.provider}".`,
        'ACCOUNT_SIGN_IN_REQUIRED',
      )
    }
  }
  const resolveAuth = async (connection: OpenAICompatConnectionOptions): Promise<{ headers: Record<string, string> }> => {
    await ensureAccountSession(connection)
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return { headers: { authorization: `Bearer ${assertUsableApiKey(hit.value, 'llm-openai-compatible', ref)}` } }
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return { headers: { authorization: `Bearer ${assertUsableApiKey(ambient.value, 'llm-openai-compatible', ref)}` } }
      }
    }
    throw new LlmError(
      `llm-openai-compatible: no API key for provider route "${connection.provider}"; store ${ref} through the credentials`
      + ` service, or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }
  let discovery: { models: readonly OpenAICompatCatalogModel[]; fetchedAt: number } | undefined
  let registration: AdapterRegistrationHandle | undefined
  let registeredRoute: string | undefined
  let registeredPolicy = ''
  const resolvedOrThrow = (): OpenAICompatConnectionOptions => {
    const connection = resolved()
    if (connection === undefined) {
      throw new LlmError('llm-openai-compatible: baseURL was removed while the route was still registered', 'INVALID_REQUEST')
    }
    return connection
  }
  const adapterDependencies = (): OpenAICompatAdapterOptions => ({
    options: resolvedOrThrow,
    resolveAuth,
    discoverModels: async (provider) => {
      const connection = resolvedOrThrow()
      const now = Date.now()
      if (discovery !== undefined && now - discovery.fetchedAt < MODEL_DISCOVERY_TTL_MS) return discovery.models
      let auth: { headers: Record<string, string> }
      try {
        auth = await resolveAuth(connection)
      } catch (error) {
        if (error instanceof LlmError && error.code === 'ACCOUNT_SIGN_IN_REQUIRED') return []
        throw error
      }
      const models = await fetchGatewayModels(connection.baseURL, auth.headers, new AbortController().signal)
      discovery = { models, fetchedAt: now }
      ctx.logger.debug(`llm-openai-compatible: discovered ${models.length} models from ${connection.baseURL} for route "${provider}"`)
      return models
    },
  })
  const mount = (): void => {
    const connection = resolved()
    if (connection === undefined) return
    ctx.llm.registerConfigurableProviders([
      {
        provider: connection.provider,
        displayName: connection.providerName,
        settingsNs: ctx.fiber.entry?.options.id ?? name,
        settingsPath: [],
      },
    ])
    registration = ctx.llm.registerAdapter([connection.provider], new OpenAICompatAdapter(adapterDependencies()))
    registeredRoute = connection.provider
    registeredPolicy = JSON.stringify(connection.retryPolicy)
  }
  mount()
  ctx.on('loader/volatile-update', () => {
    let next: OpenAICompatConnectionOptions | undefined
    try { next = resolved() } catch (error) { ctx.logger.warn(error); return }
    if (next === undefined) {
      registration?.()
      registration = undefined
      registeredRoute = undefined
      return
    }
    if (registration === undefined) {
      mount()
      return
    }
    if (registeredRoute === next.provider && registeredPolicy === JSON.stringify(next.retryPolicy)) return
    registration.replace([next.provider])
    registeredRoute = next.provider
    registeredPolicy = JSON.stringify(next.retryPolicy)
  })
}
