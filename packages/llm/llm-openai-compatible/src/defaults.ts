/** Fixed defaults for OpenAI-compatible connection settings. */

/** Default per-request output cap when a request omits one. */
export const DEFAULT_MAX_TOKENS = 8_192

/** Default context capacity when a model has no exact value. */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/** Default maximum provider idle time while one stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** How long one successful `/models` discovery answer stays cached. */
export const MODEL_DISCOVERY_TTL_MS = 300_000
