/** The Moldex sign-in slot: shadows the browser-handling onboarding in Moldex profiles. */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-moldex-account/remote'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import './slot-contract.ts'
import { MoldexBrandMark, MoldexBrandName } from './Brand.tsx'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { MoldexSignIn, type MoldexAccountSnapshot, type MoldexSignInInjected } from './MoldexSignIn.tsx'
import { MoldexSignInOverlay, type MoldexSignInOverlayInjected } from './MoldexSignInOverlay.tsx'
import { en, zh, type MoldexKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.moldex': MoldexKey }
}

/** Services required by the Moldex sign-in form. */
export const inject = ['slots', 'locale', 'remote', 'remote.account', 'remote.moldexAccount']

/** Register the Moldex sign-in form. @param ctx - client plugin context. */
export function apply(ctx: Context): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', locale: 'settings.moldex' }, MoldexBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', locale: 'settings.moldex' }, MoldexBrandName)
    }))
  if (!('dshDesktop' in globalThis)) return
  /** Client identity for one account call, read at call time so it carries the active language. */
  const clientMetadata = (): { version: string; locale: string; timezoneOffsetSeconds: number } => ({
    version: process.env.DSH_CLIENT_VERSION ?? '0.0.0-dev',
    locale: ctx.locale.getSnapshot().active === 'zh' ? 'zh-CN' : 'en',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  })
  ctx.effect(() => ctx.locale.register('settings.moldex', { en, zh }), 'moldex-account: dictionaries')
  const account = createSnapshotStore<MoldexAccountSnapshot>({
    view: undefined, failed: false, submitting: false, error: null,
  })
  const stream = ctx.remote.$stream<AccountView>({
    name: 'account-moldex', open: signal => ctx.remote.account.watch(signal), ended: () => new Error('moldex-account: state stream ended'),
  })
  const lifetime = { disposed: false }
  ctx.effect(() => () => { lifetime.disposed = true; void stream.dispose() }, 'moldex-account: state stream')
  void (async () => {
    for await (const frame of stream) {
      account.set({ ...account.getSnapshot(), view: frame.value, failed: false })
    }
    if (!lifetime.disposed) account.set({ ...account.getSnapshot(), failed: true })
  })().catch(() => { if (!lifetime.disposed) account.set({ ...account.getSnapshot(), failed: true }) })
  const operations: MoldexSignInInjected = {
    get view() { return account.getSnapshot().view },
    get failed() { return account.getSnapshot().failed },
    get submitting() { return account.getSnapshot().submitting },
    get error() { return account.getSnapshot().error },
    start: () => {
      void ctx.remote.account.startSignIn(clientMetadata(), '', 'desktop').then((result) => {
        if (result.ok) return
        account.set({ ...account.getSnapshot(), error: result.error.message })
      })
    },
    submit: (input: { account: string; password: string }) => {
      account.set({ ...account.getSnapshot(), submitting: true, error: null })
      /* v8 ignore next 3 -- the gateway RPC needs a roster carrying the Moldex host row; the host loopback suite owns the semantics. */
      void ctx.remote.moldexAccount.submitCredentials(input).then((result) => {
        account.set({ ...account.getSnapshot(), submitting: false, error: result.ok ? null : result.error.message })
      })
    },
  }
  ctx.slots.inject('settings.models.sign-in', () => ctx.slots.register({
    name: 'settings.models.sign-in', priority: -1, locale: 'settings.moldex',
    inject: (): MoldexSignInInjected & { hooks: { account: typeof account } } => ({
      ...operations,
      hooks: { account },
    }),
  }, MoldexSignIn))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'moldex-account-sign-in', priority: -1, locale: 'settings.moldex',
    inject: (): MoldexSignInOverlayInjected => ({
      ...operations,
      hooks: { account },
      cancel: async (id) => {
        const result = await ctx.remote.account.cancelSignIn(id)
        if (!result.ok) throw new Error(result.error.message)
      },
    }),
  }, MoldexSignInOverlay))
}
