import { describe, expect, it } from 'vitest'
import type { AgentProfile, AgentSession, CardSummary, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'
import {
  areAllExpandablesExpanded,
  areAllSelected,
  areAllSessionsSelected,
  areAllTimelinesSelected,
  filterStandaloneSessions,
  filterTimelines,
  getExpandableTimelineIds,
  partitionSessions,
  sortSessions,
  sortTimelines,
  sortTimelinesByUpdated,
  toggleExpandAll,
  toggleItemSelection,
  toggleSelectAll,
  toggleSelectAllSessions,
  toggleSelectAllTimelines,
} from '../../../apps/studio-client/src/widgets/sessions-panel/sessions-panel-model.js'

describe('sessions-panel-model', () => {
  it('sorts timelines in descending order of updatedAt', () => {
    const timelines: NarrativeTimeline[] = [
      { id: 't1', updatedAt: '2026-09-01T10:00:00Z', createdAt: '', promptResourceIds: [], activeBranchId: '' },
      { id: 't2', updatedAt: '2026-09-05T12:00:00Z', createdAt: '', promptResourceIds: [], activeBranchId: '' },
      { id: 't3', updatedAt: '2026-09-03T08:00:00Z', createdAt: '', promptResourceIds: [], activeBranchId: '' },
    ]

    const sorted = sortTimelinesByUpdated(timelines)
    expect(sorted.map(t => t.id)).toEqual(['t2', 't3', 't1'])
  })

  it('partitions sessions into bound and standalone groups', () => {
    const sessions: AgentSession[] = [
      { id: 's1', agentProfileId: 'p1', timelineId: 't1', entryCount: 2, createdAt: '', updatedAt: '' },
      { id: 's2', agentProfileId: 'p1', entryCount: 0, createdAt: '', updatedAt: '' },
      { id: 's3', agentProfileId: 'p2', timelineId: 't1', entryCount: 5, createdAt: '', updatedAt: '' },
      { id: 's4', agentProfileId: 'p2', entryCount: 1, createdAt: '', updatedAt: '' },
    ]

    const { sessionsByTimelineId, standaloneSessions } = partitionSessions(sessions)

    expect(standaloneSessions.map(s => s.id)).toEqual(['s2', 's4'])
    const boundToT1 = sessionsByTimelineId.get('t1')
    expect(boundToT1?.map(s => s.id)).toEqual(['s1', 's3'])
    expect(sessionsByTimelineId.get('missing')).toBeUndefined()
  })

  it('filters timelines by title, card name, or timeline ID', () => {
    const cardMap = new Map<string, CardSummary>([
      ['card-alice', { id: 'card-alice', name: 'Alice' } as CardSummary],
      ['card-bob', { id: 'card-bob', name: 'Bob' } as CardSummary],
    ])

    const timelines: NarrativeTimeline[] = [
      { id: 't-wonderland', title: 'Adventures', createdFrom: { cardId: 'card-alice', cardVersion: 1 }, updatedAt: '', createdAt: '', promptResourceIds: [], activeBranchId: '' },
      { id: 't-builder', title: 'Construct', createdFrom: { cardId: 'card-bob', cardVersion: 1 }, updatedAt: '', createdAt: '', promptResourceIds: [], activeBranchId: '' },
    ]

    expect(filterTimelines(timelines, cardMap, '')).toHaveLength(2)
    expect(filterTimelines(timelines, cardMap, 'alice')).toEqual([timelines[0]])
    expect(filterTimelines(timelines, cardMap, 'CONSTRUCT')).toEqual([timelines[1]])
    expect(filterTimelines(timelines, cardMap, 'wonderland')).toEqual([timelines[0]])
    expect(filterTimelines(timelines, cardMap, 'notfound')).toHaveLength(0)
  })

  it('filters standalone sessions by title, profile name, or session ID', () => {
    const profiles: AgentProfile[] = [
      { id: 'prof-story', name: 'Story Weaver', createdAt: '', updatedAt: '' },
      { id: 'prof-helper', name: 'Code Assistant', createdAt: '', updatedAt: '' },
    ]

    const sessions: AgentSession[] = [
      { id: 'session-alpha', agentProfileId: 'prof-story', title: 'Chapter Draft', entryCount: 1, createdAt: '', updatedAt: '' },
      { id: 'session-beta', agentProfileId: 'prof-helper', title: 'Debug Session', entryCount: 3, createdAt: '', updatedAt: '' },
    ]

    expect(filterStandaloneSessions(sessions, profiles, '')).toHaveLength(2)
    expect(filterStandaloneSessions(sessions, profiles, 'weaver')).toEqual([sessions[0]])
    expect(filterStandaloneSessions(sessions, profiles, 'DEBUG')).toEqual([sessions[1]])
    expect(filterStandaloneSessions(sessions, profiles, 'alpha')).toEqual([sessions[0]])
  })

  it('toggles item selection in a set', () => {
    const set1 = new Set(['a', 'b'])
    const set2 = toggleItemSelection(set1, 'c')
    expect(Array.from(set2)).toEqual(['a', 'b', 'c'])
    const set3 = toggleItemSelection(set2, 'b')
    expect(Array.from(set3)).toEqual(['a', 'c'])
  })

  it('evaluates whether all visible items are selected', () => {
    const timelines = ['t1', 't2']
    const sessions = ['s1']

    expect(areAllSelected([], [], new Set(), new Set())).toBe(false)
    expect(areAllSelected(timelines, sessions, new Set(['t1']), new Set(['s1']))).toBe(false)
    expect(areAllSelected(timelines, sessions, new Set(['t1', 't2']), new Set(['s1']))).toBe(true)
    expect(areAllSelected(timelines, sessions, new Set(['t1', 't2', 't3']), new Set(['s1', 's2']))).toBe(true)
  })

  it('toggles select all and deselect all for visible items', () => {
    const timelines = ['t1', 't2']
    const sessions = ['s1']

    // 初始部分选中 -> 全选
    const initialTimelines = new Set(['t1'])
    const initialSessions = new Set<string>()
    const selectAllResult = toggleSelectAll(timelines, sessions, initialTimelines, initialSessions)
    expect(Array.from(selectAllResult.nextTimelines)).toEqual(['t1', 't2'])
    expect(Array.from(selectAllResult.nextSessions)).toEqual(['s1'])

    // 已全选 -> 全不选
    const deselectAllResult = toggleSelectAll(timelines, sessions, selectAllResult.nextTimelines, selectAllResult.nextSessions)
    expect(Array.from(deselectAllResult.nextTimelines)).toEqual([])
    expect(Array.from(deselectAllResult.nextSessions)).toEqual([])
  })

  it('handles timeline-specific select all and deselect all', () => {
    const timelines = ['t1', 't2']
    const initial = new Set(['t1'])

    expect(areAllTimelinesSelected(timelines, initial)).toBe(false)
    const all = toggleSelectAllTimelines(timelines, initial)
    expect(Array.from(all)).toEqual(['t1', 't2'])
    expect(areAllTimelinesSelected(timelines, all)).toBe(true)

    const none = toggleSelectAllTimelines(timelines, all)
    expect(Array.from(none)).toEqual([])
    expect(areAllTimelinesSelected(timelines, none)).toBe(false)
  })

  it('handles session-specific select all and deselect all', () => {
    const sessions = ['s1', 's2']
    const initial = new Set<string>()

    expect(areAllSessionsSelected(sessions, initial)).toBe(false)
    const all = toggleSelectAllSessions(sessions, initial)
    expect(Array.from(all)).toEqual(['s1', 's2'])
    expect(areAllSessionsSelected(sessions, all)).toBe(true)

    const none = toggleSelectAllSessions(sessions, all)
    expect(Array.from(none)).toEqual([])
    expect(areAllSessionsSelected(sessions, none)).toBe(false)
  })

  it('sorts timelines and sessions by updatedAt asc and desc', () => {
    const items = [
      { id: '1', updatedAt: '2026-09-01T10:00:00Z' },
      { id: '2', updatedAt: '2026-09-03T10:00:00Z' },
      { id: '3', updatedAt: '2026-09-02T10:00:00Z' },
    ]

    const desc = sortTimelines(items, 'desc')
    expect(desc.map(i => i.id)).toEqual(['2', '3', '1'])

    const asc = sortTimelines(items, 'asc')
    expect(asc.map(i => i.id)).toEqual(['1', '3', '2'])

    const sessionsDesc = sortSessions(items, 'desc')
    expect(sessionsDesc.map(i => i.id)).toEqual(['2', '3', '1'])
  })

  it('computes expandable timeline ids and toggles expand all', () => {
    const timelineIds = ['t1', 't2', 't3']
    const sessionsMap = new Map([
      ['t1', [{ id: 's1' }]],
      ['t2', []],
      ['t3', [{ id: 's2' }, { id: 's3' }]],
    ])

    const expandableIds = getExpandableTimelineIds(timelineIds, sessionsMap)
    expect(expandableIds).toEqual(['t1', 't3'])

    expect(areAllExpandablesExpanded(expandableIds, new Set())).toBe(false)
    expect(areAllExpandablesExpanded(expandableIds, new Set(['t1']))).toBe(false)
    expect(areAllExpandablesExpanded(expandableIds, new Set(['t1', 't3']))).toBe(true)

    const expandedAll = toggleExpandAll(expandableIds, new Set(['t1']))
    expect(Array.from(expandedAll)).toEqual(['t1', 't3'])

    const collapsedAll = toggleExpandAll(expandableIds, expandedAll)
    expect(Array.from(collapsedAll)).toEqual([])
  })
})



