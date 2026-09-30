/** Error classification across statuses, OpenAI bodies, and gateway quirks. */
import { describe, expect, it } from 'vitest'
import { providerError } from '../src/transport.ts'

describe('providerError', () => {
  it('maps authentication statuses and types to AUTH', () => {
    expect(providerError({}, 401).code).toBe('AUTH')
    expect(providerError({}, 403).code).toBe('AUTH')
    expect(providerError({ error: { message: 'bad key', type: 'authentication_error' } }, undefined).code).toBe('AUTH')
    expect(providerError({ error: { message: 'denied', type: 'permission_error' } }, 404).code).toBe('AUTH')
  })

  it('maps the non-standard 402 balance status to QUOTA', () => {
    const failure = providerError({ error: { message: 'TENANT_INSUFFICIENT_BALANCE', code: 'TENANT_INSUFFICIENT_BALANCE' } }, 402)
    expect(failure.code).toBe('QUOTA')
    expect(failure.failure.status).toBe(402)
  })

  it('maps rate limits with retry-after in seconds and as an HTTP date', () => {
    const seconds = providerError({ error: { message: 'slow down' } }, 429, new Headers({ 'retry-after': '3' }))
    expect(seconds.code).toBe('RATE_LIMIT')
    expect(seconds.failure.providerRetryAfterMs).toBe(3000)
    const date = providerError({}, 429, new Headers({ 'retry-after': new Date(Date.now() + 60_000).toUTCString() }))
    expect(date.failure.providerRetryAfterMs).toBeGreaterThan(0)
  })

  it('maps exhausted quota wording to the terminal QUOTA code', () => {
    expect(providerError({ error: { message: 'insufficient balance', code: 'TENANT_INSUFFICIENT_BALANCE' } }, 402).code).toBe('QUOTA')
    expect(providerError({ error: { message: 'quota exceeded', type: 'insufficient_quota' } }, 400).code).toBe('QUOTA')
    expect(providerError({ error: { message: 'out of credits' } }, undefined).code).toBe('QUOTA')
  })

  it('keeps request identity and ignores invalid retry-after values', () => {
    const failure = providerError({ error: { message: 'x' } }, 500, new Headers({ 'request-id': 'req-1', 'retry-after': 'soon' }))
    expect(failure.failure.requestId).toBe('req-1')
    expect(failure.failure.providerRetryAfterMs).toBeUndefined()
    const altHeader = providerError({}, 500, new Headers({ 'x-request-id': 'req-2' }))
    expect(altHeader.failure.requestId).toBe('req-2')
  })

  it('classifies context windows, invalid requests, servers, and unknown statuses', () => {
    expect(providerError({ error: { message: "This model's maximum context length is 4096 tokens" } }, 400).code)
      .toBe('CONTEXT_WINDOW_EXCEEDED')
    expect(providerError({ error: { message: 'bad body', type: 'invalid_request_error' } }, 422).code).toBe('INVALID_REQUEST')
    expect(providerError({}, 400).code).toBe('INVALID_REQUEST')
    expect(providerError({}, 413).code).toBe('INVALID_REQUEST')
    expect(providerError({}, 500).code).toBe('SERVER')
    expect(providerError({ error: { message: 'overloaded', type: 'overloaded_error' } }, undefined).code).toBe('SERVER')
    expect(providerError({}, 418).code).toBe('HTTP_418')
    expect(providerError({}, undefined).code).toBe('SERVER')
    expect(providerError(undefined, 599).code).toBe('SERVER')
  })

  it('falls back to a generic message when the body carries none', () => {
    expect(providerError({}, 404).message).toBe('OpenAI-compatible request failed (404)')
    expect(providerError({}, undefined).message).toBe('OpenAI-compatible request failed (stream error)')
    expect(providerError({ error: { message: '' } }, 404).message).toBe('OpenAI-compatible request failed (404)')
    expect(providerError({ error: 'not-an-object' }, 404).code).toBe('HTTP_404')
  })
})
