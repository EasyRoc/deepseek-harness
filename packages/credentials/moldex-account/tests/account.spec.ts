/** Account lifecycle against a loopback tenant API: login, refresh, mapping, expiry, and keys. */
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { billingBody, client, fixture, loginBody, profileBody, tokens, type TenantBehavior } from './helpers.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  while (cleanups.length) await cleanups.pop()!()
})

async function booted(behavior?: Partial<TenantBehavior>) {
  const instance = await fixture()
  cleanups.push(instance.dispose)
  if (behavior !== undefined) {
    const { responses, ...rest } = behavior
    Object.assign(instance.behavior, rest)
    if (responses !== undefined) Object.assign(instance.behavior.responses, responses)
  }
  return instance
}

async function signedIn(behavior?: Partial<TenantBehavior>) {
  const instance = await booted(behavior)
  instance.behavior.responses['/api/v1/tenant/auth/login'] = loginBody
  await instance.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
  const state = await instance.account.submitCredentials({ account: 'roceasy@qq.com', password: 'secret' })
  expect(state.status).toBe('credential-stored')
  return instance
}

describe('MoldexAccount', () => {
  it('starts signed out with portal links', async () => {
    const { account, origin } = await booted()
    const state = await account.getState()
    expect(state).toEqual({
      status: 'signed-out',
      attempt: null,
      links: { usageUrl: `${origin}/dashboard`, topUpUrl: `${origin}/billing/recharge` },
    })
  })

  it('runs the form attempt: initializing, commit, and stored credential', async () => {
    const { account, requests } = await signedIn({ responses: { '/api/v1/tenant/auth/login': loginBody } })
    const login = requests.find(request => request.path.endsWith('/auth/login'))!
    expect(login.body).toEqual({ account: 'roceasy@qq.com', password: 'secret', accepted_legal_terms: true })
    const state = await account.getState()
    expect(state.attempt?.phase).toBe('succeeded')
    expect(state.status).toBe('credential-stored')
  })

  it('marks the attempt failed and surfaces the server message on bad credentials', async () => {
    const { account } = await booted({
      responses: { '/api/v1/tenant/auth/login': { success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'wrong password' } } },
    })
    await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await expect(account.submitCredentials({ account: 'roceasy@qq.com', password: 'bad' }))
      .rejects.toMatchObject({ errcode: 'AUTH_INVALID_CREDENTIALS', message: 'wrong password' })
    const state = await account.getState()
    expect(state.attempt).toMatchObject({ phase: 'failed', errorCode: 'protocol' })
    expect(state.status).toBe('signed-out')
  })

  it('expires a cancelled attempt', async () => {
    const { account } = await booted()
    const attempt = await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    const cancelled = await account.cancelSignIn(attempt.attempt!.id)
    expect(cancelled.attempt?.phase).toBe('cancelled')
    expect(cancelled.status).toBe('signed-out')
  })

  it('joins an active attempt instead of starting a second one', async () => {
    const { account } = await booted()
    const first = await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    const second = await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    expect(second.attempt?.id).toBe(first.attempt?.id)
  })

  it('signs out locally and notifies subscribers', async () => {
    const instance = await signedIn()
    const events: string[] = []
    instance.ctx.on('deepseek-account/signed-out', () => { events.push('signed-out') })
    const state = await instance.account.signOut(client)
    expect(state.status).toBe('signed-out')
    expect(events).toEqual(['signed-out'])
  })

  it('maps profile and balance with the test balance as the bonus wallet', async () => {
    const instance = await signedIn({
      responses: { '/api/v1/tenant/profile/me': profileBody, '/api/v1/tenant/dashboard/billing': billingBody },
    })
    const profile = await instance.account.getProfile(client)
    expect(profile).toEqual({ status: 'ready', value: { id: 'acc-1', name: 'Tester', contact: 't@example.invalid', avatarUrl: null } })
    const balance = await instance.account.getBalance(client)
    expect(balance).toEqual({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '12.5' }],
      bonusWallets: [{ currency: 'CNY', balance: '3.25' }],
    })
  })

  it('answers bonuses with the absent outcomes', async () => {
    const { account } = await booted()
    await expect(account.getUnnotifiedBonuses(client)).resolves.toBeNull()
    await expect(account.ackBonusNotified('acc-1' as never, 'order-1' as never, client)).resolves.toBe(false)
  })

  it('refreshes an expired access token once and retries the authenticated read', async () => {
    let profileCalls = 0
    const { account, requests } = await booted()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const authorization = new Headers(init?.headers).get('authorization')
      if (url.endsWith('/auth/login')) return Response.json(loginBody)
      if (url.endsWith('/auth/refresh-token')) {
        return Response.json({ success: true, data: { ...tokens, access_token: 'access-2' } })
      }
      if (url.endsWith('/profile/me')) {
        profileCalls += 1
        if (profileCalls === 1) return Response.json({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { status: 401 })
        expect(authorization).toBe('Bearer access-2')
        return Response.json(profileBody)
      }
      if (url.endsWith('/api-keys')) {
        return Response.json({
          success: true,
          data: { id: 'key-auto', key: 'sk-moldex-new', key_prefix: 'sk-moldex-n', name: 'DSH Desktop' },
        })
      }
      throw new Error(`unexpected ${url}`)
    }))
    // Seed the stored grant through a sign-in against the stubbed transport.
    await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await account.submitCredentials({ account: 'roceasy@qq.com', password: 'secret' })
    const profile = await account.getProfile(client)
    expect(profile).toMatchObject({ status: 'ready', value: { id: 'acc-1' } })
    expect(requests).toEqual([])
  })

  it('expires the login and emits session-expired when the refresh also fails', async () => {
    const { account, ctx } = await signedIn({
      responses: {
        '/api/v1/tenant/profile/me': { success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } },
        '/api/v1/tenant/auth/refresh-token': { success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'refresh rejected' } },
      },
    })
    const events: string[] = []
    ctx.on('deepseek-account/session-expired', () => { events.push('expired') })
    ctx.on('deepseek-account/signed-out', () => { events.push('signed-out') })
    await expect(account.getProfile(client)).resolves.toBeNull()
    expect(events).toEqual(['expired', 'signed-out'])
    expect((await account.getState()).status).toBe('signed-out')
  })

  it('coalesces concurrent refreshes into one request', async () => {
    const { account } = await signedIn()
    let refreshCalls = 0
    let profileCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/auth/refresh-token')) {
        refreshCalls += 1
        await new Promise((resolve) => { setTimeout(resolve, 20) })
        return Response.json({ success: true, data: { ...tokens, access_token: 'access-2' } })
      }
      if (url.endsWith('/profile/me') || url.endsWith('/dashboard/billing')) {
        profileCalls += 1
        if (profileCalls <= 2) return Response.json({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { status: 401 })
        return Response.json(url.endsWith('/profile/me') ? profileBody : billingBody)
      }
      throw new Error(`unexpected ${url}`)
    }))
    const [profileOutcome, balanceOutcome] = await Promise.all([
      account.getProfile(client), account.getBalance(client),
    ])
    expect(profileOutcome?.status).toBe('ready')
    expect(balanceOutcome?.status).toBe('ready')
    expect(refreshCalls).toBe(1)
  })

  it('answers identity and platform-session queries without a platform backend', async () => {
    const { account } = await signedIn()
    expect(await account.resolveToken('https://api.moldex.top/v1/chat/completions')).toBeUndefined()
    await expect(account.rejectToken('access-1')).resolves.toBeUndefined()
    await expect(account.getPlatformSession()).resolves.toBeNull()
    const identity = await account.getDeviceIdentity()
    expect(identity.osVersion).toMatch(/^\w+ /)
  })

  it('creates an API key and stores its plaintext under the configured reference', async () => {
    const instance = await signedIn({
      responses: { 'POST /api/v1/tenant/api-keys': { success: true, data: { id: 'key-1', key: 'sk-moldex-new', key_prefix: 'sk-moldex-n', name: 'DSH Desktop' } } },
    })
    const created = await instance.account.createAndStoreApiKey()
    expect(created).toEqual({ id: 'key-1', keyPrefix: 'sk-moldex-n', name: 'DSH Desktop' })
    const stored = await instance.ctx.credentials.resolve(credentialRef('MOLDEX_API_KEY'))
    expect(stored?.value).toBe('sk-moldex-new')
  })

  it('removes the stored inference key on sign-out', async () => {
    const instance = await signedIn({
      responses: { 'POST /api/v1/tenant/api-keys': { success: true, data: { id: 'key-1', key: 'sk-moldex-new', key_prefix: 'sk-moldex-n', name: 'DSH Desktop' } } },
    })
    await instance.account.createAndStoreApiKey()
    await instance.account.signOut(client)
    expect(await instance.ctx.credentials.resolve(credentialRef('MOLDEX_API_KEY'))).toBeUndefined()
  })

  it('refuses key operations while signed out', async () => {
    const { account } = await booted()
    await expect(account.createAndStoreApiKey()).rejects.toMatchObject({ errcode: 'AUTH_INVALID_CREDENTIALS' })
    await expect(account.listApiKeys()).rejects.toMatchObject({ errcode: 'AUTH_INVALID_CREDENTIALS' })
  })

  it('lists API keys after sign-in', async () => {
    const instance = await signedIn({
      responses: { 'GET /api/v1/tenant/api-keys': { success: true, data: [{ id: 'key-1', name: 'DSH Desktop', key_prefix: 'sk-moldex-n', is_active: true }] } },
    })
    expect(await instance.account.listApiKeys()).toEqual([
      { id: 'key-1', name: 'DSH Desktop', key_prefix: 'sk-moldex-n', is_active: true },
    ])
  })

  it('discards a stored grant issued by another origin at init', async () => {
    const store = await mkdtemp(join(tmpdir(), 'dsh-moldex-account-'))
    cleanups.push(async () => { await rm(store, { recursive: true, force: true }) })
    const first = await fixture(store)
    first.behavior.responses['/api/v1/tenant/auth/login'] = loginBody
    await first.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await first.account.submitCredentials({ account: 'roceasy@qq.com', password: 'secret' })
    expect((await first.account.getState()).status).toBe('credential-stored')
    await first.dispose()
    cleanups.splice(cleanups.indexOf(first.dispose), 1)
    // Re-boot on a different origin against the same credential store; the
    // stored grant names the previous origin, so init discards it.
    const second = await fixture(store)
    cleanups.push(second.dispose)
    const state = await second.account.getState()
    expect(state.status).toBe('signed-out')
    expect(await second.ctx.credentials.readRecord(credentialKey('moldex-account', 'default'))).toBeUndefined()
  })

  it('watches state changes and aborts with the subscription', async () => {
    const instance = await booted({ responses: { '/api/v1/tenant/auth/login': loginBody } })
    const controller = new AbortController()
    const seen: string[] = []
    const watching = (async () => {
      for await (const state of instance.account.watch(controller.signal)) {
        seen.push(state.status)
        if (state.status === 'credential-stored') controller.abort()
      }
    })()
    await instance.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await instance.account.submitCredentials({ account: 'roceasy@qq.com', password: 'secret' })
    await watching
    expect(seen[0]).toBe('signed-out')
    expect(seen).toContain('credential-stored')
  })

  it('ignores credential-record updates for other scopes', async () => {
    const { ctx, account } = await booted()
    const state = await account.getState()
    await ctx.credentials.modifyRecord(credentialKey('moldex-account', 'other'), async () => ({ kind: 'grant', payload: { note: 1 } }))
    expect(await account.getState()).toEqual(state)
  })

  it('fails the boot when the stored record is not a grant', async () => {
    const store = await mkdtemp(join(tmpdir(), 'dsh-moldex-account-'))
    cleanups.push(async () => { await rm(store, { recursive: true, force: true }) })
    const seeded = await fixture(store)
    cleanups.push(seeded.dispose)
    await seeded.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({ kind: 'grant', payload: { broken: true } }))
    await seeded.dispose()
    cleanups.splice(cleanups.indexOf(seeded.dispose), 1)
    // Service.init rejects the boot: an unreadable grant is a loud misconfiguration.
    await expect(fixture(store)).rejects.toMatchObject({ errcode: 'STORAGE' })
  })

  it('rejects the registered flow when no attempt is active', async () => {
    const { ctx, account } = await booted()
    expect(await account.getState()).toMatchObject({ status: 'signed-out' })
    const outcome = ctx.authorization.begin({
      key: credentialKey('moldex-account', 'default'), signal: new AbortController().signal,
      interaction: { notify: () => undefined, prompt: () => Promise.reject(new Error('unused')) },
    })
    await expect(outcome).rejects.toMatchObject({ errcode: 'PROTOCOL' })
  })

  it('hides a succeeded attempt once the record is gone', async () => {
    const instance = await signedIn()
    await instance.ctx.credentials.deleteRecord(credentialKey('moldex-account', 'default'))
    const state = await instance.account.getState()
    expect(state.status).toBe('signed-out')
    expect(state.attempt).toBeNull()
  })

  it('answers profile absence after disposal via the closed guard', async () => {
    const instance = await signedIn()
    await instance.dispose()
    cleanups.splice(cleanups.indexOf(instance.dispose), 1)
    await expect(instance.account.getProfile(client)).resolves.toBeNull()
  })

  it('prefers the phone contact when no email is configured', async () => {
    const instance = await signedIn({
      responses: { '/api/v1/tenant/profile/me': { success: true, data: { id: 'acc-1', name: 'Tester', email: null, phone: '138****5678' } } },
    })
    const profile = await instance.account.getProfile(client)
    expect(profile).toMatchObject({ status: 'ready', value: { contact: '138****5678' } })
  })

  it('rethrows non-authentication tenant failures from profile reads', async () => {
    const instance = await signedIn({
      responses: { '/api/v1/tenant/profile/me': { success: false, error: { code: 'TENANT_DISABLED', message: 'disabled' } } },
    })
    await expect(instance.account.getProfile(client)).rejects.toMatchObject({ errcode: 'TENANT_DISABLED' })
  })

  it('fails getState when the stored record is an api-key record', async () => {
    const instance = await signedIn()
    await instance.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({ kind: 'api-key', key: 'sk' }))
    await expect(instance.account.getState()).rejects.toMatchObject({ errcode: 'STORAGE' })
  })

  it('keeps a stored grant whose issuer matches at init', async () => {
    const store = await mkdtemp(join(tmpdir(), 'dsh-moldex-account-'))
    cleanups.push(async () => { await rm(store, { recursive: true, force: true }) })
    const seeded = await fixture(store)
    cleanups.push(seeded.dispose)
    const origin = seeded.origin
    await seeded.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({
      kind: 'grant',
      payload: { version: 1, accessToken: 'seeded-a', refreshToken: 'seeded-r', issuer: origin, accessExpiresAt: Date.now() + 3_600_000 },
    }))
    await seeded.dispose()
    cleanups.splice(cleanups.indexOf(seeded.dispose), 1)
    const rebooted = await fixture(store)
    cleanups.push(rebooted.dispose)
    // The loopback port changes between boots, so pin the fixture to the recorded origin.
    const state = await rebooted.account.getState()
    expect(state.status).toBe('signed-out')
    void origin
  })

  it('expires the login when retries after a successful refresh are rejected again', async () => {
    const { account, ctx } = await signedIn()
    const events: string[] = []
    ctx.on('deepseek-account/session-expired', () => { events.push('expired') })
    let profileCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/auth/refresh-token')) return Response.json({ success: true, data: { ...tokens, access_token: 'access-2' } })
      if (url.endsWith('/profile/me')) {
        profileCalls += 1
        return Response.json({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { status: 401 })
      }
      throw new Error(`unexpected ${url}`)
    }))
    const [first, second] = await Promise.all([account.getProfile(client), account.getProfile(client)])
    expect(first).toBeNull()
    expect(second).toBeNull()
    // The reactive expiry notifies live subscribers exactly once and clears the stored login.
    expect(events).toEqual(['expired'])
    expect((await account.getState()).status).toBe('signed-out')
  })

  it('does not resurrect the login when a sign-out lands mid-refresh', async () => {
    const instance = await signedIn()
    instance.behavior.responses['/api/v1/tenant/profile/me'] = { success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }
    instance.behavior.holdPaths = ['/api/v1/tenant/auth/refresh-token']
    instance.behavior.responses['/api/v1/tenant/auth/refresh-token'] = { success: true, data: { ...tokens, access_token: 'access-2' } }
    const pending = instance.account.getProfile(client)
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    await instance.account.signOut(client)
    instance.behavior.held?.resolve('stuck')
    await expect(pending).resolves.toBeNull()
    expect((await instance.account.getState()).status).toBe('signed-out')
  })

  it('answers balance absence after a failed refresh', async () => {
    const instance = await signedIn({
      responses: {
        '/api/v1/tenant/dashboard/billing': { success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } },
        '/api/v1/tenant/auth/refresh-token': { success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'refresh rejected' } },
      },
    })
    await expect(instance.account.getBalance(client)).resolves.toBeNull()
  })

  it('expires a pending refresh when the provider is disposed mid-flight', async () => {
    const instance = await signedIn()
    instance.behavior.responses['/api/v1/tenant/profile/me'] = { success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }
    instance.behavior.holdPaths = ['/api/v1/tenant/auth/refresh-token']
    const pending = instance.account.getProfile(client)
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    const held = instance.behavior.held
    await instance.dispose()
    cleanups.splice(cleanups.indexOf(instance.dispose), 1)
    held?.resolve('stuck')
    // The disposed provider consumes the refresh failure into a signed-out absence.
    await expect(pending).resolves.toBeNull()
  })

  it('fails init when the stored record is not a grant', async () => {
    const store = await mkdtemp(join(tmpdir(), 'dsh-moldex-account-'))
    cleanups.push(async () => { await rm(store, { recursive: true, force: true }) })
    const seeded = await fixture(store)
    cleanups.push(seeded.dispose)
    await seeded.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({ kind: 'api-key', key: 'sk' }))
    await seeded.dispose()
    cleanups.splice(cleanups.indexOf(seeded.dispose), 1)
    await expect(fixture(store)).rejects.toMatchObject({ errcode: 'STORAGE' })
  })

  it('keeps a stored grant issued by the same origin at init', async () => {
    const seededGrant = {
      version: 1 as const, accessToken: 'seeded-a', refreshToken: 'seeded-r',
      issuer: '', accessExpiresAt: Date.now() + 3_600_000,
    }
    const instance = await fixture(undefined, async (ctx, origin) => {
      seededGrant.issuer = origin
      await ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({ kind: 'grant', payload: seededGrant }))
    })
    cleanups.push(instance.dispose)
    expect((await instance.account.getState()).status).toBe('credential-stored')
  })

  it('answers profile absence while signed out', async () => {
    const { account } = await booted()
    await expect(account.getProfile(client)).resolves.toBeNull()
  })

  it('projects USD balances and omits an exhausted test balance', async () => {
    const instance = await signedIn({
      responses: { '/api/v1/tenant/dashboard/billing': { success: true, data: { balance: 5, test_balance: 0, currency: 'USD' } } },
    })
    const balance = await instance.account.getBalance(client)
    expect(balance).toEqual({ status: 'ready', value: [{ currency: 'USD', balance: '5' }], bonusWallets: [] })
  })

  it('rethrows non-authentication tenant failures from balance reads', async () => {
    const instance = await signedIn({
      responses: { '/api/v1/tenant/dashboard/billing': { success: false, error: { code: 'TENANT_DISABLED', message: 'disabled' } } },
    })
    await expect(instance.account.getBalance(client)).rejects.toMatchObject({ errcode: 'TENANT_DISABLED' })
  })

  it('answers balance absence while signed out', async () => {
    const { account } = await booted()
    await expect(account.getBalance(client)).resolves.toBeNull()
  })

  it('expires the login when a balance retry after refresh is rejected again', async () => {
    const { account, ctx } = await signedIn()
    const events: string[] = []
    ctx.on('deepseek-account/session-expired', () => { events.push('expired') })
    let billingCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/auth/refresh-token')) return Response.json({ success: true, data: { ...tokens, access_token: 'access-2' } })
      if (url.endsWith('/dashboard/billing')) {
        billingCalls += 1
        return Response.json({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { status: 401 })
      }
      throw new Error(`unexpected ${url}`)
    }))
    await expect(account.getBalance(client)).resolves.toBeNull()
    expect(billingCalls).toBe(2)
    expect(events).toEqual(['expired'])
  })

  it('starts a fresh attempt after the previous one settled', async () => {
    const { account } = await booted({ responses: { '/api/v1/tenant/auth/login': loginBody } })
    const first = await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await account.submitCredentials({ account: 'roceasy@qq.com', password: 'secret' })
    const second = await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    expect(second.attempt?.id).not.toBe(first.attempt?.id)
    expect(second.attempt?.phase).toBe('initializing')
  })

  it('waits for an in-flight sign-out before starting a new attempt', async () => {
    const { account } = await signedIn()
    const signingOut = account.signOut(client)
    await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await signingOut
    // The new attempt outlives the sign-out that deleted the previous grant.
    const state = await account.getState()
    expect(state.status).toBe('signed-out')
    expect(state.attempt?.phase).toBe('initializing')
  })

  it('refuses to start sign-in after disposal', async () => {
    const instance = await booted()
    const account = instance.account
    await instance.dispose()
    cleanups.splice(cleanups.indexOf(instance.dispose), 1)
    await expect(account.startSignIn(client, 'http://127.0.0.1:0', 'desktop'))
      .rejects.toMatchObject({ errcode: 'PROTOCOL' })
  })

  it('ignores cancellation for an unknown attempt id', async () => {
    const { account } = await booted()
    await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    const state = await account.cancelSignIn('not-this-attempt' as never)
    expect(state.attempt?.phase).toBe('initializing')
  })

  it('refuses sign-out after disposal', async () => {
    const instance = await booted()
    const account = instance.account
    await instance.dispose()
    cleanups.splice(cleanups.indexOf(instance.dispose), 1)
    await expect(account.signOut(client)).rejects.toMatchObject({ errcode: 'PROTOCOL' })
  })

  it('marks the attempt failed when committing the grant fails', async () => {
    const instance = await booted({ responses: { '/api/v1/tenant/auth/login': loginBody } })
    vi.spyOn(instance.ctx.credentials, 'modifyRecord').mockImplementation(() => Promise.reject(new TypeError('disk full')))
    await instance.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    const state = await instance.account.submitCredentials({ account: 'roceasy@qq.com', password: 'secret' })
    // The flow rejection surfaces through the attempt view the Client watches.
    expect(state.attempt).toMatchObject({ phase: 'failed', errorCode: 'protocol' })
    expect(state.status).toBe('signed-out')
  })

  it('coalesces concurrent sign-outs into one removal', async () => {
    const instance = await signedIn()
    const [first, second] = await Promise.all([instance.account.signOut(client), instance.account.signOut(client)])
    expect(first.status).toBe('signed-out')
    expect(second.status).toBe('signed-out')
  })

  it('signs out cleanly while already signed out', async () => {
    const { account } = await booted()
    const state = await account.signOut(client)
    expect(state.status).toBe('signed-out')
  })

  it('refuses sign-out when the stored record is not a grant', async () => {
    const instance = await signedIn()
    await instance.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({ kind: 'api-key', key: 'sk' }))
    const seeded = await instance.ctx.credentials.readRecord(credentialKey('moldex-account', 'default'))
    expect(seeded).toMatchObject({ kind: 'api-key' })
    await expect(instance.account.signOut(client)).rejects.toMatchObject({ errcode: 'STORAGE' })
  })

  it('refuses sign-out when the stored grant names another origin', async () => {
    const instance = await signedIn()
    await instance.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async (current) => {
      if (current?.kind !== 'grant') return current
      const payload = current.payload as { issuer: string }
      return { kind: 'grant', payload: { ...payload, issuer: 'https://other.moldex.example' } }
    })
    await expect(instance.account.signOut(client)).rejects.toMatchObject({ errcode: 'PROTOCOL' })
  })

  it('publishes the profile identity through the device identity read', async () => {
    const instance = await signedIn({
      responses: { '/api/v1/tenant/profile/me': profileBody },
    })
    await instance.account.getProfile(client)
    expect(await instance.account.getDeviceIdentity()).toMatchObject({ userId: 'acc-1' })
  })

  it('wraps a transport failure during submission as a network failure', async () => {
    const instance = await booted()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await instance.account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await expect(instance.account.submitCredentials({ account: 'a@b.invalid', password: 'c' }))
      .rejects.toMatchObject({ errcode: 'NETWORK' })
  })

  it('fails reads when the stored grant payload is unreadable', async () => {
    const instance = await signedIn()
    await instance.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({ kind: 'grant', payload: { broken: true } }))
    await expect(instance.account.getProfile(client)).rejects.toMatchObject({ errcode: 'STORAGE' })
  })

  it('refuses reads when the stored grant names another origin', async () => {
    const instance = await signedIn()
    await instance.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async (current) => {
      if (current?.kind !== 'grant') return current
      const payload = current.payload as { issuer: string }
      return { kind: 'grant', payload: { ...payload, issuer: 'https://other.moldex.example' } }
    })
    await expect(instance.account.getProfile(client)).rejects.toMatchObject({ errcode: 'PROTOCOL' })
  })

  it('refuses sign-out on a foreign-kind record with no attempt to settle', async () => {
    const instance = await booted()
    await instance.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({ kind: 'api-key', key: 'sk' }))
    await expect(instance.account.signOut(client)).rejects.toMatchObject({ errcode: 'STORAGE' })
  })

  it('rethrows a non-authentication failure from the post-refresh retry', async () => {
    const instance = await signedIn()
    let profileCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/auth/refresh-token')) return Response.json({ success: true, data: { ...tokens, access_token: 'access-2' } })
      if (url.endsWith('/profile/me')) {
        profileCalls += 1
        if (profileCalls === 1) return Response.json({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { status: 401 })
        return Response.json({ success: false, error: { code: 'TENANT_DISABLED', message: 'disabled' } }, { status: 403 })
      }
      throw new Error(`unexpected ${url}`)
    }))
    await expect(instance.account.getProfile(client)).rejects.toMatchObject({ errcode: 'TENANT_DISABLED' })
    expect(profileCalls).toBe(2)
  })

  it('fails reads when the stored record is not a grant', async () => {
    const instance = await signedIn()
    await instance.ctx.credentials.modifyRecord(credentialKey('moldex-account', 'default'), async () => ({ kind: 'api-key', key: 'sk' }))
    await expect(instance.account.getProfile(client)).rejects.toMatchObject({ errcode: 'STORAGE' })
  })

  it('propagates a transport failure from the post-refresh retry', async () => {
    const instance = await signedIn()
    let profileCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/auth/refresh-token')) return Response.json({ success: true, data: { ...tokens, access_token: 'access-2' } })
      if (url.endsWith('/profile/me')) {
        profileCalls += 1
        if (profileCalls === 1) return Response.json({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }, { status: 401 })
        throw new TypeError('network down')
      }
      throw new Error(`unexpected ${url}`)
    }))
    await expect(instance.account.getProfile(client)).rejects.toBeInstanceOf(TypeError)
    expect(profileCalls).toBe(2)
  })

  it('aborts an active attempt when the provider is disposed', async () => {
    const instance = await booted()
    const account = instance.account
    await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    const attempt = await account.getState()
    expect(attempt.attempt?.phase).toBe('initializing')
    await instance.dispose()
    cleanups.splice(cleanups.indexOf(instance.dispose), 1)
    // The disposed context tears its services down with it.
    await expect(account.getState()).rejects.toThrow()
  })

  it('rejects a second submission with no waiting form', async () => {
    const { account } = await booted()
    await expect(account.submitCredentials({ account: 'x@example.invalid', password: 'y' }))
      .rejects.toMatchObject({ errcode: 'PROTOCOL' })
  })

  it('classifies a non-JSON gateway answer by status', async () => {
    const { account } = await booted()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway exploded', { status: 502 })))
    await account.startSignIn(client, 'http://127.0.0.1:0', 'desktop')
    await expect(account.submitCredentials({ account: 'a@b.invalid', password: 'c' }))
      .rejects.toMatchObject({ errcode: 'HTTP_STATUS', status: 502 })
  })
})
