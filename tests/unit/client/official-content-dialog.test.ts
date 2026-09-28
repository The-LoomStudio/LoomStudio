import { isValidElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficialContentDialog } from '../../../apps/studio-client/src/features/official-content/ui/official-content-dialog.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { OfficialContentPackage } from '../../../apps/studio-client/src/entities/official-content.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[], cleanups: [] as (() => void)[] }))
const effects = vi.hoisted(() => ({ download: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: effects.success } }))
vi.mock('../../../apps/studio-client/src/shared/browser/download.js', () => ({ downloadBase64: effects.download }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (current: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current }
    return hooks.values[index]
  },
  useEffect: (effect: () => () => void) => {
    const index = hooks.cursor++
    if (index in hooks.values) return
    hooks.values[index] = true
    hooks.effects.push(() => hooks.cleanups.push(effect()))
  },
}))
beforeEach(() => {
  hooks.cursor = 0; hooks.values = []; hooks.effects = []; hooks.cleanups = []
  vi.clearAllMocks()
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
})
afterEach(() => {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
})
type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
const content: OfficialContentPackage = {
  id: 'starter', name: 'Starter', digest: 'digest', version: '0.1.0',
  resources: [{ id: 'preset', name: 'Assistant', resourceKind: 'preset', available: false }],
}
function fixture() {
  const api = {
    list: vi.fn().mockResolvedValue({ packages: [content] }),
    install: vi.fn().mockResolvedValue({ resources: [{ id: 'preset', created: true }] }),
    export: vi.fn().mockResolvedValue({ base64: 'eA==', fileName: 'starter.zip' }),
  }
  const onInstalled = vi.fn().mockResolvedValue(undefined)
  const props = { api, onInstalled, onClose: vi.fn(), t: createTranslator('en-US') }
  const render = () => {
    hooks.cursor = 0
    const tree = elements(OfficialContentDialog(props))
    for (const effect of hooks.effects.splice(0)) effect()
    return tree
  }
  const button = (label: string) => render().find(element => element.type === 'button'
    && (element.props['aria-label'] === label || elements(element.props.children).some(child => child.props.children === label)))!
  const click = (label: string) => {
    const target = button(label)
    expect(target).toBeDefined()
    const onClick = target.props.onClick as () => void
    onClick()
  }
  const ready = async () => {
    render()
    await vi.waitFor(() => expect(button(props.t('official.export'))?.props.disabled).toBe(false))
  }
  return { api, props, render, button, click, ready, onInstalled }
}
describe('Built-in content resource dialog', () => {
  it('lists packages without an Agent creation control and installs missing resources once', async () => {
    const f = fixture()
    await f.ready()
    expect(f.render().some(element => element.type === 'select')).toBe(false)
    const pending = Promise.withResolvers<{ resources: { id: string; created: boolean }[] }>()
    f.api.install.mockReturnValue(pending.promise)
    f.click(f.props.t('official.install'))
    f.click(f.props.t('official.install'))
    expect(f.api.install).toHaveBeenCalledExactlyOnceWith({ packageId: 'starter', digest: 'digest' })
    f.api.list.mockResolvedValue({ packages: [{ ...content, resources: [{ ...content.resources[0]!, available: true }] }] })
    pending.resolve({ resources: [{ id: 'preset', created: true }] })
    await vi.waitFor(() => expect(f.onInstalled).toHaveBeenCalledOnce())
    expect(f.button(f.props.t('official.available')).props.disabled).toBe(true)
  })

  it('reports a failed list and retries only when requested', async () => {
    const f = fixture()
    f.api.list.mockRejectedValueOnce(new Error('Catalog unavailable'))
    f.render()
    await vi.waitFor(() => expect(f.render().find(element => element.props.role === 'alert')?.props.children).toBe('Catalog unavailable'))
    f.click(f.props.t('official.refresh'))
    await f.ready()
    expect(f.api.list).toHaveBeenCalledTimes(2)
  })

  it('retains the package and reports install failure without refreshing consumers', async () => {
    const f = fixture()
    await f.ready()
    f.api.install.mockRejectedValueOnce(new Error('Install failed'))
    f.click(f.props.t('official.install'))
    await vi.waitFor(() => expect(f.render().find(element => element.props.role === 'alert')?.props.children).toBe('Install failed'))
    expect(f.onInstalled).not.toHaveBeenCalled()
    expect(f.button(f.props.t('official.install')).props.disabled).toBe(false)
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
    for (const cleanup of hooks.cleanups.splice(0)) cleanup()
    pending.resolve({ base64: 'eA==', fileName: 'starter.zip' })
    await pending.promise
    expect(effects.download).not.toHaveBeenCalled()
  })
})
