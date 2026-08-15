import { AlignLeft, Code2, Copy, FileText, Folder, FolderOpen, GripVertical, Package, Plus, Trash2 } from 'lucide-react'
import type { ContextAssetNode } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ContextMenuItem } from '../../../shared/ui/context-menu/context-menu.js'
import { StatusIndicator } from '../../../shared/ui/status-indicator/status-indicator.js'

type ContextAssetTreeActionsInput = {
  onAdd(parentId: string): void
  onDelete(id: string): void
  onDuplicate(id: string): void
  onToggleEnabled(id: string, enabled: boolean): void
  t: Translator
  view?: {
    mode: 'asset' | 'projection' | undefined
    toggle(): void
  }
}

export function renderContextAssetTreeIcon(node: ContextAssetNode, expanded: boolean) {
  if (node.kind === 'module') return <Package />
  if (node.kind === 'folder') return expanded ? <FolderOpen /> : <Folder />
  if (node.kind === 'script') return <Code2 />
  if (node.kind === 'order') return <GripVertical />
  return <FileText />
}

export function renderContextAssetLifecycleIndicator(node: ContextAssetNode, t: Translator) {
  if (node.enabled === false || node.projection?.lifecycle !== 'always') return null
  return <StatusIndicator label={t('context.lifecycleAlwaysIndicator')} tone="info" />
}

export function readContextAssetTreeActions(
  node: ContextAssetNode,
  input: ContextAssetTreeActionsInput,
): ContextMenuItem[] {
  const canAdd = (node.kind === 'module' || node.kind === 'folder') && !isReadOnlyContextAssetTreeNode(node)
  const canDuplicate = node.kind !== 'module' && node.kind !== 'order' && !isReadOnlyContextAssetTreeNode(node)
  const isSettingLayer = node.category === 'setting' && node.kind === 'module'
  const items: ContextMenuItem[] = []

  if (canToggleContextAssetEnabled(node)) {
    items.push({
      checked: node.enabled !== false,
      id: 'enabled',
      label: input.t('context.actionEnable'),
      onSelect: () => input.onToggleEnabled(node.id, node.enabled === false),
    })
    if (isSettingLayer || canAdd || canDuplicate) items.push({ id: 'state-separator', type: 'separator' })
  }
  if (isSettingLayer && input.view) {
    items.push({
      icon: input.view.mode === 'projection' ? <Folder aria-hidden="true" /> : <AlignLeft aria-hidden="true" />,
      id: 'view-mode',
      label: input.t(input.view.mode === 'projection' ? 'context.actionAssetView' : 'context.actionProjectionView'),
      onSelect: input.view.toggle,
    })
  }
  if (canAdd) items.push({ icon: <Plus aria-hidden="true" />, id: 'add', label: input.t('context.actionAdd'), onSelect: () => input.onAdd(node.id) })
  if (canDuplicate) items.push({ icon: <Copy aria-hidden="true" />, id: 'duplicate', label: input.t('context.actionDuplicate'), onSelect: () => input.onDuplicate(node.id) })
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
