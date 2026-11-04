// @vitest-environment happy-dom
import { act, createElement, Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGlobalSearchStore } from '../../../apps/studio-client/src/features/global-search/model/global-search-store.js'
import { ContextAssetExplorer } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-workbench.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { GlobalSearchOverlay } from '../../../apps/studio-client/src/features/global-search/ui/global-search-overlay.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

afterEach(() => {
  useGlobalSearchStore.setState({ byEndpoint: {} })
  useGlobalSearchStore.persist.clearStorage()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('workspace search state', () => {
  it('keeps candidate changes in memory and persists committed query and filters', () => {
    const writes = vi.spyOn(localStorage, 'setItem')
    const dispatch = useGlobalSearchStore.getState().dispatch
    dispatch('one', { type: 'input', value: '王都' })
    const saved = localStorage.getItem('loom-studio-global-search')
    writes.mockClear()
    dispatch('one', { type: 'mode', mode: 'scopes' })
    dispatch('one', { type: 'input', value: '北' })
    dispatch('one', { type: 'input', value: '北境' })
    dispatch('one', { type: 'mode', mode: 'types' })
    dispatch('one', { type: 'input', value: 'Lore' })
    expect(writes).not.toHaveBeenCalled()
    expect(localStorage.getItem('loom-studio-global-search')).toBe(saved)
    expect(useGlobalSearchStore.getState().byEndpoint.one).toMatchObject({ query: '王都', mode: 'types', candidateQuery: 'Lore' })
    dispatch('one', { type: 'kind', kind: 'lore' })
    expect(writes).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('loom-studio-global-search')!).state.byEndpoint.one).toMatchObject({ query: '王都', kind: 'lore', mode: 'results', candidateQuery: '' })
    writes.mockClear()
    const snapshot = useGlobalSearchStore.getState()
    dispatch('one', { type: 'input', value: '王都' })
    expect(useGlobalSearchStore.getState()).toBe(snapshot)
    expect(writes).not.toHaveBeenCalled()
  })

  it('updates the overlay for candidates, debounce and query data without rerendering its query-only parent', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const api = { globalSearch: { search: vi.fn(), scopes: vi.fn() } } as unknown as StudioApi
    const t = createTranslator('zh-CN')
    let parentRenders = 0
    let overlayCommits = 0
    function Parent() {
      useGlobalSearchStore(store => store.byEndpoint.one?.query ?? '')
      parentRenders += 1
      return createElement(Profiler, { id: 'search', onRender: () => { overlayCommits += 1 } },
        createElement(GlobalSearchOverlay, { api, endpoint: 'one', open: false, recent: [], t,
          onClose: () => {}, onOpenPanel: () => {}, onOpenResult: () => {} }))
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Parent))))
      const baselineRenders = parentRenders
      const baselineCommits = overlayCommits
      await act(async () => {
        const dispatch = useGlobalSearchStore.getState().dispatch
        dispatch('one', { type: 'mode', mode: 'scopes' })
        dispatch('one', { type: 'input', value: '北境' })
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(160) })
      const afterDebounce = overlayCommits
      await act(async () => {
        client.setQueryData(['global-search', 'one', 'scopes', '北境', undefined, undefined], {
          pages: [{ items: [{ kind: 'resource', id: 'north', label: '北境' }], diagnostics: [] }], pageParams: [undefined],
        })
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(afterDebounce).toBeGreaterThan(baselineCommits)
      expect(overlayCommits).toBeGreaterThan(afterDebounce)
      expect(parentRenders).toBe(baselineRenders)
      await act(async () => useGlobalSearchStore.getState().dispatch('one', { type: 'mode', mode: 'results' }))
      await act(async () => useGlobalSearchStore.getState().dispatch('one', { type: 'input', value: '已提交查询' }))
      expect(parentRenders).toBeGreaterThan(baselineRenders)
    } finally {
      await act(async () => root.unmount())
      client.clear()
    }
  })

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
