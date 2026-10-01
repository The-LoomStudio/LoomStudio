import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePresetBuildContextResources } from '../../../apps/studio-client/src/features/context-assets/model/preset-build-context.js'
import { buildPresetToolProjection } from '../../../apps/studio-client/src/features/context-assets/model/preset-tool-projection.js'
import { PresetWorkbench } from '../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.js'
import { ContextWorkbench } from '../../../apps/studio-client/src/widgets/context-workbench/context-workbench.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { AgentToolDefinition, PresetToolMount, PromptResource, SettingMount } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useId: () => 'test-id',
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    const values = hooks.values
    if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
    return [values[index], (value: unknown) => { values[index] = typeof value === 'function' ? value(values[index]) : value }]
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as unknown[] | undefined
    if (previous && deps.every((value, i) => Object.is(value, previous[i]))) return
    hooks.values[index] = deps
    hooks.effects.push(effect)
  },
}))
vi.mock('../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js', async original => {
  const actual = await original<typeof import('../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js')>()
  return { ...actual, useStudioLayoutStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ ...actual.useStudioLayoutStore.getState(), presetView: 'tools' }),
    { getState: actual.useStudioLayoutStore.getState },
  ) }
})
vi.mock('../../../apps/studio-client/src/features/state-variables/ui/macro-authoring-panel.js', () => ({
  useMacroAuthoring: () => ({ selectRow: () => undefined, selectNode: () => undefined }),
  MacroAuthoringDetail: () => null,
  MacroAuthoringExplorer: () => null,
}))
vi.mock('../../../apps/studio-client/src/features/text-transforms/ui/text-transform-panel.js', () => ({
  useTextTransformController: () => ({}),
  TextTransformExplorer: () => null,
  TextTransformDetail: () => null,
}))

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(text).join('')
  return isValidElement<Record<string, unknown>>(value) ? text(value.props.children) : ''
}
function instance(render: () => unknown) {
  const values: unknown[] = []
  return () => {
    hooks.cursor = 0
    hooks.values = values
    hooks.effects = []
    const tree = render()
    for (const effect of hooks.effects.splice(0)) effect()
    return tree
  }
}
function child(tree: unknown, name: string): Element {
  return elements(tree).find(item => typeof item.type === 'function' && item.type.name === name)!
}
function renderElement(element: Element) {
  return (element.type as (props: Record<string, unknown>) => unknown)(element.props)
}
function click(tree: unknown, label: string) {
  const button = elements(tree).find(item => item.type === 'button' && text(item) === label)
  expect(button, label).toBeDefined()
  ;(button!.props.onClick as () => void)()
}
const t = createTranslator('en-US')
const preset: PromptResource = {
  id: 'preset', resourceKind: 'preset', version: 1,
  rootNode: { id: 'root', kind: 'module', label: 'Preset' }, createdAt: '', updatedAt: '',
}
const setting: PromptResource = {
  ...preset, id: 'setting', resourceKind: 'setting',
  rootNode: { id: 'setting-root', kind: 'module', label: 'USER SETTING' },
}
const availableTool: AgentToolDefinition = {
  id: 'available', name: 'USER TOOL', description: 'User description', version: 1,
  owner: { namespace: 'example' }, input: { kind: 'structured' }, createdAt: '', updatedAt: '',
}
const mount = (toolId: string, defaultEnabled = true): PresetToolMount => ({
  id: `mount:${toolId}`, presetResourceId: 'preset', toolId, orderIndex: 3,
  defaultEnabled, provider: { order: 9 }, origin: {}, createdAt: '',
})
const settingMount = (id: string): SettingMount => ({
  id: `setting-mount:${id}`, settingResourceId: id, source: { kind: 'manual', id: 'global' },
  orderIndex: 0, origin: {}, createdAt: '',
})
const common = () => ({
  nodes: [], resources: [preset, setting], settingMounts: [settingMount('missing-setting')],
  tools: [availableTool], toolMounts: [mount('available'), mount('missing-tool'), mount('disabled-missing', false)],
  draftResourceIds: [], workspaceId: 'missing-reference-test', searchQuery: '', t,
  onReplaceToolMounts: vi.fn().mockResolvedValue(undefined),
  onReplaceCardResources: vi.fn().mockResolvedValue(undefined),
  onSelectResource: vi.fn(), onLoomScriptsChanged: vi.fn(),
})

beforeEach(() => {
  hooks.cursor = 0
  hooks.values = []
  hooks.effects = []
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => vi.unstubAllGlobals())

describe('missing context projections', () => {
  it('retains deduplicated missing Setting IDs without replacing them with other resources', () => {
    const input = {
      preset, resources: [preset, setting], settingMounts: [settingMount('gone'), settingMount('setting')],
      timelinePromptResourceIds: ['gone', 'timeline-gone', 'setting'],
    }
    const baseline = structuredClone(input)
    expect(resolvePresetBuildContextResources(input)).toEqual({
      resources: [setting], unavailableResourceIds: ['gone', 'timeline-gone'],
    })
    expect(input).toEqual(baseline)
  })

  it('preserves unavailable enabled and disabled Tool mounts but exposes only available enabled tools', () => {
    const mounts = [mount('available'), mount('gone'), mount('disabled', false), { ...mount('other'), presetResourceId: 'other-preset' }]
    const baseline = structuredClone(mounts)
    const projection = buildPresetToolProjection({ presetId: 'preset', tools: [availableTool], mounts })
    expect(projection.unavailableMounts.map(item => item.toolId)).toEqual(['gone', 'disabled'])
    expect(projection.providerTools.map(item => item.toolId)).toEqual(['available'])
    expect(projection.contentNodes).toEqual([])
    expect(mounts).toEqual(baseline)
  })

  it('reports missing legacy preset references without activating legacy Setting contributions', () => {
    expect(resolvePresetBuildContextResources({
      preset, resources: [preset, setting],
      settingMounts: ['setting', 'gone'].map(id => ({
        ...settingMount(id), source: { kind: 'preset', id: 'preset' },
      })),
    })).toEqual({ resources: [], unavailableResourceIds: ['gone'] })
  })

  it('shows Setting and Tool IDs and removes unavailable Tool mounts only on an explicit action', async () => {
    const props = common() as unknown as ComponentProps<typeof PresetWorkbench>
    const root = instance(() => PresetWorkbench(props))
    root()
    let tree = root()
    expect(elements(tree).filter(item => item.props.role === 'status').map(text)).toEqual([
      t('context.bindings.unavailable', { id: 'missing-setting' }),
      t('preset.tools.unavailable', { id: 'missing-tool' }),
      t('preset.tools.unavailable', { id: 'disabled-missing' }),
    ])
    let explorer = child(tree, 'PresetToolExplorer')
    const renderExplorer = instance(() => renderElement(explorer))
    click(renderExplorer(), t('preset.tools.unavailable', { id: 'missing-tool' }))
    tree = root()
    const detail = child(tree, 'PresetToolDetail')
    const renderDetail = instance(() => renderElement(detail))
    const missingDetail = renderDetail() as Element
    const renderMissing = instance(() => renderElement(missingDetail))
    const missingTree = renderMissing()
    expect(elements(missingTree).some(item => item.type === 'input' || item.type === 'textarea')).toBe(false)
    expect(text(missingTree)).toContain('"toolId": "missing-tool"')
    expect(props.onReplaceToolMounts).not.toHaveBeenCalled()
    click(missingTree, t('preset.tools.removeUnavailable'))
    await Promise.resolve()
    expect(props.onReplaceToolMounts).toHaveBeenCalledExactlyOnceWith('preset', [{
      toolId: 'available', orderIndex: 3, defaultEnabled: true, provider: { order: 9 },
    }])
    expect(props.toolMounts.map(item => item.toolId)).toEqual(['available', 'missing-tool', 'disabled-missing'])

    explorer = child(root(), 'PresetToolExplorer')
    click(renderExplorer(), `USER TOOL${t('preset.tools.kind.provider')}${t('preset.tools.mounted')}`)
    root()
    props.tools = []
    root()
    const afterDisappearance = root()
    expect(child(afterDisappearance, 'PresetToolExplorer').props.selectedToolId).toBe('available')
    props.tools = [availableTool]
    const restored = root()
    expect(child(restored, 'PresetToolDetail').props.tool).toEqual(availableTool)
    expect(props.onReplaceToolMounts).toHaveBeenCalledTimes(1)
  })

  it('keeps unavailable Tool detail and reports a failed removal without changing mounts', async () => {
    const props = common() as unknown as ComponentProps<typeof PresetWorkbench>
    vi.mocked(props.onReplaceToolMounts).mockRejectedValue(new Error('Save failed'))
    const root = instance(() => PresetWorkbench(props))
    root()
    const explorer = child(root(), 'PresetToolExplorer')
    click(instance(() => renderElement(explorer))(), t('preset.tools.unavailable', { id: 'missing-tool' }))
    const detail = child(root(), 'PresetToolDetail')
    const missing = instance(() => renderElement(detail))() as Element
    const renderMissing = instance(() => renderElement(missing))
    click(renderMissing(), t('preset.tools.removeUnavailable'))
    await Promise.resolve()
    expect(elements(renderMissing()).find(item => item.props.role === 'alert')?.props.children).toBe('Save failed')
    expect(props.toolMounts).toHaveLength(3)
  })

  it('opens built-in content from the resource workbench without replacing the editor', () => {
    const props = {
      ...common(), view: 'settings', onViewChange: vi.fn(),
      officialContentApi: { list: vi.fn(), install: vi.fn(), export: vi.fn() },
      onOfficialContentInstalled: vi.fn(),
    } as unknown as ComponentProps<typeof ContextWorkbench>
    const render = instance(() => ContextWorkbench(props))
    const button = elements(render()).find(element => element.props['aria-label'] === t('official.builtin'))!
    expect(button).toBeDefined()
    const onClick = button.props.onClick as () => void
    onClick()
    const tree = render()
    const dialog = child(tree, 'OfficialContentDialog')
    expect(dialog.props.api).toBe(props.officialContentApi)
    expect(dialog.props.onInstalled).toBe(props.onOfficialContentInstalled)
    expect(child(tree, 'ContextAssetEditor')).toBeDefined()
    const close = dialog.props.onClose as () => void
    close()
    expect(child(render(), 'OfficialContentDialog')).toBeUndefined()
  })

  it('keeps an in-collection Setting in its tree, replaces external targets, and restores the collection', () => {
    const sibling = { ...setting, id: 'sibling', rootNode: { ...setting.rootNode, id: 'sibling-root', label: 'SIBLING' } }
    const outside = { ...setting, id: 'outside', rootNode: { ...setting.rootNode, id: 'outside-root', label: 'OUTSIDE' } }
    const second = { ...setting, id: 'second', rootNode: { ...setting.rootNode, id: 'second-root', label: 'SECOND' } }
    const onReturn = vi.fn()
    const onSelectResource = vi.fn()
    const props = {
      ...common(), resources: [preset, setting, sibling, outside, second],
      card: { id: 'card', promptResourceIds: ['setting', 'sibling'] }, routeResourceId: 'setting', routeAssetId: 'setting-root',
      onReturn, onSelectResource, officialContentApi: { list: vi.fn(), install: vi.fn(), export: vi.fn() },
      onOfficialContentInstalled: vi.fn(),
    } as unknown as ComponentProps<typeof ContextWorkbench>
    const root = instance(() => ContextWorkbench(props))
    const ids = () => (child(root(), 'ContextAssetExplorer').props.displayNodes as Array<{ id: string }>).map(item => item.id)
    expect(ids()).toEqual(['setting-root', 'sibling-root'])
    expect(text(root())).not.toContain(t('promptResource.temporaryOpen'))
    props.routeResourceId = 'outside'
    props.routeAssetId = 'outside-root'
    expect(ids()).toEqual(['outside-root'])
    ;(child(root(), 'PromptResourceToolbar').props.onSelect as (id: string) => void)('second')
    expect(onSelectResource).toHaveBeenCalledExactlyOnceWith('second', true)
    click(root(), t('promptResource.returnToCollection'))
    expect(onReturn).toHaveBeenCalledOnce()
    props.routeResourceId = 'second'
    props.routeAssetId = 'second-root'
    expect(ids()).toEqual(['second-root'])
    props.routeResourceId = undefined
    props.routeAssetId = undefined
    expect(ids()).toEqual(['setting-root', 'sibling-root'])
    expect(props.card?.promptResourceIds).toEqual(['setting', 'sibling'])
  })

  it('keeps missing Card bindings visible and does not substitute the resource library', async () => {
    const props = {
      ...common(), view: 'settings', onViewChange: vi.fn(),
      card: { id: 'card', promptResourceIds: ['gone', 'also-gone'] },
    } as unknown as ComponentProps<typeof ContextWorkbench>
    const root = instance(() => ContextWorkbench(props))
    let tree = root()
    expect(child(tree, 'ContextAssetExplorer').props.displayNodes).toEqual([])
    expect(elements(tree).filter(item => item.props.role === 'status').map(text)).toEqual([
      t('context.bindings.unavailable', { id: 'gone' }), t('context.bindings.unavailable', { id: 'also-gone' }),
    ])
    ;(child(tree, 'PromptResourceToolbar').props.onBindResources as () => void)()
    tree = root()
    const dialog = child(tree, 'ResourceBindingDialog')
    expect(dialog.props.open).toBe(true)
    const renderDialog = instance(() => renderElement(dialog))
    const dialogTree = renderDialog()
    expect(text(dialogTree)).toContain(t('context.bindings.unavailable', { id: 'gone' }))
    expect(props.onReplaceCardResources).not.toHaveBeenCalled()
    click(dialogTree, t('context.bindings.removeUnavailable'))
    await Promise.resolve()
    expect(props.onReplaceCardResources).toHaveBeenCalledExactlyOnceWith('card', [])
    expect(props.card?.promptResourceIds).toEqual(['gone', 'also-gone'])
  })

  it('preserves valid Setting and non-Setting Card references during explicit unavailable removal', async () => {
    const props = {
      ...common(), view: 'settings', onViewChange: vi.fn(),
      resources: [setting, { ...setting, id: 'logic', resourceKind: 'logic' }],
      card: { id: 'card', promptResourceIds: ['gone', 'setting', 'logic'] },
    } as unknown as ComponentProps<typeof ContextWorkbench>
    const root = instance(() => ContextWorkbench(props))
    const tree = root()
    expect(elements(tree).filter(item => item.props.role === 'status').map(text)).toEqual([
      t('context.bindings.unavailable', { id: 'gone' }),
    ])
    const dialog = child(tree, 'ResourceBindingDialog')
    click(instance(() => renderElement(dialog))(), t('context.bindings.removeUnavailable'))
    await Promise.resolve()
    expect(props.onReplaceCardResources).toHaveBeenCalledExactlyOnceWith('card', ['setting', 'logic'])
    expect(props.card?.promptResourceIds).toEqual(['gone', 'setting', 'logic'])
  })

  it('reports failed Card binding removal and retains the missing IDs', async () => {
    const props = {
      ...common(), view: 'settings', onViewChange: vi.fn(),
      card: { id: 'card', promptResourceIds: ['gone', 'setting'] },
    } as unknown as ComponentProps<typeof ContextWorkbench>
    vi.mocked(props.onReplaceCardResources).mockRejectedValue(new Error('Binding conflict'))
    const tree = instance(() => ContextWorkbench(props))()
    const dialog = child(tree, 'ResourceBindingDialog')
    const renderDialog = instance(() => renderElement(dialog))
    click(renderDialog(), t('context.bindings.removeUnavailable'))
    await Promise.resolve()
    const failed = renderDialog()
    expect(elements(failed).find(item => item.props.role === 'alert')?.props.children).toBe('Binding conflict')
    expect(text(failed)).toContain(t('context.bindings.unavailable', { id: 'gone' }))
    expect(props.card?.promptResourceIds).toEqual(['gone', 'setting'])
  })
})
