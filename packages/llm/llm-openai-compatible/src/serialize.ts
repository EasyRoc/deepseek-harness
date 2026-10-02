/** Project the neutral conversation vocabulary onto one OpenAI chat-completions request body. */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, RequestMessage, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { OpenAICompatConnectionOptions } from './types.ts'

/** One OpenAI chat message in wire form; string content only, tool calls on assistants. */
export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

/** Assembled chat-completions request body. */
export interface WireBody {
  model: string
  messages: WireMessage[]
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[]
  stream: true
  stream_options?: { include_usage: true }
  temperature?: number
  max_tokens?: number
  stop?: string[]
}

/** Join the visible text of one content list; other block kinds are rejected here.
 * @param blocks - content blocks of one message.
 * @param role - wire role used in the failure message.
 * @returns the concatenated text, or an empty string when the message has no text.
 */
function textOf(blocks: readonly ContentBlock[], role: string): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text
    throw new LlmError(
      `llm-openai-compatible: ${role} message contains a ${block.type} block; this route sends text and tool calls only`,
      'INVALID_REQUEST',
    )
  }).join('')
}

/** Serialize the declared tools; deferred loading has no OpenAI-compatible spelling.
 * @param tools - tool schemas from the request.
 * @returns the wire `tools` array, or `undefined` without declarations.
 */
function wireTools(tools: readonly ToolSchema[] | undefined): WireBody['tools'] {
  if (tools === undefined || tools.length === 0) return undefined
  return tools.map((tool) => {
    if (tool.deferLoading === true) {
      throw new LlmError(
        `llm-openai-compatible: tool "${tool.name}" requests deferred loading; this route declares the complete tool list every request`,
        'UNSUPPORTED_OPTION',
      )
    }
    return { type: 'function' as const, function: { name: tool.name, description: tool.description, parameters: tool.parameters } }
  })
}

/** Project one conversation message; assistant reasoning has no portable spelling.
 * @param message - the conversation message.
 * @returns the wire message, or `undefined` for messages with no wire content.
 */
function wireMessage(message: RequestMessage): WireMessage | undefined {
  switch (message.role) {
    case 'system': {
      const content = textOf(message.content, 'system')
      return content.length === 0 ? undefined : { role: 'system', content }
    }
    case 'developer': {
      // Routes without mid-conversation tool updates receive complete
      // declarations; tool-change blocks are projection state, not content.
      const content = message.content
        .filter(block => block.type !== 'tool-addition' && block.type !== 'tool-removal')
        .map(block => block.type === 'text' ? block.text : '')
        .join('')
      return content.length === 0 ? undefined : { role: 'system', content }
    }
    case 'user':
      return { role: 'user', content: textOf(message.content, 'user') }
    case 'assistant': {
      const toolCalls = message.content
        .filter((block): block is Extract<typeof block, { type: 'tool-call' }> => block.type === 'tool-call')
        .map(block => ({ id: block.id, type: 'function' as const, function: { name: block.name, arguments: block.arguments } }))
      const content = message.content
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
      return {
        role: 'assistant',
        content: content.length === 0 ? null : content,
        ...toolCalls.length === 0 ? {} : { tool_calls: toolCalls },
      }
    }
    case 'tool': {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: textOf(message.content, 'tool'),
      }
    }
  }
}

/** Serialize one request into the OpenAI chat-completions body.
 * @param options - the assembled request.
 * @param connection - validated connection snapshot supplying the output default.
 * @returns the wire body; `messages` always starts with the effective system turn.
 */
export function serialize(options: GenerateOptions, connection: OpenAICompatConnectionOptions): WireBody {
  if (options.reasoningEffort !== undefined) {
    throw new LlmError(
      `llm-openai-compatible: route "${options.provider}" exposes no reasoning efforts; unset the reasoning effort for this model`,
      'UNSUPPORTED_OPTION',
    )
  }
  const messages: WireMessage[] = []
  if (options.system !== undefined && options.system.length > 0) messages.push({ role: 'system', content: options.system })
  for (const message of options.messages) {
    const wire = wireMessage(message)
    if (wire !== undefined) messages.push(wire)
  }
  const wireModel = options.model.toLowerCase()
  const omitTools = connection.toolOmitModelSubstrings.some(substring => wireModel.includes(substring))
  const tools = omitTools ? undefined : wireTools(options.tools)
  return {
    model: options.model,
    messages,
    ...tools === undefined ? {} : { tools },
    stream: true,
    ...connection.streamUsage ? { stream_options: { include_usage: true } } : {},
    ...options.temperature === undefined ? {} : { temperature: options.temperature },
    max_tokens: options.maxTokens ?? connection.maxTokens,
    ...options.stop === undefined ? {} : { stop: options.stop },
  }
}
