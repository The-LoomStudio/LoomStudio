import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecentPlayPanel } from '../../../apps/studio-client/src/widgets/play-panel/play-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { AgentPreset, AgentSession, CardSummary, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'

describe('recent play panel', () => {
  it('shows stories and sessions together with readable source information', () => {
    const updatedAt = '2026-09-29T12:00:00.000Z'
    const card = { id: 'card-1', name: 'Character' } as CardSummary
    const timeline = {
      id: 'timeline-1', title: 'Story', createdFrom: { cardId: card.id, cardVersion: 1 },
      updatedAt, createdAt: updatedAt, activeBranchId: 'branch-1', promptResourceIds: [],
    } as NarrativeTimeline
    const session = { kind: 'agent' as const,
      id: 'session-1', title: 'Agent conversation', agentPresetId: 'preset-1',
      timelineId: timeline.id, entryCount: 42, createdAt: updatedAt, updatedAt,
    } as AgentSession
    const preset = {
      id: 'preset-1', rootNode: { id: 'root', kind: 'module', label: 'Writing Assistant' },
    } as AgentPreset

    const html = renderToStaticMarkup(createElement(RecentPlayPanel, {
      agentSessions: [session],
      agentPresets: [preset],
      cards: [card],
      timelines: [timeline],
      t: createTranslator('zh-CN'),
      onOpenAgentSession: () => {},
      recent: [{ cardId: card.id, timelineId: timeline.id, branchId: "branch-1" }], onOpenRecent: () => {},
      onOpenTimeline: () => {},
    }))
    expect(html).toContain('最近活动')
    expect(html).toContain('继续上次故事')
    expect(html).toContain('Story')
    expect(html).toContain('Agent conversation')
    expect(html).toContain('Writing Assistant')
    expect(html).toContain('42 条记录')
    expect(html).not.toContain('timeline-1')

  })
  it('highlights the current story and viewed session independently from the primary writing label', () => {
    const timestamp = '2026-10-20T00:00:00.000Z'
    const t = createTranslator('zh-CN')
    const html = renderToStaticMarkup(createElement(RecentPlayPanel, {
      activeTimelineId: 'current-story', activeSessionId: 'viewed', primarySessionId: 'writer',
      cards: [], agentPresets: [],
      timelines: [{ id: 'current-story', title: 'Current story', updatedAt: timestamp, createdAt: timestamp, activeBranchId: 'branch', promptResourceIds: [] }],
      agentSessions: ['viewed', 'writer', 'other'].map(id => ({ kind: 'agent' as const,
        id, title: id, agentPresetId: 'preset', entryCount: 1, createdAt: timestamp, updatedAt: timestamp,
      })),
      t, recent: [], onOpenRecent: () => {}, onOpenTimeline: () => {}, onOpenAgentSession: () => {},
    }))
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0])
    const row = (title: string) => buttons.find(button => button.includes(`<strong>${title}</strong>`))!
    expect(row('Current story')).toContain('aria-current="true"')
    expect(row('viewed')).toContain('aria-current="true"')
    expect(row('viewed')).not.toContain(t('agent.primarySession'))
    expect(row('writer')).not.toContain('aria-current=')
    expect(row('writer')).toContain(t('agent.primarySession'))
    expect(row('other')).not.toContain('aria-current=')
    expect(row('other')).toContain('lucide-message-square')
  })

  it('resumes the last visited story rather than the most recently modified story', () => {
    const card = { id: 'card', name: 'Visited character' } as CardSummary
    const timelines = [
      { id: 'newer', title: 'Recently modified', updatedAt: '2026-11-02T12:00:00Z' },
      { id: 'visited', title: 'Last visited', updatedAt: '2026-11-01T12:00:00Z', latestPreview: '<quick_reply>hidden action</quick_reply><b>Story excerpt</b>' },
    ].map(item => ({ ...item, createdAt: item.updatedAt, activeBranchId: 'branch', promptResourceIds: [], createdFrom: { cardId: card.id, cardVersion: 1 } }))
    const html = renderToStaticMarkup(createElement(RecentPlayPanel, {
      cards: [card], timelines, agentSessions: [], agentPresets: [], t: createTranslator('zh-CN'),
      recent: [{ cardId: card.id, timelineId: 'visited', branchId: 'branch' }],
      onOpenRecent: () => {}, onOpenTimeline: () => {}, onOpenAgentSession: () => {},
    }))
    const hero = html.slice(html.indexOf('继续上次故事'), html.indexOf('最近活动'))
    expect(hero).toContain('Last visited')
    expect(hero).not.toContain('Recently modified')
    expect(hero).toContain('Story excerpt')
    expect(html).not.toContain('hidden action')
  })

})
