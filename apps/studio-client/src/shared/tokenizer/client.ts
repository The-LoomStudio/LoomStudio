import { applyTokenMultiplier, TOKEN_INPUT_LIMIT, TOKEN_QUEUE_LIMIT, type TokenCount } from '@loom-studio/tokenizer/contracts'

let worker: Worker | undefined
let sequence = 0
const TOKEN_BATCH_ITEM_LIMIT = 128
type Task = {
  texts: string[]
  next: number
  counts: number[]
  cancelled: boolean
  resolve(counts: number[]): void
  reject(error: Error): void
  cleanup(): void
}
const pending = new Map<number, Task>()

function sendBatch(id: number, task: Task): void {
  const texts: string[] = []
  let characters = 0
  while (task.next < task.texts.length && texts.length < TOKEN_BATCH_ITEM_LIMIT) {
    const text = task.texts[task.next]!
    if (characters + text.length > TOKEN_INPUT_LIMIT) break
    texts.push(text)
    characters += text.length
    task.next++
  }
  try {
    worker!.postMessage({ id, texts })
  } catch (error) {
    pending.delete(id)
    task.cleanup()
    task.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

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
      if (!task.cancelled && event.data.error === undefined) {
        task.counts.push(...event.data.counts!)
        if (task.next < task.texts.length) {
          sendBatch(event.data.id, task)
          return
        }
      }
      pending.delete(event.data.id)
      task.cleanup()
      if (task.cancelled) return
      if (event.data.error !== undefined) task.reject(new Error(event.data.error))
      else task.resolve(task.counts)
    }
    worker.onerror = event => {
      for (const task of pending.values()) {
        task.cleanup()
        task.reject(new Error(event.message))
      }
      pending.clear()
      worker!.onmessage = null
      worker!.onerror = null
      worker?.terminate()
      worker = undefined
    }
  }
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const task: Task = {
      texts: [...texts], next: 0, counts: [], cancelled: false, resolve, reject,
      cleanup: () => signal?.removeEventListener('abort', abort),
    }
    const abort = () => {
      // Keep the slot until the Worker finishes; cancellation cannot interrupt BPE.
      task.cancelled = true
      task.texts = []
      task.counts = []
      task.cleanup()
      reject(new DOMException('Token counting cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    pending.set(id, task)
    sendBatch(id, task)
  })
}

export async function countText(input: { text: string; multiplier?: number }, signal?: AbortSignal): Promise<TokenCount> {
  applyTokenMultiplier(0, input.multiplier)
  const [baseTokens] = await countTexts([input.text], signal)
  return applyTokenMultiplier(baseTokens!, input.multiplier)
}
