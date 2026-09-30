/** Plugin configuration for the Moldex tenant account provider. */
import Schema from '@deepseek-ai/schemastery'

/** Deployment-specific account and request settings. */
export interface Config {
  /** Origin serving the tenant API and the user portal, e.g. `https://www.moldex.top`. */
  accountOrigin?: string
  /** Credential reference the created inference key is stored under. */
  apiKeyEnv?: string
  /** Deadline for each tenant HTTP request. */
  requestTimeoutMs?: number
  /** Allow HTTP only on loopback hosts for the development Mock. */
  allowLoopbackHttp?: boolean
}

/** Validated deployment choices. */
export const Config = Schema.object({
  accountOrigin: Schema.string().default('https://www.moldex.top'),
  apiKeyEnv: Schema.string().role('credential-ref').default('MOLDEX_API_KEY'),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  allowLoopbackHttp: Schema.boolean().default(false),
})

/** Validate one origin as an HTTP(S) origin without credentials, path, query, or fragment.
 * @param origin - the configured value.
 * @param label - config field name used in the failure message.
 * @param allowLoopbackHttp - permit plain HTTP on loopback hosts for the development Mock.
 * @returns the normalized origin.
 */
export function originOf(origin: string, label: string, allowLoopbackHttp = false): string {
  const parsed = new URL(origin)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (!['http:', 'https:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !(allowLoopbackHttp && loopback))
    || parsed.username || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    throw new Error(`moldex-account: ${label} must be an HTTP(S) origin without credentials, path, query or fragment`)
  }
  return parsed.origin
}
