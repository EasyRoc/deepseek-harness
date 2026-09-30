/** Moldex tenant-API HTTP calls; one function per endpoint, envelope unwrapping shared. */
import { unwrap } from './envelope.ts'
import type { MoldexApiKeyCreated, MoldexApiKeyEntry, MoldexBilling, MoldexProfile, MoldexTokens } from './types.ts'

/** Tenant-API version root shared by every account endpoint. */
export const TENANT_API_ROOT = '/api/v1/tenant'

/** Send one tenant-API request and unwrap its envelope.
 * @param origin - the configured account origin, e.g. `https://www.moldex.top`.
 * @param path - tenant path below {@link TENANT_API_ROOT}, beginning with `/`.
 * @param options - method, bearer token, JSON body, and cancellation.
 * @returns the unwrapped `data` payload.
 */
export async function tenantRequest<T>(origin: string, path: string,
  options: { method?: 'GET' | 'POST'; token?: string; body?: unknown; signal: AbortSignal }): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
  const response = await fetch(`${origin}${TENANT_API_ROOT}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
    signal: options.signal, redirect: 'error',
  })
  return unwrap<T>(response)
}

/** Exchange account credentials for a token grant.
 * @param origin - the configured account origin.
 * @param account - registered email address or phone number.
 * @param password - the account password; this call is its only transit.
 * @param signal - cancellation.
 * @returns the issued token grant.
 */
export function login(origin: string, account: string, password: string, signal: AbortSignal): Promise<MoldexTokens> {
  return tenantRequest<MoldexTokens>(origin, '/auth/login', {
    method: 'POST', body: { account, password, accepted_legal_terms: true }, signal,
  })
}

/** Exchange a refresh token for a fresh grant.
 * @param origin - the configured account origin.
 * @param refreshToken - the stored refresh token.
 * @param signal - cancellation.
 * @returns the replacement token grant.
 */
export function refresh(origin: string, refreshToken: string, signal: AbortSignal): Promise<MoldexTokens> {
  return tenantRequest<MoldexTokens>(origin, '/auth/refresh-token', {
    method: 'POST', body: { refresh_token: refreshToken }, signal,
  })
}

/** Read the signed-in account profile.
 * @param origin - the configured account origin.
 * @param token - access token.
 * @param signal - cancellation.
 * @returns the current-user projection.
 */
export function profile(origin: string, token: string, signal: AbortSignal): Promise<MoldexProfile> {
  return tenantRequest<MoldexProfile>(origin, '/profile/me', { token, signal })
}

/** Read the billing dashboard overview.
 * @param origin - the configured account origin.
 * @param token - access token.
 * @param signal - cancellation.
 * @returns balance, test balance, and currency facts.
 */
export function billing(origin: string, token: string, signal: AbortSignal): Promise<MoldexBilling> {
  return tenantRequest<MoldexBilling>(origin, '/dashboard/billing', { token, signal })
}

/** List the account's tenant API keys; plaintext values never re-appear here.
 * @param origin - the configured account origin.
 * @param token - access token.
 * @param signal - cancellation.
 * @returns key entries in server order.
 */
export function listApiKeys(origin: string, token: string, signal: AbortSignal): Promise<MoldexApiKeyEntry[]> {
  return tenantRequest<MoldexApiKeyEntry[]>(origin, '/api-keys', { token, signal })
}

/** Create one tenant API key; the plaintext answer is returned exactly once.
 * @param origin - the configured account origin.
 * @param token - access token.
 * @param name - human-readable key label.
 * @param signal - cancellation.
 * @returns the created key facts carrying the one-time plaintext.
 */
export function createApiKey(origin: string, token: string, name: string, signal: AbortSignal): Promise<MoldexApiKeyCreated> {
  return tenantRequest<MoldexApiKeyCreated>(origin, '/api-keys', { method: 'POST', token, body: { name }, signal })
}
