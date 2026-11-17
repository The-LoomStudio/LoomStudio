import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import type { AgentSession, AgentTranscriptEntry, NarrativeBranch, NarrativeNode, NarrativeTimeline } from '../../../entities/index.js'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type HistoryPreview<T> = { key: string } & (
  | { status: 'loading' }
  | { status: 'ready'; data: T[] }
  | { status: 'error'; error: string }
)

const apiScopeIds = new WeakMap<StudioApi, number>()
let nextApiScopeId = 1

function getApiScopeId(api: StudioApi): number {
  let id = apiScopeIds.get(api)
  if (id === undefined) {
    id = nextApiScopeId++
    apiScopeIds.set(api, id)
  }
  return id
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function useHistoryPreviews({ api, branches, selectedTimeline, selectedSession }: {
  api?: StudioApi
  branches: NarrativeBranch[]
  selectedTimeline?: NarrativeTimeline
  selectedSession?: AgentSession
}) {
  const queryClient = useQueryClient()
  const apiScope = api ? getApiScopeId(api) : undefined

  const previewBranch = branches.find(branch => branch.id === selectedTimeline?.activeBranchId)
  const timelinePreviewKey = JSON.stringify([selectedTimeline?.activeBranchId, selectedTimeline?.updatedAt, previewBranch?.updatedAt, previewBranch?.headNodeId])
  const sessionPreviewKey = JSON.stringify([selectedSession?.updatedAt, selectedSession?.entryCount])

  const timelineQueryKey = useMemo(
    () => ['history-previews', apiScope, 'timeline', selectedTimeline?.id, timelinePreviewKey] as const,
    [apiScope, selectedTimeline?.id, timelinePreviewKey],
  )
  const sessionQueryKey = useMemo(
    () => ['history-previews', apiScope, 'session', selectedSession?.id, sessionPreviewKey] as const,
    [apiScope, selectedSession?.id, sessionPreviewKey],
  )

  // 按需拉取选中时间线的演变节点日志
  const timelineQuery = useQuery({
    queryKey: timelineQueryKey,
    enabled: Boolean(api && selectedTimeline),
    queryFn: async () => (await api!.narratives.getPage({
      timelineId: selectedTimeline!.id,
      branchId: selectedTimeline!.activeBranchId,
      limit: 20,
    })).nodes,
  })

  // 按需拉取选中会话的转录缩略预览
  const sessionQuery = useQuery({
    queryKey: sessionQueryKey,
    enabled: Boolean(api && selectedSession),
    queryFn: async () => (await api!.agentSessions.getTranscript({
      agentSessionId: selectedSession!.id,
      limit: 12,
    })).entries,
  })

  useEffect(() => {
    if (apiScope === undefined) return
    return subscribeDataCommits(
      operations => {
        const hasNarrativeChange = operations.some(op =>
          op.entityType === 'narrative.timeline'
          || op.entityType === 'narrative.branch'
          || op.entityType === 'narrative.node'
          || op.entityType === 'narrative.swipe-group',
        )
        const hasAgentChange = operations.some(op =>
          op.entityType === 'agent.session'
          || op.entityType === 'agent.transcript-entry',
        )
        if (hasNarrativeChange) void queryClient.invalidateQueries({ queryKey: ['history-previews', apiScope, 'timeline'] })
        if (hasAgentChange) void queryClient.invalidateQueries({ queryKey: ['history-previews', apiScope, 'session'] })
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['history-previews', apiScope] })
      },
    )
  }, [apiScope, queryClient])

  const timelinePreview: HistoryPreview<NarrativeNode> | undefined = !api || !selectedTimeline
    ? undefined
    : timelineQuery.isPending
      ? { key: timelinePreviewKey, status: 'loading' }
      : timelineQuery.isError
        ? { key: timelinePreviewKey, status: 'error', error: readError(timelineQuery.error) }
        : { key: timelinePreviewKey, status: 'ready', data: timelineQuery.data }

  const sessionPreview: HistoryPreview<AgentTranscriptEntry> | undefined = !api || !selectedSession
    ? undefined
    : sessionQuery.isPending
      ? { key: sessionPreviewKey, status: 'loading' }
      : sessionQuery.isError
        ? { key: sessionPreviewKey, status: 'error', error: readError(sessionQuery.error) }
        : { key: sessionPreviewKey, status: 'ready', data: sessionQuery.data }

  const retryPreview = useCallback(() => {
    if (apiScope === undefined) return
    void queryClient.invalidateQueries({ queryKey: ['history-previews', apiScope] })
  }, [apiScope, queryClient])

  return { timelinePreview, sessionPreview, retryPreview }
}
