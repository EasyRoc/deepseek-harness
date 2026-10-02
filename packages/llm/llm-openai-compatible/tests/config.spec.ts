/** Configuration resolution: dormant state, validation bounds, and catalog rules. */
import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { Config, plainOptions, resolveAdapterOptions } from '../src/config.ts'
import { config } from './helpers.ts'

describe('resolveAdapterOptions', () => {
  it('is dormant without a baseURL', () => {
    const { baseURL: _omit, ...dormant } = config()
    expect(resolveAdapterOptions(dormant)).toBeUndefined()
  })

  it('resolves the complete connection snapshot with defaults', () => {
    const connection = resolveAdapterOptions(config({ baseURL: 'https://gateway.example/v1' }))!
    expect(connection).toMatchObject({
      baseURL: 'https://gateway.example/v1',
      provider: 'openai-compatible',
      providerName: 'OpenAI Compatible',
      maxTokens: 8192,
      defaultContextWindow: 128_000,
      models: [],
      apiKeyEnv: credentialRef('OPENAI_COMPATIBLE_API_KEY'),
      requireAccountSession: false,
      toolOmitModelSubstrings: [],
    })
  })

  it('falls back to schema defaults for omitted identity and credential fields', () => {
    const {
      provider: _p, displayName: _d, apiKeyEnv: _k, streamIdleTimeoutMs: _s, models: _m,
      maxTokens: _x, defaultContextWindow: _c, ...minimal
    } = config({ baseURL: 'https://gateway.example/v1' })
    const connection = resolveAdapterOptions(minimal)!
    expect(connection.provider).toBe('openai-compatible')
    expect(connection.providerName).toBe('OpenAI Compatible')
    expect(connection.apiKeyEnv).toBe(credentialRef('OPENAI_COMPATIBLE_API_KEY'))
    expect(connection.streamIdleTimeoutMs).toBe(300_000)
    expect(connection.models).toEqual([])
    expect(connection.maxTokens).toBe(8192)
    expect(connection.defaultContextWindow).toBe(128_000)
  })

  it('brands the credential reference from the configured variable name', () => {
    const connection = resolveAdapterOptions(config({ apiKeyEnv: 'MOLDEX_API_KEY' }))!
    expect(connection.apiKeyEnv).toBe(credentialRef('MOLDEX_API_KEY'))
  })

  it('rejects non-HTTP endpoints and URLs with credentials, query, fragment, or a trailing slash', () => {
    expect(() => resolveAdapterOptions(config({ baseURL: 'ftp://gateway.example/v1' }))).toThrow(/HTTP\(S\) root/)
    expect(() => resolveAdapterOptions(config({ baseURL: 'https://user:pass@gateway.example/v1' }))).toThrow(/HTTP\(S\) root/)
    expect(() => resolveAdapterOptions(config({ baseURL: 'https://gateway.example/v1?x=1' }))).toThrow(/HTTP\(S\) root/)
    expect(() => resolveAdapterOptions(config({ baseURL: 'https://gateway.example/v1#f' }))).toThrow(/HTTP\(S\) root/)
    expect(() => resolveAdapterOptions(config({ baseURL: 'https://gateway.example/v1/' }))).toThrow(/must not end with a slash/)
  })

  it('rejects an empty provider route id', () => {
    expect(() => resolveAdapterOptions(config({ provider: '' }))).toThrow(/non-empty route id/)
  })

  it('rejects non-positive bounds', () => {
    expect(() => resolveAdapterOptions(config({ maxTokens: 0 }))).toThrow(/maxTokens must be a positive safe integer/)
    expect(() => resolveAdapterOptions(config({ defaultContextWindow: -1 })))
      .toThrow(/defaultContextWindow must be a positive safe integer/)
    expect(() => resolveAdapterOptions(config({ streamIdleTimeoutMs: 0 }))).toThrow(/streamIdleTimeoutMs must be a positive finite number/)
    expect(() => resolveAdapterOptions(config({ streamIdleTimeoutMs: Number.MAX_SAFE_INTEGER + 1 }))).toThrow(/streamIdleTimeoutMs/)
  })

  it('validates catalog models and rejects duplicates', () => {
    expect(() => resolveAdapterOptions(config({ models: [{ id: '' }] }))).toThrow(/ids must be non-empty/)
    expect(() => resolveAdapterOptions(config({ models: [{ id: 'm', name: '' }] }))).toThrow(/has an empty name/)
    expect(() => resolveAdapterOptions(config({ models: [{ id: 'm', contextWindow: 0 }] })))
      .toThrow(/contextWindow must be a positive integer/)
    expect(() => resolveAdapterOptions(config({ models: [{ id: 'm' }, { id: 'm' }] }))).toThrow(/duplicate catalog model "m"/)
    const connection = resolveAdapterOptions(config({ models: [{ id: 'm', name: 'M', description: 'D', contextWindow: 4096 }] }))!
    expect(connection.models).toEqual([{ id: 'm', name: 'M', description: 'D', contextWindow: 4096 }])
  })

  it('passes plain (non-volatile) entries through untouched', () => {
    expect(plainOptions(config({ baseURL: 'https://gateway.example/v1' }) as never)).toMatchObject({
      provider: 'openai-compatible',
      baseURL: 'https://gateway.example/v1',
    })
  })

  it('resolves the retry policy and surfaces resolver failures', () => {
    const connection = resolveAdapterOptions(config({ retryPolicy: { mode: 'normal', maxRetries: 2 } }))!
    expect(connection.retryPolicy).toEqual(resolveRetryPolicy({ mode: 'normal', maxRetries: 2 }, 'llm-openai-compatible: retryPolicy'))
    expect(() => resolveAdapterOptions(config({ retryPolicy: { mode: 'nope' } as never }))).toThrow(/retryPolicy/)
  })
})

describe('plainOptions', () => {
  it('reads every volatile reference into plain values', () => {
    const parsed = Config(config({ baseURL: 'https://gateway.example/v1' }))
    const options = plainOptions(parsed)
    expect(options.baseURL).toBe('https://gateway.example/v1')
    expect(options.apiKeyEnv).toBe('OPENAI_COMPATIBLE_API_KEY')
  })
})
