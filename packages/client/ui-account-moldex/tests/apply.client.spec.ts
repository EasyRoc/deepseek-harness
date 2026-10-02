// @vitest-environment jsdom
/** Desktop slot registration, gateway submission, and state-stream publishing. */
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp, type TestClient } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { MoldexBrandMark, MoldexBrandName } from '../src/client/Brand.tsx'
import { MoldexSignIn, type MoldexSignInInjected } from '../src/client/MoldexSignIn.tsx'

const it = createClientTest({
  roster: webApp,
  // The mock routes same-endpoint frames to the first consumer only: replace the
  // DeepSeek account plugin with an inert row so the Moldex stream is the sole
  // account/watch consumer, matching a Moldex profile where it is the provider.
  provide: { '@deepseek-ai/dsh-client-ui-settings-account': { apply: () => {} } },
})

function moldexEntry(c: TestClient) {
  return c.ctx.slots.entries('settings.models.sign-in').find(entry => entry.component === MoldexSignIn)
}
/** The injected share, read through the inject factory so getter fields evaluate at read time. */
function injectedOf(c: TestClient): MoldexSignInInjected {
  const raw: object = moldexEntry(c)!.inject!()
  return raw as MoldexSignInInjected
}
/** The Moldex gateway namespace on the runtime mock, typed by its wire methods. */
function moldexMock(c: TestClient): {
  submitCredentials: {
    mockResolvedValue(value: unknown): void
    mockRejectedValue(error: unknown): void
    mock: { calls: unknown[][] }
  }
} {
  const remote: object = c.mock.remote
  return (remote as {
    moldexAccount: {
      submitCredentials: {
        mockResolvedValue(value: unknown): void
        mockRejectedValue(error: unknown): void
        mock: { calls: unknown[][] }
      }
    }
  }).moldexAccount
}

const signedOut: AccountView = {
  status: 'signed-out', attempt: null,
  links: { usageUrl: 'https://www.moldex.top/dashboard', topUpUrl: 'https://www.moldex.top/billing/recharge' },
}
const stored: AccountView = { ...signedOut, status: 'credential-stored' }

beforeEach(() => { vi.stubEnv('DSH_CLIENT_VERSION', '0.0.0-test') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('stays inert without an explicit mount', async ({ start, mock }) => {
  const c = await start()
  await c.flush()
  expect(moldexEntry(c)).toBeUndefined()
  expect(mock.log.calls().filter(call => call.endpoint.startsWith('moldexAccount/'))).toEqual([])
}, 60_000)

it('registers Moldex sidebar brand slots', async ({ start }) => {
  const c = await start()
  await c.flush()
  expect(c.ctx.slots.entries('sidebar.brand.mark').some(entry => entry.component === MoldexBrandMark)).toBe(true)
  expect(c.ctx.slots.entries('sidebar.brand.name').some(entry => entry.component === MoldexBrandName)).toBe(true)
}, 60_000)

it('registers the shadowing form under the desktop guard', async ({ start }) => {
  vi.stubGlobal('dshDesktop', {})
  const c = await start()
  await c.flush()
  const entry = moldexEntry(c)!
  expect((entry.options as { priority?: number }).priority).toBe(-1)
  // The mock's default stream answer serves the signed-out state on open.
  expect(injectedOf(c).view).toMatchObject({ status: 'signed-out' })
}, 60_000)

it('publishes stream frames into the injected view', async ({ start }) => {
  vi.stubGlobal('dshDesktop', {})
  const c = await start()
  await c.mock.streams.opened('account/watch', 1)
  c.mock.streams.push('account/watch', stored)
  await c.flush()
  expect(injectedOf(c).view).toEqual(stored)
  expect(injectedOf(c).failed).toBe(false)
}, 60_000)

it('marks the stream failed when the watch stream ends', async ({ start }) => {
  vi.stubGlobal('dshDesktop', {})
  const c = await start()
  await c.mock.streams.opened('account/watch', 1)
  c.mock.streams.end('account/watch')
  await vi.waitFor(() => { expect(injectedOf(c).failed).toBe(true) })
}, 60_000)

it('starts sign-in through the account namespace', async ({ start, mock }) => {
  vi.stubGlobal('dshDesktop', {})
  const c = await start()
  mock.remote.account.startSignIn.mockResolvedValue(ok(signedOut))
  injectedOf(c).start?.()
  await c.flush()
  expect(mock.remote.account.startSignIn).toHaveBeenCalledTimes(1)
  const [clientArg, callbackOrigin, loginSource] = mock.remote.account.startSignIn.mock.calls[0]!
  expect(callbackOrigin).toBe('')
  expect(loginSource).toBe('desktop')
  expect(clientArg.version).toBe('0.0.0-test')
}, 60_000)

it('publishes the sign-in failure message when start is rejected', async ({ start, mock }) => {
  vi.stubGlobal('dshDesktop', {})
  const c = await start()
  mock.remote.account.startSignIn.mockRejectedValue(new Error('sign-in rejected'))
  injectedOf(c).start?.()
  await c.flush()
  await new Promise((resolve) => { setTimeout(resolve, 10) })
  expect(injectedOf(c).error).toContain('sign-in rejected')
}, 60_000)

it('submits credentials through the moldexAccount gateway', async ({ start }) => {
  vi.stubGlobal('dshDesktop', {})
  const c = await start()
  await c.mock.streams.opened('account/watch', 1)
  c.mock.streams.push('account/watch', stored)
  await c.flush()
  moldexMock(c).submitCredentials.mockResolvedValue(ok(stored))
  injectedOf(c).submit?.({ account: 'roceasy@qq.com', password: 'pw' })
  await vi.waitFor(() => { expect(injectedOf(c).submitting).toBe(false) })
  expect(moldexMock(c).submitCredentials).toHaveBeenCalledWith({ account: 'roceasy@qq.com', password: 'pw' })
  expect(injectedOf(c).error).toBeNull()
  expect(injectedOf(c).submitting).toBe(false)
}, 60_000)

it('surfaces a submission rejection through the injected error', async ({ start }) => {
  vi.stubGlobal('dshDesktop', {})
  const c = await start()
  await c.mock.streams.opened('account/watch', 1)
  c.mock.streams.push('account/watch', stored)
  await c.flush()
  moldexMock(c).submitCredentials.mockRejectedValue(new Error('wrong password'))
  injectedOf(c).submit?.({ account: 'roceasy@qq.com', password: 'bad' })
  await vi.waitFor(() => { expect(injectedOf(c).error).toContain('wrong password') })
  expect(injectedOf(c).error).toContain('wrong password')
  expect(injectedOf(c).submitting).toBe(false)
}, 60_000)
