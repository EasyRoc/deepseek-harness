/** Plugin composition: dormant mounting, activation, and volatile-update reconciliation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { Volatile } from '@deepseek-ai/cosmokit'
import * as Plugin from '../src/index.ts'
import type { Options } from '../src/index.ts'
import { config } from './helpers.ts'
import { jsonReply } from './reply.ts'

const write = Symbol.for('cosmokit.volatile.write')

/** One mutable volatile reference speaking the shared marker protocol. */
function mutableRef<T>(initial: T): Volatile<T> & { set(value: T): void } {
  let current = initial
  const holder = {
    get: () => current,
    set: (value: T) => { current = value },
    [write]: (value: unknown) => { current = value as T },
  }
  return holder as Volatile<T> & { set(value: T): void }
}

/** A live configuration whose fields the test mutates between volatile updates. */
function mutableConfig(initial: BootOptions = {}) {
  const state: BootOptions = { ...config(), ...initial }
  const fields = {
    provider: mutableRef(state.provider),
    displayName: mutableRef(state.displayName),
    baseURL: mutableRef(state.baseURL),
    apiKeyEnv: mutableRef(state.apiKeyEnv),
    models: mutableRef(state.models),
    maxTokens: mutableRef(state.maxTokens),
    defaultContextWindow: mutableRef(state.defaultContextWindow),
    streamIdleTimeoutMs: mutableRef(state.streamIdleTimeoutMs),
    retryPolicy: mutableRef(state.retryPolicy),
  }
  return { config: fields as Plugin.Config, fields }
}

/** Boot options may explicitly set a field to undefined (the dormant state). */
type BootOptions = { [K in keyof Options]?: Options[K] | undefined }

let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function boot(initial: BootOptions = {}) {
  ctx = new Context()
  const llm = new LlmRuntime(ctx)
  const pluginConfig = mutableConfig(initial)
  Plugin.apply(ctx, pluginConfig.config)
  return { llm, ...pluginConfig }
}

const emitUpdate = () => { ctx!.emit('loader/volatile-update', []) }

describe('llm-openai-compatible plugin', () => {
  it('stays inert without a baseURL', () => {
    const { llm } = boot({ baseURL: undefined })
    expect(llm.listConfigurableProviders()).toEqual([])
    expect(llm.listProviders()).toEqual([])
  })

  it('mounts one configurable provider and adapter route when configured', () => {
    const { llm } = boot({ baseURL: 'https://gateway.example/v1' })
    expect(llm.listConfigurableProviders()).toMatchObject([
      { provider: 'openai-compatible', displayName: 'OpenAI Compatible' },
    ])
    expect(llm.listProviders()).toEqual([{ id: 'openai-compatible', name: 'OpenAI Compatible' }])
  })

  it('mounts on activation after booting dormant', () => {
    const { llm, fields } = boot({ baseURL: undefined })
    fields.baseURL.set('https://gateway.example/v1')
    emitUpdate()
    expect(llm.listProviders()).toEqual([{ id: 'openai-compatible', name: 'OpenAI Compatible' }])
  })

  it('replaces the adapter route when the provider id changes', () => {
    const { llm, fields } = boot({ baseURL: 'https://gateway.example/v1' })
    fields.provider.set('moldex')
    emitUpdate()
    expect(llm.listProviders()).toEqual([{ id: 'moldex', name: 'OpenAI Compatible' }])
  })

  it('replaces the adapter route when the retry policy changes', () => {
    const { llm, fields } = boot({ baseURL: 'https://gateway.example/v1', retryPolicy: { mode: 'normal', maxRetries: 5 } })
    expect(llm.providerRetryPolicy('openai-compatible')).toMatchObject({ maxRetries: 5 })
    fields.retryPolicy.set({ mode: 'normal', maxRetries: 1 })
    emitUpdate()
    expect(llm.providerRetryPolicy('openai-compatible')).toMatchObject({ maxRetries: 1 })
  })

  it('unmounts when the configuration removes the endpoint', () => {
    const { llm, fields } = boot({ baseURL: 'https://gateway.example/v1' })
    fields.baseURL.set(undefined)
    emitUpdate()
    expect(llm.listProviders()).toEqual([])
    expect(llm.listConfigurableProviders()).toMatchObject([{ provider: 'openai-compatible' }])
  })

  it('warns and keeps the current registration when an update fails to resolve', () => {
    const { llm, fields } = boot({ baseURL: 'https://gateway.example/v1' })
    fields.maxTokens.set(-5)
    expect(() => { emitUpdate() }).not.toThrow()
    expect(llm.listProviders()).toEqual([{ id: 'openai-compatible', name: 'OpenAI Compatible' }])
  })

  it('rejects requests with a dedicated failure when the endpoint is configured away mid-flight', async () => {
    const { llm, fields } = boot({ baseURL: 'https://gateway.example/v1' })
    fields.baseURL.set(undefined)
    await expect(llm.listModels('openai-compatible')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('discovers gateway models through the launch environment key and caches the listing', async () => {
    vi.stubEnv('OPENAI_COMPATIBLE_API_KEY', 'env-key')
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(input).toBe('https://gateway.example/v1/models')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer env-key')
      return jsonReply(200, { data: [{ id: 'deepseek-v4-flash' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { llm } = boot({ baseURL: 'https://gateway.example/v1', models: [] })
    expect(await llm.listModels('openai-compatible')).toMatchObject([{ id: 'deepseek-v4-flash' }])
    expect(await llm.listModels('openai-compatible')).toMatchObject([{ id: 'deepseek-v4-flash' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves the key through the credentials service when present', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer key-from-store')
      return jsonReply(200, { data: [{ id: 'm1' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    ctx = new Context()
    const llm = new LlmRuntime(ctx)
    ctx.provide('credentials', {
      resolve: async () => ({ value: 'key-from-store', source: 'test' }),
    } as never)
    Plugin.apply(ctx, mutableConfig({ baseURL: 'https://gateway.example/v1', models: [] }).config)
    expect(await llm.listModels('openai-compatible')).toMatchObject([{ id: 'm1' }])
  })

  it('reports a missing credential when no source supplies the key', async () => {
    const { llm } = boot({ baseURL: 'https://gateway.example/v1', models: [] })
    await expect(llm.listModels('openai-compatible')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('reports a missing credential when the credentials service has no value', async () => {
    ctx = new Context()
    const llm = new LlmRuntime(ctx)
    ctx.provide('credentials', {
      resolve: async () => undefined,
    } as never)
    Plugin.apply(ctx, mutableConfig({ baseURL: 'https://gateway.example/v1', models: [] }).config)
    await expect(llm.listModels('openai-compatible')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('keeps the registration when an update changes nothing', () => {
    const { llm } = boot({ baseURL: 'https://gateway.example/v1' })
    emitUpdate()
    expect(llm.listProviders()).toEqual([{ id: 'openai-compatible', name: 'OpenAI Compatible' }])
  })
})
