/**
 * Real chat-completions round trips require a gateway endpoint, a credential,
 * and a model the key can serve. Self-skipping keeps keyless CI green.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { OpenAICompatAdapter } from '../src/adapter.ts'
import { resolveAdapterOptions } from '../src/config.ts'
import { fetchGatewayModels } from '../src/models.ts'
import { collect } from './helpers.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

const BASE_URL = process.env.OPENAI_COMPATIBLE_BASE_URL
const API_KEY = process.env.OPENAI_COMPATIBLE_API_KEY
const MODEL = process.env.OPENAI_COMPATIBLE_E2E_MODEL
const READY = BASE_URL !== undefined && API_KEY !== undefined && MODEL !== undefined

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

function adapter(): OpenAICompatAdapter {
  const connection = resolveAdapterOptions({
    provider: 'openai-compatible',
    displayName: 'OpenAI Compatible',
    baseURL: BASE_URL as string,
    models: [],
  })
  if (connection === undefined) throw new Error('e2e connection unexpectedly dormant')
  const auth = { headers: { authorization: `Bearer ${API_KEY as string}` } }
  return new OpenAICompatAdapter({
    options: () => connection,
    resolveAuth: async () => auth,
    discoverModels: async () => fetchGatewayModels(connection.baseURL, auth.headers, new AbortController().signal),
  })
}

describe.skipIf(!READY)('OpenAI-compatible real gateway', () => {
  it('discovers the gateway model listing', async () => {
    const models = await fetchGatewayModels(BASE_URL as string, { authorization: `Bearer ${API_KEY as string}` }, new AbortController().signal)
    expect(models.length).toBeGreaterThan(0)
  })

  it('streams a text completion with usage before finish', async () => {
    const stream = adapter().stream({
      provider: 'openai-compatible',
      model: MODEL as string,
      messages: [{ role: 'user', id: undefined, source: { kind: 'user' }, content: [{ type: 'text', text: 'Reply with exactly: ok' }] }] as never,
      maxTokens: 200,
    })
    const chunks = await collect(stream)
    const kinds = chunks.map(chunk => chunk.type)
    expect(kinds).toContain('text-delta')
    const usageIndex = kinds.indexOf('usage')
    const finishIndex = kinds.indexOf('finish')
    expect(usageIndex).toBeGreaterThan(-1)
    expect(finishIndex).toBe(usageIndex + 1)
    expect(kinds.slice(finishIndex + 1)).toEqual([])
    const text = chunks
      .filter((chunk): chunk is Extract<typeof chunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map(chunk => chunk.text)
      .join('')
    expect(text.toLowerCase()).toContain('ok')
  })

  it('round-trips a tool call with the wire arguments', async () => {
    const stream = adapter().stream({
      provider: 'openai-compatible',
      model: MODEL as string,
      messages: [{ role: 'user', id: undefined, source: { kind: 'user' }, content: [{ type: 'text', text: 'What is the weather in Beijing? Use the tool.' }] }] as never,
      tools: [{
        name: 'get_weather',
        description: 'Current weather for a city',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      }],
      maxTokens: 400,
    })
    const chunks = await collect(stream)
    const toolBlocks = chunks
      .filter((chunk): chunk is Extract<typeof chunk, { type: 'block-end' }> => chunk.type === 'block-end')
      .map(chunk => chunk.block)
      .filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
    expect(toolBlocks.length).toBeGreaterThan(0)
    const call = toolBlocks[0]!
    expect(call.name).toBe('get_weather')
    const parsed: unknown = JSON.parse(call.arguments)
    expect(parsed).toMatchObject({ city: 'Beijing' })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  })
})
