/** Desktop shell overlay for form-based Moldex sign-in started from the account menu. */
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MoldexSignInContent, type MoldexAccountSnapshot, type MoldexAccountSource, type MoldexSignInInjected,
} from './MoldexSignIn.tsx'
import type {} from './slot-contract.ts'
import css from './MoldexSignIn.module.css'

/** Overlay registration dependencies. */
export type MoldexSignInOverlayInjected = MoldexSignInInjected & {
  hooks: { account: MoldexAccountSource }
  cancel: (id: SignInAttemptId) => Promise<void>
}

function formBasedSignInActive(snapshot: MoldexAccountSnapshot): boolean {
  const attempt = snapshot.view?.attempt ?? undefined
  const phase = attempt?.phase
  return attempt !== undefined && attempt.authorizeUrl === undefined
    && (phase === 'initializing' || phase === 'committing' || phase === 'failed')
}

/** Render the Moldex form while a form-based sign-in attempt is active. */
export function MoldexSignInOverlay(
  props: PropsRuntime<'shell.overlay'> & PropsLocale<'settings.moldex'> & InjectFace<MoldexSignInOverlayInjected>,
): null | JSX.Element {
  const { t, useAccount, start, submit, cancel } = props
  const snapshot = useAccount(current => current)
  if (!formBasedSignInActive(snapshot)) return null
  const attempt = snapshot.view?.attempt ?? undefined
  if (attempt === undefined) return null
  const attemptId = attempt.id
  const dismiss = (): void => { void cancel(attemptId) }
  const committing = attempt.phase === 'committing'
  const dismissProps = committing ? {} : { onDismiss: dismiss }
  return (
    <Modal open headless title={t('signIn')} onClose={committing ? () => undefined : dismiss}
      className={css.dialog as string}>
      <MoldexSignInContent
        t={t}
        useAccount={useAccount}
        start={start}
        submit={submit}
        layout="dialog"
        {...dismissProps}
      />
    </Modal>
  )
}
