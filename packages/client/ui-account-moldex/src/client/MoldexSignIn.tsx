/** The Moldex sign-in form: phase-driven presentation over the account snapshot hook. */
import { useState, type FormEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Props derived by the slot renderer; components never see ctx. */
export interface MoldexSignInProps extends PropsRuntime<'settings.models.sign-in'> {
  /** Translate a Moldex account dictionary key. */
  t: (key: MoldexKey) => string
  /** Selector hook over the published account snapshot. */
  useAccount: <S>(selector: (value: MoldexAccountSnapshot) => S) => S
  /** Begin a sign-in attempt. */
  start: () => void
  /** Submit the form credentials once per attempt. */
  submit: (input: { account: string; password: string }) => void
}

/** Render the phase-driven Moldex sign-in presentation. */
export function MoldexSignIn(props: MoldexSignInProps) {
  const { t, useAccount } = props
  const { view, failed, submitting, error } = useAccount(value => value)
  const start = props.start
  const submit = props.submit
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const attemptPhase = view?.attempt?.phase
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!submitting) submit({ account, password })
  }
  if (failed) {
    return (
      <section className={css.frame} aria-label={t('failureTitle')}>
        <p className={css.title}>{t('failureTitle')}</p>
        <p>{t('streamFailed')}</p>
      </section>
    )
  }
  if (view === undefined) return <p>{t('loading')}</p>
  if (view.status === 'credential-stored' && !attemptPhase) {
    return (
      <section className={css.frame} aria-label={t('signedIn')}>
        <p>{t('signedIn')}</p>
        <a className={css.link} href={view.links.topUpUrl} target='_blank' rel='noreferrer'>{t('topUp')}</a>
      </section>
    )
  }
  if (attemptPhase === 'initializing' || attemptPhase === 'committing') {
    return (
      <form className={css.frame} aria-label={t('accountLabel')} onSubmit={onSubmit}>
        <label className={css.label} htmlFor='moldex-account'>{t('accountLabel')}</label>
        <input
          id='moldex-account'
          className={css.input}
          autoComplete='username'
          placeholder={t('accountPlaceholder')}
          value={account}
          onChange={(event) => { setAccount(event.target.value) }}
          required
        />
        <label className={css.label} htmlFor='moldex-password'>{t('passwordLabel')}</label>
        <input
          id='moldex-password'
          className={css.input}
          type='password'
          autoComplete='current-password'
          value={password}
          onChange={(event) => { setPassword(event.target.value) }}
          required
        />
        {error !== null && <p className={css.error} role='alert'>{error}</p>}
        <Button type='submit' disabled={submitting || attemptPhase === 'committing'}>
          {attemptPhase === 'committing' ? t('committing') : submitting ? t('submitting') : t('submit')}
        </Button>
      </form>
    )
  }
  if (attemptPhase === 'failed') {
    return (
      <section className={css.frame} aria-label={t('failureTitle')}>
        <p className={css.title}>{t('failureTitle')}</p>
        {error !== null && <p className={css.error} role='alert'>{error}</p>}
        <Button onClick={() => { start() }}>{t('retry')}</Button>
      </section>
    )
  }
  return (
    <section className={css.frame} aria-label={t('signIn')}>
      <p>{t('signInDescription')}</p>
      <Button onClick={() => { start() }}>{t('signIn')}</Button>
    </section>
  )
}
