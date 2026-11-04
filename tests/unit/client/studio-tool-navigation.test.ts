// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { useStudioNavigation } from '../../../apps/studio-client/src/shared/studio-shell/use-studio-navigation.js'
import { restoreStudioWorkspace, readStudioWorkspace, resolveStudioWorkspace, studioHistoryState } from '../../../apps/studio-client/src/shared/studio-shell/studio-workspace.js'

import { useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'

beforeEach(() => useStudioLayoutStore.setState({ panelPositions: {} }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const origin = { panel: 'resource' as const, search: 'q=dragon', resourceId: 'lore', assetId: 'entry', timelineId: 'story', branchId: 'branch' }

describe('Studio tool navigation', () => {
  it.each(['model', 'settings', 'extensions', 'recent'] as const)('%s preserves the editor through open, back/forward and close', async tool => {
    let navigation!: ReturnType<typeof useStudioNavigation>
    function Page() {
      navigation = useStudioNavigation({ endpoint: '/tool-test', api: {} as StudioApi })
      return null
    }
    const router = createMemoryRouter([{ path: '*', Component: Page }], {
      initialEntries: [{ pathname: '/studio', state: studioHistoryState('/tool-test', origin) }],
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RouterProvider, { router })) })
      await act(async () => { await navigation.openStoryExtensions() })
      expect(navigation.route).toEqual({ ...origin, tool: 'extensions', toolSearch: 'extensionView=participation' })
      expect(navigation.toolSearchParams.get('extensionView')).toBe('participation')
      await act(async () => { await navigation.closeTool() })
      await act(async () => { await navigation.openPanel(tool) })
      expect(navigation.route).toEqual({ ...origin, tool, ...(tool === 'extensions' ? { toolSearch: 'extensionView=participation' } : {}) })
      expect(restoreStudioWorkspace('/tool-test')).toEqual(origin)
      await act(async () => { await router.navigate(-1) })
      expect(navigation.route).toEqual(origin)
      await act(async () => { await router.navigate(1) })
      expect(navigation.route).toEqual({ ...origin, tool, ...(tool === 'extensions' ? { toolSearch: 'extensionView=participation' } : {}) })
      await act(async () => { await navigation.closeTool() })
      expect(navigation.route).toEqual(origin)
      await act(async () => { await navigation.openPath(`/studio/${tool === 'model' ? 'models' : tool}`) })
      expect(navigation.route).toEqual({ ...origin, tool })
      await act(async () => { await navigation.openPath('/studio/extensions?packageId=example.world') })
      expect(navigation.route).toEqual({ ...origin, tool: 'extensions', toolSearch: 'packageId=example.world' })
      expect(navigation.toolSearchParams.get('packageId')).toBe('example.world')
      expect(navigation.searchParams.get('q')).toBe('dragon')
      expect(restoreStudioWorkspace('/tool-test')).toEqual(origin)
      await act(async () => { await navigation.openExtensionWorkspace() })
      expect(navigation.route).toMatchObject({ panel: 'extensions', extensionWorkspace: true, search: '' })
      expect(navigation.route.tool).toBeUndefined()
      await act(async () => { await navigation.togglePanel('extensions') })
      expect(navigation.route).toMatchObject({ panel: 'extensions', extensionWorkspace: true, tool: 'extensions' })
      await act(async () => { await navigation.closeTool() })
      expect(navigation.route).toMatchObject({ panel: 'extensions', extensionWorkspace: true })
      await act(async () => { await navigation.openPanel('settings') })
      expect(navigation.route).toMatchObject({ panel: 'extensions', extensionWorkspace: true, tool: 'settings' })
      await act(async () => { await navigation.closeTool() })
      expect(navigation.route).toMatchObject({ panel: 'extensions', extensionWorkspace: true })
      expect(navigation.route.tool).toBeUndefined()
      await act(async () => { await navigation.closeExtensionWorkspace() })
      expect(navigation.route).toMatchObject({ panel: null, tool: 'extensions' })
      await act(async () => { await navigation.openResource('resource', 'editable', 'node') })
      expect(navigation.route).toMatchObject({ panel: 'resource', resourceId: 'editable', assetId: 'node' })
      expect(navigation.route.tool).toBeUndefined()
      await act(async () => { await navigation.openPanel('extensions') })
      await act(async () => { await navigation.openPath('/studio/logs?logPackage=example.world') })
      expect(navigation.route.panel).toBe('logs')
      expect(navigation.route.tool).toBeUndefined()
      if (tool === 'recent') {
        await act(async () => { await navigation.openSessionSummary('session-1') })
        expect(navigation.route.tool).toBe('recent')
        expect(navigation.toolSearchParams.get('historyTab')).toBe('sessions')
        expect(navigation.toolSearchParams.get('sessionId')).toBe('session-1')
        expect(navigation.toolSearchParams.get('sessionView')).toBe('summary')
        await act(async () => { await navigation.setToolSearchParams(new URLSearchParams({ historyTab: 'timelines' })) })
        expect(navigation.route.panel).toBe('logs')
        expect(navigation.toolSearchParams.get('historyTab')).toBe('timelines')
        await act(async () => { await navigation.openNarrative('selected-story', 'selected-branch') })
        expect(navigation.route.tool).toBeUndefined()
        expect(navigation.route).toMatchObject({ panel: 'logs', timelineId: 'selected-story', branchId: 'selected-branch' })
        await act(async () => { await navigation.openResource('resource', origin.resourceId, origin.assetId) })
      }
    } finally {
      act(() => root.unmount())
      router.dispose()
      container.remove()
      localStorage.removeItem('loom-studio-workspace:/tool-test')
    }
  })

  it('preserves the open Lore editor when switching to a saved story or a character preview', async () => {
    let navigation!: ReturnType<typeof useStudioNavigation>
    function Page() {
      navigation = useStudioNavigation({ endpoint: '/card-switch-test', api: {} as StudioApi })
      return null
    }
    const router = createMemoryRouter([{ path: '*', Component: Page }], {
      initialEntries: [{ pathname: '/studio', state: studioHistoryState('/card-switch-test', origin) }],
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RouterProvider, { router })) })
      await act(async () => { await navigation.openPanel('recent') })
      await act(async () => { await navigation.openNarrative('next-story', 'next-branch') })
      expect(navigation.route).toEqual({ ...origin, timelineId: 'next-story', branchId: 'next-branch' })
      await act(async () => { await navigation.openPanel('recent') })
      await act(async () => { await navigation.openCardPreview('preview-card') })
      const preview = { ...origin, previewCardId: 'preview-card', timelineId: undefined, branchId: undefined }
      expect(navigation.route).toEqual(preview)
      expect(restoreStudioWorkspace('/card-switch-test')).toEqual(preview)
    } finally {
      act(() => root.unmount())
      router.dispose()
      container.remove()
      localStorage.removeItem('loom-studio-workspace:/card-switch-test')
    }
  })

  it('opens a direct Model link over the last usable workspace', () => {
    expect(resolveStudioWorkspace({ pathname: '/studio/models', search: '', hash: '', state: null }, '/tool-test', origin))
      .toEqual({ ...origin, tool: 'model' })
    expect(resolveStudioWorkspace({ pathname: '/studio/models', search: '', hash: '', state: null }, '/empty'))
      .toEqual({ panel: null, search: '', tool: 'model' })
  })
  it('keeps extension deep-link queries separate from the underlying editor', () => {
    expect(resolveStudioWorkspace({ pathname: '/studio/extensions', search: '?packageId=world', hash: '', state: null }, '/tool-test', origin))
      .toEqual({ ...origin, tool: 'extensions', toolSearch: 'packageId=world' })
  })

  it('reads current tool fields without rewriting panel identities', () => {
    expect(readStudioWorkspace({ panel: 'extensions', search: 'packageId=world' }))
      .toEqual({ panel: 'extensions', search: 'packageId=world' })
    expect(readStudioWorkspace({ panel: 'settings', search: '' }))
      .toEqual({ panel: 'settings', search: '' })
    expect(readStudioWorkspace({ panel: 'extensions', search: '', extensionWorkspace: true }))
      .toEqual({ panel: 'extensions', search: '', extensionWorkspace: true })
  })

  it('opens the current history tool without redirecting old summary links', () => {
    expect(resolveStudioWorkspace({ pathname: '/studio/recent', search: '?historyTab=sessions&sessionId=s&sessionView=summary', hash: '', state: null }, '/tool-test', origin))
      .toEqual({ ...origin, tool: 'recent', toolSearch: 'historyTab=sessions&sessionId=s&sessionView=summary' })
    const summary = resolveStudioWorkspace({ pathname: '/studio/play', search: '?sessionId=s&sessionView=summary', hash: '', state: null }, '/tool-test', origin)
    expect(summary.panel).toBe('play')
    expect(summary.tool).toBeUndefined()
    expect(new URLSearchParams(summary.search).has('historyTab')).toBe(false)
  })

})
