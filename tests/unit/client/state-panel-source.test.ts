import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '@loom-studio/ui'
import { notify } from '../../../apps/studio-client/src/shared/notifications/index.js'
import { StateVariablesPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.js'
import { StateAuthoringPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-authoring-panel.js'
import { StateSourcesPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-sources-panel.js'
import { StudioStatePanel } from '../../../apps/studio-client/src/app/studio-state-panel.js'
import { FileTree } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { StateTarget } from '../../../apps/studio-client/src/entities/index.js'
import type { StateSourcesInspection } from '../../../apps/studio-client/src/entities/state.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('../../../apps/studio-client/src/shared/notifications/index.js', () => ({ notify: { success: vi.fn(() => 'test-success'), error: vi.fn(() => 'test-error') } }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
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
function snapshot(target: StateTarget, count: number) {
  return { snapshot: { target, scopeId: 'scope', revisionId: `rev-${count}`, value: { count }, createdAt: '2026-09-23' } }
}
const a = { scope: 'timeline', timelineId: 'a', branchId: 'branch' } as const
const b = { scope: 'timeline', timelineId: 'b', branchId: 'branch' } as const
const t = createTranslator('en-US')
function fixture() {
  const apply = vi.fn<ComponentProps<typeof StateVariablesPanel>['api']['apply']>()
    .mockResolvedValue({ ...snapshot(a, 1), mutation: { changesetId: 'change' } })
  const get = vi.fn<ComponentProps<typeof StateVariablesPanel>['api']['get']>(async target => snapshot(target, 1))
  const props: ComponentProps<typeof StateVariablesPanel> = {
    api: {
      get, apply,
      inspectSources: async () => { throw new Error('Unexpected source inspection') },
      listDefinitions: async () => ({ definitions: [] }),
      getDefinition: async () => { throw new Error('Unexpected definition read') },
      upsertDefinition: async () => { throw new Error('Unexpected definition write') },
      deleteDefinition: async () => { throw new Error('Unexpected definition deletion') },
    },
    timelineTarget: a, t, onStateMutated: vi.fn(),
  }
  function render() {
    hooks.cursor = 0
    const tree = StateVariablesPanel(props)
    for (const effect of hooks.effects.splice(0)) effect()
    return tree
  }
  async function settle() {
    for (let i = 0; i < 4; i++) await Promise.resolve()
    render()
    return render()
  }
  function controls() {
    const tree = render()
    const all = elements(tree)
    const fileTree = all.find(item => item.props.renderTrailing)!
    const node = (fileTree.props.nodes as { capabilities?: { path: string } }[]).find(item => item.capabilities?.path === '/count')!
    const trailing = (fileTree.props.renderTrailing as (node: unknown) => unknown)(node)
    const input = elements(trailing).find(item => item.type === 'input')!
    const save = all.find(item => item.type === Button && elements(item.props.children).some(child =>
      child.type === 'span' && Array.isArray(child.props.children) && child.props.children[0] === t('stateVariables.saveChanges')))!
    return {
      input, save,
      edit: (value: number) => (input.props.onChange as (event: unknown) => void)({ target: { value: String(value) } }),
      submit: () => (save.props.onClick as () => void)(),
    }
  }
  return { props, apply, get, render, settle, controls }
}
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = []; vi.clearAllMocks() })

describe('State panel source isolation', () => {
  it('keeps the tree collapsed across renders', async () => {
    const f = fixture()
    f.render()
    await f.settle()
    const tree = () => elements(f.render()).find(item => item.props.renderTrailing)!
    expect(tree().props.expandedIds).not.toEqual([])
    ;(tree().props.onExpandedIdsChange as (ids: string[]) => void)([])
    f.render()
    expect(tree().props.expandedIds).toEqual([])
  })

  it('reports clipboard rejection instead of losing the failure', async () => {
    const f = fixture()
    f.render()
    await f.settle()
    const writeText = vi.fn().mockRejectedValue(new Error('Denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      const tree = elements(f.render()).find(item => item.props.renderTrailing)!
      const nodes = tree.props.nodes as unknown[]
      const getActions = tree.props.getActions as (node: unknown) => { id: string; onSelect(): void }[]
      const copy = getActions(nodes[0]).find(action => action.id === 'copy-pointer')!
      copy.onSelect()
      expect(writeText).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith(t('longTextEditor.copyFailed')))
      expect(notify.success).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('preserves array drafts and only submits valid JSON arrays', async () => {
    const f = fixture()
    f.get.mockImplementation(async target => ({
      ...snapshot(target, 1),
      snapshot: { ...snapshot(target, 1).snapshot, value: { inventory: [{ name: 'item', count: 2 }] } },
    }))
    f.render()
    await f.settle()
    function arrayControls() {
      const all = elements(f.render())
      const tree = all.find(item => item.props.renderTrailing)!
      const node = (tree.props.nodes as { capabilities?: { path: string } }[])[0]!
      const trailing = elements((tree.props.renderTrailing as (node: unknown) => unknown)(node))
      const expanded = (tree.props.renderExpandedRow as (node: unknown) => unknown)(node)
      return {
        open: () => (trailing.find(item => item.type === 'button')!.props.onClick as () => void)(),
        input: elements(expanded).find(item => item.type === 'textarea'),
        save: all.find(item => item.type === Button)!,
      }
    }
    arrayControls().open()
    expect(JSON.parse(arrayControls().input!.props.value as string)).toEqual([{ name: 'item', count: 2 }])
    for (const invalid of ['[broken', '{"not":"an array"}']) {
      ;(arrayControls().input!.props.onChange as (event: unknown) => void)({ target: { value: invalid } })
      ;(arrayControls().save.props.onClick as () => void)()
      await f.settle()
      expect(f.apply).not.toHaveBeenCalled()
      expect(arrayControls().input!.props.value).toBe(invalid)
      expect(elements(f.render()).some(item => item.props.role === 'alert')).toBe(true)
    }
    ;(arrayControls().input!.props.onChange as (event: unknown) => void)({ target: { value: '[{"name":"item","count":3}]' } })
    ;(arrayControls().save.props.onClick as () => void)()
    expect(f.apply.mock.calls[0]?.[0].operations).toEqual([{ op: 'set', path: '/inventory', value: [{ name: 'item', count: 3 }] }])
    await f.settle()
  })

  it('does not show or save an old Timeline snapshot after switching target', async () => {
    const f = fixture()
    const old = Promise.withResolvers<ReturnType<typeof snapshot>>()
    f.get.mockImplementation(target => target.scope === 'timeline' && target.timelineId === 'a'
      ? old.promise : Promise.resolve(snapshot(target, 2)))
    f.render()
    f.props.timelineTarget = b
    expect(elements(f.render()).some(item => item.props.renderTrailing)).toBe(false)
    await f.settle()
    f.controls().edit(3)
    old.resolve(snapshot(a, 1))
    await f.settle()
    expect(f.controls().input.props.value).toBe(3)
    f.controls().submit()
    expect(f.apply).toHaveBeenCalledWith(expect.objectContaining({ target: b, expectedRevisionId: 'rev-2' }))
    await f.settle()
  })

  it('ignores a previous API save completion without clearing the new API draft', async () => {
    const f = fixture()
    f.render()
    await f.settle()
    f.controls().edit(4)
    const oldControls = f.controls()
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.apply>>>()
    f.apply.mockReturnValueOnce(pending.promise)
    oldControls.submit()
    oldControls.submit()
    expect(f.apply).toHaveBeenCalledTimes(1)
    oldControls.edit(99)
    expect(f.controls().input.props.value).toBe(4)
    const applyNew = vi.fn()
    f.props.api = { ...f.props.api, get: async target => snapshot(target, 8), apply: applyNew }
    expect(elements(f.render()).some(item => item.props.renderTrailing)).toBe(false)
    await f.settle()
    oldControls.submit()
    expect(f.apply).toHaveBeenCalledTimes(1)
    f.controls().edit(9)
    pending.resolve({ ...snapshot(a, 4), mutation: { changesetId: 'old-change' } })
    await f.settle()
    expect(f.controls().input.props.value).toBe(9)
    expect(f.controls().save.props.disabled).toBe(false)
    expect(f.props.onStateMutated).not.toHaveBeenCalled()
    expect(applyNew).not.toHaveBeenCalled()
  })

  it('refreshes a completed global save after switching scope without erasing the timeline draft', async () => {
    const f = fixture()
    const global = { scope: 'global' } as const
    let globalVersion = 1
    f.get.mockImplementation(async target => snapshot(target, target.scope === 'global' ? globalVersion : 1))
    function selectScope(id: string) {
      const tree = elements(f.render()).find(item => item.type === FileTree && !item.props.renderTrailing)!
      ;(tree.props.onSelect as (node: { id: string }) => void)({ id })
      f.render()
    }
    f.render()
    await f.settle()
    selectScope('global')
    f.controls().edit(4)
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.apply>>>()
    f.apply.mockReturnValueOnce(pending.promise)
    f.controls().submit()
    selectScope('timeline')
    f.controls().edit(9)
    globalVersion = 4
    pending.resolve({ ...snapshot(global, 4), mutation: { changesetId: 'global-change' } })
    await f.settle()
    expect(f.controls().input.props.value).toBe(9)
    expect(f.props.onStateMutated).toHaveBeenCalledOnce()
    selectScope('global')
    expect(f.controls().input.props.value).toBe(4)
    f.controls().edit(5)
    f.controls().submit()
    expect(f.apply.mock.calls.at(-1)?.[0]).toMatchObject({ expectedRevisionId: 'rev-4' })
    await f.settle()
  })

  it('retains a new global draft after leaving and returning during an earlier save', async () => {
    const f = fixture()
    const global = { scope: 'global' } as const
    let globalVersion = 1
    f.get.mockImplementation(async target => snapshot(target, target.scope === 'global' ? globalVersion : 1))
    function selectScope(id: string) {
      const tree = elements(f.render()).find(item => item.type === FileTree && !item.props.renderTrailing)!
      ;(tree.props.onSelect as (node: { id: string }) => void)({ id })
      f.render()
    }
    f.render()
    await f.settle()
    selectScope('global')
    f.controls().edit(4)
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.apply>>>()
    f.apply.mockReturnValueOnce(pending.promise)
    f.controls().submit()
    selectScope('timeline')
    selectScope('global')
    f.controls().edit(9)
    globalVersion = 4
    pending.resolve({ ...snapshot(global, 4), mutation: { changesetId: 'global-change' } })
    await f.settle()
    expect(f.controls().input.props.value).toBe(9)
    expect(f.controls().save.props.disabled).toBe(false)
    f.controls().submit()
    expect(f.apply.mock.calls.at(-1)?.[0]).toMatchObject({ expectedRevisionId: 'rev-4', operations: [{ op: 'set', path: '/count', value: 9 }] })
    await f.settle()
  })

  it('retains a failed save and permits retry with the original revision', async () => {
    const f = fixture()
    f.render()
    await f.settle()
    expect(f.controls().save.props).toMatchObject({ type: 'button', disabled: true })
    f.controls().edit(5)
    f.apply.mockRejectedValueOnce(new Error('Revision conflict'))
    f.controls().submit()
    await f.settle()
    expect(f.controls().input.props.value).toBe(5)
    expect(f.controls().save.props.disabled).toBe(false)
    f.controls().submit()
    expect(f.apply.mock.calls[1]?.[0]).toMatchObject({ target: a, expectedRevisionId: 'rev-1' })
    await f.settle()
  })

  it('rejects a snapshot whose target disagrees with the current panel', async () => {
    const f = fixture()
    f.get.mockImplementation(async target => snapshot(target.scope === 'global' ? target : b, 1))
    f.render()
    await f.settle()
    f.controls().edit(6)
    f.controls().submit()
    expect(f.apply).not.toHaveBeenCalled()
    expect(elements(f.render()).find(item => item.props.role === 'alert')?.props.children).toBe(t('stateVariables.targetMismatch'))
  })
})

describe('State authoring save ownership', () => {
  it('locks edits during saving, keeps failed drafts and isolates a new card', async () => {
    const card = {
      id: 'card-a', artifactId: 'fixture-artifact', version: 1, name: 'A', opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
      timelineStateBindings: [], createdAt: 'now', updatedAt: 'now',
    }
    const pending = Promise.withResolvers<typeof card>()
    const save = vi.fn().mockReturnValue(pending.promise)
    const props = { card, t, onSaveCard: save }
    const outer = StateAuthoringPanel(props)
    function render() {
      hooks.cursor = 0
      const tree = (outer.type as (props: unknown) => unknown)(props)
      for (const effect of hooks.effects.splice(0)) effect()
      return elements(tree)
    }
    let all = render()
    const detail = all.find(item => typeof item.props.updateSource === 'function')!
    const draft = String(detail.props.sourceText).replace('stateContributionIds: []', 'stateContributionIds: [draft-a]')
    ;(detail.props.updateSource as (text: string) => void)(draft)
    all = render()
    ;(all.find(item => item.props['aria-label'] === t('stateAuthoring.saveCard'))!.props.onClick as () => void)()
    expect(render().find(item => item.type === 'fieldset')!.props.disabled).toBe(true)
    ;(detail.props.updateSource as (text: string) => void)('invalid: [')
    expect(render().find(item => typeof item.props.updateSource === 'function')!.props.sourceText).toBe(draft)
    pending.reject(new Error('Save failed'))
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(render().find(item => item.type === 'fieldset')!.props.disabled).toBe(false)
    expect(render().find(item => typeof item.props.updateSource === 'function')!.props.sourceText).toBe(draft)

    const late = Promise.withResolvers<typeof card>()
    save.mockReturnValueOnce(late.promise)
    ;(render().find(item => item.props['aria-label'] === t('stateAuthoring.saveCard'))!.props.onClick as () => void)()
    for (const value of hooks.values) (value as { cleanup?: () => void })?.cleanup?.()
    const next = StateAuthoringPanel({ ...props, card: { ...card, id: 'card-b' } })
    expect(next.key).not.toBe(outer.key)
    late.resolve({ ...card, version: 2 })
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(notify.success).not.toHaveBeenCalled()
  })
})

function sourceInspection(target = a): StateSourcesInspection {
  const declaration = {
    id: 'example.world.state', entityTypes: [{ id: 'world', collectionPath: 'worlds' }],
    entities: [{ typeId: 'world', entityId: 'main' }], templates: [], componentMounts: [], bindings: [],
  }
  const source = { installationId: 'extension-installation:["global","example.world"]', packageId: 'example.world',
    contributionId: 'example.world.state', moduleId: 'server', packageVersion: '1.0.0', declaration }
  return {
    card: null, definitions: [],
    extensions: [{
      installationId: source.installationId, packageId: source.packageId, target: { kind: 'global' },
      installation: { version: 1, packageId: source.packageId, packageVersion: '1.0.0', participation: 'timeline',
        target: { kind: 'global' }, createdAt: 'now', updatedAt: 'now' },
      cardDefault: false, eligible: false,
      adoption: { installationId: source.installationId, packageId: source.packageId, packageVersion: '1.0.0',
        installationVersion: 1, enabled: false, generation: 'paused' },
      registered: [], accepted: [source],
    }],
    timeline: { target, revisionId: 'rev-source', context: null, paths: [{
      path: 'worlds.main', kind: 'entity', installationId: source.installationId, present: false,
    }] },
  }
}

function sourceFixture() {
  const inspectSources = vi.fn<ComponentProps<typeof StateSourcesPanel>['api']['inspectSources']>()
    .mockResolvedValue(sourceInspection())
  const props: ComponentProps<typeof StateSourcesPanel> = { api: { inspectSources }, timelineTarget: a, t }
  function render() {
    hooks.cursor = 0
    const tree = StateSourcesPanel(props)
    for (const effect of hooks.effects.splice(0)) effect()
    return tree
  }
  async function settle() {
    for (let i = 0; i < 4; i++) await Promise.resolve()
    return render()
  }
  return { props, inspectSources, render, settle }
}

describe('State source inspection panel', () => {
  it('does not refresh the editable runtime draft when only source participation changes', () => {
    const f = fixture()
    const props: ComponentProps<typeof StudioStatePanel> = {
      hasTimeline: true, variableView: 'sources', statesApi: f.props.api, timelineTarget: a,
      refreshToken: 'run-1', sourceRefreshToken: 'participation-2',
      t, onSaveCard: vi.fn(), onOpenSource: vi.fn(), onViewChange: vi.fn(), onStateMutated: vi.fn(),
    }
    const sources = elements(StudioStatePanel(props)).find(item => item.type === StateSourcesPanel)!
    const runtime = elements(StudioStatePanel({ ...props, variableView: 'state' })).find(item => item.type === StateVariablesPanel)!
    expect(sources.props.refreshToken).toBe('run-1:participation-2')
    expect(runtime.props.refreshToken).toBe('run-1')
  })

  it.each(['target', 'api'] as const)('discards a late source response after changing the %s', async change => {
    const f = sourceFixture()
    const pending = Promise.withResolvers<StateSourcesInspection>()
    f.inspectSources.mockReturnValueOnce(pending.promise)
    f.render()
    const next = sourceInspection()
    next.extensions = []
    if (change === 'target') {
      f.props.timelineTarget = b
      next.timeline!.target = b
      f.inspectSources.mockResolvedValueOnce(next)
    } else f.props.api = { inspectSources: vi.fn().mockResolvedValue(next) }
    expect(elements(f.render()).find(item => item.type === FileTree)?.props.nodes).toEqual([])
    await f.settle()
    pending.resolve(sourceInspection())
    const tree = elements(await f.settle()).find(item => item.type === FileTree)!
    const nodes = tree.props.nodes as ComponentProps<typeof FileTree>['nodes']
    expect(nodes.find(item => item.id === 'extensions')!.children).toEqual([])
    expect(nodes.find(item => item.id === 'timeline')!.meta).toBe(next.timeline!.target.timelineId)
  })

  it('keeps paused accepted declarations and missing Branch data visible and read-only', async () => {
    const f = sourceFixture()
    f.render()
    const tree = elements(await f.settle()).find(item => item.type === FileTree)!
    const sourceNode = (tree.props.nodes as ComponentProps<typeof FileTree>['nodes']).find(item => item.id === 'extensions')!.children![0]!
    expect(sourceNode.meta).toContain(t('participation.paused'))
    ;(tree.props.onSelect as ComponentProps<typeof FileTree>['onSelect'])(sourceNode)
    const detail = elements(f.render()).find(item => item.props.source)!
    const html = renderToStaticMarkup(detail)
    expect(html).toContain(t('stateSources.notSelected'))
    expect(html).toContain(t('stateSources.accepted'))
    expect(html).toContain(t('stateSources.unregistered'))
    expect(html).toContain('world / main')
    expect(html).toContain('data-state-presence="missing"')
    expect(html).not.toContain('<input')
    expect(f.inspectSources).toHaveBeenCalledTimes(1)
  })

  it('shows a failed query without stale data and refreshes with the new revision token', async () => {
    const f = sourceFixture()
    f.inspectSources.mockRejectedValueOnce(new Error('Source unavailable'))
    f.render()
    expect(elements(await f.settle()).find(item => item.props.role === 'alert')!.props.children).toBe('Source unavailable')
    const refresh = elements(f.render()).find(item => item.props['aria-label'] === t('stateVariables.refresh'))!
    expect(refresh.props.disabled).toBe(false)
    ;(refresh.props.onClick as () => void)()
    f.render()
    expect(elements(await f.settle()).some(item => item.type === FileTree)).toBe(true)
    f.props.refreshToken = 'adoption-changed'
    expect(elements(f.render()).find(item => item.type === FileTree)?.props.nodes).toEqual([])
    await f.settle()
    expect(f.inspectSources).toHaveBeenCalledTimes(3)
  })
})
