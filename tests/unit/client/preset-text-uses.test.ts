import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { PresetTextUses } from '../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.js'
import type { PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { FileTreeNode } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as Array<() => void> }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useEffect: (effect: () => void) => { hooks.cursor++; hooks.effects.push(effect) },
}))

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  const trailing = value.props.renderTrailing as ((node: FileTreeNode) => unknown) | undefined
  const visit = (nodes: FileTreeNode[]): Element[] => nodes.flatMap(node => [
    ...elements(trailing?.(node)), ...visit(node.children ?? []),
  ])
  return [value, ...Object.values(value.props).flatMap(elements),
    ...(trailing ? visit(value.props.nodes as FileTreeNode[]) : [])]
}

describe('Preset text use immediate save', () => {
  it('saves each edit immediately, retains failed edits across tabs for retry, and batches resource changes', async () => {
    let preset: PromptResource = { id: 'preset', version: 3, resourceKind: 'preset', createdAt: '', updatedAt: '',
      rootNode: { id: 'root', kind: 'module', label: 'Writer' }, textUses: [] }
    const api = {
      listRules: vi.fn(async () => ({ rules: [{ id: 'public-rule', name: 'Public', enabled: true, owner: { kind: 'workspace' } }] })),
      listExtractors: vi.fn(async () => ({ extractors: [{ id: 'extractor', name: 'Extract', enabled: false, owner: { kind: 'extension', packageId: 'example.memory' } }] })),
    } as unknown as StudioApi['textTransforms']
    let rejectSave!: (error: Error) => void
    const originalPreset = preset
    const onSave = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject }))
      .mockImplementation(async input => {
        preset = { ...preset, ...input, version: preset.version + 1 }
        return preset
      })
    const onOpen = vi.fn()
    const loreContent = vi.fn(() => null)
    const render = () => { hooks.cursor = 0; return elements(PresetTextUses({ preset, api, onSave, onOpen, loreContent, t: createTranslator('zh-CN') })) }
    render()
    for (const effect of hooks.effects.splice(0)) effect()
    const control = (label: string) => render().find(element => element.props['aria-label'] === label)!
    const switchTab = (id: string) => {
      const tabs = render().find(element => element.props.ariaLabel === '预设使用配置')!
      ;(tabs.props.onChange as (id: string) => void)(id)
      expect(render().filter(element => element.props.role === 'tabpanel' && !element.props.hidden)
        .map(element => element.props['aria-label'])).toEqual([
          id === 'lore' ? 'Lore' : id === 'text' ? '正则 / 提取器' : '工具',
        ])
    }
    await vi.waitFor(() => expect(control('启用规则：Public')).toBeDefined())
    const directory = () => render().find(element => element.props.ariaLabel === '正则与提取器来源目录')!
    expect((directory().props.nodes as FileTreeNode[]).map(node => node.label)).toEqual(['我的资源', '扩展 · example.memory'])
    const ruleNode = (directory().props.nodes as FileTreeNode[])[0]!.children![0]!
    ;(directory().props.onSelect as (node: FileTreeNode) => void)(ruleNode)
    expect(onOpen).toHaveBeenCalledWith('rule', 'public-rule')
    expect(render().some(element => element.props['aria-label'] === '编辑规则：Public')).toBe(false)
    const search = render().find(element => element.props['aria-label'] === '搜索正则与提取器')!
    ;(search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'example.memory' } })
    expect((directory().props.nodes as FileTreeNode[]).map(node => node.label)).toEqual(['扩展 · example.memory'])
    ;(search.props.onClear as () => void)()
    const lorePanel = render().find(element => element.props.role === 'tabpanel'
      && element.props['aria-label'] === 'Lore')!
    expect(elements(lorePanel).some(element => element.props['aria-label'] === '使用角色世界书')).toBe(true)
    ;(control('使用角色世界书').props.onClick as () => void)()
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({
      agentPresetId: 'preset', expectedVersion: 3, useCardLore: false, useGlobalLore: true, textUses: [],
    }))
    expect(control('使用全局世界书').props.disabled).toBe(true)
    switchTab('tools')
    rejectSave(new Error('version conflict'))
    await vi.waitFor(() => expect(render().some(element => element.props.role === 'alert'
      && element.props.children === 'version conflict')).toBe(true))
    switchTab('lore')
    expect(control('使用角色世界书').props['aria-pressed']).toBe(false)
    const retry = render().find(element => element.props.children === '重试保存')!
    ;(retry.props.onClick as () => void)()
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0])
    await vi.waitFor(() => expect(control('使用全局世界书').props.disabled).toBe(false))
    ;(control('使用全局世界书').props.onClick as () => void)()
    await vi.waitFor(() => expect(control('使用全局世界书').props.disabled).toBe(false))
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ expectedVersion: 4, useCardLore: false, useGlobalLore: false })
    expect(loreContent).toHaveBeenLastCalledWith(false, false)
    switchTab('text')
    ;(control('启用规则：Public').props.onClick as () => void)()
    await vi.waitFor(() => expect(control('启用规则：Public').props.disabled).toBe(false))
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ expectedVersion: 5, textUses: [{ id: 'public-rule', kind: 'rule', enabled: false }] })
    expect(control('启用规则：Public').props['aria-pressed']).toBe(false)
    const all = (directory().props.nodes as FileTreeNode[]).flatMap(folder => folder.children ?? [])
    const actions = (directory().props.getBatchActions as (nodes: FileTreeNode[]) => import('../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js').FileTreeBatchAction[])(all)
    await actions.find(action => action.id === 'enable')!.run(all)
    expect(control('启用规则：Public').props['aria-pressed']).toBe(true)
    expect(control('启用提取器：Extract').props['aria-pressed']).toBe(true)
    const latestActions = (directory().props.getBatchActions as (nodes: FileTreeNode[]) => import('../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js').FileTreeBatchAction[])(all)
    await latestActions.find(action => action.id === 'reset')!.run(all)
    expect(control('启用规则：Public').props['aria-pressed']).toBe(true)
    expect(control('启用提取器：Extract').props['aria-pressed']).toBe(false)
    expect(preset.textUses).toEqual([])
    expect(originalPreset.textUses).toEqual([])

  })
})
