/** Account-session gate for OpenAI-compatible routes configured with requireAccountSession. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { BlockAssembler, createUserMessage, type FinishReason, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Plugin from '../src/index.ts'
import { config } from './helpers.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function signedOutView(): AccountView {
  return {
    status: 'signed-out',
    attempt: null,
    links: { usageUrl: 'https://example.test/usage', topUpUrl: 'https://example.test/top_up' },
  }
}

async function assemble(ctx: Context, options: GenerateOptions): Promise<{ finish: FinishReason }> {
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  return { finish: assembler.finish }
}

it('fails with ACCOUNT_SIGN_IN_REQUIRED while signed out even when an API key is stored', async () => {
  const home = await mkdtemp(`${tmpdir()}/dsh-openai-compat-account-gate-`)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false })
  await ctx.credentials.set(credentialRef('MOLDEX_API_KEY'), 'sk-test')
  ctx.provide('deepseekAccount', {
    getState: async () => signedOutView(),
  } as Pick<DeepSeekAccount, 'getState'> as DeepSeekAccount)
  await ctx.plugin(LlmRuntime)
  Plugin.apply(ctx, Plugin.Config({
    ...config({ provider: 'moldex', apiKeyEnv: 'MOLDEX_API_KEY', requireAccountSession: true }),
    baseURL: 'https://127.0.0.1:9/v1',
  }))
  const fetch = vi.spyOn(globalThis, 'fetch')
  const result = await assemble(ctx, {
    provider: 'moldex',
    model: 'glm-test',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
  })
  expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'ACCOUNT_SIGN_IN_REQUIRED' } })
  expect(fetch).not.toHaveBeenCalled()
  await rm(home, { recursive: true, force: true })
})
