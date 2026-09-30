/** Unwrap the uniform Moldex tenant envelope; every failure carries its platform error code. */
import { MoldexApiError, type MoldexEnvelope } from './types.ts'

/** Read one JSON HTTP response as the tenant envelope.
 * @param response - the completed fetch response.
 * @returns the envelope body; non-JSON gateway bodies classify by status alone.
 */
export async function readEnvelope(response: Response): Promise<MoldexEnvelope<unknown>> {
  const text = await response.text()
  let raw: unknown
  try { raw = JSON.parse(text) } catch (_nonJsonGatewayError) {
    // HTTP status is authoritative when a gateway does not return the envelope.
    throw new MoldexApiError('HTTP_STATUS', `Moldex tenant API returned status ${response.status}`, response.status)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MoldexApiError('PROTOCOL', 'Moldex tenant API returned a non-object envelope', response.status)
  }
  return raw as MoldexEnvelope<unknown>
}

/** Read a successful envelope body or throw the mapped failure.
 * @param response - the completed fetch response.
 * @returns the envelope's `data` payload.
 */
export async function unwrap<T>(response: Response): Promise<T> {
  const envelope = await readEnvelope(response)
  if (envelope.success && envelope.data !== undefined) return envelope.data as T
  const code = envelope.error?.code ?? (!envelope.success ? 'MOLDEX_ERROR' : 'PROTOCOL')
  const message = envelope.error?.message ?? envelope.message ?? `Moldex tenant API request failed (${response.status})`
  throw new MoldexApiError(code, message, response.status)
}
