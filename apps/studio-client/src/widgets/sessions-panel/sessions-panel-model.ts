import type { AgentProfile, AgentSession, CardSummary, NarrativeTimeline } from '../../entities/index.js'

export function sortTimelinesByUpdated(timelines: NarrativeTimeline[]): NarrativeTimeline[] {
  return [...timelines].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function partitionSessions(sessions: AgentSession[]): {
  sessionsByTimelineId: Map<string, AgentSession[]>
  standaloneSessions: AgentSession[]
} {
  const sessionsByTimelineId = new Map<string, AgentSession[]>()
  const standaloneSessions: AgentSession[] = []

  for (const session of sessions) {
    if (session.timelineId) {
      const list = sessionsByTimelineId.get(session.timelineId) ?? []
      list.push(session)
      sessionsByTimelineId.set(session.timelineId, list)
    } else {
      standaloneSessions.push(session)
    }
  }

  return { sessionsByTimelineId, standaloneSessions }
}

export function filterTimelines(
  timelines: NarrativeTimeline[],
  cardMap: Map<string, CardSummary>,
  query: string,
): NarrativeTimeline[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return timelines
  return timelines.filter(t => {
    const card = t.createdFrom?.cardId ? cardMap.get(t.createdFrom.cardId) : undefined
    const titleMatch = (t.title || '').toLowerCase().includes(normalized)
    const cardMatch = card?.name?.toLowerCase().includes(normalized)
    const idMatch = t.id.toLowerCase().includes(normalized)
    return Boolean(titleMatch || cardMatch || idMatch)
  })
}

export function filterStandaloneSessions(
  sessions: AgentSession[],
  profiles: AgentProfile[],
  query: string,
): AgentSession[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return sessions
  return sessions.filter(s => {
    const profile = profiles.find(p => p.id === s.agentProfileId)
    const titleMatch = (s.title || '').toLowerCase().includes(normalized)
    const profileMatch = profile?.name?.toLowerCase().includes(normalized)
    const idMatch = s.id.toLowerCase().includes(normalized)
    return Boolean(titleMatch || profileMatch || idMatch)
  })
}

export function toggleItemSelection(
  current: Set<string>,
  id: string,
): Set<string> {
  const next = new Set(current)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

export function areAllSelected(
  visibleTimelineIds: string[],
  visibleSessionIds: string[],
  selectedTimelines: Set<string>,
  selectedSessions: Set<string>,
): boolean {
  const totalVisible = visibleTimelineIds.length + visibleSessionIds.length
  if (totalVisible === 0) return false
  const allTimelines = visibleTimelineIds.every(id => selectedTimelines.has(id))
  const allSessions = visibleSessionIds.every(id => selectedSessions.has(id))
  return allTimelines && allSessions
}

export function toggleSelectAll(
  visibleTimelineIds: string[],
  visibleSessionIds: string[],
  selectedTimelines: Set<string>,
  selectedSessions: Set<string>,
): {
  nextTimelines: Set<string>
  nextSessions: Set<string>
} {
  const isAll = areAllSelected(
    visibleTimelineIds,
    visibleSessionIds,
    selectedTimelines,
    selectedSessions,
  )
  const nextTimelines = new Set(selectedTimelines)
  const nextSessions = new Set(selectedSessions)

  if (isAll) {
    visibleTimelineIds.forEach(id => nextTimelines.delete(id))
    visibleSessionIds.forEach(id => nextSessions.delete(id))
  } else {
    visibleTimelineIds.forEach(id => nextTimelines.add(id))
    visibleSessionIds.forEach(id => nextSessions.add(id))
  }

  return { nextTimelines, nextSessions }
}

export function areAllTimelinesSelected(
  visibleTimelineIds: string[],
  selectedTimelines: Set<string>,
): boolean {
  if (visibleTimelineIds.length === 0) return false
  return visibleTimelineIds.every(id => selectedTimelines.has(id))
}

export function toggleSelectAllTimelines(
  visibleTimelineIds: string[],
  selectedTimelines: Set<string>,
): Set<string> {
  const isAll = areAllTimelinesSelected(visibleTimelineIds, selectedTimelines)
  const next = new Set(selectedTimelines)
  if (isAll) {
    visibleTimelineIds.forEach(id => next.delete(id))
  } else {
    visibleTimelineIds.forEach(id => next.add(id))
  }
  return next
}

export function areAllSessionsSelected(
  visibleSessionIds: string[],
  selectedSessions: Set<string>,
): boolean {
  if (visibleSessionIds.length === 0) return false
  return visibleSessionIds.every(id => selectedSessions.has(id))
}

export function toggleSelectAllSessions(
  visibleSessionIds: string[],
  selectedSessions: Set<string>,
): Set<string> {
  const isAll = areAllSessionsSelected(visibleSessionIds, selectedSessions)
  const next = new Set(selectedSessions)
  if (isAll) {
    visibleSessionIds.forEach(id => next.delete(id))
  } else {
    visibleSessionIds.forEach(id => next.add(id))
  }
  return next
}

export function sortTimelines<T extends { updatedAt: string }>(
  timelines: T[],
  sortOrder: 'desc' | 'asc',
): T[] {
  return [...timelines].sort((a, b) => {
    const diff = b.updatedAt.localeCompare(a.updatedAt)
    return sortOrder === 'desc' ? diff : -diff
  })
}

export function sortSessions<T extends { updatedAt: string }>(
  sessions: T[],
  sortOrder: 'desc' | 'asc',
): T[] {
  return [...sessions].sort((a, b) => {
    const diff = b.updatedAt.localeCompare(a.updatedAt)
    return sortOrder === 'desc' ? diff : -diff
  })
}

export function getExpandableTimelineIds(
  timelineIds: string[],
  sessionsByTimelineId: Map<string, { length: number }>,
): string[] {
  return timelineIds.filter(id => {
    const sessions = sessionsByTimelineId.get(id)
    return sessions && sessions.length > 0
  })
}

export function areAllExpandablesExpanded(
  expandableIds: string[],
  expandedTimelines: Set<string>,
): boolean {
  if (expandableIds.length === 0) return false
  return expandableIds.every(id => expandedTimelines.has(id))
}

export function toggleExpandAll(
  expandableIds: string[],
  expandedTimelines: Set<string>,
): Set<string> {
  const isAllExpanded = areAllExpandablesExpanded(expandableIds, expandedTimelines)
  const next = new Set(expandedTimelines)
  if (isAllExpanded) {
    expandableIds.forEach(id => next.delete(id))
  } else {
    expandableIds.forEach(id => next.add(id))
  }
  return next
}


