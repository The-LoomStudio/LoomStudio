// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { useStudioNavigation } from '../../../apps/studio-client/src/shared/studio-shell/use-studio-navigation.js'
import { useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'
import { studioHistoryState, type StudioWorkspace } from '../../../apps/studio-client/src/shared/studio-shell/studio-workspace.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const endpoint = '/navigation-intents'
const origin: StudioWorkspace = { panel: null, search: '', timelineId: 'old', branchId: 'branch' }
async function withNavigation(run: (get: () => ReturnType<typeof useStudioNavigation>, router: ReturnType<typeof createMemoryRouter>) => Promise<void>, api = {} as StudioApi, position = origin, path = '/studio') {
  let navigation!: ReturnType<typeof useStudioNavigation>
  function Page() { navigation = useStudioNavigation({ endpoint, api }); return null }
  useStudioLayoutStore.setState({ panelPositions: {} })
  const router = createMemoryRouter([{ path: '*', Component: Page }], { initialEntries: [{ pathname: path, state: studioHistoryState(endpoint, position) }] })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(RouterProvider, { router })))
    await run(() => navigation, router)
  } finally {
    act(() => root.unmount()); router.dispose(); host.remove()
    localStorage.removeItem(`loom-studio-workspace:${endpoint}`)
  }
}

describe('Shell navigation ownership', () => {
  it('keeps preview identity independent from browsing and restores it with history', async () => {
    await withNavigation(async (get, router) => {
      await act(async () => get().openCardPreview('preview-a'))
      await act(async () => get().openPanel('character', { cardId: 'browse-b' }))
      expect(get().route).toMatchObject({ cardId: 'browse-b', previewCardId: 'preview-a' })
      await act(async () => get().openCardPreview('preview-c'))
      await act(async () => router.navigate(-1))
      expect(get().route).toMatchObject({ cardId: 'browse-b', previewCardId: 'preview-a' })
    })
  })

  it('normalizes the old rule entry once and allows the tool to close', async () => {
    await withNavigation(async (get, router) => {
      expect(router.state.location.pathname).toBe('/studio')
      expect(get().route).toMatchObject({ panel: null, tool: 'extensions' })
      expect(get().toolSearchParams.get('ruleInspector')).toBe('1')
      const key = router.state.location.key
      await act(async () => Promise.resolve())
      expect(router.state.location.key).toBe(key)
      await act(async () => get().closeTool())
      expect(get().route.tool).toBeUndefined()
    }, undefined, origin, '/studio/text-transforms')
  })

  it('separates extension workspace and tool memories', async () => {
    await withNavigation(async get => {
      await act(async () => get().openExtensionWorkspace())
      await act(async () => get().openPanel('extensions', { search: 'extensionView=scripts&scriptFilter=rules' }))
      await act(async () => get().openPanel('settings'))
      await act(async () => get().closeTool())
      await act(async () => get().openPanel('extensions'))
      expect(get().toolSearchParams.get('extensionView')).toBe('scripts')
      expect(get().route.extensionWorkspace).toBe(true)
    })
  })

  it('lets the newest pending selection win while temporary tools remain open', async () => {
    await withNavigation(async get => {
      const first = get().beginTargetNavigation()
      const latest = get().beginTargetNavigation()
      await act(async () => get().openPanel('settings'))
      expect(first()).toBe(false)
      expect(latest()).toBe(true)
      await act(async () => get().openResource('resource', 'chosen', 'node', false, true))
      expect(get().route).toMatchObject({ resourceId: 'chosen', tool: 'settings' })
      const cancelled = get().beginTargetNavigation()
      await act(async () => get().returnToReading())
      expect(cancelled()).toBe(false)
    })
  })

  it.each(['complete', 'cancel'] as const)('resolves an external target without taking over later tools: %s', async mode => {
    const pending = Promise.withResolvers<{ timeline: { id: string; activeBranchId: string }; branches: { id: string }[] }>()
    const read = vi.fn(() => pending.promise)
    await withNavigation(async get => {
      await act(async () => get().openUri('loom-resource://entity?type=timeline&id=new'))
      await act(async () => get().openPanel('settings'))
      expect(read).toHaveBeenCalledTimes(1)
      if (mode === 'cancel') await act(async () => get().returnToReading())
      await act(async () => pending.resolve({ timeline: { id: 'new', activeBranchId: 'b' }, branches: [{ id: 'b' }] }))
      if (mode === 'complete') expect(get().route).toMatchObject({ timelineId: 'new', tool: 'settings' })
      else expect(get().route.timelineId).not.toBe('new')
    }, { narratives: { get: read } } as unknown as StudioApi)
  })

  it('clears deleted objects in the latest location without disturbing another tool', async () => {
    await withNavigation(async get => {
      const deletion = get().clearDeletedCards
      await act(async () => get().openPanel('settings'))
      await act(async () => deletion(['card'], ['old']))
      expect(get().route.timelineId).toBeUndefined()
      expect(get().route.tool).toBe('settings')
    })
  })
})
