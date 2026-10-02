/** Loader apply plugin mounts the account provider and Remote gateway together. */
import { afterEach, describe, expect, it } from 'vitest'
import { MoldexAccount, MoldexAccountGateway } from '../src/index.ts'
import { fixture } from './helpers.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

describe('moldex-account apply', () => {
  it('mounts MoldexAccount and MoldexAccountGateway through the default export', async () => {
    const instance = await fixture(undefined, undefined, 'apply')
    cleanups.push(instance.dispose)
    expect(instance.ctx.deepseekAccount).toBeInstanceOf(MoldexAccount)
    expect(instance.ctx.moldexAccountGateway).toBeInstanceOf(MoldexAccountGateway)
  })
})
