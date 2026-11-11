import { describe, expect, it } from 'vitest'
import { characterPanelProps, renderCharacterPanel } from '../../support/client/character-panel.js'

describe('CharacterPanel MasterDetail', () => {
  const dummyCards = [
    {
      id: 'card-1',
      version: 1,
      name: '爱丽丝',
      userName: 'Alice',
      description: '奇境漫游者',
      media: { avatarAssetId: 'avatar-1' },
      lore: { entries: [] },
      opening: { id: 'root-opening', content: '你好，我是爱丽丝。' },
    },
    {
      id: 'card-2',
      version: 1,
      name: '鲍勃',
      userName: 'Bob',
      description: '旅行诗人',
    },
  ]

  const dummyProps = characterPanelProps({ cards: dummyCards })

  it('renders master-detail layout containing gallery cards and character profile simultaneously', () => {
    const html = renderCharacterPanel(dummyProps)

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

    // 编辑草稿由 effect 填充；静态渲染仅检查编辑入口。
    expect(html).toContain('character.opening')
    expect(html).toContain('character.continueNarrative')
    expect(html).toContain('character.newNarrative')
    expect(html).toContain('character.preview')
    expect(html).not.toContain('character.chooseOpening')
    expect(html).toContain('directory.attachments')
  })

  it('renders the bound world book and state section in the attachment directory', () => {
    const dummyResources = [
      {
        id: 'res-world-1',
        version: 1,
        createdAt: '',
        updatedAt: '',
        resourceKind: 'lore' as const,
        rootNode: {
          id: 'node-root-1',
          kind: 'module',
          label: '奇境世界书',
          category: 'module' as const,
          children: [
            { id: 'node-1', kind: 'entry', label: '疯帽子茶会', category: 'lore' as const },
          ],
        },
      },
    ]

    const cardWithWorldBook = {
      ...dummyCards[0]!,
      promptResourceIds: ['res-world-1'],
      stateTemplates: [{ id: 'state-template', label: '角色状态', templateVersion: 1, schema: { type: 'object' }, initial: {} }],
    }

    const html = renderCharacterPanel({
      ...dummyProps,
      cards: [cardWithWorldBook, dummyCards[1]!],
      resources: dummyResources,
      resourceDirectoryOpen: true,
      resourceDirectoryExpandedIds: ['references', 'settings', 'state'],
    })

    expect(html).toContain('奇境世界书')
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

    const html = renderCharacterPanel({
      ...dummyProps,
      timeline: timelines[0],
    }, timelines)

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
