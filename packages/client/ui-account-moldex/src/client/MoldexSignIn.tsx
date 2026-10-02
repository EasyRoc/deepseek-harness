/** The Moldex sign-in form: phase-driven presentation over the account snapshot hook. */
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, IconCloseOutlineRegular, IconLoadingOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { type MoldexKey } from './locales.ts'
import css from './MoldexSignIn.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.moldex': MoldexKey }
}

/** The registrant-private observable source the renderer binds as `useAccount`. */
export interface MoldexAccountSource {
  getSnapshot(): MoldexAccountSnapshot
  subscribe(listener: () => void): () => void
}

/** Reactive account facts the apply closure publishes; the renderer binds `useAccount`. */
export interface MoldexAccountSnapshot {
  /** Latest Host account state, absent until the stream responds. */
  view: AccountView | undefined
  /** Whether the state stream failed. */
  failed: boolean
  /** Whether a form submission is in flight. */
  submitting: boolean
  /** The failure message from the last submission, null when the last attempt settled. */
  error: string | null
}

/** Callbacks and published facts the apply closure injects beside the snapshot hook. */
export interface MoldexSignInInjected {
  /** Latest Host account state, absent until the stream responds. */
  view: AccountView | undefined
  /** Whether the state stream failed. */
  failed: boolean
  /** Whether a form submission is in flight. */
  submitting: boolean
  /** The failure message from the last submission, null when the last attempt settled. */
  error: string | null
  /** Begin a sign-in attempt; the Host creates the form-waiting attempt. */
  start: () => void
  /** Submit the form credentials once per attempt. */
  submit: (input: { account: string; password: string }) => void
}

/** Shared presentation props for the Models slot and the Desktop shell overlay. */
export interface MoldexSignInContentProps {
  /** Translate a Moldex account dictionary key. */
  t: (key: MoldexKey) => string
  /** Selector hook over the published account snapshot. */
  useAccount: <S>(selector: (value: MoldexAccountSnapshot) => S) => S
  /** Begin a sign-in attempt. */
  start: () => void
  /** Submit the form credentials once per attempt. */
  submit: (input: { account: string; password: string }) => void
  /** Dialog chrome for the shell overlay; embedded layout for Models settings. */
  layout?: 'dialog' | 'embedded'
  /** Close the shell overlay dialog. */
  onDismiss?: () => void
}

/** Props derived by the slot renderer; components never see ctx. */
export interface MoldexSignInProps extends PropsRuntime<'settings.models.sign-in'>, MoldexSignInContentProps {}

/**
 * Dialog header row matching the account SignInDialog chrome.
 * @param props - title, close label, and dismiss handler.
 * @returns header fragment for the Modal body.
 */
export function MoldexSignInDialogHeader({ title, closeLabel, onDismiss }: {
  title: string
  closeLabel: string
  onDismiss: () => void
}): JSX.Element {
  return (
    <div className={css.header}>
      <h2 className={css.title}>{title}</h2>
      <button type="button" className={css.close} aria-label={closeLabel} onClick={onDismiss}>
        <IconCloseOutlineRegular size={14} />
      </button>
    </div>
  )
}

/** Render the phase-driven Moldex sign-in presentation. */
export function MoldexSignInContent(props: MoldexSignInContentProps) {
  const { t, useAccount, start, submit, layout = 'embedded', onDismiss } = props
  const { view, failed, submitting, error } = useAccount(value => value)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const attemptPhase = view?.attempt?.phase
  const dialog = layout === 'dialog'
  const wrap = (title: string, body: ReactNode, actions?: ReactNode): JSX.Element => {
    if (!dialog) {
      return (
        <section className={css.embedded} aria-label={title}>
          <h3 className={css.embeddedTitle}>{title}</h3>
          {body}
          {actions}
        </section>
      )
    }
    return (
      <div className={css.content}>
        {onDismiss !== undefined && (
          <MoldexSignInDialogHeader title={title} closeLabel={t('close')} onDismiss={onDismiss} />
        )}
        <div className={css.body}>{body}</div>
        {actions !== undefined && <div className={css.actions}>{actions}</div>}
      </div>
    )
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!submitting) submit({ account, password })
  }
  if (failed) {
    return wrap(t('failureTitle'), (
      <>
        <p className={css.description}>{t('streamFailed')}</p>
        <Button variant="primary" className={css.primaryButton} onClick={() => { start() }}>{t('retry')}</Button>
      </>
    ))
  }
  if (view === undefined) return <p className={css.loading}>{t('loading')}</p>
  if (view.status === 'credential-stored' && !attemptPhase) {
    return wrap(t('signedIn'), (
      <>
        <p className={css.description}>{t('signedInHint')}</p>
        <a className={css.link} href={view.links.topUpUrl} target='_blank' rel='noreferrer'>{t('topUp')}</a>
      </>
    ))
  }
  if (attemptPhase === 'initializing' || attemptPhase === 'committing') {
    const busy = submitting || attemptPhase === 'committing'
    const primary = (
      <Button type="submit" variant="primary" className={css.primaryButton} disabled={busy} form="moldex-sign-in-form"
        aria-label={busy ? t('submitting') : t('submit')}>
        {busy ? <IconLoadingOutlineRegular className={css.spinner} size={16} /> : t('submit')}
      </Button>
    )
    const secondary = dialog && onDismiss !== undefined
      ? <Button type="button" variant="outline" className={css.secondaryButton} disabled={busy} onClick={onDismiss}>{t('cancel')}</Button>
      : undefined
    return wrap(t('signIn'), (
      <>
        <p className={css.description}>{t('signInDescription')}</p>
        <form id="moldex-sign-in-form" aria-label={t('accountLabel')} onSubmit={onSubmit}>
          <div className={css.field}>
            <label className={css.label} htmlFor='moldex-account'>{t('accountLabel')}</label>
            <input
              id='moldex-account'
              className={css.input}
              autoComplete='username'
              placeholder={t('accountPlaceholder')}
              value={account}
              disabled={busy}
              onChange={(event) => { setAccount(event.target.value) }}
              required
            />
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor='moldex-password'>{t('passwordLabel')}</label>
            <input
              id='moldex-password'
              className={css.input}
              type='password'
              autoComplete='current-password'
              value={password}
              disabled={busy}
              onChange={(event) => { setPassword(event.target.value) }}
              required
            />
          </div>
          {error !== null && <p className={css.error} role='alert'>{error}</p>}
        </form>
      </>
    ), dialog ? (
      <>
        {secondary}
        {primary}
      </>
    ) : primary)
  }
  if (attemptPhase === 'failed') {
    return wrap(t('failureTitle'), (
      <>
        <p className={css.description}>{error ?? t('signInFailed')}</p>
        <Button variant="primary" className={css.primaryButton} onClick={() => { start() }}>{t('retry')}</Button>
      </>
    ))
  }
  return wrap(t('signIn'), (
    <>
      <p className={css.description}>{t('signInDescription')}</p>
      <Button variant="primary" className={css.primaryButton} onClick={() => { start() }}>{t('signIn')}</Button>
    </>
  ))
}

/** Models settings slot entry that reuses {@link MoldexSignInContent}. */
export function MoldexSignIn(props: MoldexSignInProps) {
  const { t, useAccount, start, submit } = props
  return <MoldexSignInContent t={t} useAccount={useAccount} start={start} submit={submit} layout="embedded" />
}
