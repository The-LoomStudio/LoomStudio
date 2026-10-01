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
    const session = {
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
})
