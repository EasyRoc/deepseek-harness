/** Dedicated Remote namespace for the Moldex sign-in form and key management. */
import type { Context } from '@deepseek-ai/cordis'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { MoldexAccount } from './service.ts'
import type { MoldexApiKeyList, MoldexApiKeySelection, MoldexSignInInput } from './types.ts'

/**
 * Form submissions cross this namespace exactly once per attempt; the account
 * namespace stays free of credentials, and no password or key value is ever
 * returned to the Client after submission.
 */
export class MoldexAccountGateway extends TypertRemoteService {
  static inject = ['deepseekAccount']

  /** @param ctx - Host carrying the moldex account implementation. */
  constructor(ctx: Context) { super(ctx, 'moldexAccountGateway', { namespace: 'moldexAccount' }) }

  private get account(): MoldexAccount {
    const account = this.ctx.deepseekAccount
    // A moldex profile composition mounts exactly one account implementation.
    if (!(account instanceof MoldexAccount)) {
      throw new Error('moldex-account: the mounted deepseekAccount service is not the Moldex provider')
    }
    return account
  }

  /** Submit the sign-in form for the active attempt.
   * @param input - account identifier and password; consumed once, never stored.
   * @returns the state after the attempt commits or fails.
   */
  submitCredentials(input: MoldexSignInInput): Promise<AccountView> {
    return this.account.submitCredentials(input)
  }

  /** Create one tenant API key and store its plaintext under the configured reference.
   * @param name - human-readable key label; defaults to `DSH Desktop`.
   * @returns the created key facts for display.
   */
  createAndStoreApiKey(name?: string): Promise<MoldexApiKeySelection> {
    return this.account.createAndStoreApiKey(name)
  }

  /** List the account's tenant API keys for display.
   * @returns key entries in server order.
   */
  listApiKeys(): Promise<MoldexApiKeyList> {
    return this.account.listApiKeys()
  }
}
