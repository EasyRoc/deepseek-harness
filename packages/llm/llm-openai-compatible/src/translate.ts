/** Translate OpenAI chat-completions SSE frames into the harness chunk vocabulary. */

import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

/** One prose block being assembled; at most one is open at a time. */
interface ProseBlock {
  readonly index: number
  readonly blockType: 'text' | 'reasoning'
  text: string
}

/** One tool-call block being assembled, keyed by its wire fragment index. */
interface ToolBlock {
  readonly index: number
  readonly blockType: 'tool-call'
  toolCall: { id: string; name: string; arguments: string }
}

/** Wire identity of one streaming tool-call fragment. */
interface ToolFragment {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAIDelta {
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
  tool_calls?: ToolFragment[]
}

interface OpenAIChoice {
  delta?: OpenAIDelta | null
  finish_reason?: string | null
}

interface OpenAIChunk {
  choices?: OpenAIChoice[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

/** Project wire chunks onto first-seen block order; at most one prose block is open at a time. */
export class OpenAIStreamTranslator {
  private readonly toolBlocks = new Map<number, ToolBlock>()
  private openProse: ProseBlock | undefined
  private finishReason: FinishReason | undefined
  private usage: TokenUsage | undefined
  private nextIndex = 0

  /** Map one wire chunk onto zero or more harness chunks.
   * @param event - one decoded `data:` frame.
   * @returns the harness chunks for this frame; block ends arrive at {@link done}.
   */
  push(event: Record<string, unknown>): StreamChunk[] {
    const chunk = event as OpenAIChunk
    if (chunk.usage !== undefined) this.usage = this.wireUsage(chunk.usage)
    const choice = chunk.choices?.[0]
    if (choice === undefined) return []
    if (this.finishReason === undefined && choice.finish_reason != null) {
      this.finishReason = this.wireFinishReason(choice.finish_reason)
    }
    const delta = choice.delta
    if (delta === undefined || delta === null) return []
    const output: StreamChunk[] = []
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      output.push(...this.proseDelta('reasoning', reasoning))
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      output.push(...this.proseDelta('text', delta.content))
    }
    for (const fragment of delta.tool_calls ?? []) {
      output.push(...this.toolDelta(fragment))
    }
    return output
  }

  /** Close every open block and emit the terminal usage and finish chunks.
   * @returns the remaining chunks; `usage` precedes `finish` and nothing follows it.
   */
  done(): StreamChunk[] {
    const output: StreamChunk[] = []
    if (this.openProse !== undefined) {
      output.push(this.closeProse(this.openProse))
      this.openProse = undefined
    }
    for (const block of [...this.toolBlocks.values()].sort((left, right) => left.index - right.index)) {
      output.push(this.closeTool(block))
      this.toolBlocks.delete(block.index)
    }
    output.push({ type: 'usage', usage: this.usage ?? { inputTokens: 0, outputTokens: 0 } })
    output.push({ type: 'finish', reason: this.finishReason ?? { kind: 'stop' } })
    return output
  }

  /** A prose delta continues the open prose block only when it has the same kind. */
  private proseDelta(blockType: 'text' | 'reasoning', text: string): StreamChunk[] {
    const output: StreamChunk[] = []
    if (this.openProse !== undefined && this.openProse.blockType !== blockType) {
      output.push(this.closeProse(this.openProse))
      this.openProse = undefined
    }
    if (this.openProse === undefined) {
      this.openProse = { index: this.nextIndex++, blockType, text: '' }
      output.push({ type: 'block-start', index: this.openProse.index, blockType })
    }
    this.openProse.text += text
    output.push(blockType === 'text'
      ? { type: 'text-delta', index: this.openProse.index, text }
      : { type: 'reasoning-delta', index: this.openProse.index, text })
    return output
  }

  /** A tool fragment closes any open prose block; wire indexes map to first-seen block indexes. */
  private toolDelta(fragment: ToolFragment): StreamChunk[] {
    const output: StreamChunk[] = []
    if (this.openProse !== undefined) {
      output.push(this.closeProse(this.openProse))
      this.openProse = undefined
    }
    let block = this.toolBlocks.get(fragment.index)
    if (block === undefined) {
      block = {
        index: this.nextIndex++,
        blockType: 'tool-call',
        toolCall: {
          id: fragment.id ?? `call_${fragment.index}`,
          name: fragment.function?.name ?? '',
          arguments: '',
        },
      }
      this.toolBlocks.set(fragment.index, block)
      output.push({ type: 'block-start', index: block.index, blockType: 'tool-call' })
      output.push({
        type: 'tool-call-delta',
        index: block.index,
        id: ToolCallId(block.toolCall.id),
        name: block.toolCall.name,
        argumentsDelta: fragment.function?.arguments ?? '',
      })
    } else {
      output.push({
        type: 'tool-call-delta',
        index: block.index,
        id: ToolCallId(block.toolCall.id),
        argumentsDelta: fragment.function?.arguments ?? '',
      })
    }
    block.toolCall.arguments += fragment.function?.arguments ?? ''
    return output
  }

  private closeProse(block: ProseBlock): StreamChunk {
    return { type: 'block-end', index: block.index, block: { type: block.blockType, text: block.text } }
  }

  private closeTool(block: ToolBlock): StreamChunk {
    return {
      type: 'block-end',
      index: block.index,
      block: { type: 'tool-call', id: ToolCallId(block.toolCall.id), name: block.toolCall.name, arguments: block.toolCall.arguments },
    }
  }

  private wireFinishReason(reason: string): FinishReason {
    if (reason === 'tool_calls' || reason === 'function_call') return { kind: 'tool-calls' }
    if (reason === 'length') return { kind: 'max-tokens' }
    return { kind: 'stop' }
  }

  private wireUsage(usage: NonNullable<OpenAIChunk['usage']>): TokenUsage {
    const promptTokens = usage.prompt_tokens ?? 0
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
    return {
      inputTokens: Math.max(0, promptTokens - cached),
      outputTokens: usage.completion_tokens ?? 0,
      ...usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens },
      ...cached > 0 ? { cacheReadTokens: cached } : {},
      ...usage.completion_tokens_details?.reasoning_tokens ? { reasoningTokens: usage.completion_tokens_details.reasoning_tokens } : {},
    }
  }
}
