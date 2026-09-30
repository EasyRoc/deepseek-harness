/** Envelope unwrapping: every success and failure branch of the tenant contract. */
import { describe, expect, it } from 'vitest'
import { readEnvelope, unwrap } from '../src/envelope.ts'
import { MoldexApiError } from '../src/service.ts'

describe('readEnvelope', () => {
  it('reads a JSON object body', async () => {
    expect(await readEnvelope(Response.json({ success: true, data: { x: 1 } }))).toMatchObject({ success: true })
  })

  it('classifies a non-JSON body by status', async () => {
    await expect(readEnvelope(new Response('gateway exploded', { status: 502 })))
      .rejects.toMatchObject({ errcode: 'HTTP_STATUS', status: 502 })
  })

  it('rejects a non-object envelope body', async () => {
    await expect(readEnvelope(Response.json([1, 2]))).rejects.toMatchObject({ errcode: 'PROTOCOL' })
  })
})

describe('unwrap', () => {
  it('returns the data payload on success', async () => {
    expect(await unwrap<{ x: number }>(Response.json({ success: true, data: { x: 1 } }))).toEqual({ x: 1 })
  })

  it('carries the platform error code and message', async () => {
    await expect(unwrap(Response.json({ success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'wrong password' } }, { status: 200 })))
      .rejects.toMatchObject({ errcode: 'AUTH_INVALID_CREDENTIALS', message: 'wrong password' })
  })

  it('falls back to the envelope message and the generic code', async () => {
    await expect(unwrap(Response.json({ success: false, message: 'maintenance' }, { status: 503 })))
      .rejects.toMatchObject({ errcode: 'MOLDEX_ERROR', message: 'maintenance', status: 503 })
  })

  it('uses both fallbacks when the envelope carries neither error nor message', async () => {
    await expect(unwrap(Response.json({ success: false }, { status: 418 })))
      .rejects.toMatchObject({ errcode: 'MOLDEX_ERROR', message: 'Moldex tenant API request failed (418)' })
  })

  it('rejects success without a data payload as a protocol failure', async () => {
    await expect(unwrap(Response.json({ success: true }, { status: 200 })))
      .rejects.toMatchObject({ errcode: 'PROTOCOL', message: 'Moldex tenant API request failed (200)' })
  })

  it('preserves the typed failure class', async () => {
    const failure = await unwrap<{ readonly x: number }>(Response.json({ success: false })).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MoldexApiError)
  })
})
