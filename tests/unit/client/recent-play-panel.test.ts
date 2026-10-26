import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecentPlayPanel } from '../../../apps/studio-client/src/widgets/play-panel/play-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { AgentPreset, AgentSession, CardSummary, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'

describe('recent play panel', () => {
  it('keeps Agent sessions and narrative timelines in separate sections', () => {
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
      onOpenCard: () => {},
      onOpenTimeline: () => {},
    }))
    const timelines = html.split('<h3>最近剧情</h3>')[1]?.split('<h3>最近会话</h3>')[0]
    const sessions = html.split('<h3>最近会话</h3>')[1]

    expect(timelines).toContain('Story')
    expect(timelines).not.toContain('Agent conversation')
    expect(sessions).toContain('Agent conversation')
    expect(sessions).toContain('Writing Assistant · 42 条记录 · 剧情：Story')
    expect(sessions).not.toContain('timeline-1')
  })
  it('highlights the current story and viewed session independently from the primary writing star', () => {
    const timestamp = '2026-10-20T00:00:00.000Z'
    const t = createTranslator('zh-CN')
    const html = renderToStaticMarkup(createElement(RecentPlayPanel, {
      activeTimelineId: 'current-story', activeSessionId: 'viewed', primarySessionId: 'writer',
      cards: [], agentPresets: [],
      timelines: [{ id: 'current-story', title: 'Current story', updatedAt: timestamp, createdAt: timestamp, activeBranchId: 'branch', promptResourceIds: [] }],
      agentSessions: ['viewed', 'writer', 'other'].map(id => ({ kind: 'agent' as const,
        id, title: id, agentPresetId: 'preset', entryCount: 1, createdAt: timestamp, updatedAt: timestamp,
      })),
      t, onOpenCard: () => {}, onOpenTimeline: () => {}, onOpenAgentSession: () => {},
    }))
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0])
    const row = (title: string) => buttons.find(button => button.includes(`<strong>${title}</strong>`))!
    expect(row('Current story')).toContain('aria-current="true"')
    expect(row('viewed')).toContain('aria-current="true"')
    expect(row('viewed')).not.toContain(`aria-label="${t('agent.primarySession')}"`)
    expect(row('writer')).not.toContain('aria-current=')
    expect(row('writer')).toContain(`aria-label="${t('agent.primarySession')}"`)
    expect(row('writer')).toContain('lucide-star')
    expect(row('other')).not.toContain('aria-current=')
    expect(row('other')).toContain('lucide-bot')
  })

})
