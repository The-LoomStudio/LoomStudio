import type { LogGap, LogRecord, MemoryLogSink } from '@loom-studio/logging'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { createLatestRequestGuard, mergePolledLogRecords, readLogPages, runLatestRequest } from './log-feed-model.js'

export type LogSource = 'server' | 'client' | 'all'
const EMPTY_LOG_RECORDS: LogRecord[] = []

type UseLogFeedInput = {
  active: boolean
  source: LogSource
  api: StudioApi['logs']
  clientLogs: MemoryLogSink
  followingLatestRef: RefObject<boolean>
  onUnreadRecords: (records: LogRecord[]) => void
  packageId?: string
}

export function useLogFeed(input: UseLogFeedInput) {
  const server = useSingleLogFeed({ ...input, source: 'server', active: input.active && input.source !== 'client' })
  const client = useSingleLogFeed({ ...input, source: 'client', active: input.active && input.source !== 'server' })
  const merged = useMemo(() => [...server.records, ...client.records].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), [server.records, client.records])
  const refresh = useCallback(async () => { await Promise.all([server.refresh(), client.refresh()]) }, [server.refresh, client.refresh])
  if (input.source !== 'all') return input.source === 'server' ? server : client
  return {
    records: merged,
    gap: server.gap ?? client.gap,
    truncated: server.truncated || client.truncated,
    loading: server.loading || client.loading,
    error: [server.error && `Server: ${server.error}`, client.error && `Client: ${client.error}`].filter(Boolean).join('; ') || undefined,
    sourceIssues: [...server.sourceIssues, ...client.sourceIssues],
    refresh,
    sourceReady: (server.sourceReady || Boolean(server.error)) && (client.sourceReady || Boolean(client.error)),
  }
}

function useSingleLogFeed(input: UseLogFeedInput & { source: 'server' | 'client' }) {
  const feedKey = `${input.source}:${input.packageId ?? ''}`
  const [records, setRecords] = useState<LogRecord[]>([])
  const [gap, setGap] = useState<LogGap>()
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [errorSource, setErrorSource] = useState<string>()
  const [committedSource, setCommittedSource] = useState<string>()
  const cursorRef = useRef<string | undefined>(undefined)
  const refreshGuardRef = useRef(createLatestRequestGuard())

  const listLogs = useCallback<StudioApi['logs']['list']>(request => {
    if (input.source === 'server') return input.api.list({ ...request, packageId: input.packageId })
    return Promise.resolve(input.clientLogs.query({
      cursor: request?.cursor,
      limit: request?.limit ?? 500,
      levels: request?.levels,
      namespacePrefix: request?.namespacePrefix,
      service: request?.service,
      instanceId: request?.instanceId,
      since: request?.since,
      until: request?.until,
      packageId: input.packageId,
    }))
  }, [input.api, input.clientLogs, input.source, input.packageId])

  const refresh = useCallback(async () => {
    if (!input.active) return
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
        setCommittedSource(feedKey)
      },
      onError: caught => {
        setError(toErrorMessage(caught))
        setErrorSource(feedKey)
      },
      onFinish: () => setLoading(false),
    })
  }, [input.active, feedKey, listLogs])

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
        setError(undefined)
        setErrorSource(undefined)
        cursorRef.current = result.cursor
        setGap(result.gap)
        setTruncated(result.truncated)
        if (result.items.length === 0) return
        setRecords(current => mergePolledLogRecords(current, result.items, result.gap))
        if (!input.followingLatestRef.current) input.onUnreadRecords(result.items)
      } catch (caught) {
        if (!disposed && refreshGuardRef.current.isCurrent(requestId)) {
          setError(toErrorMessage(caught))
          setErrorSource(feedKey)
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
  }, [input.active, input.followingLatestRef, input.onUnreadRecords, feedKey, listLogs])

  const sourceReady = committedSource === feedKey
  return {
    records: sourceReady ? records : EMPTY_LOG_RECORDS,
    gap: sourceReady ? gap : undefined,
    truncated: sourceReady ? truncated : false,
    loading: input.active && !sourceReady && !error ? true : loading,
    error: errorSource === feedKey ? error : undefined,
    refresh,
    sourceReady,
    sourceIssues: sourceReady && gap ? [`${input.source}: ${gap.reason}${gap.dropped ? ` (${gap.dropped})` : ''}`] : [],
  }
}

function toErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}
