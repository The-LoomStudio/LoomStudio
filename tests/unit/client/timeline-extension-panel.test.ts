import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { Button, Checkbox, Dialog } from '@loom-studio/ui'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { TimelineExtensionPanel, type TimelineExtensionPanelProps } from '../../../apps/studio-client/src/features/extension-renderers/ui/timeline-extension-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((item, i) => Object.is(item, previous.deps[i]))) return
    const entry = { deps, cleanup: undefined as (() => void) | undefined }
    hooks.values[index] = entry
    hooks.effects.push(() => { previous?.cleanup?.(); entry.cleanup = effect() || undefined })
  },
}))

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
const t = createTranslator('en-US')
const packageId = 'example.world'
const installationId = extensionInstallationId(packageId, { kind: 'global' })
const source = { kind: 'git', url: 'https://example.com/world.git' } as const
function fixture(adopted = false) {
  const entry = { installationId, packageId, packageVersion: '1.0.0', installationVersion: 1, source, enabled: true, generation: 'gen-1' }
  const config = { timelineId: 'story', version: 4, entries: adopted ? [entry] : [] }
  const preview = {
    timelineId: 'story', branchId: 'branch', installationId, packageId, packageVersion: '1.0.0',
    source, expectedVersion: 4, expectedInstallationVersion: 1, expectedStateRevisionId: 'state-1',
    expectedRuntimeContextVersion: 2, contributionInstances: [], paths: ['/world'],
  }
  const api = {
    inspectResources: vi.fn(async () => ({ timelineId: 'story', installationId, resources: [] })),
    get: vi.fn(async () => config),
    update: vi.fn(async () => ({ participation: config, revisionId: 'state-2', mutation: { changesetId: 'change' } })),
    previewAdoption: vi.fn(async () => preview),
    previewStateInitialization: vi.fn(async () => preview),
    initializeState: vi.fn(async () => ({ participation: config, revisionId: 'state-2', mutation: { changesetId: 'change' } })),
    adopt: vi.fn(async () => ({ participation: config, revisionId: 'state-2', mutation: { changesetId: 'change' } })),
    previewRecovery: vi.fn(async () => ({
      ...preview, previousSource: source, source: { kind: 'git' as const, url: 'https://example.com/replacement.git' }, sourceChanged: true,
    })),
    recover: vi.fn(async () => ({ participation: config, revisionId: 'state-2', mutation: { changesetId: 'change' } })),
  }
  const props: TimelineExtensionPanelProps = {
    packages: [],
    api, t,
    timeline: { id: 'story', branchId: 'branch', cardId: 'card' },
    installations: [{
      id: installationId, version: 1, packageId, packageVersion: '1.0.0', participation: 'timeline',
      target: { kind: 'global' }, source, createdAt: '', updatedAt: '',
    }],
    onChanged: vi.fn(),
  }
  function render() {
    hooks.cursor = 0
    const tree = TimelineExtensionPanel(props)
    for (const effect of hooks.effects.splice(0)) effect()
    return elements(tree)
  }
  async function settle() {
    for (let i = 0; i < 12; i++) await Promise.resolve()
    return render()
  }
  function button(key: Parameters<typeof t>[0]) {
    return render().find(element => element.type === Button
      && (element.props.children === t(key) || Array.isArray(element.props.children) && element.props.children.includes(t(key))))!
  }
  return { api, props, preview, render, settle, button }
}
function click(element: Element) { (element.props.onClick as () => void)() }
function check(element: Element, checked: boolean) {
  (element.props.onChange as (event: unknown) => void)({ target: { checked } })
}
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('Timeline extension participation panel', () => {
  it('inspects carried resources without changing adoption or resource mounts', async () => {
    const f = fixture(true)
    f.render()
    await f.settle()
    click(f.render().find(element => element.props['aria-label'] === `${t('participation.resources')}: ${packageId}`)!)
    await f.settle()
    expect(f.api.inspectResources).toHaveBeenCalledWith({ timelineId: 'story', installationId })
    expect(f.render().some(element => element.type === Dialog && element.props.title === t('participation.resources'))).toBe(true)
    expect(f.api.update).not.toHaveBeenCalled()
    expect(f.api.adopt).not.toHaveBeenCalled()
  })

  it.each([true, false])('previews checkpoint initialization and only enables a nonempty commit (%s)', async missing => {
    const f = fixture(true)
    if (!missing) f.preview.paths = []
    f.render()
    await f.settle()
    click(f.render().find(element => element.props['aria-label'] === `${t('participation.initializeState')}: ${packageId}`)!)
    await f.settle()
    expect(f.api.previewStateInitialization).toHaveBeenCalledExactlyOnceWith({ timelineId: 'story', branchId: 'branch', installationId })
    expect(f.api.initializeState).not.toHaveBeenCalled()
    const confirm = f.button('participation.confirm')
    expect(confirm.props.disabled).toBe(!missing)
    if (missing) {
      click(confirm)
      click(confirm)
      await f.settle()
      expect(f.api.initializeState).toHaveBeenCalledExactlyOnceWith(f.preview)
      expect(f.props.onChanged).toHaveBeenCalledOnce()
    }
    expect(f.api.adopt).not.toHaveBeenCalled()
    expect(f.api.update).not.toHaveBeenCalled()
  })

  it('previews without adopting, then commits the exact preview once', async () => {
    const f = fixture()
    f.render()
    await f.settle()
    click(f.button('participation.add'))
    await f.settle()
    expect(f.api.previewAdoption).toHaveBeenCalledWith({ timelineId: 'story', branchId: 'branch', installationId })
    expect(f.api.adopt).not.toHaveBeenCalled()
    const confirm = f.button('participation.confirm')
    click(confirm)
    click(confirm)
    await f.settle()
    expect(f.api.adopt).toHaveBeenCalledExactlyOnceWith(f.preview)
    expect(f.props.onChanged).toHaveBeenCalledTimes(1)
    expect(f.render().some(element => element.type === Dialog)).toBe(false)
  })

  it('requires source replacement confirmation before recovery', async () => {
    const f = fixture(true)
    f.props.installations[0]!.version = 2
    f.render()
    await f.settle()
    click(f.button('participation.recover'))
    await f.settle()
    expect(f.button('participation.confirm').props.disabled).toBe(true)
    expect(f.api.recover).not.toHaveBeenCalled()
    check(f.render().find(element => element.type === Checkbox)!, true)
    expect(f.button('participation.confirm').props.disabled).toBe(false)
    click(f.button('participation.confirm'))
    await f.settle()
    expect(f.api.recover).toHaveBeenCalledWith(expect.objectContaining({ timelineId: 'story', acceptSourceChange: true, expectedVersion: 4 }))
  })

  it('pauses only the current story without changing other stories', async () => {
    const f = fixture(true)
    f.render()
    await f.settle()
    click(f.render().find(element => element.type === 'button' && element.props['aria-pressed'] === true)!)
    await f.settle()
    expect(f.api.update).toHaveBeenCalledExactlyOnceWith({ timelineId: 'story', installationId, expectedVersion: 4, enabled: false })
    expect(f.api.adopt).not.toHaveBeenCalled()
  })

  it('retains an uninstalled adoption as unavailable instead of deleting its row', async () => {
    const f = fixture(true)
    f.props.installations = []
    f.render()
    await f.settle()
    expect(f.render().find(element => element.type === 'strong')?.props.children).toBe(packageId)
    expect(f.render().find(element => element.type === 'button' && element.props['aria-pressed'] === true)?.props).toMatchObject({ 'aria-pressed': true, disabled: true })
    expect(f.api.update).not.toHaveBeenCalled()
  })
})
