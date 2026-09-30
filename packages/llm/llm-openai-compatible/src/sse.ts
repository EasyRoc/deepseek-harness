/** SSE framing delegated to eventsource-parser; the `[DONE]` marker ends the stream. */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { providerError } from './transport.ts'

/** Decode complete SSE frames without treating an unterminated tail as an event.
 * @param body - provider response bytes.
 * @param activity - pulse the idle watchdog for events and heartbeat comments.
 * @returns JSON data frames in wire order; the terminal `data: [DONE]` frame is consumed here.
 */
export async function* parseSse(body: ReadableStream<BufferSource>, activity: () => void): AsyncGenerator<Record<string, unknown>> {
  const events = body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({ onComment: activity }))
  for await (const frame of events) {
    activity()
    const data = frame.data
    if (data === '[DONE]') return
    let raw: unknown
    try { raw = JSON.parse(data) } catch (_invalidSseJson) {
      throw new LlmError('OpenAI-compatible SSE frame contains invalid JSON', 'MALFORMED_RESPONSE')
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new LlmError('OpenAI-compatible SSE frame is not an object', 'MALFORMED_RESPONSE')
    }
    const event = raw as Record<string, unknown>
    if (typeof event.error === 'object' && event.error !== null) throw providerError(event, undefined)
    yield event
  }
}
