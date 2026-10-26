// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGlobalSearchStore } from '../../../apps/studio-client/src/features/global-search/model/global-search-store.js'
import { ContextAssetExplorer } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-workbench.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

afterEach(() => {
  useGlobalSearchStore.setState({ byEndpoint: {} })
  useGlobalSearchStore.persist.clearStorage()
})

describe('workspace search state', () => {
  it('restores query and scope after storage rehydration, isolates endpoints and persists clearing', async () => {
    const dispatch = useGlobalSearchStore.getState().dispatch
    dispatch('one', { type: 'input', value: '世界' })
    dispatch('one', { type: 'scope', scope: { kind: 'card', id: 'card-one', label: '角色' } })
    dispatch('one', { type: 'kind', kind: 'lore' })
    dispatch('one', { type: 'mode', mode: 'scopes' })
    dispatch('one', { type: 'input', value: '未完成候选输入' })
    dispatch('two', { type: 'input', value: '另外的查询' })
    const saved = localStorage.getItem('loom-studio-global-search')!
    useGlobalSearchStore.setState({ byEndpoint: {} })
    localStorage.setItem('loom-studio-global-search', saved)
    await useGlobalSearchStore.persist.rehydrate()
    expect(useGlobalSearchStore.getState().byEndpoint.one).toEqual({ mode: 'results', query: '世界', candidateQuery: '', kind: 'lore', scope: { kind: 'card', id: 'card-one', label: '角色' } })
    expect(useGlobalSearchStore.getState().byEndpoint.two.query).toBe('另外的查询')
    dispatch('one', { type: 'input', value: '' })
    await useGlobalSearchStore.persist.rehydrate()
    expect(useGlobalSearchStore.getState().byEndpoint.one.query).toBe('')
    expect(useGlobalSearchStore.getState().byEndpoint.one.scope?.id).toBe('card-one')
  })

  it('highlights expanded directory labels without filtering or dropping unrelated nodes', () => {
    const props = {
      displayNodes: [{ id: 'root', kind: 'folder' as const, label: '目录', children: [
        { id: 'world', kind: 'entry' as const, label: '世界观.md' },
        { id: 'other', kind: 'entry' as const, label: '酒馆.md' },
      ] }], expandedIds: ['root'], query: '', highlightQuery: '世界',
      t: createTranslator('zh-CN'), scrollKey: 'search-test', workspaceId: 'test',
      onAddNode: async () => undefined, onDeleteNode: async () => undefined, onDuplicateNode: async () => undefined,
      onExpandedIdsChange: vi.fn(), onMoveNode: vi.fn(), onQueryChange: vi.fn(), onSelectId: vi.fn(), onToggleEnabled: vi.fn(),
    }
    const html = renderToStaticMarkup(createElement(ContextAssetExplorer, props))
    expect(html).toContain('<mark>世界</mark>观.md')
    expect(html).toContain('酒馆.md')
    expect(renderToStaticMarkup(createElement(ContextAssetExplorer, { ...props, highlightQuery: '' }))).not.toContain('<mark>')
  })
})
