import { parentPort, workerData } from 'node:worker_threads'
const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
if (extension === 'ts') {
  const { register } = await import('tsx/esm/api')
  register()
}
const { projectHistoryEntries, extractHistory, extractionResultUnits, defaultHistoryExtractionBudget, HistoryExtractionBudgetExceededError } = await import(new URL(`./history-text.${extension}`, import.meta.url).href) as typeof import('./history-text.js')
import type { HistoryTextJob } from './history-text-isolation.js'

try {
  const input = workerData as HistoryTextJob
  const snapshot = projectHistoryEntries(input.projection)
  const extractions: import('./history-text.js').TextExtractionResult[] = []
  let resultUnits = 0
  for (const extractor of input.extractors ?? []) {
    const extraction = extractHistory({ snapshot: snapshot as import('./history-text.js').HistoryProjectionSnapshot, extractor })
    resultUnits += extractionResultUnits(extraction as unknown as import('@loom-studio/shared').JsonValue)
    if (resultUnits > defaultHistoryExtractionBudget.maxResultUnits) {
      throw new HistoryExtractionBudgetExceededError('maxResultUnits', defaultHistoryExtractionBudget.maxResultUnits, resultUnits)
    }
    extractions.push(extraction)
  }
  parentPort!.postMessage({ result: { snapshot, extractions } })
} catch (error) {
  const details = error as Error & { code?: string; budget?: string; limit?: number; actual?: number }
  parentPort!.postMessage({ error: { message: error instanceof Error ? error.message : String(error),
    code: details.code, budget: details.budget, limit: details.limit, actual: details.actual } })
}
