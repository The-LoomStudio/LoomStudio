import type { LogGap, LogPage, LogRecord } from '@loom-studio/logging'
import type { StudioApi } from '../../../shared/api/studio-api.js'

export async function readLogPages(list: StudioApi['logs']['list'], initialCursor?: string): Promise<{
  items: LogRecord[]
  cursor: string
  gap?: LogGap
  truncated: boolean
}> {
  const items: LogRecord[] = []
  let cursor = initialCursor
  let gap: LogGap | undefined

  // ponytail: 防止持续高速写入时刷新永不结束；日志缓冲区当前最多 5000 条，20 页留有一倍余量。
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page: LogPage = await list({ cursor, limit: 500 })
    items.push(...page.items)
    gap ??= page.gap
    if (!page.hasMore) return { items, cursor: page.cursor, gap, truncated: false }
    if (page.cursor === cursor) throw new Error('Log pagination cursor did not advance')
    cursor = page.cursor
  }

  return { items: items.slice(-5_000), cursor: cursor!, gap, truncated: true }
}

export function mergePolledLogRecords(current: LogRecord[], incoming: LogRecord[], gap?: LogGap): LogRecord[] {
  if (gap?.reason === 'reset') return incoming
  return [...current, ...incoming].slice(-5_000)
}

export type LatestRequestGuard = {
  begin: () => number
  isCurrent: (requestId: number) => boolean
  invalidate: () => void
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let currentRequestId = 0
  return {
    begin: () => ++currentRequestId,
    isCurrent: requestId => requestId === currentRequestId,
    invalidate: () => { currentRequestId += 1 },
  }
}

export async function runLatestRequest<T>(input: {
  guard: LatestRequestGuard
  request: () => Promise<T>
  onStart: () => void
  onSuccess: (result: T) => void
  onError: (error: unknown) => void
  onFinish: () => void
}): Promise<void> {
  const requestId = input.guard.begin()
  input.onStart()
  try {
    const result = await input.request()
    if (input.guard.isCurrent(requestId)) input.onSuccess(result)
  } catch (caught) {
    if (input.guard.isCurrent(requestId)) input.onError(caught)
  } finally {
    if (input.guard.isCurrent(requestId)) input.onFinish()
  }
}
