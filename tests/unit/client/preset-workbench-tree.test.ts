// @vitest-environment happy-dom
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PresetWorkbench, PresetArrangementWorkbench } from '../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.js'
import { useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-resource-token-snapshot.js', () => ({
  useResourceTokenSnapshot: () => ({ pending: false, refresh: vi.fn() }),
}))
vi.mock('../../../apps/studio-client/src/shared/ui/extension-icon/extension-icon.js', async original => ({
  ...await original<typeof import('../../../apps/studio-client/src/shared/ui/extension-icon/extension-icon.js')>(),
  useExtensionIdentities: () => [],
}))
vi.mock('../../../apps/studio-client/src/shared/studio-shell/use-workbench-view.js', async () => {
  const react = await import('react')
  return { useWorkbenchView: (_key: string, initial: string) => react.useState(initial) }
})
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useId: () => 'test-id',
  useMemo: (fn: () => unknown) => fn(),
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
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
  return {
    ...actual,
    useStudioLayoutStore: Object.assign(
      (selector: (state: unknown) => unknown) => selector({
        ...actual.useStudioLayoutStore.getState(),
        assetLayouts: {
          preset: { explorerWidth: 260, views: { 'test-ws': { selectedId: 'preset-root-1' } } },
          resources: { explorerWidth: 260, views: {} },
        },
      }),
      { getState: actual.useStudioLayoutStore.getState },
    ),
  }
})
vi.mock('../../../apps/studio-client/src/features/state-variables/ui/macro-authoring-panel.js', () => ({
  useMacroAuthoring: () => ({ selectRow: () => undefined, selectNode: () => undefined }),
  MacroAuthoringDetail: () => null,
  MacroAuthoringExplorer: () => null,
}))
vi.mock('../../../apps/studio-client/src/widgets/text-transform-workbench/text-transform-panel.js', () => ({
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

function child(tree: unknown, name: string): Element {
  const match = elements(tree).find(item => typeof item.type === 'function' && item.type.name === name)
  expect(match, name).toBeDefined()
  return match!
}

describe('PresetWorkbench tree and rename ID mapping', () => {
  beforeEach(() => {
    hooks.cursor = 0
    hooks.values = []
    hooks.effects = []
  })

  it('assigns preset.rootNode.id to the explorer displayNodes and resolves rootNode.id on rename', async () => {
    const presetResource: PromptResource = {
      id: 'prompt-resource-uuid-1234',
      version: 1,
      resourceKind: 'preset',
      rootNode: {
        id: 'preset-root-node-5678',
        kind: 'module',
        label: 'My Test Preset',
        children: [{ id: 'child-message', kind: 'message', label: 'Message 1' }],
      },
      createdAt: '',
      updatedAt: '',
    }

    const onRenameNode = vi.fn().mockResolvedValue(undefined)
    const props = {
      active: true,
      resources: [presetResource, { ...presetResource, id: 'other', rootNode: { id: 'other-root', kind: 'module', label: 'Other' } }],
      loreMounts: [],
      tools: [],
      toolMounts: [],
      draftResourceIds: [],
      workspaceId: 'test-ws',
      searchQuery: '',
      t: createTranslator('zh-CN'),
      onRenameNode,
      onSaveModel: vi.fn(),
      onChangeNode: vi.fn(),
      onCommitNode: vi.fn(),
      onMoveNode: vi.fn(),
      onAddNode: vi.fn(),
      onDuplicateNode: vi.fn(),
      onDeleteNode: vi.fn(),
      onCreateResource: vi.fn(),
      onDuplicateResource: vi.fn(),
      onDeleteResource: vi.fn(),
      onImportResource: vi.fn(),
      onExportResource: vi.fn(),
      onReplaceToolMounts: vi.fn(),
      onReplaceLoreMounts: vi.fn(),
      onUpdateTool: vi.fn(),
      onDiscardDraft: vi.fn(),
      onRetryDraft: vi.fn(),
      modelProfiles: [],
      providerAccounts: [],
    } as unknown as ComponentProps<typeof PresetWorkbench>

    const tree = PresetArrangementWorkbench({ ...props, onConfigure: vi.fn() })
    const explorer = child(tree, 'ContextAssetExplorer')
    const displayNodes = explorer.props.displayNodes as ContextAssetNode[]

    expect(displayNodes).toHaveLength(1)

    for (const effect of hooks.effects.splice(0)) effect()
    expect(useStudioLayoutStore.getState().assetLayouts.preset.views['test-ws']?.expandedIds)
      .toEqual(expect.arrayContaining(['preset-root-node-5678', 'child-message']))
    // A later resource refresh must not reopen a message the user just collapsed.
    useStudioLayoutStore.getState().setAssetExpandedIds('preset', 'test-ws', ['preset-root-node-5678'])
    hooks.cursor = 0
    PresetArrangementWorkbench({ ...props, resources: [{ ...presetResource, version: 2 }], onConfigure: vi.fn() })
    for (const effect of hooks.effects.splice(0)) effect()
    expect(useStudioLayoutStore.getState().assetLayouts.preset.views['test-ws']?.expandedIds)
      .toEqual(['preset-root-node-5678'])

    // Verify root node uses AST rootNode.id instead of resource.id
    expect(displayNodes[0]?.id).toBe('preset-root-node-5678')
    expect(displayNodes[0]?.label).toBe('My Test Preset')

    // Verify renaming via rootNode.id invokes onRenameNode with rootNode.id
    const renameHandler = explorer.props.onRenameNode as (id: string, label: string) => Promise<void>
    await renameHandler('preset-root-node-5678', 'New Preset Name')
    expect(onRenameNode).toHaveBeenCalledWith('preset-root-node-5678', 'New Preset Name')

    // Verify defensive fallback: if called with resource ID, it resolves to rootNode.id
    await renameHandler('prompt-resource-uuid-1234', 'Another Name')
    expect(onRenameNode).toHaveBeenCalledWith('preset-root-node-5678', 'Another Name')
  })
  it('opens configuration without navigating or changing the selected preset, and tracks persistence until completion', async () => {
    const first = { id: 'one', version: 1, resourceKind: 'preset', rootNode: { id: 'root-one', kind: 'module', label: 'One' }, createdAt: '', updatedAt: '' } as PromptResource
    const second = { ...first, id: 'two', rootNode: { ...first.rootNode, id: 'root-two', label: 'Two' } }
    const commit = Promise.withResolvers<PromptResource>()
    const onSaveModel = vi.fn(() => commit.promise)
    const onSelectResource = vi.fn()
    const props = { active: true, resources: [first, second], loreMounts: [], toolMounts: [], tools: [], draftResourceIds: [],
      selectedResourceId: first.id, onSelectResource, onSaveModel, t: createTranslator('zh-CN') } as unknown as ComponentProps<typeof PresetWorkbench>
    const render = () => { hooks.cursor = 0; return PresetWorkbench(props) }
    const initial = render()
    const catalog = child(initial, 'PresetLibraryCatalog')
    ;(catalog.props.onConfigure as (id: string) => void)('two')
    expect(onSelectResource).not.toHaveBeenCalled()
    const overlay = child(render(), 'PresetConfigurationDialog')
    expect(overlay.props.open).toBe(true)
    const configuration = child(render(), 'AgentPresetOverview')
    expect((configuration.props.preset as PromptResource).id).toBe('two')
    const saving = (configuration.props.onSaveModel as (input: unknown) => Promise<PromptResource>)({ agentPresetId: 'two', expectedVersion: 1, delivery: 'complete' })
    expect(child(render(), 'PresetConfigurationDialog').props.busy).toBe(true)
    commit.resolve({ ...second, version: 2, delivery: 'complete' })
    await saving
    expect(child(render(), 'PresetConfigurationDialog').props.busy).toBe(false)
    ;(overlay.props.onClose as () => void)()
    expect(child(render(), 'PresetConfigurationDialog').props.open).toBe(false)
    expect(props.selectedResourceId).toBe('one')
    expect(onSelectResource).not.toHaveBeenCalled()
    ;(child(render(), 'PresetLibraryCatalog').props.onOpen as (id: string) => void)('two')
    expect(onSelectResource).toHaveBeenCalledExactlyOnceWith('two')
  })

})
