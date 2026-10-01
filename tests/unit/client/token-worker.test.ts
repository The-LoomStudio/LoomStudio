import { afterEach, describe, expect, it, vi } from 'vitest'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage?: (event: { data: { id: number; counts: number[] } }) => void
  onerror?: (event: { message: string }) => void
  messages: Array<{ id: number; texts: string[] }> = []
  constructor() { TestWorker.instances.push(this) }
  postMessage(message: { id: number; texts: string[] }) { this.messages.push(message) }
  terminate = vi.fn()
  finish() {
    for (const message of this.messages.splice(0)) this.onmessage?.({ data: { id: message.id, counts: message.texts.map(() => 3) } })
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); TestWorker.instances = [] })

describe('shared token Worker client', () => {
  it('is lazy, shares one Worker and applies a multiplier after receiving base counts', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const { countText, countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    expect(TestWorker.instances).toHaveLength(0)
    expect(await countTexts([])).toEqual([])
    expect(TestWorker.instances).toHaveLength(0)
    const first = countText({ text: 'text', multiplier: 0.6 })
    const second = countText({ text: 'other' })
    expect(TestWorker.instances).toHaveLength(1)
    TestWorker.instances[0]!.finish()
    expect(await first).toMatchObject({ baseTokens: 3, estimatedTokens: 2 })
    expect(await second).toMatchObject({ baseTokens: 3, estimatedTokens: 3 })
  })
  it('keeps cancelled job slots occupied until the Worker actually completes', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const { countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    const abort = new AbortController()
    const tasks = Array.from({ length: 32 }, () => countTexts(['text'], abort.signal))
    const results = Promise.allSettled(tasks)
    abort.abort()
    await expect(countTexts(['overflow'])).rejects.toThrow('queue')
    expect((await results).every(result => result.status === 'rejected')).toBe(true)
    TestWorker.instances[0]!.finish()
    const next = countTexts(['next'])
    TestWorker.instances[0]!.finish()
    expect(await next).toEqual([3])
  })
})
