// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudioWorkspace } from '../../../apps/studio-client/src/shared/studio-shell/studio-workspace.js'
import { studioHistoryState } from '../../../apps/studio-client/src/shared/studio-shell/studio-workspace.js'
import { useStudioNavigation } from '../../../apps/studio-client/src/shared/studio-shell/use-studio-navigation.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { renderHook } from '../../support/client/render-hook.js'

const fixture = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { key: 'initial', pathname: '/studio', search: '', hash: '', state: {} as unknown },
}))
vi.mock('react-router-dom', async original => ({
  ...await original<typeof import('react-router-dom')>(),
  useLocation: () => fixture.location,
  useNavigate: () => fixture.navigate,
  useNavigationType: () => 'PUSH',
}))

const workspace: StudioWorkspace = {
  panel: 'sessions', search: '', cardId: 'other-card',
  timelineId: 'deleted', branchId: 'branch', nodeId: 'node',
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.location.state = studioHistoryState('/rpc', workspace)
})

describe('Deleted Timeline navigation', () => {
  it('invalidates callbacks from the previous workspace as soon as newer navigation is published', () => {
    const harness = renderHook(() => useStudioNavigation({ endpoint: '/rpc', api: {} as StudioApi }))
    expect(harness.current.isCurrent()).toBe(true)
    harness.current.openPanel('model')
    expect(harness.current.isCurrent()).toBe(false)
    harness.unmount()
  })

  it('replaces deleted narrative context with its source-card preview and closes the panel', () => {
    const harness = renderHook(() => useStudioNavigation({ endpoint: '/rpc', api: {} as StudioApi }))
    harness.current.clearDeletedTimeline('deleted', 'source-card')
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith('/studio', {
      replace: true,
      state: studioHistoryState('/rpc', {
        ...workspace, panel: null, previewCardId: 'source-card',
        timelineId: undefined, branchId: undefined, nodeId: undefined,
      }),
    })
    harness.unmount()
  })

  it('opens a card preview without changing the browsing panel or card', () => {
    const harness = renderHook(() => useStudioNavigation({ endpoint: '/rpc', api: {} as StudioApi }))
    harness.current.openCardPreview('preview-card')
    expect(fixture.navigate).toHaveBeenCalledWith('/studio', {
      replace: false,
      state: studioHistoryState('/rpc', {
        ...workspace, previewCardId: 'preview-card', timelineId: undefined, branchId: undefined, nodeId: undefined,
      }),
    })
    harness.unmount()
  })

  it('does not close a newer panel opened while deletion was pending', () => {
    const harness = renderHook(() => useStudioNavigation({ endpoint: '/rpc', api: {} as StudioApi }))
    harness.current.openPanel('model')
    fixture.navigate.mockClear()
    harness.current.clearDeletedTimeline('deleted', 'source-card')
    expect(fixture.navigate).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('does not navigate away from a different Timeline selected during deletion', () => {
    const harness = renderHook(() => useStudioNavigation({ endpoint: '/rpc', api: {} as StudioApi }))
    harness.current.openNarrative('new', 'new-branch')
    fixture.navigate.mockClear()
    harness.current.clearDeletedTimeline('deleted', 'source-card')
    expect(fixture.navigate).not.toHaveBeenCalled()
    harness.unmount()
  })
})


describe('Preset library navigation', () => {
  it.each([true, false])('clears explicit or legacy node targets without losing the story or search: resource id %s', hasResourceId => {
    const position = { ...workspace, panel: 'agent' as const, search: 'q=writer', resourceId: hasResourceId ? 'preset' : undefined, assetId: 'message' }
    fixture.location.state = studioHistoryState('/rpc', position)
    const harness = renderHook(() => useStudioNavigation({ endpoint: '/rpc', api: {} as StudioApi }))
    harness.current.clearResourceTarget('unrelated-resource')
    expect(fixture.navigate).not.toHaveBeenCalled()
    harness.current.clearResourceTarget()
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith('/studio', {
      replace: true,
      state: studioHistoryState('/rpc', { ...position, resourceId: undefined, assetId: undefined, referenceUri: undefined, targetUri: undefined }),
    })
    harness.unmount()
  })
})
