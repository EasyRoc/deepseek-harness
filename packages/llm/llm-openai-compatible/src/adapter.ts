/** OpenAI-compatible chat-completions transport with one cancellable lifecycle per model request. */

import { attributionHeaders, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { serialize } from './serialize.ts'
import { parseSse } from './sse.ts'
import { OpenAIStreamTranslator } from './translate.ts'
import { providerError } from './transport.ts'
import { catalogModelInfo, resolveModelInfo } from './model-info.ts'
import type { OpenAICompatAdapterOptions, OpenAICompatConnectionOptions as Connection } from './types.ts'

/** Provider route speaking the OpenAI chat-completions protocol with server-sent events. */
export class OpenAICompatAdapter<C extends Connection = Connection> extends LlmAdapter {
  constructor(private readonly dependencies: OpenAICompatAdapterOptions<C>) {
    super()
  }

  override providerInfo(provider: string) {
    return { id: provider, name: this.dependencies.options().providerName }
  }

  override providerRetryPolicy(_provider: string) {
    return this.dependencies.options().retryPolicy
  }

  override async listModels(provider: string) {
    const connection = this.dependencies.options()
    if (connection.models.length > 0) return connection.models.map(model => catalogModelInfo(provider, model))
    return (await this.dependencies.discoverModels?.(provider))?.map(model => catalogModelInfo(provider, model)) ?? []
  }

  override resolveModel(provider: string, model: string, _signal?: AbortSignal) {
    return Promise.resolve(resolveModelInfo(this.dependencies.options(), provider, model))
  }

  override prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const connection = this.dependencies.options()
    return Promise.resolve({
      model: resolveModelInfo(connection, provider, model),
      stream: options => this.generate(options, this.dependencies.options()),
    })
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.generate(options, this.dependencies.options())
  }

  private async * generate(options: GenerateOptions, connection: C): AsyncGenerator<StreamChunk> {
    const consumer = new AbortController()
    const signal = options.signal === undefined ? consumer.signal : AbortSignal.any([consumer.signal, options.signal])
    using watchdog = idleWatchdog(signal, connection.streamIdleTimeoutMs, 'OPENAI_COMPATIBLE_IDLE')
    const iterator = this.request(options, connection, watchdog.signal, () => { watchdog.pulse() })
    try {
      while (true) {
        const next = await watchdog.next(iterator)
        if (next.done) return
        yield next.value
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, 'OPENAI_COMPATIBLE_IDLE') !== undefined) {
        throw new LlmError('OpenAI-compatible stream idle timeout', 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) throw new LlmError('OpenAI-compatible request aborted', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : ''
      throw new LlmError(`OpenAI-compatible transport failed${detail}`, 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort()
      try { await iterator.return(undefined) } catch (_abortedRequestCleanup) {
        // The request already settled; aborting its reader cannot replace that outcome.
      }
    }
  }

  private async * request(
    options: GenerateOptions, connection: C, signal: AbortSignal, activity: () => void,
  ): AsyncGenerator<StreamChunk> {
    signal.throwIfAborted()
    const auth = await this.dependencies.resolveAuth(connection)
    const body = serialize(options, connection)
    const response = await fetch(`${connection.baseURL}/chat/completions`, {
      method: 'POST', signal, body: JSON.stringify(body), redirect: 'error',
      headers: {
        ...attributionHeaders(),
        'content-type': 'application/json', 'accept': 'text/event-stream',
        ...auth.headers,
      },
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) {
      const text = await response.text()
      let raw: unknown
      try { raw = JSON.parse(text) } catch (_nonJsonGatewayError) {
        // HTTP status is authoritative when a gateway does not return JSON.
      }
      const failure = providerError(raw, response.status, response.headers)
      throw new LlmError(failure.message, failure.code, { ...failure.failure, cause: new Error(text) })
    }
    const translator = new OpenAIStreamTranslator()
    if (contentType.includes('application/json')) {
      let raw: unknown
      try {
        raw = await response.json()
      } catch (error) {
        throw new LlmError('OpenAI-compatible JSON response is malformed', 'MALFORMED_RESPONSE', { cause: error })
      }
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new LlmError('OpenAI-compatible JSON response is not an object', 'MALFORMED_RESPONSE')
      }
      const envelope = raw as Record<string, unknown>
      if (typeof envelope.error === 'object' && envelope.error !== null) throw providerError(envelope, undefined)
      yield* translator.push(envelope)
      yield* translator.done()
      return
    }
    if (response.body === null) throw new LlmError('OpenAI-compatible response has no body', 'EMPTY_RESPONSE')
    for await (const frame of parseSse(response.body, activity)) {
      yield* translator.push(frame)
    }
    yield* translator.done()
  }
}
