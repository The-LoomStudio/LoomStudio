import { Anchor, Bot, Code2, Cog, Copy, FileText, Folder, FolderOpen, FolderPlus, GripVertical, Layers, MessageSquare, MessagesSquare, Package, Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import type { ContextAssetNode } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { MenuAction } from '../../../shared/ui/menu-action.js'
import { StatusIndicator } from '../../../shared/ui/status-indicator/status-indicator.js'

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

export function renderContextAssetTreeIcon(node: ContextAssetNode, expanded: boolean) {
  if (node.kind === 'module') return <Package />
  if (node.kind === 'folder') return expanded ? <FolderOpen /> : <Folder />
  if (node.kind === 'script') return <Code2 />
  if (node.kind === 'order') return <GripVertical />
  if (node.kind === 'virtual') return <Anchor />
  if (node.kind === 'slot') return <Layers />
  if (node.kind === 'message') {
    const role = node.capabilities?.roleHint
    if (role === 'system') return <Cog aria-hidden="true" />
    if (role === 'developer') return <Code2 aria-hidden="true" />
    if (role === 'assistant') return <Bot aria-hidden="true" />
    if (role === 'user') return <UserRound aria-hidden="true" />
    return <MessagesSquare aria-hidden="true" />
  }
  return <FileText />
}

export function renderContextAssetLifecycleIndicator(node: ContextAssetNode, t: Translator) {
  if (node.kind === 'message') return null
  if (node.enabled === false || node.projection?.lifecycle !== 'always') return null
  return <StatusIndicator label={t('context.lifecycleAlwaysIndicator')} tone="info" />
}

export function readContextAssetTreeActions(
  node: ContextAssetNode,
  input: ContextAssetTreeActionsInput,
): MenuAction[] {
  const canAdd = (node.kind === 'module' || node.kind === 'folder' || node.kind === 'message') && !isReadOnlyContextAssetTreeNode(node)
  const canDuplicate = node.kind !== 'module' && node.kind !== 'order' && node.kind !== 'slot' && !isReadOnlyContextAssetTreeNode(node)
  const isPreset = node.category === 'preset'
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
  if (canAdd) items.push({ icon: <Plus aria-hidden="true" />, id: 'add', label: input.t('context.actionAdd'), onSelect: () => input.onAdd(node.id) })
  if (canAdd && input.onAddFolder) items.push({ icon: <FolderPlus aria-hidden="true" />, id: 'addFolder', label: input.t('context.actionAddFolder'), onSelect: () => input.onAddFolder!(node.id) })
  if (canAdd && isPreset && input.onAddAnchor) items.push({ icon: <Anchor aria-hidden="true" />, id: 'addAnchor', label: input.t('context.actionAddAnchor'), onSelect: () => input.onAddAnchor!(node.id) })
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

function isReadOnlyContextAssetTreeNode(node: ContextAssetNode): boolean {
  return node.readOnly === true
    || node.category === 'runtime'
    || node.category === 'history'
    || node.projection?.sourceKind === 'virtual'
    || node.id.startsWith('history-')
}
