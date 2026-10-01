import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPresetOverview } from '../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.js'
import type { AgentToolDefinition, Card, PresetToolMount, PromptResource, SettingMount } from '../../../apps/studio-client/src/entities/index.js'
import { FileTree, type FileTreeNode } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
}))
beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  const trailing = value.props.renderTrailing as ((node: FileTreeNode) => unknown) | undefined
  const visit = (nodes: FileTreeNode[]): Element[] => nodes.flatMap(node => [
    ...elements(trailing?.(node)), ...visit(node.children ?? []),
  ])
  const settingsContent = value.props.settingsContent
  return [value, ...Object.values(value.props).flatMap(elements),
    ...(typeof settingsContent === 'function'
      ? elements(settingsContent((value.props.preset as PromptResource).useCardSettings ?? true)) : []),
    ...(trailing ? visit(value.props.nodes as FileTreeNode[]) : [])]
}

describe('Preset Setting mounts', () => {
  it('preserves an unresolved mount by identity when adding another Setting, and lets it be removed', async () => {
    const preset = { id: 'preset', version: 1, resourceKind: 'preset',
      rootNode: { id: 'root', label: 'Writer' } } as PromptResource
    const resources = [{ id: 'new', resourceKind: 'setting', rootNode: { id: 'new-root', label: 'New' } }] as PromptResource[]
    const missing = { id: 'missing-mount', settingResourceId: 'old', resolvedSettingResourceId: null,
      source: { kind: 'preset', id: 'preset' }, orderIndex: 0 } as SettingMount
    const save = vi.fn(async () => {})
    const open = vi.fn()
    const props = {
      preset, resources, settingMounts: [missing], tools: [], toolMounts: [], unavailableMounts: [],
      onReplaceSettingMounts: save, onReplaceMounts: vi.fn(), onSaveModel: vi.fn(), onOpenSetting: open,
      onDuplicate: vi.fn(), onDelete: vi.fn(), onExport: vi.fn(),
      textTransformsApi: {}, modelProfiles: [], providerAccounts: [],
      t: (key: string) => key,
    } as unknown as Parameters<typeof AgentPresetOverview>[0]
    const render = () => { hooks.cursor = 0; return elements(AgentPresetOverview(props)) }
    const click = (element: Element) => (element.props.onClick as () => void)()
    const tree = render()
    const directory = () => render().find(element => element.props.ariaLabel === 'Settings 来源目录')!
    const nodes = directory().props.nodes as FileTreeNode[]
    expect(nodes.map(node => node.label)).toEqual(['不可用引用', '我的资源'])
    expect(nodes[0]!.children![0]!.label).toBe('Settings 引用不可用：old')
    const search = render().find(element => element.props['aria-label'] === '搜索 Settings')!
    ;(search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'old' } })
    expect((directory().props.nodes as FileTreeNode[]).map(node => node.label)).toEqual(['不可用引用'])
    ;(search.props.onClear as () => void)()
    ;(directory().props.onExpandedIdsChange as (ids: string[]) => void)(['source:不可用引用'])
    expect(directory().props.expandedIds).toEqual(['source:不可用引用'])
    expect(tree.some(element => element.props['aria-label'] === '编辑 Settings')).toBe(false)
    ;(directory().props.onSelect as (node: FileTreeNode) => void)(nodes[1]!.children![0]!)
    expect(open).toHaveBeenCalledWith('new', 'new-root')
    const enable = tree.find(element => element.props['aria-label'] === '启用 Settings：New')!
    expect(enable.props['aria-pressed']).toBe(false)
    expect(tree.some(element => /上移|下移/.test(String(element.props['aria-label'])))).toBe(false)
    click(enable)
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ kind: 'preset', id: 'preset' },
      [{ id: 'missing-mount' }, { settingResourceId: 'new' }]))
    click(render().find(element => element.props['aria-label'] === '移除 Settings')!)
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith({ kind: 'preset', id: 'preset' }, []))
  })

  it('uses the shared tool tree with expandable descriptions and preserves configuration on enable', async () => {
    const tool = { id: 'official/codeact_json', name: 'CodeAct JSON', description: 'Structured execution',
      owner: { namespace: 'official' }, input: { kind: 'structured', schema: { type: 'object' } },
    } as AgentToolDefinition
    const mount = { id: 'mount', presetResourceId: 'preset', toolId: tool.id, orderIndex: 3,
      defaultEnabled: false, activation: { kind: 'always' }, provider: { order: 5 },
    } as PresetToolMount
    const save = vi.fn(async () => {})
    const props = {
      preset: { id: 'preset', version: 1, resourceKind: 'preset', rootNode: { id: 'root', label: 'Writer' } },
      resources: [], settingMounts: [], tools: [tool], toolMounts: [mount], unavailableMounts: [],
      onReplaceMounts: save, onReplaceSettingMounts: vi.fn(), onSaveModel: vi.fn(),
      onDuplicate: vi.fn(), onDelete: vi.fn(), onExport: vi.fn(),
      textTransformsApi: {}, modelProfiles: [], providerAccounts: [], t: (key: string) => key,
    } as unknown as Parameters<typeof AgentPresetOverview>[0]
    const render = () => { hooks.cursor = 0; return elements(AgentPresetOverview(props)) }
    const directory = () => render().find(element => element.props.ariaLabel === '工具来源目录')!
    expect(directory().type).toBe(FileTree)
    const group = (directory().props.nodes as FileTreeNode[])[0]!
    const leaf = group.children![0]!
    expect(group.label).toBe('CodeAct（Freeform / JSON）')
    expect(group.meta).toBe('0 / 1 已启用')
    expect((directory().props.isMuted as (node: FileTreeNode) => boolean)(leaf)).toBe(true)
    const detail = () => (directory().props.renderExpandedRow as (node: FileTreeNode) => Element | null)(leaf)
    expect(detail()).toBeNull()
    ;(directory().props.onExpandedIdsChange as (ids: string[]) => void)([group.id, leaf.id])
    expect(detail()?.props.children).toBe(tool.description)
    const enable = render().find(element => element.props['aria-label'] === '启用工具：CodeAct JSON')!
    expect(enable.props['aria-pressed']).toBe(false)
    ;(enable.props.onClick as () => void)()
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('preset', [{
      toolId: tool.id, orderIndex: 3, defaultEnabled: true,
      activation: { kind: 'always' }, provider: { order: 5 },
    }]))
  })

  it('places current Card Settings first and distinguishes inherited use from explicit mounts', () => {
    const preset = { id: 'preset', version: 1, resourceKind: 'preset',
      rootNode: { id: 'root', label: 'Writer' } } as PromptResource
    const props = {
      preset, card: { id: 'card', name: 'Current Card', promptResourceIds: ['card-setting'] } as Card,
      resources: [
        { id: 'other', resourceKind: 'setting', rootNode: { id: 'other-root', label: 'Other' } },
        { id: 'card-setting', resourceKind: 'setting', sourceArtifactRef: {},
          rootNode: { id: 'card-root', label: 'Card Worldbook' } },
      ], settingMounts: [], tools: [], toolMounts: [], unavailableMounts: [],
      onReplaceSettingMounts: vi.fn(), onReplaceMounts: vi.fn(), onSaveModel: vi.fn(),
      onDuplicate: vi.fn(), onDelete: vi.fn(), onExport: vi.fn(),
      textTransformsApi: {}, modelProfiles: [], providerAccounts: [], t: (key: string) => key,
    } as unknown as Parameters<typeof AgentPresetOverview>[0]
    const render = () => { hooks.cursor = 0; return elements(AgentPresetOverview(props)) }
    const directory = () => render().find(element => element.props.ariaLabel === 'Settings 来源目录')!
    const groups = directory().props.nodes as FileTreeNode[]
    expect(groups.map(node => node.label)).toEqual(['当前角色 · Current Card', '我的资源'])
    const leaf = groups[0]!.children![0]!
    expect(leaf.meta).toBe('随角色默认采用')
    expect((directory().props.isMuted as (node: FileTreeNode) => boolean)(leaf)).toBe(false)
    const icon = (directory().props.renderIcon as (node: FileTreeNode) => Element)(leaf)
    expect((icon.type as { displayName?: string }).displayName).toBe('Star')
    const inherited = render().find(element => element.props['aria-label'] === '停用 Settings：Card Worldbook')!
    expect(inherited.props['aria-pressed']).toBe(true)
    expect(inherited.props.disabled).toBe(true)
    expect(props.onReplaceSettingMounts).not.toHaveBeenCalled()
    props.preset = { ...preset, useCardSettings: false }
    const disabled = render().find(element => element.props['aria-label'] === '启用 Settings：Card Worldbook')!
    expect(disabled.props['aria-pressed']).toBe(false)
    expect(disabled.props.disabled).toBe(false)
    expect((directory().props.isMuted as (node: FileTreeNode) => boolean)(leaf)).toBe(true)
  })
})
