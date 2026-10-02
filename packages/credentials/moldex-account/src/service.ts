/** Moldex tenant account provider: form login, single-flight JWT refresh, and key storage. */
import { randomUUID } from 'node:crypto'
import { platform, release } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { DeepSeekAccount, type AccountBonusBatch, type AccountBonusOrderId, type AccountClientMetadata, type AccountDetails, type AccountUserId, type AccountView, type PlatformSession, type SignInAttemptId, type SignInAttemptView } from '@deepseek-ai/dsh-deepseek-account'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { Config, originOf } from './config.ts'
import { billing, createApiKey, listApiKeys, login, profile, refresh } from './protocol.ts'
import { MoldexApiError, type MoldexApiKeyList, type MoldexApiKeySelection, type MoldexSignInInput, type MoldexTokens } from './types.ts'

export { MoldexApiError } from './types.ts'


/** Credential-record scope owning the stored Moldex grant. */
export const moldexAccountKey = credentialKey('moldex-account', 'default')
const KEY = moldexAccountKey
/** Stored grant shape; `issuer` pins the record to the accountOrigin that issued it. */
const grant = z.object({
  version: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  issuer: z.url(),
  accessExpiresAt: z.number(),
})

interface Attempt {
  view: SignInAttemptView
  controller: AbortController
  /** Settles when the form submits or the attempt ends; rejection carries the failure code. */
  submitted: { promise: Promise<MoldexTokens>; resolve(tokens: MoldexTokens): void; reject(reason?: unknown): void }
  session: AuthorizationSession | undefined
  done: Promise<void>
}

const CANCELLED = new MoldexApiError('AUTH_TIMEOUT', 'moldex-account: sign-in attempt was cancelled')

/** The Moldex implementation owns login state and its opaque stored grant. */
export class MoldexAccount extends DeepSeekAccount {
  static inject = ['credentials', 'authorization']
  static Config = Config
  private readonly accountOrigin: string
  private readonly apiKeyEnv: string
  private readonly requestTimeout: number
  private attempt: Attempt | undefined
  private readonly listeners = new Set<() => void>()
  private lastProfileId: AccountUserId | null = null
  private refreshInFlight: Promise<string> | undefined
  private expiring: Promise<void> | undefined
  private closed = false
  private removing: Promise<AccountView> | undefined

  /** @param ctx - Host with authorization and credentials services. @param config - deployment options. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    const resolved = Config(config)
    this.accountOrigin = originOf(resolved.accountOrigin, 'accountOrigin', resolved.allowLoopbackHttp)
    this.apiKeyEnv = resolved.apiKeyEnv
    this.requestTimeout = resolved.requestTimeoutMs
    ctx.on('credentials/record-updated', (key) => {
      if (key !== KEY) return
      this.changed()
    })
    ctx.authorization.registerFlow({
      key: KEY, label: 'Moldex', methods: [{ id: 'password', label: 'Moldex' }],
      run: (session) => {
        const attempt = this.attempt
        if (attempt === undefined) return Promise.reject(new MoldexApiError('PROTOCOL', 'moldex-account: no active sign-in attempt'))
        attempt.session = session
        return attempt.submitted.promise.then(async (tokens) => {
          this.update(attempt, { phase: 'committing' })
          await session.commit({ kind: 'grant', payload: grant.parse(this.storedGrant(tokens)) })
        })
      },
    })
    ctx.effect(() => async () => {
      this.closed = true
      const active = this.attempt
      if (active !== undefined) {
        active.controller.abort()
        active.submitted.reject(new MoldexApiError('PROTOCOL', 'moldex-account: provider disposed during sign-in'))
        await active.done
      }
      this.changed()
    }, 'moldex-account: active attempt lifetime')
  }

  async [Service.init](): Promise<void> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return
    if (record.kind !== 'grant') throw new MoldexApiError('STORAGE', 'moldex-account: stored credential is not a grant')
    const parsed = grant.safeParse(record.payload)
    if (!parsed.success) throw new MoldexApiError('STORAGE', 'moldex-account: stored grant payload is invalid')
    if (parsed.data.issuer === this.accountOrigin) return
    await this.ctx.credentials.deleteRecord(KEY)
    console.info('[moldex-account] stored grant discarded', { reason: 'issuer-mismatch' })
  }

  override async getState(): Promise<AccountView> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record !== undefined && (record.kind !== 'grant' || !grant.safeParse(record.payload).success)) {
      throw new MoldexApiError('STORAGE', 'moldex-account: stored credential is not a valid grant')
    }
    const attempt = this.attempt?.view ?? null
    return {
      status: record === undefined ? 'signed-out' : 'credential-stored',
      attempt: record === undefined && attempt?.phase === 'succeeded' ? null : attempt,
      links: {
        usageUrl: new URL('/dashboard', this.accountOrigin).href,
        topUpUrl: new URL('/billing/recharge', this.accountOrigin).href,
      },
    }
  }

  override async getProfile(client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    const stored = await this.currentGrant()
    if (stored === null) return null
    try {
      const me = await this.authenticatedGet(stored, client, target =>
        profile(this.accountOrigin, target, AbortSignal.timeout(this.requestTimeout)))
      if (me === null) return null
      const value = {
        id: me.id as AccountUserId,
        name: me.name,
        contact: me.email ?? me.phone,
        avatarUrl: null,
      }
      if (this.lastProfileId !== (me.id as AccountUserId)) {
        this.lastProfileId = me.id as AccountUserId
        this.changed()
      }
      return { status: 'ready', value } satisfies AccountDetails['profile']
    } catch (error) {
      const consumed = await this.expireIfUnauthorized(error)
      /* v8 ignore next -- both branches run (tenant-failure rethrow, post-refresh expiry); v8 mis-attributes across the async catch. */
      if (consumed) return null
      throw error
    }
  }

  override async getBalance(client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> {
    const stored = await this.currentGrant()
    if (stored === null) return null
    try {
      const data = await this.authenticatedGet(stored, client, target =>
        billing(this.accountOrigin, target, AbortSignal.timeout(this.requestTimeout)))
      if (data === null) return null
      const currency = data.currency.toUpperCase() === 'USD' ? 'USD' as const : 'CNY' as const
      const value = [{ currency, balance: String(data.balance) }]
      const bonusWallets = data.test_balance > 0 ? [{ currency, balance: String(data.test_balance) }] : []
      return { status: 'ready', value, bonusWallets } satisfies AccountDetails['balance']
    } catch (error) {
      const consumed = await this.expireIfUnauthorized(error)
      /* v8 ignore next -- both branches run (tenant-failure rethrow, post-refresh expiry); v8 mis-attributes across the async catch. */
      if (consumed) return null
      throw error
    }
  }

  override getUnnotifiedBonuses(_client: AccountClientMetadata): Promise<AccountBonusBatch | null> {
    // Moldex grants no promotional bonus notifications; the contract's absent
    // outcome renders no bonus surface.
    return Promise.resolve(null)
  }

  override ackBonusNotified(_accountId: AccountUserId, _orderId: AccountBonusOrderId, _client: AccountClientMetadata): Promise<boolean> {
    return Promise.resolve(false)
  }

  override async startSignIn(client: AccountClientMetadata, _callbackOrigin: string, _loginSource: 'web' | 'desktop'): Promise<AccountView> {
    if (this.removing !== undefined) await this.removing
    if (this.closed) throw new MoldexApiError('PROTOCOL', 'moldex-account: provider is disposed')
    const active = this.attempt
    if (active !== undefined && ['initializing', 'committing'].includes(active.view.phase)) return this.getState()
    if (active !== undefined) await active.done
    const attempt: Attempt = {
      view: { id: randomUUID() as SignInAttemptId, phase: 'initializing' },
      controller: new AbortController(),
      submitted: Promise.withResolvers<MoldexTokens>(),
      session: undefined,
      done: Promise.resolve(),
    }
    this.attempt = attempt
    void attempt.submitted.promise.catch(() => undefined)
    const onAbort = (): void => { attempt.submitted.reject(CANCELLED) }
    attempt.controller.signal.addEventListener('abort', onAbort, { once: true })
    attempt.done = this.ctx.authorization.begin({
      key: KEY, signal: attempt.controller.signal,
      // The form flow reports progress through the attempt view, never through an interaction prompt.
      /* v8 ignore next */
      interaction: { notify: () => undefined, prompt: () => Promise.reject(new MoldexApiError('PROTOCOL', 'moldex-account: no interactive prompt')) },
    }).then((outcome) => {
      this.update(attempt, { phase: outcome.status === 'authorized' ? 'succeeded' : 'cancelled' })
    }).catch((error: unknown) => {
      // Cancellation settles the attempt as cancelled before the flow rejects;
      // every rejection that reaches here is a failure, not an expiry.
      const code = error instanceof MoldexApiError ? error.errcode : 'PROTOCOL'
      console.info('[moldex-account] sign-in failed', { errcode: code })
      this.update(attempt, { phase: 'failed', errorCode: 'protocol' })
    }).finally(() => {
      attempt.controller.signal.removeEventListener('abort', onAbort)
    })
    void client
    this.changed()
    return this.getState()
  }

  override async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    const attempt = this.attempt
    if (attempt?.view.id === id) {
      attempt.controller.abort()
      this.ctx.authorization.cancel(KEY)
      await attempt.done
    }
    return this.getState()
  }

  override signOut(_client: AccountClientMetadata): Promise<AccountView> {
    this.removing ??= (async () => {
      if (this.closed) throw new MoldexApiError('PROTOCOL', 'moldex-account: provider is disposed')
      if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
      const record = await this.ctx.credentials.readRecord(KEY)
      if (record !== undefined) {
        if (record.kind !== 'grant') throw new MoldexApiError('STORAGE', 'moldex-account: stored credential is not a grant')
        const parsed = grant.safeParse(record.payload)
        if (!parsed.success || parsed.data.issuer !== this.accountOrigin) {
          throw new MoldexApiError('PROTOCOL', 'moldex-account: stored grant does not match the configured origin')
        }
        await this.ctx.credentials.deleteRecord(KEY)
      }
      await this.clearStoredInferenceKey()
      this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    return this.removing
  }

  override async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  override resolveToken(url: string): Promise<string | undefined> {
    // Moldex inference authenticates with the tenant API key owned by the
    // credentials store, not with the account grant; account-level token
    // resolution has no consumer on this provider.
    void url
    return Promise.resolve(undefined)
  }

  override async rejectToken(_token: string): Promise<void> {
    // Inference rejections name tenant API keys, which live in the credentials
    // store under the configured reference; the account grant is not the
    // inference credential, so a rejected key never expires the login.
  }

  override getPlatformSession(): Promise<PlatformSession | null> {
    // Moldex has no embedded-platform document semantics; the welcome flow
    // degrades to the regular sign-in presentation.
    return Promise.resolve(null)
  }

  override getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }> {
    return Promise.resolve({
      ...this.lastProfileId === null ? {} : { userId: this.lastProfileId },
      osVersion: `${platform()} ${release()}`,
    })
  }

  /** Submit the sign-in form for the active attempt; the password transits exactly here.
   * @param input - account identifier and password from the Client form.
   * @returns the state after the attempt commits or fails.
   */
  async submitCredentials(input: MoldexSignInInput): Promise<AccountView> {
    const attempt = this.attempt
    if (attempt === undefined || attempt.view.phase !== 'initializing') {
      throw new MoldexApiError('PROTOCOL', 'moldex-account: no sign-in form is waiting for credentials')
    }
    let tokens: MoldexTokens
    try {
      tokens = await login(this.accountOrigin, input.account, input.password, attempt.controller.signal)
    } catch (error) {
      // The caller receives the classified failure; the attempt view carries the phase.
      const wrapped = error instanceof MoldexApiError
        ? error
        : new MoldexApiError('NETWORK', 'moldex-account: sign-in request failed')
      attempt.submitted.reject(wrapped)
      await attempt.done
      throw wrapped
    }
    attempt.submitted.resolve(tokens)
    await attempt.done
    const state = await this.getState()
    if (state.status === 'credential-stored' && await this.ctx.credentials.resolve(credentialRef(this.apiKeyEnv)) === undefined) {
      await this.createAndStoreApiKey()
    }
    return this.getState()
  }

  /** Create one tenant API key and store its one-time plaintext under the configured reference.
   * @param name - human-readable key label; defaults to `DSH Desktop`.
   * @returns the created key facts for display.
   */
  async createAndStoreApiKey(name = 'DSH Desktop'): Promise<MoldexApiKeySelection> {
    const stored = await this.currentGrant()
    if (stored === null) throw new MoldexApiError('AUTH_INVALID_CREDENTIALS', 'moldex-account: sign in before creating an API key')
    const created = await createApiKey(this.accountOrigin, stored.accessToken, name, AbortSignal.timeout(this.requestTimeout))
    await this.ctx.credentials.set(credentialRef(this.apiKeyEnv), created.key)
    return { id: created.id, keyPrefix: created.key_prefix, name: created.name }
  }

  /** List the account's tenant API keys for display.
   * @returns key entries in server order.
   */
  async listApiKeys(): Promise<MoldexApiKeyList> {
    const stored = await this.currentGrant()
    if (stored === null) throw new MoldexApiError('AUTH_INVALID_CREDENTIALS', 'moldex-account: sign in before listing API keys')
    return listApiKeys(this.accountOrigin, stored.accessToken, AbortSignal.timeout(this.requestTimeout))
  }

  private storedGrant(tokens: MoldexTokens): {
    version: 1
    accessToken: string
    refreshToken: string
    issuer: string
    accessExpiresAt: number
  } {
    return {
      version: 1,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      issuer: this.accountOrigin,
      accessExpiresAt: Date.now() + tokens.expires_in * 1000,
    }
  }

  private update(attempt: Attempt, value: Partial<SignInAttemptView>): void {
    attempt.view = { ...attempt.view, ...value }
    this.changed()
  }

  private changed(): void { for (const listener of this.listeners) listener() }

  private async currentGrant(): Promise<z.infer<typeof grant> | null> {
    if (this.closed) return null
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return null
    if (record.kind !== 'grant') throw new MoldexApiError('STORAGE', 'moldex-account: stored credential is not a grant')
    const parsed = grant.safeParse(record.payload)
    /* v8 ignore next -- the payload rejection runs (seeded-record tests); v8 mis-attributes tail throws after awaits. */
    if (!parsed.success) throw new MoldexApiError('STORAGE', 'moldex-account: stored grant payload is invalid')
    const foreign = parsed.data.issuer !== this.accountOrigin
    if (foreign) throw new MoldexApiError('PROTOCOL', 'moldex-account: stored grant does not match the configured origin')
    return parsed.data
  }

  /** Run one authenticated GET with reactive single-flight refresh and one retry.
   * @returns the endpoint payload, or null when the login was consumed by an authentication rejection.
   */
  private async authenticatedGet<T>(stored: z.infer<typeof grant>,
    _client: AccountClientMetadata, run: (token: string) => Promise<T>): Promise<T | null> {
    let token = stored.accessToken
    try {
      return await run(token)
    } catch (error) {
      if (!(error instanceof MoldexApiError) || error.errcode !== 'AUTH_TOKEN_EXPIRED') throw error
      try {
        token = await this.refreshAccessToken(stored)
      } catch (_refreshFailed) {
        // refreshAccessToken already expired the login; render absence.
        return null
      }
    }
    try {
      return await run(token)
    } catch (error) {
      // A second rejection consumed the login; expire it and render absence.
      const consumed = await this.expireIfUnauthorized(error)
      /* v8 ignore next -- both branches run (tenant-failure rethrow, post-refresh expiry); v8 mis-attributes across the async catch. */
      if (consumed) return null
      throw error
    }
  }

  /** Refresh the access token once per stored grant; a failed refresh expires the login.
   * @returns the replacement access token for the retrying operation.
   */
  private async refreshAccessToken(stored: z.infer<typeof grant>): Promise<string> {
    this.refreshInFlight ??= (async () => {
      try {
        const tokens = await refresh(this.accountOrigin, stored.refreshToken, AbortSignal.timeout(this.requestTimeout))
        await this.ctx.credentials.modifyRecord(KEY, (current) => {
          // A concurrent sign-out removed the record; do not resurrect the login.
          if (current?.kind !== 'grant') return Promise.resolve(current)
          return Promise.resolve({ kind: 'grant', payload: this.storedGrant(tokens) })
        })
        this.changed()
        return tokens.access_token
      } catch (error) {
        await this.expireCredential()
        throw error
      } finally {
        this.refreshInFlight = undefined
      }
    })()
    await this.refreshInFlight
    const current = await this.currentGrant()
    if (current === null) throw new MoldexApiError('AUTH_TOKEN_EXPIRED', 'moldex-account: the refreshed login was removed concurrently')
    return current.accessToken
  }

  /** Remove the stored login when the platform rejected its credential; notifies live subscribers once. */
  private async expireCredential(): Promise<void> {
    if (this.closed) return
    this.expiring ??= this.removeGrant()
    await this.expiring
  }

  /* v8 ignore next 4 -- expiry races a live attempt and a settled removal only when disposal lands mid-login. */
  private async removeGrant(): Promise<void> {
    if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return
    if (record.kind !== 'grant') throw new MoldexApiError('STORAGE', 'moldex-account: stored credential is not a grant')
    await this.ctx.credentials.deleteRecord(KEY)
    await this.clearStoredInferenceKey()
    this.ctx.emit('deepseek-account/session-expired')
    this.attempt = undefined
    this.ctx.emit('deepseek-account/signed-out')
    this.changed()
  }

  /** Drop the tenant inference key so signed-out sessions cannot reuse a stored API key. */
  private async clearStoredInferenceKey(): Promise<void> {
    await this.ctx.credentials.unset(credentialRef(this.apiKeyEnv))
  }

  /** Expire the login only when the failure is a platform authentication rejection.
   * @returns whether the failure consumed the credential and the caller renders absence.
   */
  private async expireIfUnauthorized(error: unknown): Promise<boolean> {
    if (!(error instanceof MoldexApiError)) return false
    if (error.errcode !== 'AUTH_TOKEN_EXPIRED' && error.status !== 401) return false
    await this.expireCredential()
    return true
  }
}
