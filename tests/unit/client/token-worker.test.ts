import { afterEach, describe, expect, it, vi } from 'vitest'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage?: (event: { data: { id: number; counts?: number[]; error?: string } }) => void
  onerror?: (event: { message: string }) => void
  messages: Array<{ id: number; texts: string[] }> = []
  posts: Array<{ id: number; items: number; characters: number }> = []
  constructor() { TestWorker.instances.push(this) }
  postMessage(message: { id: number; texts: string[] }) {
    const clone = structuredClone(message)
    this.messages.push(clone)
    this.posts.push({ id: clone.id, items: clone.texts.length, characters: clone.texts.reduce((sum, text) => sum + text.length, 0) })
  }
  terminate = vi.fn()
  finishOne(count: (text: string) => number = () => 3) {
    const message = this.messages.shift()!
    this.onmessage?.({ data: { id: message.id, counts: message.texts.map(count) } })
  }
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
  it('clones 64 * 32768 characters as three bounded sequential batches, preserving every result in order', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const { countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    const texts = Array.from({ length: 64 }, (_, index) => `${String(index).padStart(2, '0')}${'x'.repeat(32766)}`)
    const result = countTexts(texts)
    let settled = false
    void result.then(() => { settled = true })
    const worker = TestWorker.instances[0]!
    for (let batch = 0; batch < 3; batch++) {
      expect(worker.messages).toHaveLength(1)
      worker.finishOne(text => Number(text.slice(0, 2)))
      await Promise.resolve()
      expect(settled).toBe(batch === 2)
    }
    expect(await result).toEqual(Array.from({ length: 64 }, (_, index) => index))
    expect(worker.posts.map(post => post.items)).toEqual([30, 30, 4])
    expect(worker.posts.map(post => post.characters)).toEqual([983040, 983040, 131072])
    expect(worker.posts.reduce((sum, post) => sum + post.characters, 0)).toBe(2097152)
    expect(worker.messages).toEqual([])
    expect(TestWorker.instances).toHaveLength(1)
  })
  it('bounds item counts even for empty strings and retains a logical slot across all batches', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const { countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    const tasks = Array.from({ length: 32 }, () => countTexts(Array.from({ length: 300 }, () => '')))
    const worker = TestWorker.instances[0]!
    expect(worker.posts).toHaveLength(32)
    for (let batch = 0; batch < 3; batch++) {
      await expect(countTexts(['overflow'])).rejects.toThrow('queue')
      expect(worker.messages).toHaveLength(32)
      worker.finish()
    }
    expect(await Promise.all(tasks)).toEqual(Array.from({ length: 32 }, () => Array.from({ length: 300 }, () => 3)))
    expect(worker.posts.map(post => post.items)).toEqual([
      ...Array.from({ length: 32 }, () => 128),
      ...Array.from({ length: 32 }, () => 128),
      ...Array.from({ length: 32 }, () => 44),
    ])
    expect(worker.posts.every(post => post.characters === 0)).toBe(true)
    const next = countTexts(['next'])
    worker.finish()
    expect(await next).toEqual([3])
  })
  it('does not split, truncate or drop texts at the character boundary and snapshots unsent inputs', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const { TOKEN_INPUT_LIMIT } = await import('../../../packages/tokenizer/src/contracts.js')
    const { countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    await expect(countTexts(['x'.repeat(TOKEN_INPUT_LIMIT + 1)])).rejects.toThrow('per text')
    expect(TestWorker.instances).toHaveLength(0)
    const texts = ['a'.repeat(TOKEN_INPUT_LIMIT), '', 'b', 'c'.repeat(TOKEN_INPUT_LIMIT - 1), 'd']
    const result = countTexts(texts)
    texts[2] = 'mutated after submission'
    texts.push('injected')
    const worker = TestWorker.instances[0]!
    expect(worker.messages[0]!.texts.map(text => text.length)).toEqual([TOKEN_INPUT_LIMIT, 0])
    worker.finishOne(text => text.length)
    expect(worker.messages[0]!.texts.map(text => text.length)).toEqual([1, TOKEN_INPUT_LIMIT - 1])
    worker.finishOne(text => text.length)
    expect(worker.messages[0]!.texts).toEqual(['d'])
    worker.finishOne(text => text.length)
    expect(await result).toEqual([TOKEN_INPUT_LIMIT, 0, 1, TOKEN_INPUT_LIMIT - 1, 1])
    expect(worker.posts.every(post => post.characters <= TOKEN_INPUT_LIMIT && post.items <= 128)).toBe(true)
  })
  it('rejects cancellation immediately but sends no remaining batches and releases only the completed owner', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const { countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    const abort = new AbortController()
    const cancelled = countTexts(Array.from({ length: 300 }, () => 'text'), abort.signal)
    const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const others = Array.from({ length: 31 }, () => countTexts(['other']))
    const worker = TestWorker.instances[0]!
    abort.abort()
    await cancellation
    await expect(countTexts(['overflow'])).rejects.toThrow('queue')
    expect(worker.posts).toHaveLength(32)
    worker.finishOne()
    await Promise.resolve()
    expect(worker.posts).toHaveLength(32)
    const next = countTexts(['next'])
    await expect(countTexts(['still full'])).rejects.toThrow('queue')
    worker.finish()
    expect(await Promise.all(others)).toHaveLength(31)
    expect(await next).toEqual([3])
    expect(worker.posts).toHaveLength(33)
  })
  it('stops remaining batches after a batch error and frees the owner slot', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const { countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    const failed = countTexts(Array.from({ length: 300 }, () => 'text'))
    const failure = expect(failed).rejects.toThrow('batch failed')
    const worker = TestWorker.instances[0]!
    const message = worker.messages.shift()!
    worker.onmessage?.({ data: { id: message.id, error: 'batch failed' } })
    await failure
    expect(worker.posts).toHaveLength(1)
    expect(worker.messages).toHaveLength(0)
    const next = countTexts(['next'])
    worker.finish()
    expect(await next).toEqual([3])
  })
  it('releases all owners on Worker error, stops old continuations and recreates one shared Worker', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const { countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    const abort = new AbortController()
    const tasks = [
      countTexts(Array.from({ length: 300 }, () => 'text'), abort.signal),
      ...Array.from({ length: 31 }, () => countTexts(Array.from({ length: 300 }, () => 'other'))),
    ]
    const results = Promise.allSettled(tasks)
    const old = TestWorker.instances[0]!
    abort.abort()
    old.onerror?.({ message: 'Worker crashed' })
    expect((await results).map(result => result.status)).toEqual(Array.from({ length: 32 }, () => 'rejected'))
    expect(old.terminate).toHaveBeenCalledOnce()
    const next = countTexts(['next'])
    const second = countTexts(['second'])
    expect(TestWorker.instances).toHaveLength(2)
    old.finish()
    await Promise.resolve()
    expect(old.posts).toHaveLength(32)
    TestWorker.instances[1]!.finish()
    expect(await next).toEqual([3])
    expect(await second).toEqual([3])
  })
  it('frees the owner if postMessage fails synchronously without retrying a partial submission', async () => {
    class FailedWorker extends TestWorker {
      override postMessage() { throw new Error('clone failed') }
    }
    vi.stubGlobal('Worker', FailedWorker)
    const { countTexts } = await import('../../../apps/studio-client/src/shared/tokenizer/client.js')
    for (let task = 0; task < 33; task++) {
      await expect(countTexts(['text'])).rejects.toThrow('clone failed')
    }
    expect(TestWorker.instances).toHaveLength(1)
  })
})
