// @vitest-environment jsdom
/** Phase-driven presentation of the Moldex sign-in form over injected props. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { MoldexSignIn, type MoldexAccountSnapshot, type MoldexSignInProps } from '../src/client/MoldexSignIn.tsx'
import { en, type MoldexKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const links = { usageUrl: 'https://www.moldex.top/dashboard', topUpUrl: 'https://www.moldex.top/billing/recharge' }
const t = (key: MoldexKey) => en[key]
const signedOut: AccountView = {
  status: 'signed-out', attempt: null, links,
}
const stored: AccountView = { ...signedOut, status: 'credential-stored' }

type MoldexCallbacks = Partial<{ start: () => void; submit: (input: { account: string; password: string }) => void }>

function propsOf(snapshot: Partial<MoldexAccountSnapshot>, callbacks: MoldexCallbacks = {}): MoldexSignInProps {
  const full: MoldexAccountSnapshot = { view: undefined, failed: false, submitting: false, error: null, ...snapshot }
  return {
    ...({} as GlobalStandardProps),
    t,
    useAccount: (selector: (value: MoldexAccountSnapshot) => unknown) => selector(full),
    start: callbacks.start ?? vi.fn(),
    submit: callbacks.submit ?? vi.fn(),
  } as MoldexSignInProps
}
it('renders the sign-in entry while signed out and starts on click', async () => {
  const start = vi.fn()
  render(<MoldexSignIn {...propsOf({ view: { ...signedOut } }, { start })} />)
  fireEvent.click(screen.getByRole('button', { name: en.signIn }))
  expect(start).toHaveBeenCalledTimes(1)
})

it('renders the credential form during the initializing attempt and submits once', () => {
  const submit = vi.fn()
  const attempt = { id: 'a' as never, phase: 'initializing' as const }
  const view = { ...signedOut, attempt }
  render(<MoldexSignIn {...propsOf({ view }, { submit })} />)
  fireEvent.change(screen.getByPlaceholderText(en.accountPlaceholder), { target: { value: 'roceasy@qq.com' } })
  fireEvent.change(screen.getByLabelText(en.passwordLabel), { target: { value: 'pw' } })
  fireEvent.submit(screen.getByRole('form'))
  expect(submit).toHaveBeenCalledWith({ account: 'roceasy@qq.com', password: 'pw' })
})

it('shows the submission error inside the form and disables while submitting', () => {
  const attempt = { id: 'a' as never, phase: 'initializing' as const }
  render(<MoldexSignIn {...propsOf({ view: { ...signedOut, attempt }, submitting: true, error: 'wrong password' })} />)
  expect(screen.getByRole('alert').textContent).toBe('wrong password')
  expect(screen.getByRole('button', { name: en.submitting }).hasAttribute('disabled')).toBe(true)
})

it('renders the committing phase with a disabled submit control', () => {
  const attempt = { id: 'a' as never, phase: 'committing' as const }
  render(<MoldexSignIn {...propsOf({ view: { ...signedOut, attempt } })} />)
  expect(screen.getByRole('button', { name: en.submitting }).hasAttribute('disabled')).toBe(true)
})

it('offers a retry after a failed attempt with the server message', () => {
  const start = vi.fn()
  const attempt = { id: 'a' as never, phase: 'failed' as const }
  render(<MoldexSignIn {...propsOf({ view: { ...signedOut, attempt }, error: 'wrong password' }, { start })} />)
  expect(screen.getByText('wrong password')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  expect(start).toHaveBeenCalledTimes(1)
})

it('renders the signed-in state with the recharge link when stored', () => {
  render(<MoldexSignIn {...propsOf({ view: stored })} />)
  expect(screen.getByRole('heading', { name: en.signedIn })).toBeDefined()
  const link = screen.getByRole('link', { name: en.topUp })
  expect(link.getAttribute('href')).toBe(links.topUpUrl)
})

it('renders the stream-failure presentation', () => {
  render(<MoldexSignIn {...propsOf({ failed: true })} />)
  expect(screen.getByText(en.streamFailed)).toBeDefined()
})

it('renders loading while the first frame is pending', () => {
  render(<MoldexSignIn {...propsOf({})} />)
  expect(screen.getByText(en.loading)).toBeDefined()
})
