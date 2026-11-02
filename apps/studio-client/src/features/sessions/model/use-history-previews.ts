import { useEffect, useState } from 'react'
import type { AgentSession, AgentTranscriptEntry, NarrativeBranch, NarrativeNode, NarrativeTimeline } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type HistoryPreview<T> = { key: string } & (
  | { status: 'loading' }
  | { status: 'ready'; data: T[] }
  | { status: 'error'; error: string }
)

export function useHistoryPreviews({ api, branches, selectedTimeline, selectedSession }: {
  api?: StudioApi
  branches: NarrativeBranch[]
  selectedTimeline?: NarrativeTimeline
  selectedSession?: AgentSession
}) {
  const [previews, setPreviews] = useState<{
    api?: StudioApi
    timelineNodes: Record<string, HistoryPreview<NarrativeNode> | undefined>
    sessionTranscripts: Record<string, HistoryPreview<AgentTranscriptEntry> | undefined>
  }>({ api, timelineNodes: {}, sessionTranscripts: {} })
  const [previewRetry, setPreviewRetry] = useState(0)
  const timelineNodesMap = previews.api === api ? previews.timelineNodes : undefined
  const sessionTranscriptMap = previews.api === api ? previews.sessionTranscripts : undefined

  const previewBranch = branches.find(branch => branch.id === selectedTimeline?.activeBranchId)
  const timelinePreviewKey = JSON.stringify([selectedTimeline?.activeBranchId, selectedTimeline?.updatedAt, previewBranch?.updatedAt, previewBranch?.headNodeId])
  const sessionPreviewKey = JSON.stringify([selectedSession?.updatedAt, selectedSession?.entryCount])
  const timelinePreview = selectedTimeline && timelineNodesMap?.[selectedTimeline.id]?.key === timelinePreviewKey
    ? timelineNodesMap[selectedTimeline.id] : undefined
  const sessionPreview = selectedSession && sessionTranscriptMap?.[selectedSession.id]?.key === sessionPreviewKey
    ? sessionTranscriptMap[selectedSession.id] : undefined

  // 按需拉取选中时间线的演变节点日志
  useEffect(() => {
    if (!selectedTimeline || !api) return
    const timelineId = selectedTimeline.id
    if (timelineNodesMap?.[timelineId]?.key === timelinePreviewKey && timelineNodesMap[timelineId]?.status === 'ready') return

    let active = true
    setPreviews(prev => ({
      api,
      timelineNodes: { ...(prev.api === api ? prev.timelineNodes : {}), [timelineId]: { key: timelinePreviewKey, status: 'loading' } },
      sessionTranscripts: prev.api === api ? prev.sessionTranscripts : {},
    }))
    void api.narratives
      .getPage({ timelineId, branchId: selectedTimeline.activeBranchId, limit: 20 })
      .then(page => {
        if (active) {
          setPreviews(prev => ({
            api,
            timelineNodes: { ...(prev.api === api ? prev.timelineNodes : {}), [timelineId]: { key: timelinePreviewKey, status: 'ready', data: page.nodes } },
            sessionTranscripts: prev.api === api ? prev.sessionTranscripts : {},
          }))
        }
      })
      .catch(cause => {
        if (active) setPreviews(prev => ({
          api,
          timelineNodes: { ...(prev.api === api ? prev.timelineNodes : {}), [timelineId]: {
            key: timelinePreviewKey, status: 'error', error: cause instanceof Error ? cause.message : String(cause),
          } },
          sessionTranscripts: prev.api === api ? prev.sessionTranscripts : {},
        }))
      })
    return () => {
      active = false
    }
  }, [selectedTimeline?.id, timelinePreviewKey, api, previewRetry])

  // 按需拉取选中会话的转录缩略预览
  useEffect(() => {
    if (!selectedSession || !api) return
    const sessionId = selectedSession.id
    if (sessionTranscriptMap?.[sessionId]?.key === sessionPreviewKey && sessionTranscriptMap[sessionId]?.status === 'ready') return

    let active = true
    setPreviews(prev => ({
      api,
      timelineNodes: prev.api === api ? prev.timelineNodes : {},
      sessionTranscripts: { ...(prev.api === api ? prev.sessionTranscripts : {}), [sessionId]: { key: sessionPreviewKey, status: 'loading' } },
    }))
    void api.agentSessions
      .getTranscript({ agentSessionId: sessionId, limit: 12 })
      .then(page => {
        if (active) {
          setPreviews(prev => ({
            api,
            timelineNodes: prev.api === api ? prev.timelineNodes : {},
            sessionTranscripts: { ...(prev.api === api ? prev.sessionTranscripts : {}), [sessionId]: { key: sessionPreviewKey, status: 'ready', data: page.entries } },
          }))
        }
      })
      .catch(cause => {
        if (active) setPreviews(prev => ({
          api,
          timelineNodes: prev.api === api ? prev.timelineNodes : {},
          sessionTranscripts: { ...(prev.api === api ? prev.sessionTranscripts : {}), [sessionId]: {
            key: sessionPreviewKey, status: 'error', error: cause instanceof Error ? cause.message : String(cause),
          } },
        }))
      })
    return () => {
      active = false
    }
  }, [selectedSession?.id, sessionPreviewKey, api, previewRetry])

  return { timelinePreview, sessionPreview, retryPreview: () => setPreviewRetry(value => value + 1) }
}
