import type { LogGap, LogRecord, MemoryLogSink } from '@loom-studio/logging'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { createLatestRequestGuard, mergePolledLogRecords, readLogPages, runLatestRequest } from './log-feed-model.js'

export type LogSource = 'server' | 'client'
const EMPTY_LOG_RECORDS: LogRecord[] = []

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
  const [errorSource, setErrorSource] = useState<LogSource>()
  const [committedSource, setCommittedSource] = useState<LogSource>()
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
        setErrorSource(undefined)
      },
      onSuccess: result => {
        cursorRef.current = result.cursor
        setRecords(result.items)
        setGap(result.gap)
        setTruncated(result.truncated)
        setCommittedSource(input.source)
      },
      onError: caught => {
        setError(toErrorMessage(caught))
        setErrorSource(input.source)
      },
      onFinish: () => setLoading(false),
    })
  }, [input.source, listLogs])

  useEffect(() => {
    if (!input.active) {
      refreshGuardRef.current.invalidate()
      setLoading(false)
      return
    }
    refreshGuardRef.current.invalidate()
    cursorRef.current = undefined
    setRecords([])
    setGap(undefined)
    setTruncated(false)
    setError(undefined)
    setErrorSource(undefined)
    setCommittedSource(undefined)
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
      const requestId = refreshGuardRef.current.current()
      const cursor = cursorRef.current
      try {
        const result = await readLogPages(listLogs, cursor)
        if (disposed || !refreshGuardRef.current.isCurrent(requestId) || cursorRef.current !== cursor) return
        cursorRef.current = result.cursor
        setGap(result.gap)
        setTruncated(result.truncated)
        if (result.items.length === 0) return
        setRecords(current => mergePolledLogRecords(current, result.items, result.gap))
        if (!input.followingLatestRef.current) input.onUnreadRecords(result.items)
      } catch (caught) {
        if (!disposed && refreshGuardRef.current.isCurrent(requestId)) {
          setError(toErrorMessage(caught))
          setErrorSource(input.source)
        }
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
  }, [input.active, input.followingLatestRef, input.onUnreadRecords, input.source, listLogs])

  const sourceReady = committedSource === input.source
  return {
    records: sourceReady ? records : EMPTY_LOG_RECORDS,
    gap: sourceReady ? gap : undefined,
    truncated: sourceReady ? truncated : false,
    loading: input.active && !sourceReady ? true : loading,
    error: errorSource === input.source ? error : undefined,
    refresh,
    sourceReady,
  }
}

function toErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}
