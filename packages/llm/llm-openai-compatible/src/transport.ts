/** Normalize HTTP and in-band chat-completions errors into provider-neutral failures. */

import { isContextWindowExceededError, isQuotaExceededError, LlmError, ProviderRequestId } from '@deepseek-ai/dsh-llm'

/** Classify a provider error without trusting arbitrary response fields.
 *
 * Status classes follow the OpenAI wire contract, with non-standard gateway
 * statuses mapped to the harness quota semantics: 402 marks an exhausted
 * balance (one-api family gateways) and is never retried, while 403 covers
 * invalid, disabled, or scope-restricted keys.
 * @param raw - decoded response or in-band error object.
 * @param status - HTTP status when the error preceded streaming.
 * @param headers - response headers for retry delay and request identity.
 * @returns a stable error consumed by LlmRuntime and llm-retry.
 */
export function providerError(raw: unknown, status: number | undefined, headers?: Headers): LlmError {
  const envelope = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const error = typeof envelope.error === 'object' && envelope.error !== null ? envelope.error as Record<string, unknown> : {}
  const message = typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : `OpenAI-compatible request failed (${status ?? 'stream error'})`
  const type = typeof error.type === 'string' ? error.type : ''
  const detail = `${type} ${typeof error.code === 'string' ? error.code : ''} ${message}`
  let code: string
  if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') code = 'AUTH'
  else if (status === 402 || isQuotaExceededError(detail)) code = 'QUOTA'
  else if (status === 429 || type === 'rate_limit_error' || type === 'insufficient_quota') code = 'RATE_LIMIT'
  else if (isContextWindowExceededError(detail)) code = 'CONTEXT_WINDOW_EXCEEDED'
  else if (status === 400 || status === 413 || type === 'invalid_request_error') code = 'INVALID_REQUEST'
  else if ((status !== undefined && status >= 500) || type === 'api_error' || type === 'overloaded_error') code = 'SERVER'
  else code = status === undefined ? 'SERVER' : `HTTP_${status}`
  const retry = headers?.get('retry-after')
  const delay = retry == null ? NaN : /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()
  const id = headers?.get('request-id') ?? headers?.get('x-request-id')
  return new LlmError(message, code, {
    ...status === undefined ? {} : { status },
    ...id ? { requestId: ProviderRequestId(id) } : {},
    ...Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {},
  })
}
