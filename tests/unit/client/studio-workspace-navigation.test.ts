import { createMemoryRouter, matchRoutes } from '../../../apps/studio-client/node_modules/react-router-dom/dist/index.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STUDIO_ENTRY_PATHS } from '../../../apps/studio-client/src/shared/studio-shell/studio-route.js'
import {
  persistStudioWorkspace, readStudioWorkspace, resolveStudioWorkspace, restoreStudioWorkspace, studioHistoryState,
  type StudioWorkspace,
} from '../../../apps/studio-client/src/shared/studio-shell/studio-workspace.js'

const entry = { pathname: '/studio', search: '', hash: '', state: null }
const position: StudioWorkspace = {
  panel: 'resource', timelineId: 'timeline', branchId: 'branch',
  cardId: 'card', resourceId: 'setting', assetId: 'root', search: 'q=hello',
}

afterEach(() => vi.unstubAllGlobals())

describe('Studio workspace navigation', () => {
  it('restores same-URL history positions without losing Timeline/Branch', async () => {
    const router = createMemoryRouter([{ path: '*', Component: () => null }], {
      initialEntries: [{ pathname: '/studio', state: studioHistoryState('/rpc', { panel: null, timelineId: 'timeline', branchId: 'branch', search: '' }) }],
    })
    try {
      await router.navigate('/studio', { state: studioHistoryState('/rpc', position) })
      await router.navigate('/studio', { state: studioHistoryState('/rpc', { ...position, panel: 'state' }) })
      await router.navigate(-1)
      expect(resolveStudioWorkspace(router.state.location, '/rpc')).toEqual(position)
      await router.navigate(-1)
      expect(resolveStudioWorkspace(router.state.location, '/rpc')).toMatchObject({ panel: null, timelineId: 'timeline', branchId: 'branch' })
      await router.navigate(1)
      expect(resolveStudioWorkspace(router.state.location, '/rpc')).toEqual(position)
      expect(router.state.location.pathname).toBe('/studio')
      expect(router.state.location.search).toBe('')
    } finally { router.dispose() }
  })

  it('gives explicit links precedence over history and persisted workspace', () => {
    const uri = 'loom-resource://entity?type=resource&id=explicit'
    expect(resolveStudioWorkspace({
      ...entry, search: `?target=${encodeURIComponent(uri)}`, state: studioHistoryState('/rpc', position),
    }, '/rpc', position)).toEqual({ panel: null, search: '', targetUri: uri })
    expect(resolveStudioWorkspace({ ...entry, pathname: '/studio/chat/other/branch/other-branch' }, '/rpc', position))
      .toEqual({ panel: null, timelineId: 'other', branchId: 'other-branch', search: '' })
  })

  it('prefers this tab history over last workspace, and isolates API endpoints', () => {
    const history = { ...position, panel: 'state' as const }
    expect(resolveStudioWorkspace({ ...entry, state: studioHistoryState('/rpc', history) }, '/rpc', position)).toEqual(history)
    expect(resolveStudioWorkspace({ ...entry, state: studioHistoryState('/other', history) }, '/rpc', position)).toEqual(position)
    expect(resolveStudioWorkspace(entry, '/rpc', position)).toEqual(position)
    expect(resolveStudioWorkspace(entry, '/rpc')).toEqual({ panel: null, search: '' })
  })

  it('persists only usable positions, not reference dialogs or unresolved targets', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    })
    persistStudioWorkspace('/rpc', { ...position, referenceUri: 'loom-resource://entity?type=card&id=card' })
    expect(restoreStudioWorkspace('/rpc')).toEqual(position)
    expect(restoreStudioWorkspace('/other')).toBeUndefined()
    persistStudioWorkspace('/rpc', { panel: null, search: '', targetUri: 'invalid' })
    expect(restoreStudioWorkspace('/rpc')).toEqual(position)
    storage.set('loom-studio-workspace:/rpc', '{invalid')
    expect(restoreStudioWorkspace('/rpc')).toBeUndefined()
  })

  it.each([null, { panel: 'unknown' }, { panel: null, branchId: 'branch' }, { panel: 'resource', resourceId: {} }])(
    'rejects invalid persisted navigation %j', value => expect(readStudioWorkspace(value)).toBeUndefined(),
  )

  it('registers every panel entry including play, state and text transforms', () => {
    const routes = STUDIO_ENTRY_PATHS.map(path => ({ path }))
    for (const path of ['/', '/studio', '/studio/play', '/studio/state', '/studio/text-transforms']) {
      expect(matchRoutes(routes, path), path).not.toBeNull()
    }
    expect(matchRoutes(routes, '/studio/not-a-panel')).toBeNull()
  })
})
