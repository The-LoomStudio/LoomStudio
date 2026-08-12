import type { LogGap, LogRecord, MemoryLogSink } from '@loom-studio/logging'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { createLatestRequestGuard, mergePolledLogRecords, readLogPages, runLatestRequest } from './log-feed-model.js'

export type LogSource = 'server' | 'client'

type UseLogFeedInput = {
  active: boolean
  source: LogSource
  api: StudioApi['logs']
  clientLogs: MemoryLogSink
  followingLatestRef: RefObject<boolean>
  onUnreadRecords: (records: LogRecord[]) => void
}

export function useLogFeed(input: UseLogFeedInput) {
  const [records, setRecords] = useState<LogRecord[]>([])
  const [gap, setGap] = useState<LogGap>()
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const cursorRef = useRef<string | undefined>(undefined)
  const refreshGuardRef = useRef(createLatestRequestGuard())

  const listLogs = useCallback<StudioApi['logs']['list']>(request => {
    if (input.source === 'server') return input.api.list(request)
    return Promise.resolve(input.clientLogs.query({
      cursor: request?.cursor,
      limit: request?.limit ?? 500,
      levels: request?.levels,
      namespacePrefix: request?.namespacePrefix,
      service: request?.service,
      instanceId: request?.instanceId,
      since: request?.since,
      until: request?.until,
    }))
  }, [input.api, input.clientLogs, input.source])

  const refresh = useCallback(async () => {
    await runLatestRequest({
      guard: refreshGuardRef.current,
      request: () => readLogPages(listLogs),
      onStart: () => {
        setLoading(true)
        setError(undefined)
      },
      onSuccess: result => {
        cursorRef.current = result.cursor
        setRecords(result.items)
        setGap(result.gap)
        setTruncated(result.truncated)
      },
      onError: caught => setError(toErrorMessage(caught)),
      onFinish: () => setLoading(false),
    })
  }, [listLogs])

  useEffect(() => {
    if (!input.active) {
      refreshGuardRef.current.invalidate()
      setLoading(false)
      return
    }
    cursorRef.current = undefined
    void refresh()
    return () => refreshGuardRef.current.invalidate()
  }, [input.active, refresh])

  useEffect(() => {
    if (!input.active) return
    let disposed = false
    let polling = false

    const poll = async () => {
      if (disposed || polling || document.visibilityState === 'hidden' || !cursorRef.current) return
      polling = true
      try {
        const result = await readLogPages(listLogs, cursorRef.current)
        if (disposed) return
        cursorRef.current = result.cursor
        setGap(result.gap)
        setTruncated(result.truncated)
        if (result.items.length === 0) return
        setRecords(current => mergePolledLogRecords(current, result.items, result.gap))
        if (!input.followingLatestRef.current) input.onUnreadRecords(result.items)
      } catch (caught) {
        if (!disposed) setError(toErrorMessage(caught))
      } finally {
        polling = false
      }
    }

    const interval = window.setInterval(() => void poll(), 2_000)
    const handleVisibilityChange = () => void poll()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      disposed = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [input.active, input.followingLatestRef, input.onUnreadRecords, listLogs])

  return { records, gap, truncated, loading, error, refresh }
}

function toErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}
