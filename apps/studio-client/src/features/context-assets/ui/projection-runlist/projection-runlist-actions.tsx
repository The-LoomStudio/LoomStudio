import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import type { PromptMessageBlock } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import type { MenuAction } from '../../../../shared/ui/menu-action.js'
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../../../../shared/ui/context-menu/context-menu.js'
import type { ProjectionOrderEntry } from '../../model/projection-order.js'

export function renderContextMenuItems(actions: MenuAction[]): ReactNode {
  return actions.map(action => {
    if (action.type === 'separator') return <ContextMenuSeparator key={action.id} />
    if (action.checked !== undefined) {
      return (
        <ContextMenuCheckboxItem
          key={action.id}
          checked={action.checked}
          disabled={action.disabled}
          onCheckedChange={() => action.onSelect()}
        >
          {action.label}
        </ContextMenuCheckboxItem>
      )
    }
    return (
      <ContextMenuItem
        key={action.id}
        disabled={action.disabled}
        icon={action.icon}
        tone={action.tone}
        onSelect={() => action.onSelect()}
      >
        {action.label}
      </ContextMenuItem>
    )
  })
}

export function readProjectionEntryActions(
  entry: ProjectionOrderEntry,
  input: {
    canMoveDown: boolean
    canMoveUp: boolean
    onMoveDown?(): void
    onMoveUp?(): void
    onDeleteNode?(id: string): void
    onDuplicateNode?(id: string): void
    onRename?(id: string): void
    onToggleEnabled?(id: string, enabled: boolean): void
    t: Translator
  },
): MenuAction[] {
  const items: MenuAction[] = []
  const node = entry.node
  const isReadOnly = node.readOnly === true || node.category === 'runtime' || node.category === 'history' || node.projection?.sourceKind === 'virtual'

  if (node.enabled !== undefined && input.onToggleEnabled && !isReadOnly) {
    items.push({
      checked: node.enabled !== false,
      id: 'enabled',
      label: input.t('context.actionEnable'),
      onSelect: () => input.onToggleEnabled!(node.id, node.enabled === false),
    })
    items.push({ id: 'reorder-separator', type: 'separator' })
  }

  if (input.canMoveUp && input.onMoveUp) {
    items.push({
      icon: <ArrowUp aria-hidden="true" />,
      id: 'move-up',
      label: input.t('context.actionMoveUp'),
      onSelect: input.onMoveUp,
    })
  }
  if (input.canMoveDown && input.onMoveDown) {
    items.push({
      icon: <ArrowDown aria-hidden="true" />,
      id: 'move-down',
      label: input.t('context.actionMoveDown'),
      onSelect: input.onMoveDown,
    })
  }

  if (input.onDuplicateNode && !isReadOnly) {
    if (items.length > 0) items.push({ id: 'edit-separator', type: 'separator' })
    items.push({
      icon: <Copy aria-hidden="true" />,
      id: 'duplicate',
      label: input.t('context.actionDuplicate'),
      onSelect: () => input.onDuplicateNode!(node.id),
    })
  }
  if (input.onRename && !isReadOnly) {
    items.push({
      icon: <Pencil aria-hidden="true" />,
      id: 'rename',
      label: input.t('context.actionRename'),
      onSelect: () => input.onRename!(node.id),
    })
  }
  if (input.onDeleteNode && !isReadOnly) {
    items.push({ id: 'delete-separator', type: 'separator' })
    items.push({
      icon: <Trash2 aria-hidden="true" />,
      id: 'delete',
      label: input.t('context.actionDelete'),
      onSelect: () => input.onDeleteNode!(node.id),
      tone: 'danger',
    })
  }

  return items
}

export function readProjectionZoneActions(
  zoneId: string,
  input: {
    canMoveDown: boolean
    canMoveUp: boolean
    onAddEntryInZone?(zoneId: string): void
    onAddZone?(afterZoneId?: string): void
    onDeleteZone?(zoneId: string): void
    onMoveDown?(): void
    onMoveUp?(): void
    t: Translator
  },
): MenuAction[] {
  const items: MenuAction[] = []
  if (input.onAddEntryInZone) {
    items.push({
      icon: <Plus aria-hidden="true" />,
      id: 'add-entry-in-zone',
      label: input.t('context.actionAddEntryInZone'),
      onSelect: () => input.onAddEntryInZone!(zoneId),
    })
  }
  if (input.canMoveUp && input.onMoveUp) {
    items.push({
      icon: <ArrowUp aria-hidden="true" />,
      id: 'move-zone-up',
      label: input.t('context.actionMoveZoneUp'),
      onSelect: input.onMoveUp,
    })
  }
  if (input.canMoveDown && input.onMoveDown) {
    items.push({
      icon: <ArrowDown aria-hidden="true" />,
      id: 'move-zone-down',
      label: input.t('context.actionMoveZoneDown'),
      onSelect: input.onMoveDown,
    })
  }
  if (input.onAddZone) {
    items.push({
      icon: <Plus aria-hidden="true" />,
      id: 'add-zone-below',
      label: input.t('context.actionAddZone'),
      onSelect: () => input.onAddZone!(zoneId),
    })
  }
  if (input.onDeleteZone) {
    items.push({
      icon: <Trash2 aria-hidden="true" />,
      id: 'delete-zone',
      label: input.t('context.actionDeleteZone'),
      tone: 'danger',
      onSelect: () => input.onDeleteZone!(zoneId),
    })
  }
  return items
}

export function readMessageBlockActions(
  block: PromptMessageBlock,
  input: {
    canMoveDown: boolean
    canMoveUp: boolean
    onAddDirectEntry?(blockId: string): void
    onAddSlot?(blockId: string): void
    onAddZone?(blockId: string): void
    onDelete?(id: string): void
    onMove?(id: string, direction: 'up' | 'down'): void
    t: Translator
  },
): MenuAction[] {
  const items: MenuAction[] = []
  if (input.onAddZone) {
    items.push({
      icon: <Plus aria-hidden="true" />,
      id: 'add-zone-to-message-block',
      label: input.t('context.actionAddZoneToMessageBlock'),
      onSelect: () => input.onAddZone!(block.id),
    })
  }
  if (input.onAddSlot) {
    items.push({
      icon: <Plus aria-hidden="true" />,
      id: 'add-slot-to-message-block',
      label: input.t('context.actionAddSlotToMessageBlock'),
      onSelect: () => input.onAddSlot!(block.id),
    })
  }
  if (input.onAddDirectEntry) {
    items.push({
      icon: <Plus aria-hidden="true" />,
      id: 'add-direct-entry-to-message-block',
      label: input.t('context.actionAddDirectEntry'),
      onSelect: () => input.onAddDirectEntry!(block.id),
    })
  }
  if (items.length > 0) items.push({ id: 'message-block-edit-separator', type: 'separator' })
  if (input.canMoveUp && input.onMove) {
    items.push({
      icon: <ArrowUp aria-hidden="true" />,
      id: 'move-message-block-up',
      label: input.t('context.actionMoveUp'),
      onSelect: () => input.onMove!(block.id, 'up'),
    })
  }
  if (input.canMoveDown && input.onMove) {
    items.push({
      icon: <ArrowDown aria-hidden="true" />,
      id: 'move-message-block-down',
      label: input.t('context.actionMoveDown'),
      onSelect: () => input.onMove!(block.id, 'down'),
    })
  }
  if (input.onDelete) {
    if (items.length > 0) items.push({ id: 'message-block-delete-separator', type: 'separator' })
    items.push({
      icon: <Trash2 aria-hidden="true" />,
      id: 'delete-message-block',
      label: input.t('context.actionDeleteMessageBlock'),
      onSelect: () => input.onDelete!(block.id),
      tone: 'danger',
    })
  }
  return items
}
