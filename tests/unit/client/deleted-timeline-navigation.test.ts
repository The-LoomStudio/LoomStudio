import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudioWorkspace } from '../../../apps/studio-client/src/shared/studio-shell/studio-workspace.js'
import { studioHistoryState } from '../../../apps/studio-client/src/shared/studio-shell/studio-workspace.js'
import { useStudioNavigation } from '../../../apps/studio-client/src/shared/studio-shell/use-studio-navigation.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

const fixture = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { key: 'initial', pathname: '/studio', search: '', hash: '', state: {} as unknown },
}))
vi.mock('react-router-dom', () => ({
  useLocation: () => fixture.location,
  useNavigate: () => fixture.navigate,
  useNavigationType: () => 'PUSH',
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: () => undefined,
}))

const workspace: StudioWorkspace = {
  panel: 'play', search: '', cardId: 'other-card',
  timelineId: 'deleted', branchId: 'branch', nodeId: 'node',
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.location.state = studioHistoryState('/rpc', workspace)
})
const navigation = () => useStudioNavigation({ endpoint: '/rpc', api: {} as StudioApi })

describe('Deleted Timeline navigation', () => {
  it('replaces deleted narrative context with its source-card preview without closing the panel', () => {
    navigation().clearDeletedTimeline('deleted', 'source-card')
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith('/studio', {
      replace: true,
      state: studioHistoryState('/rpc', {
        ...workspace, cardId: 'source-card',
        timelineId: undefined, branchId: undefined, nodeId: undefined,
      }),
    })
  })

  it('does not navigate away from a different Timeline selected during deletion', () => {
    const nav = navigation()
    nav.openNarrative('new', 'new-branch')
    fixture.navigate.mockClear()
    nav.clearDeletedTimeline('deleted', 'source-card')
    expect(fixture.navigate).not.toHaveBeenCalled()
  })
})
