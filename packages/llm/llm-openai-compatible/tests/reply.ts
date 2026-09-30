/** One JSON HTTP response for fetch stubs. */
export function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
