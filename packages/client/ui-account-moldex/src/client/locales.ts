/** Moldex account copy, owned by the Moldex account feature. */

/** English Moldex account dictionary. */
export const en = {
  brandName: 'Moldex',
  loading: 'Loading…',
  signIn: 'Sign in with Moldex',
  signInDescription: 'Sign in to your Moldex account to use models through your workspace balance.',
  signInFailed: 'Sign-in did not complete. Check your account and password, then try again.',
  accountLabel: 'Account',
  accountPlaceholder: 'Email or phone number',
  passwordLabel: 'Password',
  submit: 'Sign in',
  submitting: 'Signing in…',
  committing: 'Finishing sign-in…',
  failureTitle: 'Could not sign in',
  retry: 'Try again',
  cancel: 'Cancel',
  close: 'Close',
  signedIn: 'Signed in to Moldex',
  signedInHint: 'Your Moldex account is connected. Inference uses your workspace API key.',
  streamFailed: 'Account state is unavailable. Try again.',
  topUp: 'Recharge',
} as const

/** The copy keys the Moldex sign-in slot renders. */
export type MoldexKey = keyof typeof en


/** Chinese Moldex account dictionary. */
export const zh: Record<MoldexKey, string> = {
  brandName: 'Moldex',
  loading: '加载中…',
  signIn: '使用 Moldex 账号登录',
  signInDescription: '登录 Moldex 账号，通过工作区余额使用模型。',
  signInFailed: '登录未完成，请检查账号与密码后重试。',
  accountLabel: '账号',
  accountPlaceholder: '邮箱或手机号',
  passwordLabel: '密码',
  submit: '登录',
  submitting: '登录中…',
  committing: '正在完成登录…',
  failureTitle: '登录失败',
  retry: '重试',
  cancel: '取消',
  close: '关闭',
  signedIn: '已登录 Moldex',
  signedInHint: 'Moldex 账号已连接，推理将使用工作区 API 密钥。',
  streamFailed: '账号状态不可用，请重试。',
  topUp: '充值',
}
