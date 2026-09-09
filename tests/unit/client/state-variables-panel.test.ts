import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Card } from '../../../apps/studio-client/src/entities/card.js'
import { StateVariablesPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.js'
import { StateAuthoringPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-authoring-panel.js'
import { MacroAuthoringDetail } from '../../../apps/studio-client/src/features/state-variables/ui/macro-authoring-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const t = createTranslator('zh-CN')

const api = {
  get: async () => { throw new Error('not called during SSR') },
  apply: async () => { throw new Error('not called during SSR') },
  listDefinitions: async () => ({ definitions: [] }),
  getDefinition: async () => { throw new Error('not called during SSR') },
  upsertDefinition: async () => { throw new Error('not called during SSR') },
  deleteDefinition: async () => { throw new Error('not called during SSR') },
}

describe('StateVariablesPanel', () => {
  it('renders Text Variables workspace by default', () => {
    const html = renderToStaticMarkup(createElement(StateVariablesPanel, {
      api,
      t,
      timelineTarget: { scope: 'timeline', timelineId: 'timeline-1', branchId: 'branch-2' },
    }))

    expect(html).toContain('运行态变量')
    expect(html).toContain('当前世界线状态')
    expect(html).toContain('全局状态')
    expect(html).not.toContain('共享 State Definition')
  })

  it('renders the source action only when the timeline source is available', () => {
    const html = renderToStaticMarkup(createElement(StateVariablesPanel, {
      api,
      t,
      timelineTarget: { scope: 'timeline', timelineId: 'timeline-1', branchId: 'branch-2' },
      canOpenTimelineSource: false,
      onOpenSource: () => undefined,
    }))

    expect(html).not.toContain('打开来源配置')
    expect(html).toContain('timeline-1')
    expect(html).toContain('branch-2')
  })

  it('renders Card authoring without a Workspace scope', () => {
    const html = renderToStaticMarkup(createElement(StateAuthoringPanel, {
      t,
      card: {
        id: 'card-1', version: 1, name: 'Alice', stateDefinitionIds: ['shared-1'],
        timelineStateBindings: [], opening: { entries: [] }, settingLayer: { entries: [] },
        createdAt: 'now', updatedAt: 'now',
      },
      onSaveCard: async (input): Promise<Card> => ({
        id: input.cardId,
        version: input.expectedVersion + 1,
        name: 'Alice',
        opening: { entries: [] },
        settingLayer: { entries: [] },
        createdAt: 'now',
        updatedAt: 'now',
      }),
    }))

    expect(html).toContain('Alice')
    expect(html).toContain('保存到角色卡')
    expect(html).not.toContain('Workspace')
    expect(html).not.toContain('共享 State Definition')
  })

  it('keeps the save action available when the last macro is deleted', () => {
    const html = renderToStaticMarkup(createElement(MacroAuthoringDetail, {
      controller: {
        input: {
          ownerId: 'card-1',
          ownerLabel: 'Alice',
          version: 2,
          macros: { greeting: 'Hello' },
          onSave: async () => ({ version: 3, macros: {} }),
          t,
        },
        rows: [],
        dirty: true,
        saving: false,
        error: '',
        selectRow: () => undefined,
        addRow: () => undefined,
        updateRow: () => undefined,
        removeRow: () => undefined,
        save: async () => undefined,
      },
    }))

    expect(html).toContain('保存宏')
    expect(html).toContain('暂无静态宏')
  })
})
