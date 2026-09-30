/** Deterministic chat-completions fixtures and loopback transport with explicit teardown. */
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import { ToolCallId, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { resolveAdapterOptions } from '../src/config.ts'
import type { Options } from '../src/config.ts'
import { OpenAICompatAdapter } from '../src/adapter.ts'

export const MODEL = 'deepseek-v4-flash'

export const system = (text = 'be brief'): Message => createSystemMessage(text)
export const user = (text = 'hello'): Message =>
  createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
export const assistant = (text: string, calls: { id: string; name: string; arguments: string }[] = []): Message =>
  createAssistantMessage({
    source: { provider: 'openai-compatible', model: MODEL },
    content: [
      ...text.length === 0 ? [] : [{ type: 'text' as const, text }],
      ...calls.map(call => ({
        type: 'tool-call' as const, id: ToolCallId(call.id), name: call.name, arguments: call.arguments,
      })),
    ],
  })
export const toolResult = (callId: string, text = 'done'): Message =>
  createToolResultMessage({ callId: ToolCallId(callId), content: [{ type: 'text', text }], isError: false })

export const options = (overrides: Partial<GenerateOptions> = {}): GenerateOptions => ({
  provider: 'openai-compatible', model: MODEL, messages: [user()], ...overrides,
})

export const config = (overrides: Partial<Options> = {}): Options => ({
  provider: 'openai-compatible',
  displayName: 'OpenAI Compatible',
  baseURL: 'http://localhost:0/v1',
  apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
  models: [],
  maxTokens: 8192,
  defaultContextWindow: 128_000,
  streamIdleTimeoutMs: 300_000,
  ...overrides,
})

export const resolved = (overrides: Partial<Options> = {}) => {
  const connection = resolveAdapterOptions(config(overrides))
  if (connection === undefined) throw new Error('test connection unexpectedly dormant')
  return connection
}

type AdapterDependencies = Partial<ConstructorParameters<typeof OpenAICompatAdapter>[0]>

export const adapter = (overrides: Partial<Options> = {}, dependencies: AdapterDependencies = {}) =>
  new OpenAICompatAdapter({
    options: () => resolved(overrides),
    resolveAuth: async () => ({ headers: { authorization: 'Bearer test-key' } }),
    ...dependencies,
  })

/** One text-only completion stream ending with usage and [DONE]. */
export const textFrames = (text = 'Hello 世界') => [
  { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
  '[DONE]',
]
export const sse = (frames: unknown[]) => frames
  .map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`)
  .join('')

export async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const output: StreamChunk[] = []
  for await (const chunk of stream) output.push(chunk)
  return output
}

export interface RecordedRequest { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }

type ServerReply = (response: ServerResponse, count: number) => void

export async function server(reply: ServerReply = response => response.end(sse(textFrames()))): Promise<{
  url: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}> {
  const requests: RecordedRequest[] = []
  const http = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => response.destroy(error as Error))
  })
  async function handle(request: import('node:http').IncomingMessage, response: ServerResponse) {
    const parts: Buffer[] = []
    for await (const part of request as AsyncIterable<Buffer>) parts.push(part)
    const text = Buffer.concat(parts).toString()
    const body: Record<string, unknown> = text.length === 0 ? {} : JSON.parse(text) as Record<string, unknown>
    requests.push({ path: request.url!, headers: request.headers, body })
    reply(response, requests.length)
  }
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('loopback server failed to bind')
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      await new Promise<void>((resolve) => {
        http.close(() => { resolve() })
      })
    },
  }
}
