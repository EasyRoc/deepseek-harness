/** Chunk translation: block continuity, tool fragments, usage ordering, and finish mapping. */
import { describe, expect, it } from 'vitest'
import { OpenAIStreamTranslator } from '../src/translate.ts'

describe('OpenAIStreamTranslator', () => {
  it('continues one text block across contiguous deltas', () => {
    const translator = new OpenAIStreamTranslator()
    expect(translator.push({ choices: [{ delta: { content: 'Hel' } }] })).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hel' },
    ])
    expect(translator.push({ choices: [{ delta: { content: 'lo' } }] })).toEqual([
      { type: 'text-delta', index: 0, text: 'lo' },
    ])
  })

  it('splits reasoning and text into separate blocks and closes on kind change', () => {
    const translator = new OpenAIStreamTranslator()
    expect(translator.push({ choices: [{ delta: { reasoning_content: 'think' } }] })).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'think' },
    ])
    expect(translator.push({ choices: [{ delta: { content: 'answer' } }] })).toEqual([
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'answer' },
    ])
    expect(translator.push({ choices: [{ delta: { reasoning: 'more' } }] })).toEqual([
      { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
      { type: 'block-start', index: 2, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 2, text: 'more' },
    ])
  })

  it('reassembles tool-call fragments by wire index with synthesized ids', () => {
    const translator = new OpenAIStreamTranslator()
    const fragment = (index: number, rest: Record<string, unknown> = {}) =>
      ({ choices: [{ delta: { tool_calls: [{ index, ...rest }] } }] })
    expect(translator.push(fragment(0, { id: 'call_1', function: { name: 'echo', arguments: '{"x"' } })))
      .toEqual([
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'echo', argumentsDelta: '{"x"' },
      ])
    expect(translator.push(fragment(0, { function: { arguments: ':1}' } })))
      .toEqual([{ type: 'tool-call-delta', index: 0, id: 'call_1', argumentsDelta: ':1}' }])
    expect(translator.push(fragment(1, { id: 'call_2', function: { name: 'nop' } })))
      .toEqual([
        { type: 'block-start', index: 1, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 1, id: 'call_2', name: 'nop', argumentsDelta: '' },
      ])
    expect(translator.push(fragment(2)))
      .toEqual([
        { type: 'block-start', index: 2, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 2, id: 'call_2', name: '', argumentsDelta: '' },
      ])
    expect(translator.push(fragment(0)))
      .toEqual([{ type: 'tool-call-delta', index: 0, id: 'call_1', argumentsDelta: '' }])
  })

  it('closes multiple tool blocks in first-seen order at done', () => {
    const translator = new OpenAIStreamTranslator()
    const fragment = (index: number, rest: Record<string, unknown>) =>
      ({ choices: [{ delta: { tool_calls: [{ index, ...rest }] } }] })
    translator.push(fragment(0, { id: 'a', function: { name: 'one', arguments: '{}' } }))
    translator.push(fragment(1, { id: 'b', function: { name: 'two', arguments: '{"y":2}' } }))
    expect(translator.done().slice(0, 2)).toEqual([
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'a', name: 'one', arguments: '{}' } },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'b', name: 'two', arguments: '{"y":2}' } },
    ])
  })

  it('closes interleaved prose before tool blocks and closes everything at done', () => {
    const translator = new OpenAIStreamTranslator()
    expect(translator.push({ choices: [{ delta: { content: 'a' } }] })[0]?.type).toBe('block-start')
    const toolStart = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'e', arguments: '{}' } }] } }] }
    expect(translator.push(toolStart)[0])
      .toEqual({ type: 'block-end', index: 0, block: { type: 'text', text: 'a' } })
    expect(translator.push({ choices: [{ delta: { content: 'b' } }] })).toEqual([
      { type: 'block-start', index: 2, blockType: 'text' },
      { type: 'text-delta', index: 2, text: 'b' },
    ])
    const tail = translator.done()
    expect(tail.slice(0, 4)).toEqual([
      { type: 'block-end', index: 2, block: { type: 'text', text: 'b' } },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call_1', name: 'e', arguments: '{}' } },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('emits usage before finish, subtracts cached input, and carries detail counters', () => {
    const translator = new OpenAIStreamTranslator()
    translator.push({ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] })
    translator.push({
      choices: [],
      usage: {
        prompt_tokens: 12, completion_tokens: 4, total_tokens: 16,
        prompt_tokens_details: { cached_tokens: 7 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    })
    const tail = translator.done()
    expect(tail).toEqual([
      { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 4, totalTokens: 16, cacheReadTokens: 7, reasoningTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const bare = new OpenAIStreamTranslator()
    bare.push({ choices: [], usage: {} })
    expect(bare.done().at(-2)).toEqual({ type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } })
  })

  it('maps finish reasons and keeps the first one seen', () => {
    const translator = new OpenAIStreamTranslator()
    translator.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    translator.push({ choices: [{ delta: {}, finish_reason: 'length' }] })
    expect(translator.done().at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    const legacy = new OpenAIStreamTranslator()
    legacy.push({ choices: [{ delta: {}, finish_reason: 'function_call' }] })
    expect(legacy.done().at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    const length = new OpenAIStreamTranslator()
    length.push({ choices: [{ delta: {}, finish_reason: 'length' }] })
    expect(length.done().at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
    const other = new OpenAIStreamTranslator()
    other.push({ choices: [{ delta: {}, finish_reason: 'content_filter' }] })
    expect(other.done().at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('ignores absent choices, null deltas, and empty prose fragments', () => {
    const translator = new OpenAIStreamTranslator()
    expect(translator.push({})).toEqual([])
    expect(translator.push({ choices: [] })).toEqual([])
    expect(translator.push({ choices: [{ delta: null }] })).toEqual([])
    expect(translator.push({ choices: [{ delta: { content: '', reasoning_content: null } }] })).toEqual([])
    expect(translator.push({ choices: [{ delta: { content: 'x' } }], usage: undefined })).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'x' },
    ])
  })
})
