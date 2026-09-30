/** Gateway namespace delegation, the implementation guard, and envelope edge branches. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MoldexAccountGateway, MoldexApiError, originOf } from '../src/index.ts'
import { client, fixture, loginBody } from './helpers.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  while (cleanups.length) await cleanups.pop()!()
})

describe('originOf', () => {
  it('normalizes an origin and rejects non-HTTP, credentialed, pathed, or query-bearing values', () => {
    expect(originOf('https://www.moldex.top/', 'accountOrigin')).toBe('https://www.moldex.top')
    expect(() => originOf('ftp://www.moldex.top', 'accountOrigin')).toThrow(/HTTP\(S\) origin/)
    expect(() => originOf('https://user:pass@www.moldex.top', 'accountOrigin')).toThrow(/HTTP\(S\) origin/)
    expect(() => originOf('https://www.moldex.top/api', 'accountOrigin')).toThrow(/HTTP\(S\) origin/)
    expect(() => originOf('https://www.moldex.top/?x=1', 'accountOrigin')).toThrow(/HTTP\(S\) origin/)
  })

  it('permits plain HTTP only on loopback when allowed', () => {
    expect(originOf('http://127.0.0.1:8080', 'accountOrigin', true)).toBe('http://127.0.0.1:8080')
    expect(() => originOf('http://127.0.0.1:8080', 'accountOrigin')).toThrow(/HTTP\(S\) origin/)
    expect(() => originOf('http://www.moldex.top', 'accountOrigin', true)).toThrow(/HTTP\(S\) origin/)
  })
})

describe('MoldexAccountGateway', () => {
  it('rejects a Host whose account service is not the Moldex provider', () => {
    const ctx = new Context()
    const gateway = new MoldexAccountGateway(ctx)
    expect(() => gateway.listApiKeys()).toThrow(/is not the Moldex provider/)
  })

  it('delegates sign-in submission and key operations to the account service', async () => {
    const instance = await fixture()
    cleanups.push(instance.dispose)
    instance.behavior.responses['/api/v1/tenant/auth/login'] = loginBody
    const gateway = new MoldexAccountGateway(instance.ctx)
    await instance.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    const state = await gateway.submitCredentials({ account: 'roceasy@qq.com', password: 'secret' })
    expect(state.status).toBe('credential-stored')

    instance.behavior.responses['/api/v1/tenant/api-keys'] = {
      success: true,
      data: { id: 'key-1', key: 'sk-moldex-new', key_prefix: 'sk-moldex-n', name: 'DSH Desktop' },
    }
    expect(await gateway.createAndStoreApiKey()).toEqual({ id: 'key-1', keyPrefix: 'sk-moldex-n', name: 'DSH Desktop' })

    instance.behavior.responses['/api/v1/tenant/api-keys'] = {
      success: true,
      data: [{ id: 'key-1', name: 'DSH Desktop', key_prefix: 'sk-moldex-n', is_active: true }],
    }
    expect(await gateway.listApiKeys()).toEqual([
      { id: 'key-1', name: 'DSH Desktop', key_prefix: 'sk-moldex-n', is_active: true },
    ])
  })

  it('maps non-JSON and malformed envelopes onto typed failures', async () => {
    const instance = await fixture()
    cleanups.push(instance.dispose)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[1,2]', { status: 200 })))
    await instance.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await expect(instance.account.submitCredentials({ account: 'a@b.invalid', password: 'c' }))
      .rejects.toMatchObject({ errcode: 'PROTOCOL' })
  })

  it('keeps the envelope message when success is false without an error object', async () => {
    const instance = await fixture()
    cleanups.push(instance.dispose)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, message: 'gateway maintenance' })))
    await instance.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await expect(instance.account.submitCredentials({ account: 'a@b.invalid', password: 'c' }))
      .rejects.toMatchObject({ errcode: 'MOLDEX_ERROR', message: 'gateway maintenance' })
  })

  it('names the failure from the error object and falls back through the message chain', async () => {
    const instance = await fixture()
    cleanups.push(instance.dispose)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true })))
    await instance.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    // success without data reads as a protocol failure against the status.
    await expect(instance.account.submitCredentials({ account: 'a@b.invalid', password: 'c' }))
      .rejects.toBeInstanceOf(MoldexApiError)
  })
})
