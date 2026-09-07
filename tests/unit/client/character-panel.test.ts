import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CharacterPanel } from '../../../apps/studio-client/src/widgets/character-panel/character-panel.js'

describe('CharacterPanel MasterDetail', () => {
  const dummyCards = [
    {
      id: 'card-1',
      version: 1,
      name: '爱丽丝',
      userName: 'Alice',
      description: '奇境漫游者',
      media: { avatarAssetId: 'avatar-1' },
      settingLayer: { entries: [] },
      opening: { entries: [{ role: 'assistant' as const, content: '你好，我是爱丽丝。' }] },
    },
    {
      id: 'card-2',
      version: 1,
      name: '鲍勃',
      userName: 'Bob',
      description: '旅行诗人',
    },
  ]

  const dummyProps = {
    active: true,
    busy: false,
    cardDraft: { name: '', userName: '', description: '' },
    cards: dummyCards,
    onChangeCardDraft: () => undefined,
    onCreateCard: async () => undefined,
    onCreateTimelineFromCard: async () => undefined,
    onExportCard: async () => undefined,
    onImportCards: async () => undefined,
    onDeleteCards: async () => undefined,
    onPreviewCardDeletion: async () => ({ timelines: [] }),
    onSelectCard: () => undefined,
    onOpenTimeline: () => undefined,
    onOpenStatePanel: () => undefined,
    onUpdateCardMedia: async () => undefined,
    onUpdateCard: async () => undefined,
    timelines: [],
    t: (key: string) => key,
  }

  it('renders master-detail layout containing gallery cards and character profile simultaneously', () => {
    const html = renderToStaticMarkup(createElement(CharacterPanel, dummyProps))

    // 包含 Master-Detail Workbench 容器
    expect(html).toContain('data-loom-component="character-panel"')
    expect(html).toContain('data-loom-component="master-detail-workbench"')
    expect(html).toContain('data-loom-slot="master"')
    expect(html).toContain('data-loom-slot="detail"')

    // Master 区域包含角色卡片与网格/列表切换
    expect(html).toContain('爱丽丝')
    expect(html).toContain('鲍勃')
    expect(html).toContain('character.grid')
    expect(html).toContain('character.list')

    // Detail 区域默认渲染第一个选中角色的档案与开场白
    expect(html).toContain('你好，我是爱丽丝。')
    expect(html).toContain('character.resources')
    expect(html).toContain('character.expandOpening')
    expect(html).toContain('character.stateVariables')
  })

  it('renders bound world book card and state variables card in character profile', () => {
    const dummyResources = [
      {
        id: 'res-world-1',
        resourceKind: 'setting' as const,
        rootNode: {
          id: 'node-root-1',
          label: '奇境世界书',
          category: 'module' as const,
          children: [
            { id: 'node-1', label: '疯帽子茶会', category: 'setting' as const },
          ],
        },
      },
    ]

    const cardWithWorldBook = {
      ...dummyCards[0],
      promptResourceIds: ['res-world-1'],
    }

    const html = renderToStaticMarkup(createElement(CharacterPanel, {
      ...dummyProps,
      cards: [cardWithWorldBook, dummyCards[1]],
      resources: dummyResources,
    }))

    expect(html).toContain('奇境世界书')
    expect(html).toContain('character.worldBookCount')
    expect(html).toContain('character.stateVariables')
  })

  it('renders session card with open button and sort toggle without duplicate timestamp', () => {
    const timelines = [
      {
        id: 'timeline-1',
        title: '漫游历险记',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-05T12:00:00.000Z',
      },
      {
        id: 'timeline-2',
        title: '红皇后审判',
        createdAt: '2026-09-02T10:00:00.000Z',
        updatedAt: '2026-09-06T12:00:00.000Z',
      },
    ]

    const html = renderToStaticMarkup(createElement(CharacterPanel, {
      ...dummyProps,
      timelines,
      timeline: timelines[0],
    }))

    // 包含排序按钮
    expect(html).toContain('character.sortLatest')

    // 包含会话标题
    expect(html).toContain('漫游历险记')
    expect(html).toContain('红皇后审判')

    // 包含进入会话按钮
    expect(html).toContain('character.enterCurrentSession')
    expect(html).toContain('character.enterSession')

    // 不再包含重复的“最后一段消息”时间戳项
    expect(html).not.toContain('character.sessionLatestMessage')
  })
})
