import type { AgentTranscriptEntry, NarrativeNode } from '@loom-studio/application-data'

/** Project the selected transcript ancestry, never all candidates or array positions. */
export function projectTimelinePositions(entries: AgentTranscriptEntry[], nodes: NarrativeNode[] = []): AgentTranscriptEntry[] {
  const byNode = new Map(nodes.map(node => [node.id, node]))
  const byEntry = new Map<string, NarrativeNode>()
  for (const node of nodes) {
    if (node.entryId) byEntry.set(node.entryId, node)
    if (node.source?.agentMessageId) byEntry.set(node.source.agentMessageId, node)
  }
  let anchorNodeId: string | undefined
  let exchangeId: string | undefined
  const seenNarratives = new Set<string>()
  const runs = new Map<string, string | undefined>()
  return entries.map(item => {
    const data = item.entry
    if (data.kind === 'message' && data.role === 'user') {
      exchangeId = data.purpose === 'narrative' ? undefined : item.id
      if (item.runId) runs.set(item.runId, exchangeId)
    } else if (item.runId && runs.has(item.runId)) exchangeId = runs.get(item.runId)
    else if (data.kind === 'run-state' && data.sourceRunId && runs.has(data.sourceRunId)) {
      exchangeId = runs.get(data.sourceRunId)
      if (item.runId) runs.set(item.runId, exchangeId)
    }
    const nodeId = data.kind === 'message' ? byEntry.get(item.id)?.id ?? data.narrativeId : undefined
    const node = nodeId ? byNode.get(nodeId) : undefined
    // Revisions of an existing node update content without moving the reading cursor.
    if (data.kind === 'message' && nodeId && (data.purpose === 'narrative' || node !== undefined)
      && data.state !== 'partial' && !seenNarratives.has(nodeId)
      && (!node?.source?.runId || node.source.runId === item.runId)) {
      anchorNodeId = nodeId
      seenNarratives.add(nodeId)
    }
    return { ...item, timelinePosition: { anchorNodeId, exchangeId } }
  })
}
