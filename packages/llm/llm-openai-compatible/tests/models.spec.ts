/** `/models` discovery: wire listing, error mapping, and malformed answers. */
import { describe, expect, it, vi } from 'vitest'
import { fetchGatewayModels } from '../src/models.ts'
import { jsonReply } from './reply.ts'

describe('fetchGatewayModels', () => {
  it('maps listed ids onto catalog entries and skips malformed entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonReply(200, { data: [{ id: 'deepseek-v4-flash' }, { id: 42 }, 'junk', { id: 'm2' }] })))
    const models = await fetchGatewayModels('https://gateway.example/v1', { authorization: 'Bearer k' }, new AbortController().signal)
    expect(models).toEqual([{ id: 'deepseek-v4-flash' }, { id: 'm2' }])
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toEqual({ authorization: 'Bearer k' })
  })

  it('classifies a failed listing through the provider error mapping', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonReply(402, { error: { message: 'no balance' } })))
    await expect(fetchGatewayModels('https://gateway.example/v1', {}, new AbortController().signal))
      .rejects.toMatchObject({ code: 'QUOTA', message: 'no balance' })
  })

  it('classifies a non-JSON failure by status alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway exploded', { status: 502 })))
    await expect(fetchGatewayModels('https://gateway.example/v1', {}, new AbortController().signal))
      .rejects.toMatchObject({ code: 'SERVER' })
  })

  it('rejects a listing without a data array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonReply(200, { models: [] })))
    await expect(fetchGatewayModels('https://gateway.example/v1', {}, new AbortController().signal))
      .rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
})
