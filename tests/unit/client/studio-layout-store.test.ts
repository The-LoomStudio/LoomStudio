import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultStudioLayout,
  sanitizeStudioLayout,
  useStudioLayoutStore,
  useStudioPanelStore,
} from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'

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

  it('persists view preferences while keeping route positions session-only', async () => {
    const store = useStudioLayoutStore.getState()
    store.setViewPreference('preset.configuration', 'tools')
    store.rememberPanelPosition('endpoint/card/logs', { search: 'logView=model' })
    const key = useStudioLayoutStore.persist.getOptions().name
    const saved = storedValues.get(key)!
    expect(JSON.parse(saved).state.viewPreferences).toEqual({ 'preset.configuration': 'tools' })
    expect(JSON.parse(saved).state.panelPositions).toBeUndefined()
    useStudioLayoutStore.setState({ viewPreferences: {} })
    storedValues.set(key, saved)
    await useStudioLayoutStore.persist.rehydrate()
    expect(useStudioLayoutStore.getState().viewPreferences['preset.configuration']).toBe('tools')
    expect(sanitizeStudioLayout({ viewPreferences: { valid: 'tools', invalid: {} } }).viewPreferences).toEqual({ valid: 'tools' })
  })

  it('pins the Composer by default without overriding an explicit immersive preference', () => {
    expect(createDefaultStudioLayout().composerPinned).toBe(true)
    expect(sanitizeStudioLayout({}).composerPinned).toBe(true)
    expect(sanitizeStudioLayout({ composerPinned: false }).composerPinned).toBe(false)
  })

  it('persists and rehydrates both Composer pin states', async () => {
    const key = useStudioLayoutStore.persist.getOptions().name
    if (!key) throw new Error('Layout persistence requires a storage key')
    for (const pinned of [true, false]) {
      useStudioLayoutStore.setState({ composerPinned: pinned })
      const saved = storedValues.get(key)!
      expect(JSON.parse(saved).state.composerPinned).toBe(pinned)
      useStudioLayoutStore.setState({ composerPinned: !pinned })
      storedValues.set(key, saved)
      await useStudioLayoutStore.persist.rehydrate()
      expect(useStudioLayoutStore.getState().composerPinned).toBe(pinned)
    }
  })

  it('keeps the Sidebar visibility independent from routed panels', () => {
    useStudioLayoutStore.getState().toggleDock()

    expect(useStudioLayoutStore.getState().dockOpen).toBe(true)

    useStudioLayoutStore.getState().toggleDock()

    expect(useStudioLayoutStore.getState().dockOpen).toBe(false)
  })

  it('toggles dockPinned preference independently', () => {
    expect(useStudioLayoutStore.getState().dockPinned).toBe(true)

    useStudioLayoutStore.getState().toggleDockPinned()
    expect(useStudioLayoutStore.getState().dockPinned).toBe(false)

    useStudioLayoutStore.getState().toggleDockPinned()
    expect(useStudioLayoutStore.getState().dockPinned).toBe(true)
  })

  it('keeps window immersive mode global across all panel switches', () => {
    const layout = useStudioLayoutStore.getState()
    const panels = useStudioPanelStore.getState()

    expect(layout.panelWindowMode).toBe('reference')

    layout.togglePanelWindowMode()
    expect(useStudioLayoutStore.getState().panelWindowMode).toBe('immersive')

    panels.syncActivePanel('agent')
    expect(useStudioLayoutStore.getState().panelWindowMode).toBe('immersive')

    panels.syncActivePanel('character')
    expect(useStudioLayoutStore.getState().panelWindowMode).toBe('immersive')

    panels.syncActivePanel('sessions')
    expect(useStudioLayoutStore.getState().panelWindowMode).toBe('immersive')

    useStudioLayoutStore.getState().togglePanelWindowMode()
    expect(useStudioLayoutStore.getState().panelWindowMode).toBe('reference')
    expect(useStudioLayoutStore.getState()).not.toHaveProperty('panelWindowModes')
    expect(JSON.parse(storedValues.get('loom-studio-layout')!).state).not.toHaveProperty('panelWindowModes')
  })

  it('switches workspace panels without changing persisted layout data', () => {
    const writesBefore = vi.mocked(localStorage.setItem).mock.calls.length
    const store = useStudioPanelStore.getState()

    store.syncActivePanel('character')
    expect(useStudioPanelStore.getState().activePanel).toBe('character')

    store.syncActivePanel('resource')
    expect(useStudioPanelStore.getState().activePanel).toBe('resource')

    store.syncActivePanel(null)
    expect(useStudioPanelStore.getState().activePanel).toBeNull()
    expect(vi.mocked(localStorage.setItem).mock.calls.length).toBe(writesBefore)
  })

  it('keeps window and explorer layouts isolated by page', () => {
    const store = useStudioLayoutStore.getState()
    store.setPanelWindowSize('preset', { width: 920, height: 700 })
    store.setRailWidth(224)
    store.setPanelWindowSize('character', { width: 1080, height: 760 })
    store.togglePanelWindowMode()
    store.setAssetExplorerWidth('preset', 260)
    store.setAssetExplorerWidth('resources', 340)
    store.setAssetViewMode('preset', 'card-a', 'master-detail')
    store.setAssetViewMode('resources', 'card-a', 'drilldown')
    store.setAssetViewMode('preset', 'card-b', 'drilldown')
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
              viewMode: 'master-detail',
            },
            'card-b': { viewMode: 'drilldown' },
          },
        },
        resources: { explorerWidth: 340, views: { 'card-a': { viewMode: 'drilldown' } } },
      },
      panelWindowSizes: {
        preset: { width: 920, height: 700 },
        character: { width: 1080, height: 760 },
      },
      panelWindowMode: 'immersive',
      railWidth: 224,
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
      viewMode: 'master-detail',
    })
    expect(setItem.mock.calls.length - writesBefore).toBe(1)
  })

  it('rehydrates the persisted layout after a reload', async () => {
    useStudioLayoutStore.getState().toggleDock()
    useStudioLayoutStore.getState().setAssetMetadataOpen(true)
    useStudioLayoutStore.getState().setAssetExplorerWidth('resources', 360)
    useStudioLayoutStore.getState().setAssetSelectedId('resources', 'card-a', 'resource-entry-a')
    useStudioLayoutStore.getState().setAssetExpandedIds('resources', 'card-a', ['resource-root', 'resource-folder'])
    useStudioLayoutStore.getState().setAssetViewMode('resources', 'card-a', 'master-detail')
    useStudioLayoutStore.getState().togglePanelWindowMode()
    useStudioLayoutStore.getState().setRailWidth(208)
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
              viewMode: 'master-detail',
            },
          },
        },
      },
      dockOpen: true,
      panelWindowMode: 'immersive',
      railWidth: 208,
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
      panelWindowMode: 'immersive',
      panelWindowSizes: {
        model: { width: 720, height: 600 },
        character: { width: 1080, height: 760 },
        resource: { width: 900, height: 640 },
      },
    })
    expect(sanitizeStudioLayout({
      panelWindowModes: { character: 'reference', resources: 'immersive' },
    }).panelWindowMode).toBe('reference')
  })
})

describe('sanitizeStudioLayout', () => {
  it('ignores removed play tab preferences', () => {
    expect(sanitizeStudioLayout({ playTab: 'recent' })).not.toHaveProperty('playTab')
    expect(sanitizeStudioLayout({ playTab: 'sessions' })).not.toHaveProperty('playTab')
  })

  it('keeps valid preferences and rejects malformed persisted values', () => {
    expect(sanitizeStudioLayout({
      assetMetadataOpen: true,
      assetPanes: { preset: {}, resources: {} },
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
      uiScale: 100,
    })).toEqual({
      ...createDefaultStudioLayout(),
      assetMetadataOpen: true,
      assetLayouts: {
        preset: { explorerWidth: 280, views: {} },
        resources: { explorerWidth: 300, views: {} },
      },
      contextCategory: 'history',
      panelWindowMode: 'immersive',
      panelWindowSizes: {
        preset: { width: 900, height: 680 },
      },
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
              viewMode: 'master-detail',
            },
          },
        },
        resources: {
          explorerWidth: 320,
          views: {
            'card-b': { selectedId: '', viewMode: 'drilldown' },
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
            viewMode: 'master-detail',
          },
        },
      },
      resources: { explorerWidth: 320, views: { 'card-b': { viewMode: 'drilldown' } } },
    })
  })

  it('falls back to defaults when persisted data is not an object', () => {
    expect(sanitizeStudioLayout('broken')).toEqual(createDefaultStudioLayout())
  })

  it('keeps readable Rail widths and snaps the unreadable range to icon mode', () => {
    expect(sanitizeStudioLayout({ railWidth: 240 }).railWidth).toBe(240)
    expect(sanitizeStudioLayout({ railWidth: 70 }).railWidth).toBe(42)
    expect(sanitizeStudioLayout({ railWidth: 900 }).railWidth).toBe(320)
  })

  it('clamps and snaps the persisted interface scale', () => {
    expect(sanitizeStudioLayout({ uiScale: 117 }).uiScale).toBe(115)
    expect(sanitizeStudioLayout({ uiScale: 40 }).uiScale).toBe(80)
    expect(sanitizeStudioLayout({ uiScale: 180 }).uiScale).toBe(125)
  })

  it('manages transient workbenchNavigation without persisting it', () => {
    expect(useStudioLayoutStore.getState().workbenchNavigation).toBeNull()
    const nav = {
      canGoBack: () => true,
      goBack: () => true,
      canGoForward: () => false,
      goForward: () => false,
    }
    useStudioLayoutStore.getState().setWorkbenchNavigation(nav)
    expect(useStudioLayoutStore.getState().workbenchNavigation).toBe(nav)
    useStudioLayoutStore.getState().setWorkbenchNavigation(null)
    expect(useStudioLayoutStore.getState().workbenchNavigation).toBeNull()
  })
})
