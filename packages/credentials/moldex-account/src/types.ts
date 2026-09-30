/** Moldex tenant-API wire shapes and the typed failures adapters map onto account semantics. */

/** One failure of the Moldex tenant envelope: the platform error code and its message. */
export class MoldexApiError extends Error {
  /** Stable Moldex error code, e.g. AUTH_INVALID_CREDENTIALS. */
  readonly errcode: string
  /** HTTP status when the error preceded streaming. */
  readonly status: number | undefined

  /**
   * @param errcode - the envelope's stable platform error code.
   * @param message - the server-authored failure text.
   * @param status - HTTP status when the error preceded streaming.
   */
  constructor(errcode: string, message: string, status?: number) {
    super(message)
    this.name = 'MoldexApiError'
    this.errcode = errcode
    this.status = status
  }
}

/** The uniform Moldex tenant response envelope; callers receive only `data`. */
export interface MoldexEnvelope<T> {
  readonly success: boolean
  readonly data?: T
  readonly message?: string
  readonly error?: { readonly code: string; readonly message: string; readonly details?: unknown }
  readonly request_id?: string
}

/** Token grant returned by login and refresh; lifetimes are server-fixed. */
export interface MoldexTokens {
  readonly access_token: string
  readonly refresh_token: string
  readonly expires_in: number
  readonly username?: string
}

/** Current-user projection returned by the tenant profile endpoint. */
export interface MoldexProfile {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
}

/** Billing overview returned by the tenant dashboard endpoint. */
export interface MoldexBilling {
  readonly balance: number
  readonly test_balance: number
  readonly currency: string
  readonly plan_name?: string | null
  readonly low_balance_warning?: boolean
}

/** One tenant API key as listed; the plaintext never re-appears after creation. */
export interface MoldexApiKeyEntry {
  readonly id: string
  readonly name: string
  readonly key_prefix: string
  readonly is_active: boolean
}

/** The one-time plaintext answer of API-key creation. */
export interface MoldexApiKeyCreated {
  readonly id: string
  readonly key: string
  readonly key_prefix: string
  readonly name: string
}

/** Sign-in form payload crossing the dedicated moldexAccount namespace once per attempt. */
export interface MoldexSignInInput {
  /** Registered account: email address or phone number. */
  readonly account: string
  readonly password: string
}

/** API-key facts the Client may display after creation. */
export interface MoldexApiKeySelection {
  readonly id: string
  readonly keyPrefix: string
  readonly name: string
}

/** Keys visible to the signed-in account, in server order. */
export type MoldexApiKeyList = readonly MoldexApiKeyEntry[]
