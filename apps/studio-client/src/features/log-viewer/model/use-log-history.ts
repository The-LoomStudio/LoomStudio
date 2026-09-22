import type { LogHistoryQuery, LogHistoryPage } from '@loom-studio/logging'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'

export function useLogHistory(api: StudioApi['logs'], active: boolean) {
  const [page, setPage] = useState<LogHistoryPage>()
  const [query, setQuery] = useState<LogHistoryQuery>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const cancel = useCallback(() => { controller.current?.abort(); controller.current = undefined; setLoading(false) }, [])
  useEffect(() => {
    if (!active) { cancel(); setPage(undefined); setQuery(undefined); setError(undefined) }
    return cancel
  }, [active, cancel])
  const read = useCallback(async (input: LogHistoryQuery, previous?: LogHistoryPage) => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setError(undefined)
    if (!previous) setPage(undefined)
    setQuery(input)
    try {
      const next = await api.history(input, request.signal)
      if (request.signal.aborted || controller.current !== request) return
      setPage(previous ? {
        ...next,
        items: [...previous.items, ...next.items],
        scannedBytes: previous.scannedBytes + next.scannedBytes,
        scannedRecords: previous.scannedRecords + next.scannedRecords,
        issues: [...previous.issues, ...next.issues],
      } : next)
    } catch (reason) {
      if (!request.signal.aborted && controller.current === request) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (controller.current === request) { setLoading(false); controller.current = undefined }
    }
  }, [api])
  const loadMore = () => {
    if (page?.hasMore && query && !loading && page.items.length < 5_000) void read({ ...query, cursor: page.cursor }, page)
  }
  return { page, query, error, loading, cancel, search: read, loadMore, capped: Boolean(page?.hasMore && page.items.length >= 5_000) }
}
