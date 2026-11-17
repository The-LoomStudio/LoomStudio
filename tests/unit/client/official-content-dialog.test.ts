// @vitest-environment happy-dom
import { defaultScheduler, notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficialContentDialog } from '../../../apps/studio-client/src/features/official-content/ui/official-content-dialog.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { OfficialContentPackage } from '../../../apps/studio-client/src/entities/official-content.js'

const effects = vi.hoisted(() => ({ download: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: effects.success, error: vi.fn() } }))
vi.mock('../../../apps/studio-client/src/shared/browser/download.js', () => ({ downloadBase64: effects.download }))
vi.mock('../../../apps/studio-client/src/shared/ui/confirm-dialog/index.js', () => ({ confirm: vi.fn(async () => true) }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

class StubEventSource extends EventTarget {
  static OPEN = 1
  static CLOSED = 2
  readyState = 0
  close() { this.readyState = 2 }
}

const content: OfficialContentPackage = {
  id: 'starter', name: 'Starter', digest: 'digest', version: '0.1.0',
  resources: [{ id: 'preset', name: 'Assistant', resourceKind: 'preset', available: false }],
}

let activeRoot: Root | undefined
let activeContainer: HTMLElement | undefined
let activeClient: QueryClient | undefined

beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask)
  vi.clearAllMocks()
  vi.stubGlobal('EventSource', StubEventSource)
})

afterEach(async () => {
  await act(async () => activeRoot?.unmount())
  activeContainer?.remove()
  activeClient?.clear()
  activeRoot = undefined
  activeContainer = undefined
  activeClient = undefined
  notifyManager.setScheduler(defaultScheduler)
  vi.unstubAllGlobals()
})

function fixture() {
  const api = {
    list: vi.fn().mockResolvedValue({ packages: [content] }),
    install: vi.fn().mockResolvedValue({ resources: [{ id: 'preset', created: true }] }),
    export: vi.fn().mockResolvedValue({ base64: 'eA==', fileName: 'starter.zip' }),
  }
  const onInstalled = vi.fn().mockResolvedValue(undefined)
  const t = createTranslator('en-US')
  const props = { api, onInstalled, onClose: vi.fn(), t }
  activeContainer = document.createElement('div')
  document.body.append(activeContainer)
  activeRoot = createRoot(activeContainer)
  activeClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const render = () => {
    act(() => activeRoot!.render(createElement(QueryClientProvider, { client: activeClient! }, createElement(OfficialContentDialog, props))))
  }
  const unmount = () => {
    act(() => activeRoot?.unmount())
    activeRoot = undefined
  }
  const button = (label: string) => [...activeContainer!.querySelectorAll('button')].find(el =>
    el.getAttribute('aria-label') === label || el.textContent?.trim() === label)!
  const click = (label: string) => {
    const target = button(label)
    expect(target).toBeDefined()
    act(() => target.click())
  }
  const ready = async () => {
    render()
    await vi.waitFor(() => expect(button(t('official.export'))?.disabled).toBe(false))
  }
  return { api, props, container: activeContainer, render, unmount, button, click, ready, onInstalled }
}

describe('Built-in content resource dialog', () => {
  it('lists packages without an Agent creation control and installs missing resources once', async () => {
    const f = fixture()
    await f.ready()
    expect(f.container.querySelectorAll('select')).toHaveLength(0)
    const pending = Promise.withResolvers<{ resources: { id: string; created: boolean }[] }>()
    f.api.install.mockReturnValue(pending.promise)
    f.click(f.props.t('official.install'))
    await vi.waitFor(() => expect(f.api.install).toHaveBeenCalledTimes(1))
    f.click(f.props.t('official.install'))
    expect(f.api.install).toHaveBeenCalledExactlyOnceWith({ packageId: 'starter', digest: 'digest' })
    f.api.list.mockResolvedValue({ packages: [{ ...content, resources: [{ ...content.resources[0]!, available: true }] }] })
    pending.resolve({ resources: [{ id: 'preset', created: true }] })
    await vi.waitFor(() => expect(f.onInstalled).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(f.button(f.props.t('official.available'))?.disabled).toBe(true))
  })

  it('reports a failed list and retries only when requested', async () => {
    const f = fixture()
    f.api.list.mockRejectedValueOnce(new Error('Catalog unavailable'))
    f.render()
    await vi.waitFor(() => expect(f.container.querySelector('[role="alert"]')?.textContent).toBe('Catalog unavailable'))
    f.click(f.props.t('official.refresh'))
    await vi.waitFor(() => expect(f.button(f.props.t('official.export'))?.disabled).toBe(false))
    expect(f.api.list).toHaveBeenCalledTimes(2)
  })

  it('retains the package and reports install failure without refreshing consumers', async () => {
    const f = fixture()
    await f.ready()
    f.api.install.mockRejectedValueOnce(new Error('Install failed'))
    f.click(f.props.t('official.install'))
    await vi.waitFor(() => expect(f.container.querySelector('[role="alert"]')?.textContent).toBe('Install failed'))
    expect(f.onInstalled).not.toHaveBeenCalled()
    expect(f.button(f.props.t('official.install')).disabled).toBe(false)
  })

  it('exports the original package as ZIP', async () => {
    const f = fixture()
    await f.ready()
    f.click(f.props.t('official.export'))
    await vi.waitFor(() => expect(effects.download).toHaveBeenCalledWith('eA==', 'starter.zip', 'application/zip'))
    expect(f.api.export).toHaveBeenCalledWith({ packageId: 'starter', digest: 'digest' })
  })

  it('does not download a late export after the resource dialog unmounts', async () => {
    const f = fixture()
    await f.ready()
    const pending = Promise.withResolvers<{ base64: string; fileName: string }>()
    f.api.export.mockReturnValueOnce(pending.promise)
    f.click(f.props.t('official.export'))
    f.unmount()
    pending.resolve({ base64: 'eA==', fileName: 'starter.zip' })
    await pending.promise
    expect(effects.download).not.toHaveBeenCalled()
  })
})
