/** Request projection onto the OpenAI chat-completions body. */
import { ToolCallId, createAssistantMessage, createDeveloperMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { serialize } from '../src/serialize.ts'
import { MODEL, assistant, resolved, system, toolResult, user } from './helpers.ts'

const connection = resolved()

describe('serialize', () => {
  it('maps a system turn, user text, and the fixed stream fields', () => {
    const body = serialize({ provider: 'openai-compatible', model: MODEL, messages: [system('be brief'), user('hi')] }, connection)
    expect(body).toMatchObject({
      model: MODEL,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: connection.maxTokens,
    })
    expect(body.tools).toBeUndefined()
  })

  it('prepends one-shot system text ahead of the conversation', () => {
    const body = serialize({ provider: 'p', model: MODEL, messages: [user()], system: 'one-shot' }, connection)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'one-shot' })
  })

  it('skips an empty system prompt and empty developer messages', () => {
    const emptySystem = createSystemMessage('')
    const toolOnlyDeveloper = createDeveloperMessage({
      source: { kind: 'user' },
      content: [{ type: 'tool-addition', toolName: 'x' }],
    })
    const body = serialize({ provider: 'p', model: MODEL, messages: [emptySystem, toolOnlyDeveloper, user()] }, connection)
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('projects developer text as a system turn and ignores tool-change blocks around it', () => {
    const developer = createDeveloperMessage({
      source: { kind: 'user' },
      content: [{ type: 'tool-addition', toolName: 'x' }, { type: 'text', text: 'note' }, { type: 'tool-removal', toolName: 'y' }],
    })
    const body = serialize({ provider: 'p', model: MODEL, messages: [developer] }, connection)
    expect(body.messages).toEqual([{ role: 'system', content: 'note' }])
    const reasoningOnly = createDeveloperMessage({
      source: { kind: 'user' },
      content: [{ type: 'reasoning', text: 'scratch' }],
    })
    expect(serialize({ provider: 'p', model: MODEL, messages: [reasoningOnly] }, connection).messages).toEqual([])
  })

  it('serializes assistant text and tool calls, with null content for pure calls', () => {
    const textAndCalls = assistant('working', [{ id: 'call_1', name: 'echo', arguments: '{"x":1}' }])
    const pureCalls = createAssistantMessage({
      source: { provider: 'p', model: MODEL },
      content: [{ type: 'tool-call', id: ToolCallId('call_2'), name: 'echo', arguments: '{}' }],
    })
    const textOnly = assistant('plain')
    const body = serialize({ provider: 'p', model: MODEL, messages: [textAndCalls, pureCalls, textOnly] }, connection)
    expect(body.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'working',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"x":1}' } }],
    })
    expect(body.messages[1]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 'call_2' }] })
    expect(body.messages[2]).toEqual({ role: 'assistant', content: 'plain' })
  })

  it('maps tool results onto the tool role with their call id', () => {
    const body = serialize({ provider: 'p', model: MODEL, messages: [toolResult('call_1', 'done')] }, connection)
    expect(body.messages).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: 'done' }])
  })

  it('omits stream_options when streamUsage is disabled on the route', () => {
    const body = serialize({ provider: 'p', model: MODEL, messages: [user()] }, resolved({ streamUsage: false }))
    expect(body.stream).toBe(true)
    expect(body.stream_options).toBeUndefined()
  })

  it('carries optional request fields and the connection output default', () => {
    const body = serialize({
      provider: 'p', model: MODEL, messages: [user()], temperature: 0.5, maxTokens: 128, stop: ['END'],
    }, resolved({ maxTokens: 77 }))
    expect(body.temperature).toBe(0.5)
    expect(body.max_tokens).toBe(128)
    expect(body.stop).toEqual(['END'])
    const defaulted = serialize({ provider: 'p', model: MODEL, messages: [user()] }, resolved({ maxTokens: 77 }))
    expect(defaulted.max_tokens).toBe(77)
  })

  it('omits tools when the wire model matches a configured substring', () => {
    const route = resolved({ toolOmitModelSubstrings: ['glm', 'qwen'] })
    const body = serialize({
      provider: 'p', model: 'glm-5.3-flash', messages: [user()],
      tools: [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }],
    }, route)
    expect(body.tools).toBeUndefined()
    const kept = serialize({
      provider: 'p', model: 'deepseek-v4-flash', messages: [user()],
      tools: [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }],
    }, route)
    expect(kept.tools).toHaveLength(1)
  })

  it('serializes declared tools and rejects deferred loading', () => {
    const body = serialize({
      provider: 'p', model: MODEL, messages: [user()],
      tools: [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }],
    }, connection)
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'echo', description: 'Echo', parameters: { type: 'object' } } }])
    expect(serialize({ provider: 'p', model: MODEL, messages: [user()], tools: [] }, connection).tools).toBeUndefined()
    expect(() => serialize({
      provider: 'p', model: MODEL, messages: [user()],
      tools: [{ name: 'lazy', description: 'Lazy', parameters: {}, deferLoading: true }],
    }, connection)).toThrow(/tool "lazy" requests deferred loading/)
  })

  it('rejects reasoning efforts and non-text content blocks', () => {
    expect(() => serialize({ provider: 'p', model: MODEL, messages: [user()], reasoningEffort: 'high' as never }, connection))
      .toThrow(/exposes no reasoning efforts/)
    const withImage = createUserMessage({
      source: { kind: 'user' },
      content: [{
        type: 'image',
        attachment: { kind: 'image', mediaType: 'image/png', data: new Uint8Array(), width: 1, height: 1 } as never,
      }],
    })
    expect(() => serialize({ provider: 'p', model: MODEL, messages: [withImage] }, connection)).toThrow(/contains a image block/)
  })
})
