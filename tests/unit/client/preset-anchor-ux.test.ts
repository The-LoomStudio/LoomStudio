import { listPresetAnchorOptions } from '../../../apps/studio-client/src/features/prompt-resources/model/preset-anchor-options.js'
import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { ContextAssetNode, PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import { ContextAssetDetailHeader } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-detail-header/context-asset-detail-header.js'
import { ContextAssetDetail } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-detail/context-asset-detail.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useContext: () => true,
  useId: () => 'test-id',
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: Function) => fn,
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

type Element = ReactElement<Record<string, any>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, any>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}

describe('Preset Anchor UX', () => {
  const t = createTranslator('zh-CN')

  beforeEach(() => {
    hooks.cursor = 0
    hooks.values = []
    hooks.effects = []
  })

  it('shows Session history as a message sequence with no editable anchor or content, and excludes it from text targets', () => {
    const node: ContextAssetNode = { id: 'session', kind: 'virtual', label: 'History', capabilities: { targetAnchorId: '@chat.session' } }
    const detail = ContextAssetDetail({ editorMode: 'source', metadataOpen: true, node,
      onChangeNode: vi.fn(), onCommitNode: vi.fn(), onEditorModeChange: vi.fn(), onMetadataOpenChange: vi.fn(), t })
    expect(elements(detail).some(item => item.type === 'input')).toBe(false)
    expect(elements(detail).some(item => item.type === 'p' && String(item.props.children).includes('原生消息'))).toBe(true)
    const preset = { rootNode: { id: 'root', kind: 'module', label: 'Preset', children: [node,
      { id: 'lore', kind: 'virtual', label: 'Lore', capabilities: { targetAnchorId: '@lore.stable' } }] } } as PromptResource
    expect(listPresetAnchorOptions(preset).map(option => option.id)).toEqual(['@lore.stable'])
  })

  it('ContextAssetDetailHeader surfaces anchor ID in subtitle for virtual anchor nodes', () => {
    const virtualNode: ContextAssetNode = {
      id: 'default.system',
      kind: 'virtual',
      label: '基础补充',
      meta: 'preset.virtual',
      capabilities: {
        targetAnchorId: '@chat.system',
      },
    }

    const header = ContextAssetDetailHeader({
      metadataOpen: false,
      node: virtualNode,
      toggleEnabled: false,
      t,
      onEnabledChange: vi.fn(),
      onMetadataOpenChange: vi.fn(),
    })

    expect(header).toBeDefined()
    const all = elements(header)
    const subtitleSpan = all.find(item => item.type === 'span' && typeof item.props.children === 'string' && item.props.children.includes('@chat.system'))
    expect(subtitleSpan).toBeDefined()
    expect(subtitleSpan?.props.children).toBe('preset.virtual · 锚点 ID: @chat.system')
  })

  it('ContextAssetDetail renders editable anchor ID field for virtual nodes', () => {
    const onChangeNode = vi.fn()
    const onCommitNode = vi.fn()
    const virtualNode: ContextAssetNode = {
      id: 'default.tools',
      kind: 'virtual',
      label: '文本工具定义',
      meta: 'preset.virtual',
      capabilities: {
        targetAnchorId: '@chat.tools',
      },
    }

    const detail = ContextAssetDetail({
      editorMode: 'source',
      metadataOpen: true,
      node: virtualNode,
      onChangeNode,
      onCommitNode,
      onEditorModeChange: vi.fn(),
      onMetadataOpenChange: vi.fn(),
      t,
    })

    expect(detail).toBeDefined()
    const all = elements(detail)
    const anchorInput = all.find(item => item.type === 'input' && item.props.value === '@chat.tools')
    expect(anchorInput).toBeDefined()

    // Test editing Anchor ID
    anchorInput?.props.onChange?.({ target: { value: '@custom.tools' } })
    expect(onChangeNode).toHaveBeenCalledWith({ capabilities: { targetAnchorId: '@custom.tools' } })

    anchorInput?.props.onBlur?.({ target: { value: '  @custom.tools  ' } })
    expect(onCommitNode).toHaveBeenCalledWith({ capabilities: { targetAnchorId: '@custom.tools' } })
  })

  it('ContextAssetExplorer renders the anchor ID first with the name as secondary text', async () => {
    const { ContextAssetExplorer } = await import('../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-workbench.js')
    const { FileTree } = await import('../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js')

    const explorer = ContextAssetExplorer({
      active: true,
      displayNodes: [],
      expandedIds: [],
      onExpandedIdsChange: vi.fn(),
      onSelectId: vi.fn(),
      query: '', onQueryChange: vi.fn(), scrollKey: 'anchor-test', workspaceId: 'anchor-test',
      onAddNode: vi.fn(async () => undefined), onDeleteNode: vi.fn(async () => undefined), onDuplicateNode: vi.fn(async () => undefined),
      onRenameNode: vi.fn(async () => undefined), onMoveNode: vi.fn(), onToggleEnabled: vi.fn(),
      t,
    })

    const all = elements(explorer)
    const fileTree = all.find(item => item.type === FileTree)
    expect(fileTree).toBeDefined()

    const renderLabelSuffix = fileTree?.props.renderLabelSuffix as (item: unknown) => ReactElement<{ children?: ReactElement<{ text: string }>; title?: string }> | null
    expect(renderLabelSuffix).toBeDefined()

    // 1. The anchor ID is the primary label; the human-readable name is secondary.
    const anchorNode: ContextAssetNode = {
      id: 'default.system',
      kind: 'virtual',
      label: '基础补充',
      capabilities: { targetAnchorId: '@chat.system' },
    }
    const badge = renderLabelSuffix(anchorNode)
    expect(badge).toBeDefined()
    expect(fileTree?.props.formatLabel(anchorNode)).toBe('@chat.system')
    expect(elements(fileTree?.props.renderLabel(anchorNode)).some(item => item.props.text === '@chat.system')).toBe(true)
    expect(badge?.props.children?.props.text).toBe('基础补充')
    expect(badge?.props.title).toBe('基础补充')

    // 2. Virtual node where label equals anchor ID -> returns null to avoid duplicate text
    const selfNamedAnchor: ContextAssetNode = {
      id: 'default.tools',
      kind: 'virtual',
      label: '@chat.tools',
      capabilities: { targetAnchorId: '@chat.tools' },
    }
    expect(renderLabelSuffix(selfNamedAnchor)).toBeNull()

    // 3. Regular entry node -> returns null
    const regularEntry: ContextAssetNode = {
      id: 'default.entry',
      kind: 'entry',
      label: '身份设定',
    }
    expect(renderLabelSuffix(regularEntry)).toBeNull()
  })
})
