import { applyTokenMultiplier, TOKEN_INPUT_LIMIT, TOKEN_QUEUE_LIMIT, type TokenCount } from '@loom-studio/tokenizer/contracts'

let worker: Worker | undefined
let sequence = 0
const pending = new Map<number, { resolve(counts: number[]): void; reject(error: Error): void; cleanup(): void }>()

export function countTexts(texts: string[], signal?: AbortSignal): Promise<number[]> {
  if (signal?.aborted) return Promise.reject(new DOMException('Token counting cancelled', 'AbortError'))
  if (texts.some(text => typeof text !== 'string' || text.length > TOKEN_INPUT_LIMIT)) {
    return Promise.reject(new RangeError(`Token input limit is ${TOKEN_INPUT_LIMIT} characters per text`))
  }
  if (pending.size >= TOKEN_QUEUE_LIMIT) return Promise.reject(new RangeError('Token counting queue is full'))
  if (texts.length === 0) return Promise.resolve([])
  if (!worker) {
    worker = new Worker(new URL('./tokenizer.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ id: number; counts?: number[]; error?: string }>) => {
      const task = pending.get(event.data.id)
      if (!task) return
      pending.delete(event.data.id)
      task.cleanup()
      if (event.data.error !== undefined) task.reject(new Error(event.data.error))
      else task.resolve(event.data.counts!)
    }
    worker.onerror = event => {
      for (const task of pending.values()) {
        task.cleanup()
        task.reject(new Error(event.message))
      }
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const abort = () => {
      // Keep the slot until the Worker finishes; cancellation cannot interrupt BPE.
      reject(new DOMException('Token counting cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    pending.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) })
    worker!.postMessage({ id, texts })
  })
}

export async function countText(input: { text: string; multiplier?: number }, signal?: AbortSignal): Promise<TokenCount> {
  applyTokenMultiplier(0, input.multiplier)
  const [baseTokens] = await countTexts([input.text], signal)
  return applyTokenMultiplier(baseTokens!, input.multiplier)
}
