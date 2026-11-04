// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StudioPanelHost } from '../../../apps/studio-client/src/pages/studio/studio-panel-host.js'
import { MasterDetailWorkbench } from '../../../apps/studio-client/src/shared/ui/master-detail-workbench/master-detail-workbench.js'
import { STUDIO_PANEL_IDS, useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'
import { RendererWorkspacePanel } from '../../../apps/studio-client/src/widgets/extension-workbench/renderer-workspace-panel.js'

vi.mock('../../../apps/studio-client/src/features/extension-renderers/ui/extension-workspace.js', () => ({ ExtensionWorkspace: () => null }))
vi.mock('../../../apps/studio-client/src/features/loom-scripts/ui/script-management-panel.js', () => ({ ScriptManagementPanel: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('innerWidth', 390)
})
afterEach(() => { vi.unstubAllGlobals(); useStudioLayoutStore.getState().setWorkbenchNavigation(null) })

it('retains a hidden panel without letting its detail navigation consume the active panel history', () => {
  const changePane = vi.fn()
  const panels = Object.fromEntries(STUDIO_PANEL_IDS.map(id => [id, () => id === 'character'
    ? createElement(MasterDetailWorkbench, { master: 'master', children: 'detail', mobilePane: 'detail', onMobilePaneChange: changePane })
    : createElement('p', null, id)])) as ComponentProps<typeof StudioPanelHost>['panels']
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    act(() => root.render(createElement(StudioPanelHost, { activePanel: 'character', panels })))
    expect(useStudioLayoutStore.getState().workbenchNavigation?.canGoBack()).toBe(true)
    act(() => root.render(createElement(StudioPanelHost, { activePanel: 'logs', panels })))
    expect(container.querySelector('#studio-character-panel')?.textContent).toContain('detail')
    expect(useStudioLayoutStore.getState().workbenchNavigation).toBeNull()
    expect(changePane).not.toHaveBeenCalled()
    act(() => root.render(createElement(StudioPanelHost, { activePanel: 'character', panels })))
    expect(useStudioLayoutStore.getState().workbenchNavigation?.canGoBack()).toBe(true)
  } finally { act(() => root.unmount()); container.remove() }
})

it('opens the requested inspector only on the active management surface', () => {
  const props = { active: true, searchParams: new URLSearchParams('ruleInspector=1'), runtimeInspector: createElement('p', null, 'inspector'), onNavigate: vi.fn() } as unknown as ComponentProps<typeof RendererWorkspacePanel>
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function render(active: boolean) {
    root.render(createElement('div', null,
      createElement(RendererWorkspacePanel, { ...props, mode: 'workspace' }),
      createElement(RendererWorkspacePanel, { ...props, active, mode: 'management' })))
  }
  try {
    act(() => render(true))
    expect(container.querySelectorAll('dialog[open]')).toHaveLength(1)
    act(() => render(false))
    expect(container.querySelectorAll('dialog')).toHaveLength(0)
    act(() => render(true))
    expect(container.querySelectorAll('dialog[open]')).toHaveLength(1)
  } finally { act(() => root.unmount()); container.remove() }
})
