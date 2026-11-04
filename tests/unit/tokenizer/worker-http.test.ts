import { expect, it, vi } from 'vitest'
import { countText } from '@loom-studio/tokenizer'

it('counts tokens without SubtleCrypto on LAN HTTP', async () => {
  const worker = { onmessage: undefined as unknown as (event: unknown) => Promise<void>, postMessage: vi.fn() }
  vi.stubGlobal('self', worker)
  vi.stubGlobal('crypto', {})
  try {
    await import('../../../apps/studio-client/src/shared/tokenizer/tokenizer.worker.js')
    const texts = ['', '你好 world', '你好 world']
    await worker.onmessage({ data: { id: 7, texts } })
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 7, counts: texts.map(text => countText(text).baseTokens) })
  } finally { vi.unstubAllGlobals() }
})
