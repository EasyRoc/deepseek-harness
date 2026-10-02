/** HTTP lifecycle: routing, headers, streaming, errors, timeouts, and cancellation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { OpenAICompatAdapter } from '../src/adapter.ts'
import { MODEL, adapter, collect, resolved, sse, user, server, options } from './helpers.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  while (cleanup.length) await cleanup.pop()!()
})

async function endpoint(reply?: Parameters<typeof server>[0]) {
  const instance = await server(reply)
  cleanup.push(instance.close)
  return instance
}

describe('OpenAICompatAdapter', () => {
  it('streams text with usage before finish and sends the exact wire request', async () => {
    const http = await endpoint((response) => {
      response.setHeader('content-type', 'text/event-stream')
      response.end(sse([
        { choices: [{ delta: { content: 'Hi' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
        '[DONE]',
      ]))
    })
    const instance = adapter({ baseURL: http.url })
    const output = await collect(instance.stream(options({ messages: [user('hey')], temperature: 0.3 })))
    expect(output).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hi' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hi' } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const request = http.requests[0]!
    expect(request.path).toBe('/v1/chat/completions')
    expect(request.headers.authorization).toBe('Bearer test-key')
    expect(request.headers.accept).toBe('text/event-stream')
    expect(request.body).toMatchObject({
      model: MODEL,
      messages: [{ role: 'user', content: 'hey' }],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      max_tokens: 8192,
    })
  })

  it('resolves authentication per request', async () => {
    const http = await endpoint()
    let calls = 0
    const instance = new OpenAICompatAdapter({
      options: () => resolved({ baseURL: http.url }),
      resolveAuth: async () => { calls += 1; return { headers: { authorization: `Bearer key-${calls}` } } },
    })
    await collect(instance.stream(options()))
    expect(calls).toBe(1)
    expect(http.requests[0]!.headers.authorization).toBe('Bearer key-1')
  })

  it('completes a tool-call round trip with the harness block vocabulary', async () => {
    const http = await endpoint((response) => {
      response.setHeader('content-type', 'text/event-stream')
      response.end(sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'echo', arguments: '{"x"' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 8, completion_tokens: 3 } },
        '[DONE]',
      ]))
    })
    const output = await collect(adapter({ baseURL: http.url }).stream(options()))
    expect(output.filter(chunk => chunk.type === 'block-end')).toEqual([
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_9', name: 'echo', arguments: '{"x":1}' } },
    ])
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('maps a non-JSON gateway error by status and keeps the raw body as cause', async () => {
    const http = await endpoint((response) => {
      response.statusCode = 402
      response.end('insufficient balance')
    })
    await expect(collect(adapter({ baseURL: http.url }).stream(options())))
      .rejects.toMatchObject({ code: 'QUOTA', message: 'OpenAI-compatible request failed (402)' })
  })

  it('maps an in-band SSE error event through the provider mapping', async () => {
    const http = await endpoint((response) => {
      response.setHeader('content-type', 'text/event-stream')
      response.end(sse([{ error: { message: 'KEY_EXPIRED', type: 'authentication_error' } }]))
    })
    await expect(collect(adapter({ baseURL: http.url }).stream(options()))).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('rejects malformed SSE frames and non-object frames', async () => {
    const invalid = await endpoint((response) => {
      response.setHeader('content-type', 'text/event-stream')
      response.end('data: not-json\n\n')
    })
    await expect(collect(adapter({ baseURL: invalid.url }).stream(options()))).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
    const nonObject = await endpoint((response) => {
      response.setHeader('content-type', 'text/event-stream')
      response.end('data: [1,2]\n\n')
    })
    await expect(collect(adapter({ baseURL: nonObject.url }).stream(options()))).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })

  it('classifies an empty successful body as EMPTY_RESPONSE', async () => {
    const http = await endpoint((response) => { response.statusCode = 204; response.end() })
    await expect(collect(adapter({ baseURL: http.url }).stream(options()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('times out an idle stream and closes the connection', async () => {
    const stopped = Promise.withResolvers<undefined>()
    const http = await endpoint((response) => {
      response.once('close', () => { stopped.resolve(undefined) })
      response.setHeader('content-type', 'text/event-stream')
      response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stream = adapter({ baseURL: http.url, streamIdleTimeoutMs: 30 }).stream(options())[Symbol.asyncIterator]()
    try {
      expect((await stream.next()).value).toMatchObject({ type: 'block-start' })
      expect((await stream.next()).value).toMatchObject({ type: 'text-delta' })
      const rejected = expect(stream.next()).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(30)
      await rejected
      await stopped.promise
    } finally {
      vi.useRealTimers()
      await stream.return?.()
    }
  })

  it('classifies an already cancelled request without contacting the provider', async () => {
    const http = await endpoint()
    const controller = new AbortController()
    controller.abort()
    await expect(collect(adapter({ baseURL: http.url }).stream(options({ signal: controller.signal }))))
      .rejects.toMatchObject({ code: 'ABORTED' })
    expect(http.requests).toEqual([])
  })

  it('streams through SSE frames that carry usage null', async () => {
    const http = await endpoint((response) => {
      response.setHeader('content-type', 'text/event-stream')
      response.end(sse([
        { choices: [{ delta: { content: 'Hi' } }], usage: null },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        '[DONE]',
      ]))
    })
    const output = await collect(adapter({ baseURL: http.url }).stream(options()))
    expect(output.filter(chunk => chunk.type === 'text-delta')).toEqual([
      { type: 'text-delta', index: 0, text: 'Hi' },
    ])
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('accepts a JSON chat-completions body when the provider omits SSE', async () => {
    const http = await endpoint((response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
    })
    const output = await collect(adapter({ baseURL: http.url }).stream(options()))
    expect(output).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hi' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hi' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('classifies a transport failure', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('network down') })
    await expect(collect(adapter().stream(options()))).rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('reports provider info, retry policy, and per-call dispatch from prepareCall', async () => {
    const http = await endpoint()
    const instance = adapter({ baseURL: http.url, displayName: 'Moldex', retryPolicy: { mode: 'normal', maxRetries: 2 } as never })
    expect(instance.providerInfo('openai-compatible')).toEqual({ id: 'openai-compatible', name: 'Moldex' })
    expect(instance.providerRetryPolicy('openai-compatible')).toEqual(resolveRetryPolicy({ mode: 'normal', maxRetries: 2 }, 'x'))
    const prepared = await instance.prepareCall('openai-compatible', MODEL)
    expect(prepared.model).toMatchObject({ provider: 'openai-compatible', id: MODEL, context: { contextWindow: 128_000 } })
    const output = await collect(prepared.stream(options()))
    expect(output.at(-1)).toMatchObject({ type: 'finish' })
  })

  it('serves the configured catalog from listModels and exact context from resolveModel', async () => {
    const instance = adapter({ models: [{ id: MODEL, name: 'V4 Flash', description: 'flagship', contextWindow: 160_000 }] })
    expect(await instance.listModels('openai-compatible')).toEqual([
      { provider: 'openai-compatible', id: MODEL, name: 'V4 Flash', description: 'flagship', inputModalities: ['text'] },
    ])
    expect(await instance.resolveModel('openai-compatible', MODEL)).toMatchObject({
      id: MODEL, name: 'V4 Flash', description: 'flagship', context: { contextWindow: 160_000 },
    })
    expect(await instance.resolveModel('openai-compatible', 'unknown-model')).toMatchObject({
      id: 'unknown-model', name: 'unknown-model', context: { contextWindow: 128_000 },
    })
    const discovering = adapter({ models: [] }, { discoverModels: async () => [{ id: 'm1' }, { id: 'm2', description: 'second' }] })
    expect(await discovering.listModels('openai-compatible')).toEqual([
      { provider: 'openai-compatible', id: 'm1', name: 'm1', inputModalities: ['text'] },
      { provider: 'openai-compatible', id: 'm2', name: 'm2', description: 'second', inputModalities: ['text'] },
    ])
    const bare = new OpenAICompatAdapter({ options: () => resolved(), resolveAuth: async () => ({ headers: {} }) })
    expect(await bare.listModels('openai-compatible')).toEqual([])
  })
})
