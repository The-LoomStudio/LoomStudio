import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultStudioLayout,
  sanitizeStudioLayout,
  useStudioLayoutStore,
  useStudioPanelStore,
} from './studio-layout-store.js'

describe('studio layout store', () => {
  const storedValues = new Map<string, string>()

  beforeEach(() => {
    storedValues.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storedValues.get(key) ?? null,
      removeItem: (key: string) => storedValues.delete(key),
      setItem: vi.fn((key: string, value: string) => storedValues.set(key, value)),
    })
    useStudioLayoutStore.setState(createDefaultStudioLayout())
    useStudioPanelStore.setState({ activePanel: null })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps the Sidebar visibility independent from routed panels', () => {
    useStudioLayoutStore.getState().toggleDock()

    expect(useStudioLayoutStore.getState().dockOpen).toBe(true)

    useStudioLayoutStore.getState().toggleDock()

    expect(useStudioLayoutStore.getState().dockOpen).toBe(false)
  })

  it('switches workspace panels without changing persisted layout data', () => {
    const writesBefore = vi.mocked(localStorage.setItem).mock.calls.length
    const store = useStudioPanelStore.getState()

    store.togglePanel('character')
    expect(useStudioPanelStore.getState().activePanel).toBe('character')

    store.togglePanel('resource')
    expect(useStudioPanelStore.getState().activePanel).toBe('resource')

    store.closePanel()
    expect(useStudioPanelStore.getState().activePanel).toBeNull()
    expect(vi.mocked(localStorage.setItem).mock.calls.length).toBe(writesBefore)
  })

  it('keeps window and explorer layouts isolated by page', () => {
    const store = useStudioLayoutStore.getState()
    store.setPanelWindowSize('preset', { width: 920, height: 700 })
    store.setPanelWindowSize('character', { width: 1080, height: 760 })
    store.togglePanelWindowMode('preset')
    store.setAssetExplorerWidth('preset', 260)
    store.setAssetExplorerWidth('resources', 340)
    store.setAssetViewMode('preset', 'card-a', 'editor')
    store.setAssetViewMode('resources', 'card-a', 'split')
    store.setAssetViewMode('preset', 'card-b', 'explorer')
    store.setAssetSelectedId('preset', 'card-a', 'preset-entry-a')
    store.setAssetExpandedIds('preset', 'card-a', ['preset-root', 'preset-folder'])

    expect(useStudioLayoutStore.getState()).toMatchObject({
      assetLayouts: {
        preset: {
          explorerWidth: 260,
          views: {
            'card-a': {
              expandedIds: ['preset-root', 'preset-folder'],
              selectedId: 'preset-entry-a',
              viewMode: 'editor',
            },
            'card-b': { viewMode: 'explorer' },
          },
        },
        resources: { explorerWidth: 340, views: { 'card-a': { viewMode: 'split' } } },
      },
      panelWindowSizes: {
        preset: { width: 920, height: 700 },
        character: { width: 1080, height: 760 },
      },
      panelWindowModes: { preset: 'immersive' },
    })
  })

  it('keeps the metadata drawer state global across asset pages', () => {
    useStudioLayoutStore.getState().setAssetMetadataOpen(true)
    useStudioLayoutStore.getState().setTextEditorMode('preview')
    expect(useStudioLayoutStore.getState().assetMetadataOpen).toBe(true)
    expect(useStudioLayoutStore.getState().textEditorMode).toBe('preview')
  })

  it('opens an asset detail with one persisted layout update', () => {
    const setItem = vi.mocked(localStorage.setItem)
    const writesBefore = setItem.mock.calls.length

    useStudioLayoutStore.getState().openAssetDetail('resources', 'card-a', 'entry-a')

    expect(useStudioLayoutStore.getState().assetLayouts.resources.views['card-a']).toEqual({
      selectedId: 'entry-a',
      viewMode: 'split',
    })
    expect(setItem.mock.calls.length - writesBefore).toBe(1)
  })

  it('rehydrates the persisted layout after a reload', async () => {
    useStudioLayoutStore.getState().toggleDock()
    useStudioLayoutStore.getState().setAssetMetadataOpen(true)
    useStudioLayoutStore.getState().setAssetExplorerWidth('resources', 360)
    useStudioLayoutStore.getState().setAssetSelectedId('resources', 'card-a', 'resource-entry-a')
    useStudioLayoutStore.getState().setAssetExpandedIds('resources', 'card-a', ['resource-root', 'resource-folder'])
    useStudioLayoutStore.getState().setAssetViewMode('resources', 'card-a', 'split')
    useStudioLayoutStore.getState().togglePanelWindowMode('character')
    const persisted = storedValues.get('loom-studio-layout')
    expect(persisted).toBeDefined()

    useStudioLayoutStore.setState(createDefaultStudioLayout())
    storedValues.set('loom-studio-layout', persisted!)
    await useStudioLayoutStore.persist.rehydrate()

    expect(useStudioLayoutStore.getState()).toMatchObject({
      assetMetadataOpen: true,
      assetLayouts: {
        resources: {
          explorerWidth: 360,
          views: {
            'card-a': {
              expandedIds: ['resource-root', 'resource-folder'],
              selectedId: 'resource-entry-a',
              viewMode: 'split',
            },
          },
        },
      },
      dockOpen: true,
      panelWindowModes: { character: 'immersive' },
    })
  })

  it('migrates legacy model, character and resource panel ids without changing asset layouts', () => {
    expect(sanitizeStudioLayout({
      activePanel: 'api',
      assetLayouts: { resources: { explorerWidth: 340, views: {} } },
      lastActivePanel: 'editor',
      panelWindowModes: { api: 'reference', resources: 'immersive', editor: 'reference' },
      panelWindowSizes: {
        api: { width: 720, height: 600 },
        resources: { width: 1080, height: 760 },
        editor: { width: 900, height: 640 },
      },
    })).toMatchObject({
      assetLayouts: { resources: { explorerWidth: 340, views: {} } },
      panelWindowModes: { model: 'reference', character: 'immersive', resource: 'reference' },
      panelWindowSizes: {
        model: { width: 720, height: 600 },
        character: { width: 1080, height: 760 },
        resource: { width: 900, height: 640 },
      },
    })
  })
})

describe('sanitizeStudioLayout', () => {
  it('keeps valid preferences and rejects malformed persisted values', () => {
    expect(sanitizeStudioLayout({
      assetMetadataOpen: true,
      assetLayouts: {
        preset: { explorerOpen: false, explorerWidth: 280 },
        resources: { explorerOpen: 'yes', explorerWidth: -10 },
      },
      contextCategory: 'history',
      dockOpen: false,
      lastActivePanel: 'unknown',
      panelWindowSizes: {
        preset: { width: 900, height: 680 },
        resources: { width: Number.NaN, height: 600 },
      },
      panelWindowModes: {
        preset: 'immersive',
        resources: 'oversized',
      },
      presetPanel: 'order',
      textEditorMode: 'preview',
    })).toEqual({
      assetMetadataOpen: true,
      assetLayouts: {
        preset: { explorerWidth: 280, views: {} },
        resources: { explorerWidth: 300, views: {} },
      },
      contextCategory: 'history',
      dockOpen: false,
      panelWindowModes: { preset: 'immersive' },
      panelWindowSizes: {
        preset: { width: 900, height: 680 },
      },
      presetPanel: 'order',
      textEditorMode: 'preview',
    })
  })

  it('keeps valid asset view state scoped by workspace', () => {
    expect(sanitizeStudioLayout({
      assetLayouts: {
        preset: {
          explorerWidth: 240,
          views: {
            'card-a': {
              expandedIds: ['root', 'folder', 'root', 42],
              selectedId: 'entry-a',
              viewMode: 'split',
            },
          },
        },
        resources: {
          explorerWidth: 320,
          views: {
            'card-b': { selectedId: '', viewMode: 'editor' },
            broken: { viewMode: 'unknown' },
          },
        },
      },
    }).assetLayouts).toEqual({
      preset: {
        explorerWidth: 240,
        views: {
          'card-a': {
            expandedIds: ['root', 'folder'],
            selectedId: 'entry-a',
            viewMode: 'split',
          },
        },
      },
      resources: { explorerWidth: 320, views: { 'card-b': { viewMode: 'editor' } } },
    })
  })

  it('falls back to defaults when persisted data is not an object', () => {
    expect(sanitizeStudioLayout('broken')).toEqual(createDefaultStudioLayout())
  })
})
