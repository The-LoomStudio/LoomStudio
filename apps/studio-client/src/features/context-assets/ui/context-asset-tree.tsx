import { Anchor, Book, Bot, Code2, Cog, Copy, FileText, Folder, FolderOpen, FolderPlus, MessageSquare, MessagesSquare, Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import type { ContextAssetNode } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { MenuAction } from '@loom-studio/ui'
export { resolveVirtualDisplayName } from '../model/context-asset-tree.js'

type ContextAssetTreeActionsInput = {
  onAdd(parentId: string): void
  onDelete(id: string): void
  onDuplicate(id: string): void
  onToggleEnabled(id: string, enabled: boolean): void
  onRename?(id: string): void
  onAddFolder?(parentId: string): void
  onAddAnchor?(parentId: string): void
  onAddMessageBlock?(parentId: string): void
  onChangeRole?(id: string, role: 'system' | 'user' | 'assistant' | 'developer'): void
  t: Translator
}

export type ContextAssetActivationTone = 'always' | 'conditional' | 'manual'

function readContextAssetActivationTone(node: ContextAssetNode): ContextAssetActivationTone {
  const activation = node.capabilities?.activation
  if (activation) {
    if (activation.kind === 'always') return 'always'
    if (activation.kind === 'keyword' || activation.kind === 'condition' || activation.kind === 'all') {
      return 'conditional'
    }
    if (activation.kind === 'manual') return 'manual'
  }
  const lifecycle = node.projection?.lifecycle ?? node.capabilities?.lifecycle?.lifecycle
  if (lifecycle === 'always') return 'always'
  if (lifecycle === 'conditional' || lifecycle === 'fresh' || lifecycle === 'current-turn') return 'conditional'

  return 'manual'
}

export type ContextAssetBadgeInfo = {
  tone: ContextAssetActivationTone
  label: string
}

export function readContextAssetBadgeInfo(
  node: ContextAssetNode | undefined,
  t: Translator,
): ContextAssetBadgeInfo | null {
  if (!node || node.kind === 'module' || node.kind === 'slot') return null

  const tone = readContextAssetActivationTone(node)
  if (tone === 'always') {
    return { tone, label: t('context.activation.badgeAlways') }
  }

  if (tone === 'conditional') {
    const activation = node.capabilities?.activation
    if (activation?.kind === 'keyword' && activation.keywords && activation.keywords.length > 0) {
      const kw = activation.keywords[0]?.trim()
      if (kw) {
        const shortKw = kw.length > 8 ? `${kw.slice(0, 8)}…` : kw
        return { tone, label: `${t('context.activation.badgeKeyword')}: ${shortKw}` }
      }
    }
    return { tone, label: t('context.activation.badgeConditional') }
  }

  return { tone, label: t('context.activation.badgeAiSearch') }
}

export function renderContextAssetTreeIcon(node: ContextAssetNode, expanded: boolean) {
  if (node.kind === 'slot') return null
  if (node.kind === 'module') return <Book />
  if (node.kind === 'folder') return expanded ? <FolderOpen /> : <Folder />
  if (node.kind === 'virtual') return <Anchor />
  if (node.kind === 'message') {
    const role = node.capabilities?.roleHint
    if (role === 'system') return <Cog aria-hidden="true" />
    if (role === 'developer') return <Code2 aria-hidden="true" />
    if (role === 'assistant') return <Bot aria-hidden="true" />
    if (role === 'user') return <UserRound aria-hidden="true" />
    return <MessagesSquare aria-hidden="true" />
  }

  const tone = readContextAssetActivationTone(node)
  const isEnabled = node.enabled !== false
  const toneColor = tone === 'always'
    ? 'var(--loom-color-info, #89b4fa)'
    : tone === 'conditional'
      ? 'var(--loom-color-success, #a6e3a1)'
      : 'var(--loom-color-text, #ccd6f5)'

  const toneStyle = {
    color: toneColor,
    ...(isEnabled ? {} : { opacity: 0.58 }),
  }

  const baseTitle = tone === 'always'
    ? '常驻 (Always)'
    : tone === 'conditional'
      ? '条件/关键词触发 (Conditional)'
      : '无条件/靠AI检索 (Manual / Search)'

  const toneTitle = isEnabled ? baseTitle : `${baseTitle} (已禁用)`

  if (node.kind === 'script') {
    return (
      <span style={{ display: 'inline-flex', ...toneStyle }} title={toneTitle}>
        <Code2 />
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', ...toneStyle }} title={toneTitle}>
      <FileText />
    </span>
  )
}

export const renderContextAssetLifecycleIndicator: (node: ContextAssetNode, t: Translator) => null = () => null

export function readContextAssetTreeActions(
  node: ContextAssetNode,
  input: ContextAssetTreeActionsInput,
): MenuAction[] {
  const canAdd = (node.kind === 'module' || node.kind === 'folder' || node.kind === 'message') && !isReadOnlyContextAssetTreeNode(node)
  const canDuplicate = node.kind !== 'module' && node.kind !== 'slot' && !isReadOnlyContextAssetTreeNode(node)
  const isPreset = node.category === 'preset'
  const isPresetRoot = isPreset && node.kind === 'module'
  const canAddEntryOrAnchor = canAdd && !isPresetRoot
  const isSettingLayer = node.category === 'setting' && node.kind === 'module'
  const items: MenuAction[] = []

  if (canToggleContextAssetEnabled(node)) {
    items.push({
      checked: node.enabled !== false,
      id: 'enabled',
      label: input.t('context.actionEnable'),
      onSelect: () => input.onToggleEnabled(node.id, node.enabled === false),
    })
    if (isSettingLayer || canAdd || canDuplicate) items.push({ id: 'state-separator', type: 'separator' })
  }
  if (canAddEntryOrAnchor) items.push({ icon: <Plus aria-hidden="true" />, id: 'add', label: input.t('context.actionAdd'), onSelect: () => input.onAdd(node.id) })
  if (canAdd && input.onAddFolder) items.push({ icon: <FolderPlus aria-hidden="true" />, id: 'addFolder', label: input.t('context.actionAddFolder'), onSelect: () => input.onAddFolder!(node.id) })
  if (canAddEntryOrAnchor && isPreset && input.onAddAnchor) items.push({ icon: <Anchor aria-hidden="true" />, id: 'addAnchor', label: input.t('context.actionAddAnchor'), onSelect: () => input.onAddAnchor!(node.id) })
  if (canAdd && isPreset && input.onAddMessageBlock) items.push({ icon: <MessageSquare aria-hidden="true" />, id: 'addMessageBlock', label: input.t('context.actionAddMessageBlock'), onSelect: () => input.onAddMessageBlock!(node.id) })

  if (node.kind === 'message' && input.onChangeRole) {
    const currentRole = node.capabilities?.roleHint ?? 'system'
    const roles: Array<{ id: 'system' | 'user' | 'assistant' | 'developer'; label: string; icon: React.ReactNode }> = [
      { id: 'system', label: 'Role: System', icon: <Cog aria-hidden="true" /> },
      { id: 'user', label: 'Role: User', icon: <UserRound aria-hidden="true" /> },
      { id: 'assistant', label: 'Role: Assistant', icon: <Bot aria-hidden="true" /> },
      { id: 'developer', label: 'Role: Developer', icon: <Code2 aria-hidden="true" /> },
    ]
    items.push({ id: 'role-separator', type: 'separator' })
    for (const r of roles) {
      items.push({
        checked: currentRole === r.id,
        icon: r.icon,
        id: `role-${r.id}`,
        label: r.label,
        onSelect: () => input.onChangeRole!(node.id, r.id),
      })
    }
  }

  if (canDuplicate) items.push({ icon: <Copy aria-hidden="true" />, id: 'duplicate', label: input.t('context.actionDuplicate'), onSelect: () => input.onDuplicate(node.id) })
  if (!isReadOnlyContextAssetTreeNode(node)) {
    items.push({ icon: <Pencil aria-hidden="true" />, id: 'rename', label: input.t('context.actionRename'), onSelect: () => input.onRename?.(node.id) })
  }
  if (canDuplicate) {
    if (items.length > 0) items.push({ id: 'delete-separator', type: 'separator' })
    items.push({ icon: <Trash2 aria-hidden="true" />, id: 'delete', label: input.t('context.actionDelete'), onSelect: () => input.onDelete(node.id), tone: 'danger' })
  }
  return items
}

export function canToggleContextAssetEnabled(node: ContextAssetNode | undefined): node is ContextAssetNode {
  return node?.kind === 'entry' && !isReadOnlyContextAssetTreeNode(node)
}

export function isReadOnlyContextAssetTreeNode(node: ContextAssetNode): boolean {
  return node.readOnly === true
    || node.category === 'runtime'
    || node.category === 'history'
    || node.projection?.sourceKind === 'virtual'
    || node.id.startsWith('history-')
}
