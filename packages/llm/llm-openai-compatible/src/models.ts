/** `/models` discovery for gateways that expose the OpenAI listing. */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { providerError } from './transport.ts'
import type { OpenAICompatCatalogModel } from './types.ts'

/** Fetch one gateway's model listing.
 * @param baseURL - validated chat-completions root.
 * @param headers - request authentication headers from the latest resolution.
 * @param signal - cancellation for this lookup.
 * @returns one catalog entry per listed model id, in wire order.
 */
export async function fetchGatewayModels(
  baseURL: string, headers: Record<string, string>, signal: AbortSignal,
): Promise<OpenAICompatCatalogModel[]> {
  const response = await fetch(`${baseURL}/models`, { headers: { ...headers }, signal, redirect: 'error' })
  if (!response.ok) {
    const text = await response.text()
    let raw: unknown
    try { raw = JSON.parse(text) } catch (_nonJsonGatewayError) {
      // HTTP status is authoritative when a gateway does not return JSON.
    }
    throw providerError(raw, response.status, response.headers)
  }
  const raw: unknown = await response.json()
  const listing = typeof raw === 'object' && raw !== null && 'data' in raw ? raw.data : undefined
  if (!Array.isArray(listing)) throw new LlmError('OpenAI-compatible model listing has no data array', 'MALFORMED_RESPONSE')
  const models: OpenAICompatCatalogModel[] = []
  for (const entry of listing) {
    if (typeof entry !== 'object' || entry === null) continue
    const id = (entry as { id?: unknown }).id
    if (typeof id === 'string') models.push({ id })
  }
  return models
}
