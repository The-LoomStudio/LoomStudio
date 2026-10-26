// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { Dialog } from '@loom-studio/ui'
import { SettingsPanel } from '../../../apps/studio-client/src/widgets/settings-panel/settings-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MasterDetailWorkbench } from '../../../apps/studio-client/src/shared/ui/master-detail-workbench/master-detail-workbench.js'
import { useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Tool workbench local navigation', () => {
  it('provides a narrow detail back button without replacing the underlying workspace navigation', () => {
    const previous = useStudioLayoutStore.getState().workbenchNavigation
    const navigation = { canGoBack: () => true, goBack: vi.fn(() => true), canGoForward: () => false, goForward: vi.fn(() => false) }
    useStudioLayoutStore.getState().setWorkbenchNavigation(navigation)
    const changePane = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      act(() => root.render(createElement(MasterDetailWorkbench, {
        master: createElement('p', null, 'Categories'), mobilePane: 'detail',
        onMobilePaneChange: changePane, navigationScope: 'local', backLabel: 'Back to list', children: createElement('p', null, 'Details'),
      })))
      expect(container.querySelector('[data-single-pane="true"]')).not.toBeNull()
      expect(useStudioLayoutStore.getState().workbenchNavigation).toBe(navigation)
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Back to list"]')!.click())
      expect(changePane).toHaveBeenCalledExactlyOnceWith('master')
      expect(navigation.goBack).not.toHaveBeenCalled()
      act(() => root.unmount())
      expect(useStudioLayoutStore.getState().workbenchNavigation).toBe(navigation)
    } finally {
      container.remove()
      useStudioLayoutStore.getState().setWorkbenchNavigation(previous)
    }
  })
  it('keeps network save failures visible inside the settings dialog', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Proxy is unreachable'))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      act(() => root.render(createElement(Dialog, { open: true, title: 'Settings', layout: 'workbench', onClose: vi.fn() },
        createElement(SettingsPanel, {
          busy: false, customCss: '', locale: 'en-US', uiScale: 100,
          networkSettings: { proxyMode: 'system', systemProxyDetected: false },
          onChangeCustomCss: vi.fn(), onChangeLocale: vi.fn(), onChangeUiScale: vi.fn(),
          onUpdateNetworkSettings: save, t: createTranslator('en-US'),
        }))))
      act(() => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Network')!.click() })
      await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
      expect(save).toHaveBeenCalledExactlyOnceWith({ proxyMode: 'system' })
      expect(container.querySelector('dialog [role="alert"]')?.textContent).toContain('Proxy is unreachable')
      expect(container.querySelector('dialog')!.open).toBe(true)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

})
