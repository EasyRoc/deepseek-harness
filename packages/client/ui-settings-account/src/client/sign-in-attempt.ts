/** Shared sign-in attempt classification for account UI surfaces. */
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'

/**
 * Whether the active attempt is the Moldex (or other) password form flow rather
 * than browser OAuth with an authorize URL.
 * @param view - latest account snapshot, if any.
 * @returns true when a dedicated form overlay should own the dialog chrome.
 */
export function isFormBasedSignInAttempt(view: AccountView | undefined): boolean {
  const attempt = view?.attempt ?? undefined
  const phase = attempt?.phase
  return attempt !== undefined && attempt.authorizeUrl === undefined
    && (phase === 'initializing' || phase === 'committing' || phase === 'failed')
}
