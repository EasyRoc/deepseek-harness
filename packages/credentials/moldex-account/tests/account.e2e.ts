/**
 * Real tenant round trips against the production account origin. Self-skipping
 * without MOLDEX_E2E_ACCOUNT and MOLDEX_E2E_PASSWORD keeps keyless CI green.
 * The run signs in, reads profile and balance, and signs out; it creates no
 * tenant resources.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MoldexAccount } from '../src/service.ts'

const ACCOUNT = process.env.MOLDEX_E2E_ACCOUNT
const PASSWORD = process.env.MOLDEX_E2E_PASSWORD
const READY = ACCOUNT !== undefined && PASSWORD !== undefined

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length) await cleanups.pop()!()
})

const client: AccountClientMetadata = { version: '0.0.0-dev', locale: 'en', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }

describe.skipIf(!READY)('Moldex account real gateway', () => {
  it('signs in, reads profile and balance, and signs out', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-moldex-e2e-'))
    cleanups.push(async () => { await rm(home, { recursive: true, force: true }) })
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
    await credentials
    const authorization = ctx.plugin(AuthorizationService)
    await authorization
    const provider = ctx.plugin(MoldexAccount, { accountOrigin: 'https://www.moldex.top', requestTimeoutMs: 30_000 })
    await provider
    const account = ctx.deepseekAccount as MoldexAccount

    const attempt = await account.startSignIn(client, '', 'desktop')
    expect(attempt.attempt?.phase).toBe('initializing')
    const signedIn = await account.submitCredentials({ account: ACCOUNT as string, password: PASSWORD as string })
    expect(signedIn.status).toBe('credential-stored')

    const profile = await account.getProfile(client)
    expect(profile?.status).toBe('ready')
    if (profile?.status === 'ready') expect(profile.value.id).not.toBeNull()

    const balance = await account.getBalance(client)
    expect(balance?.status).toBe('ready')
    if (balance?.status === 'ready') {
      expect(balance.value.length).toBeGreaterThan(0)
      expect(balance.value[0]?.currency).toMatch(/CNY|USD/)
    }

    const signedOut = await account.signOut(client)
    expect(signedOut.status).toBe('signed-out')
    expect(await ctx.credentials.readRecord(credentialKey('moldex-account', 'default'))).toBeUndefined()
  })
})
