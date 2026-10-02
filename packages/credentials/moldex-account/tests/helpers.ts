/** Programmable Moldex tenant API loopback and a booted account fixture. */
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account'
import apply from '../src/index.ts'
import { MoldexAccount } from '../src/service.ts'

/** Client identity supplied with each account operation. */
export const client: AccountClientMetadata = { version: '1.2.3', locale: 'en', timezoneOffsetSeconds: 28_800 }

/** One recorded tenant-API request. */
export interface TenantRequest { path: string; method: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }

/** Behavior knobs the test mutates between requests. */
export interface TenantBehavior {
  status: number
  responses: Record<string, unknown>
  holdPaths: string[]
  held?: PromiseWithResolvers<string>
}

/** Boot one Moldex account against a loopback tenant API; the caller drives replies per path. */
export async function fixture(
  home?: string,
  beforeAccount?: (ctx: Context, origin: string) => Promise<void>,
  mount: 'account' | 'apply' = 'account',
): Promise<{
  ctx: Context
  account: MoldexAccount
  origin: string
  requests: TenantRequest[]
  behavior: TenantBehavior
  dispose: () => Promise<void>
}> {
  const requests: TenantRequest[] = []
  const behavior: TenantBehavior = {
    status: 200,
    responses: {
      'POST /api/v1/tenant/api-keys': {
        success: true,
        data: { id: 'key-auto', key: 'sk-moldex-new', key_prefix: 'sk-moldex-n', name: 'DSH Desktop' },
      },
    },
    holdPaths: [],
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => response.destroy(error as Error))
  })
  async function handle(request: import('node:http').IncomingMessage, response: ServerResponse) {
    const parts: Buffer[] = []
    for await (const part of request as AsyncIterable<Buffer>) parts.push(part)
    const text = Buffer.concat(parts).toString()
    requests.push({
      path: request.url ?? '/', method: request.method ?? 'GET', headers: request.headers,
      body: text.length === 0 ? {} : JSON.parse(text) as Record<string, unknown>,
    })
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const method = request.method ?? 'GET'
    const methodPath = `${method} ${path}`
    if (behavior.holdPaths.includes(path)) {
      behavior.held ??= Promise.withResolvers<string>()
      await behavior.held.promise
    }
    const payload = behavior.responses[methodPath] ?? behavior.responses[path]
      ?? { error: { code: 'ROUTE_NOT_FOUND', message: `no fixture for ${methodPath}` } }
    response.statusCode = behavior.status
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(payload))
  }
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('loopback server failed to bind')
  const origin = `http://127.0.0.1:${address.port}`
  const store = home ?? await mkdtemp(join(tmpdir(), 'dsh-moldex-account-'))
  vi.stubEnv('DSH_HOME', store)
  delete process.env.MOLDEX_API_KEY
  const ctx = new Context()
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(store, 'credentials.yaml'), watch: false })
  await credentials
  const authorization = ctx.plugin(AuthorizationService)
  await authorization
  await beforeAccount?.(ctx, origin)
  const config = { accountOrigin: origin, allowLoopbackHttp: true, requestTimeoutMs: 5_000 }
  const provider = mount === 'apply'
    ? ctx.plugin(apply, config)
    : ctx.plugin(MoldexAccount, config)
  await provider
  await ctx.fiber.await()
  const account = ctx.deepseekAccount as MoldexAccount
  return {
    ctx, account, origin, requests, behavior,
    dispose: async () => {
      await provider.dispose()
      await authorization.dispose()
      await credentials.dispose()
      await ctx.fiber.dispose()
      vi.unstubAllEnvs()
      await new Promise<void>((resolve) => {
        server.close(() => { resolve() })
        server.closeAllConnections()
      })
      if (home === undefined) await rm(store, { recursive: true, force: true })
    },
  }
}

/** Standard tenant envelope bodies shared by several scenarios. */
export const tokens = { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, username: 'tester' }
export const loginBody = { success: true, data: tokens }
export const profileBody = { success: true, data: { id: 'acc-1', name: 'Tester', email: 't@example.invalid', phone: null } }
export const billingBody = {
  success: true,
  data: { balance: 12.5, test_balance: 3.25, currency: 'CNY', plan_name: 'Pro', low_balance_warning: false },
}
