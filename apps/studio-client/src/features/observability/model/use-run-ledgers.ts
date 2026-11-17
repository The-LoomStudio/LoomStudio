import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { LogRecord } from '@loom-studio/logging'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { ObservationSummary } from '../../../entities/observation.js'
import type { PromptBuildStep } from '../../prompt-build/model/build-prompt-build-steps.js'
import {
  buildDiagnosticLogLedger,
  buildModelCallLedger,
  buildPromptProjectionLedger,
  doesDiagnosticMatchRun,
  doesLogMatchRun,
} from './run-ledger-view.js'

export type UseRunLedgersInput = {
  api: StudioApi
  endpoint: string
  runId?: string
  buildId?: string
  enabled?: boolean
  fallback?: {
    tokenEstimate?: { estimatedTokens: number }
    promptBuildSteps?: PromptBuildStep[]
    promptBuildTrace?: unknown
    promptMessages?: unknown
  }
}

export function useRunLedgers(input: UseRunLedgersInput) {
  const enabled = input.enabled ?? true
  const [manualRecordId, setManualRecordId] = useState<string | undefined>(undefined)

  useEffect(() => {
    setManualRecordId(undefined)
  }, [input.runId, input.endpoint])

  const baseKey = useMemo(() => [input.endpoint, 'inspector-ledgers'] as const, [input.endpoint])

  const runsQuery = useQuery({
    queryKey: [...baseKey, 'runs'],
    enabled,
    queryFn: () => input.api.observations.list({ limit: 30 }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })

  const availableRecords = runsQuery.data?.records ?? []
  const activeRecordId = manualRecordId
    ?? input.runId
    ?? availableRecords.find(record => record.kind === 'run')?.id
    ?? availableRecords[0]?.id

  const detailQuery = useQuery({
    queryKey: [...baseKey, 'detail', activeRecordId],
    enabled: enabled && Boolean(activeRecordId),
    queryFn: () => input.api.observations.get(activeRecordId!),
    placeholderData: keepPreviousData,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  })

  const detail = detailQuery.data?.record.id === activeRecordId ? detailQuery.data : undefined
  const activeSummary = detail?.record ?? availableRecords.find(record => record.id === activeRecordId)
  const activeStatus = activeSummary?.status
  const children = detail?.children ?? []
  const correlationId = activeSummary?.origin?.correlationId
    ?? children.find(child => child.origin?.correlationId)?.origin?.correlationId
  const resolvedRunId = activeSummary?.kind === 'run'
    ? activeSummary.id
    : activeSummary?.origin?.sourceRunId ?? (activeRecordId === input.runId ? input.runId : undefined)
  const resolvedBuildId = activeSummary?.buildId
    ?? children.find(child => child.kind === 'build')?.id
    ?? (activeSummary?.kind === 'build' ? activeSummary.id : undefined)
    ?? (activeRecordId === input.runId ? input.buildId : undefined)

  const buildQuery = useQuery({
    queryKey: [...baseKey, 'build', resolvedBuildId, activeStatus],
    enabled: enabled && Boolean(resolvedBuildId),
    queryFn: () => input.api.observations.getBuild(resolvedBuildId!),
    placeholderData: keepPreviousData,
    refetchInterval: activeStatus === 'running' ? 2000 : false,
    refetchIntervalInBackground: false,
  })

  const apiListQuery = useQuery({
    queryKey: [...baseKey, 'api-list', correlationId, resolvedRunId],
    enabled: enabled && Boolean(correlationId || resolvedRunId),
    queryFn: () => input.api.observations.list({ kind: 'api', limit: 50 }),
    placeholderData: keepPreviousData,
    refetchInterval: activeSummary?.status === 'running' ? 2000 : 5000,
    refetchIntervalInBackground: false,
  })

  const callSummaries = useMemo(() => {
    const byId = new Map<string, ObservationSummary>()
    if (activeSummary && (activeSummary.kind === 'api' || activeSummary.kind === 'request')) {
      byId.set(activeSummary.id, activeSummary)
    }
    for (const child of children) {
      if (child.kind === 'request' || child.kind === 'api') {
        byId.set(child.id, child)
      }
    }
    for (const record of apiListQuery.data?.records ?? []) {
      const matchesCorrelation = Boolean(correlationId && record.origin?.correlationId === correlationId)
      const matchesSourceRun = Boolean(resolvedRunId && record.origin?.sourceRunId === resolvedRunId)
      if (matchesCorrelation || matchesSourceRun) {
        byId.set(record.id, record)
      }
    }
    return [...byId.values()]
  }, [activeSummary, apiListQuery.data?.records, children, correlationId, resolvedRunId])

  const callIdsKey = useMemo(() => callSummaries.map(item => item.id).join(','), [callSummaries])

  const callEntriesQuery = useQuery({
    queryKey: [...baseKey, 'call-entries', callIdsKey, activeStatus],
    enabled: enabled && callSummaries.length > 0,
    queryFn: () => Promise.all(callSummaries.map(item => input.api.observations.getRequest(item.id))),
    placeholderData: keepPreviousData,
    refetchInterval: activeStatus === 'running' ? 2000 : false,
    refetchIntervalInBackground: false,
  })

  const logsQuery = useQuery({
    queryKey: [...baseKey, 'logs', resolvedRunId, correlationId],
    enabled: enabled && Boolean(resolvedRunId || correlationId),
    queryFn: async () => {
      const queries: Array<Promise<{ items: LogRecord[] }>> = []
      if (resolvedRunId) queries.push(input.api.logs.list({ runId: resolvedRunId, limit: 200 }))
      if (correlationId && correlationId !== resolvedRunId) {
        queries.push(input.api.logs.list({ text: correlationId, limit: 200 }))
      }
      const pages = await Promise.all(queries)
      const deduped = new Map<string, LogRecord>()
      for (const page of pages) {
        for (const item of page.items) {
          if (!doesLogMatchRun(item, resolvedRunId, correlationId)) continue
          const key = `${item.timestamp}|${item.service}|${item.namespace}|${item.event ?? ''}|${item.message}`
          if (!deduped.has(key)) deduped.set(key, item)
        }
      }
      return [...deduped.values()]
    },
    placeholderData: keepPreviousData,
    refetchInterval: activeSummary?.status === 'running' ? 2000 : 5000,
    refetchIntervalInBackground: false,
  })

  const diagnosticsQuery = useQuery({
    queryKey: [...baseKey, 'diagnostics', resolvedRunId, correlationId],
    enabled: enabled && Boolean(resolvedRunId || correlationId),
    queryFn: async () => {
      const result = await input.api.diagnostics.list()
      return result.items.filter(item => doesDiagnosticMatchRun(item, resolvedRunId, correlationId))
    },
    placeholderData: keepPreviousData,
    refetchInterval: activeSummary?.status === 'running' ? 2000 : 5000,
    refetchIntervalInBackground: false,
  })

  const buildEntry = buildQuery.data?.id === resolvedBuildId ? buildQuery.data : undefined
  const promptLedger = useMemo(
    () => buildPromptProjectionLedger(buildEntry, input.fallback),
    [buildEntry, input.fallback],
  )

  const modelCalls = useMemo(
    () => buildModelCallLedger(callSummaries, callEntriesQuery.data ?? []),
    [callSummaries, callEntriesQuery.data],
  )

  const diagnosticLogLedger = useMemo(
    () => buildDiagnosticLogLedger({
      runId: resolvedRunId,
      correlationId,
      record: activeSummary,
      buildEntry,
      callItems: modelCalls,
      logs: logsQuery.data,
      diagnostics: diagnosticsQuery.data,
    }),
    [activeSummary, buildEntry, correlationId, diagnosticsQuery.data, logsQuery.data, modelCalls, resolvedRunId],
  )

  async function refreshAll() {
    await Promise.all([
      runsQuery.refetch(),
      activeRecordId ? detailQuery.refetch() : Promise.resolve(),
      resolvedBuildId ? buildQuery.refetch() : Promise.resolve(),
      (correlationId || resolvedRunId) ? apiListQuery.refetch() : Promise.resolve(),
      callSummaries.length > 0 ? callEntriesQuery.refetch() : Promise.resolve(),
      (resolvedRunId || correlationId) ? logsQuery.refetch() : Promise.resolve(),
      (resolvedRunId || correlationId) ? diagnosticsQuery.refetch() : Promise.resolve(),
    ])
  }

  return {
    availableRecords,
    activeRecordId,
    selectRecord: setManualRecordId,
    activeSummary,
    resolvedRunId,
    correlationId,
    resolvedBuildId,
    promptLedger,
    modelCalls,
    diagnosticLogLedger,
    loading: {
      runs: runsQuery.isLoading,
      detail: detailQuery.isLoading,
      build: buildQuery.isLoading,
      calls: callEntriesQuery.isLoading || apiListQuery.isLoading,
      logs: logsQuery.isLoading || diagnosticsQuery.isLoading,
    },
    errors: {
      runs: runsQuery.error,
      detail: detailQuery.error,
      build: buildQuery.error,
      calls: callEntriesQuery.error ?? apiListQuery.error,
      logs: logsQuery.error ?? diagnosticsQuery.error,
    },
    refreshAll,
  }
}
