// @vitest-environment happy-dom
import { act, isValidElement, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPresetOverview } from '../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.js'
import type { AgentToolDefinition, Card, PresetToolMount, PromptResource, LoreMount } from '../../../apps/studio-client/src/entities/index.js'
import { renderHook } from '../../support/client/render-hook.js'
import { FileTree, type FileTreeNode } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js'

const mounted: ReturnType<typeof renderHook>[] = []
afterEach(() => { for (const hook of mounted.splice(0)) hook.unmount() })
function renderOverview(props: Parameters<typeof AgentPresetOverview>[0]) {
  const hook = renderHook(() => AgentPresetOverview(props))
  mounted.push(hook)
  return () => { hook.rerender(); return elements(hook.current) }
}

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  const trailing = value.props.renderTrailing as ((node: FileTreeNode) => unknown) | undefined
  const visit = (nodes: FileTreeNode[]): Element[] => nodes.flatMap(node => [
    ...elements(trailing?.(node)), ...visit(node.children ?? []),
  ])
  const loreContent = value.props.loreContent
  return [value, ...Object.values(value.props).flatMap(elements),
    ...(typeof loreContent === 'function'
      ? elements(loreContent((value.props.preset as PromptResource).useCardLore ?? true, (value.props.preset as PromptResource).useGlobalLore ?? true)) : []),
    ...(trailing ? visit(value.props.nodes as FileTreeNode[]) : [])]
}

describe('Preset Lore mounts', () => {
  it('preserves an unresolved mount by identity when adding another Lore, and lets it be removed', async () => {
    const preset = { id: 'preset', version: 1, resourceKind: 'preset',
      rootNode: { id: 'root', label: 'Writer' } } as PromptResource
    const resources = [{ id: 'new', resourceKind: 'lore', rootNode: { id: 'new-root', label: 'New' } }] as PromptResource[]
    const missing = { id: 'missing-mount', loreResourceId: 'old', resolvedLoreResourceId: null,
      source: { kind: 'preset', id: 'preset' }, orderIndex: 0 } as LoreMount
    const save = vi.fn(async () => {})
    const open = vi.fn()
    const props = {
      preset, resources, loreMounts: [missing], tools: [], toolMounts: [], unavailableMounts: [],
      onReplaceLoreMounts: save, onReplaceMounts: vi.fn(), onSaveModel: vi.fn(), onOpenLore: open,
      onDuplicate: vi.fn(), onDelete: vi.fn(), onExport: vi.fn(),
      textTransformsApi: {}, modelProfiles: [], providerAccounts: [],
      t: (key: string) => key,
    } as unknown as Parameters<typeof AgentPresetOverview>[0]
    const render = renderOverview(props)
    const click = (element: Element) => act(() => (element.props.onClick as () => void)())
    const tree = render()
    const directory = () => render().find(element => element.props.ariaLabel === 'Lore 来源目录')!
    const nodes = directory().props.nodes as FileTreeNode[]
    expect(nodes.map(node => node.label)).toEqual(['个人', '不可用引用'])
    expect(nodes[1]!.children![0]!.label).toBe('Lore 引用不可用：old')
    const search = render().find(element => element.props['aria-label'] === '搜索 Lore')!
    ;(search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'old' } })
    expect((directory().props.nodes as FileTreeNode[]).map(node => node.label)).toEqual(['不可用引用'])
    ;(search.props.onClear as () => void)()
    ;(directory().props.onExpandedIdsChange as (ids: string[]) => void)([])
    expect(directory().props.expandedIds).toEqual([])
    expect(tree.some(element => element.props['aria-label'] === '编辑 Lore')).toBe(false)
    ;(directory().props.onSelect as (node: FileTreeNode) => void)(nodes[0]!.children![0]!)
    expect(open).toHaveBeenCalledWith('new', 'new-root')
    const enable = tree.find(element => element.props['aria-label'] === '启用 Lore：New')!
    expect(enable.props['aria-pressed']).toBe(false)
    expect(tree.some(element => /上移|下移/.test(String(element.props['aria-label'])))).toBe(false)
    click(enable)
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ kind: 'preset', id: 'preset' },
      [{ id: 'missing-mount' }, { loreResourceId: 'new' }], ['missing-mount']))
    click(render().find(element => element.props['aria-label'] === '移除 Lore')!)
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith({ kind: 'preset', id: 'preset' }, [], ['missing-mount']))
  })

  it('uses the shared tool tree with inline descriptions and preserves configuration on enable', async () => {
    const tool: AgentToolDefinition = { id: 'official/codeact_json', name: 'CodeAct JSON', description: 'Structured execution',
      version: 1, createdAt: '', updatedAt: '',
      owner: { namespace: 'official' }, input: { kind: 'structured', schema: { type: 'object' } },
    }
    const mount: PresetToolMount = { id: 'mount', presetResourceId: 'preset', toolId: tool.id, orderIndex: 3,
      origin: {}, createdAt: '',
      defaultEnabled: false, activation: { kind: 'always' }, provider: { order: 5 },
    }
    const save = vi.fn(async () => {})
    const props = {
      preset: { id: 'preset', version: 1, resourceKind: 'preset', rootNode: { id: 'root', label: 'Writer' } },
      resources: [], loreMounts: [], tools: [tool], toolMounts: [mount], unavailableMounts: [],
      onReplaceMounts: save, onReplaceLoreMounts: vi.fn(), onSaveModel: vi.fn(),
      onDuplicate: vi.fn(), onDelete: vi.fn(), onExport: vi.fn(),
      textTransformsApi: {}, modelProfiles: [], providerAccounts: [], t: (key: string) => key,
    } as unknown as Parameters<typeof AgentPresetOverview>[0]
    const render = renderOverview(props)
    const directory = () => render().find(element => element.props.ariaLabel === '工具来源目录')!
    expect(directory().type).toBe(FileTree)
    const group = (directory().props.nodes as FileTreeNode[])[0]!
    const leaf = group.children![0]!
    expect(group.label).toBe('CodeAct（Freeform / JSON）')
    expect(group.meta).toBe('0 / 1 已启用')
    expect((directory().props.isMuted as (node: FileTreeNode) => boolean)(leaf)).toBe(true)


    const detail = () => (directory().props.renderExpandedRow as (node: FileTreeNode) => Element | null)(leaf)
    expect(detail()?.props.children).toBe(tool.description)
    expect(directory().props.expandedIds).toEqual([group.id])
    ;(directory().props.onExpandedIdsChange as (ids: string[]) => void)([group.id, leaf.id])
    expect(detail()?.props.children).toBe(tool.description)
    const enable = render().find(element => element.props['aria-label'] === '启用工具：CodeAct JSON')!
    expect(enable.props['aria-pressed']).toBe(false)
    ;(enable.props.onClick as () => void)()
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('preset', [{
      toolId: tool.id, orderIndex: 3, defaultEnabled: true,
      activation: { kind: 'always' }, provider: { order: 5 },
    }], ['mount']))
  })

  it('places current Card Lore first and distinguishes inherited use from explicit mounts', () => {
    const preset = { id: 'preset', version: 1, resourceKind: 'preset',
      rootNode: { id: 'root', label: 'Writer' } } as PromptResource
    const props = {
      preset, card: { id: 'card', name: 'Current Card', promptResourceIds: ['card-setting'] } as Card,
      resources: [
        { id: 'other', resourceKind: 'lore', rootNode: { id: 'other-root', label: 'Other' } },
        { id: 'card-setting', resourceKind: 'lore', sourceArtifactRef: {},
          rootNode: { id: 'card-root', label: 'Card Worldbook' } },
      ], loreMounts: [], tools: [], toolMounts: [], unavailableMounts: [],
      onReplaceLoreMounts: vi.fn(), onReplaceMounts: vi.fn(), onSaveModel: vi.fn(),
      onDuplicate: vi.fn(), onDelete: vi.fn(), onExport: vi.fn(),
      textTransformsApi: {}, modelProfiles: [], providerAccounts: [], t: (key: string) => key,
    } as unknown as Parameters<typeof AgentPresetOverview>[0]
    const render = renderOverview(props)
    const directory = () => render().find(element => element.props.ariaLabel === 'Lore 来源目录')!
    const groups = directory().props.nodes as FileTreeNode[]
    expect(groups.map(node => node.label)).toEqual(['角色', '个人'])
    expect(groups[0]!.children![0]!.label).toBe('Current Card')
    const leaf = groups[0]!.children![0]!.children![0]!
    expect(leaf.meta).toBe('随角色默认采用')
    expect((directory().props.isMuted as (node: FileTreeNode) => boolean)(leaf)).toBe(false)
    const icon = (directory().props.renderIcon as (node: FileTreeNode) => Element)(leaf)
    expect((icon.type as { displayName?: string }).displayName).toBe('Star')
    const inherited = render().find(element => element.props['aria-label'] === '停用 Lore：Card Worldbook')!
    expect(inherited.props['aria-pressed']).toBe(true)
    expect(inherited.props.disabled).toBe(true)
    expect(props.onReplaceLoreMounts).not.toHaveBeenCalled()
    props.preset = { ...preset, useCardLore: false }
    const disabled = render().find(element => element.props['aria-label'] === '启用 Lore：Card Worldbook')!
    expect(disabled.props['aria-pressed']).toBe(false)
    expect(disabled.props.disabled).toBe(false)
    expect((directory().props.isMuted as (node: FileTreeNode) => boolean)(leaf)).toBe(true)
    props.loreMounts = [{ id: 'global-mount', loreResourceId: 'other', source: { kind: 'manual', id: 'global' }, orderIndex: 0 } as LoreMount]
    const inheritedGlobal = render().find(element => element.props['aria-label'] === '停用 Lore：Other')!
    expect(inheritedGlobal.props.disabled).toBe(true)
    expect(inheritedGlobal.props['aria-pressed']).toBe(true)
    props.preset = { ...props.preset, useGlobalLore: false }
    const unselectedGlobal = render().find(element => element.props['aria-label'] === '启用 Lore：Other')!
    expect(unselectedGlobal.props.disabled).toBe(false)

  })
})
