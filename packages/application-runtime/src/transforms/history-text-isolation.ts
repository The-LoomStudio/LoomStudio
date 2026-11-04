import { Worker } from 'node:worker_threads'
import { projectHistoryEntries, type HistoryProjectionSnapshot, type TextExtractorEntry, type TextExtractionResult } from './history-text.js'

type ProjectionInput = Parameters<typeof projectHistoryEntries>[0]
export type HistoryTextJob<Source extends ProjectionInput['source'] = ProjectionInput['source']> = { projection: Omit<ProjectionInput, 'source' | 'entries'> & { source: Source; entries: Array<import('./history-text.js').HistoryTextEntry<Source>> }; extractors?: TextExtractorEntry[] }
export type HistoryTextJobResult<Source extends ProjectionInput['source'] = ProjectionInput['source']> = { snapshot: HistoryProjectionSnapshot<Source>; extractions: TextExtractionResult[] }
export const historyTextExecutionLimits = { concurrency: 2, maxQueued: 16, timeoutMs: 5_000 } as const
let running = 0
const queue: Array<() => void> = []

function executionError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/** One deadline covers queueing, startup, projection and every extraction. Slots are released only after termination. */
export async function runHistoryTextIsolated<Source extends ProjectionInput['source']>(input: HistoryTextJob<Source>): Promise<HistoryTextJobResult<Source>> {
  // With no rules or extractors, the pure core cannot execute user supplied RegExp.
  if (input.projection.rules.length === 0 && !input.extractors?.length) {
    return { snapshot: projectHistoryEntries(input.projection), extractions: [] }
  }
  if (running >= historyTextExecutionLimits.concurrency && queue.length >= historyTextExecutionLimits.maxQueued) {
    throw executionError('text.execution_busy', 'Text processing is busy; retry after current work completes.')
  }
  const deadline = Date.now() + historyTextExecutionLimits.timeoutMs
  await new Promise<void>((resolve, reject) => {
    const start = () => { clearTimeout(timer); running++; resolve() }
    const timer = setTimeout(() => {
      const index = queue.indexOf(start)
      if (index >= 0) queue.splice(index, 1)
      reject(executionError('text.execution_timeout', 'Text processing exceeded its execution deadline while queued.'))
    }, historyTextExecutionLimits.timeoutMs)
    if (running < historyTextExecutionLimits.concurrency) start()
    else queue.push(start)
  })
  let worker: Worker | undefined
  try {
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
    worker = new Worker(new URL(`./history-text-worker.${extension}`, import.meta.url), {
      workerData: input,
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    })
    const activeWorker = worker
    return await new Promise<HistoryTextJobResult<Source>>((resolve, reject) => {
      const timer = setTimeout(() => reject(executionError('text.execution_timeout',
        'Text processing exceeded its execution deadline; the isolated worker was terminated.')), Math.max(0, deadline - Date.now()))
      const finish = (action: () => void) => { clearTimeout(timer); action() }
      activeWorker.once('message', (reply: { result?: HistoryTextJobResult<Source>; error?: { message: string; code?: string; budget?: string; limit?: number; actual?: number } }) => {
        finish(() => reply.error ? reject(Object.assign(new Error(reply.error.message), reply.error)) : resolve(reply.result!))
      })
      activeWorker.once('error', error => finish(() => reject(executionError('text.execution_failed', `Isolated text processing failed: ${error.message}`))))
      activeWorker.once('exit', code => finish(() => reject(executionError('text.execution_failed', `Isolated text processing exited without a result (${code}).`))))
    })
  } finally {
    try { await worker?.terminate() }
    finally { running--; queue.shift()?.() }
  }
}

export async function projectHistoryEntriesIsolated<Source extends ProjectionInput['source']>(
  input: Omit<ProjectionInput, 'source' | 'entries'> & { source: Source; entries: Array<import('./history-text.js').HistoryTextEntry<Source>> },
): Promise<HistoryProjectionSnapshot<Source>> {
  const { snapshot } = await runHistoryTextIsolated({ projection: input })
  return snapshot as HistoryProjectionSnapshot<Source>
}
