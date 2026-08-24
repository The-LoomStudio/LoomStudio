import { ArrowDown, ArrowUp, Bot, ChevronDown, ChevronRight, Code2, Cog, Copy, Diamond, Eye, EyeOff, GripVertical, History, Pencil, Plus, Trash2, UserRound, Wrench } from 'lucide-react'
import { useLayoutEffect, useMemo, useState, type DragEvent } from 'react'
import type { PromptCompositionEntry, PromptCompositionItem, PromptCompositionSlot, PromptMessageBlock } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import type { MenuAction } from '../../../../shared/ui/menu-action.js'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
} from '../../../../shared/ui/context-menu/context-menu.js'
import { buildProjectionZones, type ProjectionOrderEntry, type ProjectionOrderRow, type ProjectionZoneDefinition } from '../../model/projection-order.js'
import type { ProviderToolSurfaceItem } from '../../model/preset-tool-projection.js'
import { readSlotEntrySummary } from '../../model/projection-slot.js'
import styles from './projection-runlist.module.scss'

type DragTarget = { id: string; type: 'row' | 'zone' | 'block' }
type CompositionDropTarget = { id: string; position: 'before' | 'after' | 'inside' }
type ProjectionDropTarget = CompositionDropTarget & { valid: boolean }

function hideNativeDragPreview(event: DragEvent<HTMLElement>) {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setDragImage(canvas, 0, 0)
}

type ProjectionRunlistProps = {
  compositionItems?: PromptCompositionItem[]
  entries: ProjectionOrderEntry[]
  providerTools?: ProviderToolSurfaceItem[]
  onSelectProviderTool?: (toolId: string) => void
  onReorder?: (draggedId: string, targetId: string) => void
  onReorderZone?: (draggedZoneId: string, targetZoneId: string) => void
  onSelect?: (id: string) => void
  selectedId?: string
  selectedProviderToolId?: string
  selectedZoneId?: string
  showSummary?: boolean
  t: Translator
  zoneDefinitions?: ProjectionZoneDefinition[]
  onSelectZone?: (zoneId: string) => void
  onDeleteNode?: (id: string) => void
  onDuplicateNode?: (id: string) => void
  onToggleEnabled?: (id: string, enabled: boolean) => void
  onRename?: (id: string) => void
  onAddZone?: (afterZoneId?: string) => void
  onDeleteZone?: (zoneId: string) => void
  onAddEntryInZone?: (zoneId: string) => void
  onAddDirectEntry?: (blockId: string) => void
  onAddMessageBlock?: () => void
  onAddSlotToMessageBlock?: (blockId: string) => void
  onAddZoneToMessageBlock?: (blockId: string) => void
  onDeleteCompositionItem?: (id: string) => void
  onMoveCompositionItem?: (id: string, direction: 'up' | 'down') => void
  onDropCompositionItem?: (draggedId: string, targetId: string, position: CompositionDropTarget['position']) => void
}

function renderContextMenuItems(actions: MenuAction[]) {
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

function readProjectionEntryActions(
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

function readProjectionZoneActions(
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

function readMessageBlockActions(
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

function messageRoleClass(role: PromptMessageBlock['role']): string {
  return role === 'system'
    ? styles.messageRoleSystem
    : role === 'developer'
      ? styles.messageRoleDeveloper
      : role === 'assistant'
        ? styles.messageRoleAssistant
        : styles.messageRoleUser
}

function renderMessageRoleIcon(role: PromptMessageBlock['role']) {
  if (role === 'system') return <Cog aria-hidden="true" />
  if (role === 'developer') return <Code2 aria-hidden="true" />
  if (role === 'assistant') return <Bot aria-hidden="true" />
  return <UserRound aria-hidden="true" />
}

function renderZoneIcon(zoneId: string) {
  return zoneId === 'chat.history'
    ? <History className={styles.zoneIcon} aria-hidden="true" />
    : <Diamond className={styles.zoneIcon} aria-hidden="true" />
}

export function ProjectionRunlist(props: ProjectionRunlistProps) {
  const compositionMode = props.compositionItems !== undefined
  const zones = useMemo(() => buildProjectionZones(props.entries, props.zoneDefinitions), [props.entries, props.zoneDefinitions])
  const zonesById = useMemo(() => new Map(zones.map(zone => [zone.id, zone])), [zones])
  const compositionItems = useMemo(() => [...(props.compositionItems ?? [])].sort((left, right) => left.orderIndex - right.orderIndex), [props.compositionItems])
  const compositionSlotZoneIds = useMemo(() => new Set(compositionItems.flatMap(item => item.kind === 'message'
    ? item.items.flatMap(child => child.kind === 'slot' && child.zoneId ? [child.zoneId] : [])
    : item.kind === 'slot' && item.zoneId ? [item.zoneId] : [])), [compositionItems])
  const visibleZones = useMemo(() => zones.filter(zone => !compositionMode || !compositionSlotZoneIds.has(zone.id)), [compositionMode, compositionSlotZoneIds, zones])
  const displayPositionById = useMemo(() => new Map(zones
    .flatMap(zone => zone.rows.flatMap(row => row.entries))
    .map((entry, index) => [entry.node.id, index + 1])), [zones])
  const compositionVisualIds = useMemo(() => compositionItems.flatMap(item => item.kind === 'message'
    ? [item.id, ...[...item.items].sort((left, right) => left.orderIndex - right.orderIndex).map(child => child.id)]
    : [item.id]), [compositionItems])
  const [collapsedIds, setCollapsedIds] = useState(() => new Set<string>())
  const [messageViewEnabled, setMessageViewEnabled] = useState(true)
  const [dragging, setDragging] = useState<DragTarget>()
  const [compositionDropTarget, setCompositionDropTarget] = useState<CompositionDropTarget>()
  const [projectionDropTarget, setProjectionDropTarget] = useState<ProjectionDropTarget>()
  const messageViewAvailable = Boolean(props.compositionItems)

  useLayoutEffect(() => {
    if (messageViewAvailable) setMessageViewEnabled(true)
  }, [messageViewAvailable])

  const entryIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    props.entries.forEach((entry, idx) => map.set(entry.node.id, idx))
    return map
  }, [props.entries])

  function getNeighbors(id: string) {
    const idx = entryIndexMap.get(id)
    if (idx === undefined) return { nextId: undefined, prevId: undefined }
    return {
      nextId: idx < props.entries.length - 1 ? props.entries[idx + 1].node.id : undefined,
      prevId: idx > 0 ? props.entries[idx - 1].node.id : undefined,
    }
  }

  function toggle(id: string) {
    setCollapsedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function drop(target: DragTarget) {
    if (!dragging || dragging.type !== target.type || dragging.id === target.id) return
    if (target.type === 'zone') props.onReorderZone?.(dragging.id, target.id)
    else if (target.type === 'row' && projectionDropTarget?.valid) props.onReorder?.(dragging.id, target.id)
    setProjectionDropTarget(undefined)
    setDragging(undefined)
  }

  function previewProjectionDrop(targetId: string) {
    if (dragging?.type !== 'row' || dragging.id === targetId) return
    const draggedIndex = entryIndexMap.get(dragging.id)
    const targetIndex = entryIndexMap.get(targetId)
    if (draggedIndex === undefined || targetIndex === undefined) return
    const draggedEntry = props.entries[draggedIndex]
    const targetEntry = props.entries[targetIndex]
    setProjectionDropTarget({
      id: targetId,
      position: draggedIndex < targetIndex ? 'after' : 'before',
      valid: draggedEntry?.sourceKind === 'actual' && targetEntry?.sourceKind === 'actual',
    })
  }

  function readDropPosition(targetId: string): 'before' | 'after' {
    const draggedIndex = compositionVisualIds.indexOf(dragging?.id ?? '')
    const targetIndex = compositionVisualIds.indexOf(targetId)
    return draggedIndex >= 0 && draggedIndex < targetIndex ? 'after' : 'before'
  }

  function previewCompositionDrop(event: DragEvent<HTMLElement>, targetId: string, position: CompositionDropTarget['position']) {
    if (!dragging || dragging.id === targetId || !props.onDropCompositionItem) return
    event.preventDefault()
    event.stopPropagation()
    setCompositionDropTarget({ id: targetId, position })
  }

  function commitCompositionDrop(event: DragEvent<HTMLElement>, targetId: string, position: CompositionDropTarget['position']) {
    if (!dragging || dragging.id === targetId || !props.onDropCompositionItem) return
    event.preventDefault()
    event.stopPropagation()
    props.onDropCompositionItem(dragging.id, targetId, position)
    setCompositionDropTarget(undefined)
    setDragging(undefined)
  }

  function renderZone(zone: (typeof zones)[number]) {
    const zoneIndex = zones.findIndex(candidate => candidate.id === zone.id)
    const collapsed = collapsedIds.has(zone.id)
    const editable = zone.rows.every(row => row.primary.sourceKind !== 'virtual')
    const projectionReorderable = Boolean(props.onReorderZone) && editable
    const compositionReorderable = Boolean(compositionMode && props.onDropCompositionItem) && editable
    const reorderable = projectionReorderable || compositionReorderable
    const compositionParent = compositionItems.find(item => item.kind === 'message' && item.items.some(child => child.id === zone.id))
    const compositionIndex = compositionParent?.kind === 'message' ? compositionParent.items.findIndex(child => child.id === zone.id) : -1
    const previousCompositionId = compositionParent?.kind === 'message' && compositionIndex > 0 ? compositionParent.items[compositionIndex - 1]?.id : undefined
    const nextCompositionId = compositionParent?.kind === 'message' && compositionIndex >= 0 && compositionIndex < compositionParent.items.length - 1 ? compositionParent.items[compositionIndex + 1]?.id : undefined
    const prevZoneId = zoneIndex > 0 ? zones[zoneIndex - 1]?.id : undefined
    const nextZoneId = zoneIndex < zones.length - 1 ? zones[zoneIndex + 1]?.id : undefined
    const zoneActions = readProjectionZoneActions(zone.id, {
      canMoveDown: Boolean(compositionMode ? nextCompositionId : reorderable && nextZoneId),
      canMoveUp: Boolean(compositionMode ? previousCompositionId : reorderable && prevZoneId),
      onAddEntryInZone: editable ? props.onAddEntryInZone : undefined,
      onAddZone: editable ? props.onAddZone : undefined,
      onDeleteZone: editable ? props.onDeleteZone : undefined,
      onMoveDown: compositionMode && nextCompositionId
        ? () => props.onDropCompositionItem?.(zone.id, nextCompositionId, 'after')
        : nextZoneId && reorderable ? () => props.onReorderZone!(zone.id, nextZoneId) : undefined,
      onMoveUp: compositionMode && previousCompositionId
        ? () => props.onDropCompositionItem?.(zone.id, previousCompositionId, 'before')
        : prevZoneId && reorderable ? () => props.onReorderZone!(zone.id, prevZoneId) : undefined,
      t: props.t,
    })

    return (
      <section
        className={`${styles.zone} ${props.selectedZoneId === zone.id ? styles.selectedZone : ''}`}
        data-drop-position={compositionDropTarget?.id === zone.id ? compositionDropTarget.position : undefined}
        draggable={!compositionMode && projectionReorderable}
        key={zone.id}
        role="listitem"
        onDragOver={event => {
          if (dragging?.type !== 'zone') return
          if (compositionMode) previewCompositionDrop(event, zone.id, readDropPosition(zone.id))
          else event.preventDefault()
        }}
        onDrop={event => {
          if (dragging?.type !== 'zone') return
          if (compositionMode) commitCompositionDrop(event, zone.id, readDropPosition(zone.id))
          else drop({ id: zone.id, type: 'zone' })
        }}
        onDragEnd={() => setDragging(undefined)}
        onDragStart={event => {
          hideNativeDragPreview(event)
          if (!compositionMode && projectionReorderable) setDragging({ id: zone.id, type: 'zone' })
        }}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={zoneActions.length === 0}>
            <div className={styles.zoneHeader}>
              {reorderable ? (
                <span
                  className={styles.dragHandle}
                  draggable={compositionMode}
                  onDragEnd={() => {
                    setDragging(undefined)
                    setCompositionDropTarget(undefined)
                  }}
                  onDragStart={event => {
                    hideNativeDragPreview(event)
                    event.stopPropagation()
                    if (compositionMode) setDragging({ id: zone.id, type: 'zone' })
                  }}
                >
                  <GripVertical aria-hidden="true" />
                </span>
              ) : <span className={styles.dragHandleSpacer} aria-hidden="true" />}
              <span className={styles.positionSpacer} aria-hidden="true" />
              <span className={collapsed ? styles.zoneCollapsed : styles.zoneStart} aria-hidden="true" />
              <button
                aria-expanded={!collapsed}
                aria-label={props.t(collapsed ? 'context.tree.expand' : 'context.tree.collapse', { label: zone.id })}
                className={styles.disclosure}
                type="button"
                onClick={() => toggle(zone.id)}
              >
                {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>
              {renderZoneIcon(zone.id)}
              {props.onSelectZone ? (
                <button className={styles.zoneLabel} type="button" onClick={() => props.onSelectZone?.(zone.id)}>
                  <strong>{zone.displayName}</strong>
                  <small>{zone.id}</small>
                </button>
              ) : <strong>{zone.displayName}</strong>}
              <span className={styles.zoneCount}>{zone.rows.length}</span>
              <span className={styles.zoneDivider} aria-hidden="true" />
            </div>
          </ContextMenuTrigger>
          {zoneActions.length > 0 ? (
            <ContextMenuContent>
              {renderContextMenuItems(zoneActions)}
            </ContextMenuContent>
          ) : null}
        </ContextMenu>

        {!collapsed ? (
          <div className={styles.zoneRows}>
            {zone.rows.map((row, index) => (
              <ProjectionRow
                collapsedIds={collapsedIds}
                displayPositionById={displayPositionById}
                dropTarget={projectionDropTarget}
                getNeighbors={getNeighbors}
                isLast={index === zone.rows.length - 1}
                key={row.id}
                row={row}
                selectedId={props.selectedId}
                t={props.t}
                toggle={toggle}
                onDeleteNode={props.onDeleteNode}
                onDragEnd={() => {
                  setDragging(undefined)
                  setProjectionDropTarget(undefined)
                }}
                onDragOver={previewProjectionDrop}
                onDragStart={id => setDragging({ id, type: 'row' })}
                onDrop={id => drop({ id, type: 'row' })}
                onDuplicateNode={props.onDuplicateNode}
                onRename={props.onRename}
                onReorder={props.onReorder}
                onSelect={props.onSelect}
                onToggleEnabled={props.onToggleEnabled}
                reorderable={Boolean(props.onReorder) && row.primary.sourceKind !== 'virtual'}
              />
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  function renderBlock(block: PromptMessageBlock) {
    const collapsed = collapsedIds.has(block.id)
    const blockIndex = compositionItems.findIndex(item => item.id === block.id)
    const actions = readMessageBlockActions(block, {
      canMoveDown: blockIndex >= 0 && blockIndex < compositionItems.length - 1,
      canMoveUp: blockIndex > 0,
      onAddDirectEntry: props.onAddDirectEntry,
      onAddSlot: props.onAddSlotToMessageBlock,
      onAddZone: props.onAddZoneToMessageBlock,
      onDelete: props.onDeleteCompositionItem,
      onMove: props.onMoveCompositionItem,
      t: props.t,
    })
    const children = [...block.items].sort((left, right) => left.orderIndex - right.orderIndex)
    const slotZoneIds = new Set(children.flatMap(item => item.kind === 'slot' && item.zoneId ? [item.zoneId] : []))
    return (
      <ContextMenu key={block.id}>
        <ContextMenuTrigger asChild disabled={actions.length === 0}>
          <section
            aria-label={`${block.displayName}, ${block.role}, ${block.items.length} ${props.t('context.compositionItems')}`}
            className={`${styles.messageBlock} ${messageRoleClass(block.role)}`}
            data-drop-position={compositionDropTarget?.id === block.id ? compositionDropTarget.position : undefined}
            data-message-block-id={block.id}
            tabIndex={0}
            onDragOver={event => {
              if (dragging?.type === 'block') previewCompositionDrop(event, block.id, readDropPosition(block.id))
              else if (dragging?.type === 'zone') previewCompositionDrop(event, block.id, 'inside')
            }}
            onDrop={event => {
              if (dragging?.type === 'block') commitCompositionDrop(event, block.id, readDropPosition(block.id))
              else if (dragging?.type === 'zone') commitCompositionDrop(event, block.id, 'inside')
            }}
            onClick={event => {
              if (event.target === event.currentTarget) props.onSelect?.(block.id)
            }}
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              props.onSelect?.(block.id)
            }}
          >
            <button
              aria-expanded={!collapsed}
              aria-label={props.t(collapsed ? 'context.tree.expand' : 'context.tree.collapse', { label: block.displayName })}
              className={styles.messageBlockIcon}
              draggable
              type="button"
              onClick={() => toggle(block.id)}
              onDragEnd={() => {
                setDragging(undefined)
                setCompositionDropTarget(undefined)
              }}
              onDragStart={event => {
                hideNativeDragPreview(event)
                event.stopPropagation()
                setDragging({ id: block.id, type: 'block' })
              }}
            >
              {renderMessageRoleIcon(block.role)}
            </button>
            {!collapsed ? (
              <div className={styles.messageBlockZones}>
                {children.map((item, index) => {
                  if (item.kind === 'zone') {
                    const zone = zonesById.get(item.id)
                    if (!zone || slotZoneIds.has(item.id)) return null
                    return renderZone(zone)
                  }
                  if (item.kind === 'slot') return renderCompositionSlot(item, false, index === children.length - 1)
                  return renderCompositionEntry(item, index === children.length - 1)
                })}
              </div>
            ) : null}
          </section>
        </ContextMenuTrigger>
        {actions.length > 0 ? <ContextMenuContent>{renderContextMenuItems(actions)}</ContextMenuContent> : null}
      </ContextMenu>
    )
  }

  function renderCompositionSlot(slot: PromptCompositionSlot, root: boolean, isLast = false) {
    const collapsed = collapsedIds.has(slot.id)
    const zone = slot.zoneId ? zonesById.get(slot.zoneId) : undefined
    const content = (
      <>
        <button className={styles.compositionNodeLabel} type="button" onClick={() => props.onSelect?.(slot.id)}>
          <strong>{slot.displayName}</strong>
          <small>{slot.messageMode === 'native' ? props.t('context.nativeMessageSlot') : slot.bindingId}</small>
        </button>
        {zone ? <span className={styles.zoneCount}>{zone.rows.length}</span> : null}
      </>
    )
    if (!root) {
      return (
        <div
          className={styles.compositionNode}
          data-drop-position={compositionDropTarget?.id === slot.id ? compositionDropTarget.position : undefined}
          key={slot.id}
          onDragOver={event => {
            if (dragging?.type === 'zone') previewCompositionDrop(event, slot.id, readDropPosition(slot.id))
          }}
          onDrop={event => {
            if (dragging?.type === 'zone') commitCompositionDrop(event, slot.id, readDropPosition(slot.id))
          }}
        >
          <span className={styles.dragHandleSpacer} aria-hidden="true" />
          <span className={styles.positionSpacer} aria-hidden="true" />
          <span className={isLast ? styles.guideEnd : styles.guideBranch} aria-hidden="true" />
          <span className={styles.disclosureSpacer} aria-hidden="true" />
          <span className={styles.nodeIconSpacer} aria-hidden="true" />
          {content}
        </div>
      )
    }
    return (
      <section
        className={`${styles.messageBlock} ${styles.nativeCompositionBlock}`}
        data-drop-position={compositionDropTarget?.id === slot.id ? compositionDropTarget.position : undefined}
        key={slot.id}
        onDragOver={event => {
          if (dragging?.type === 'block') previewCompositionDrop(event, slot.id, readDropPosition(slot.id))
        }}
        onDrop={event => {
          if (dragging?.type === 'block') commitCompositionDrop(event, slot.id, readDropPosition(slot.id))
        }}
      >
        <button
          aria-expanded={!collapsed}
          aria-label={props.t(collapsed ? 'context.tree.expand' : 'context.tree.collapse', { label: slot.displayName })}
          className={styles.messageBlockIcon}
          type="button"
          onClick={() => toggle(slot.id)}
        >
          {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
        {!collapsed ? <div className={`${styles.compositionNode} ${styles.nativeCompositionContent}`}>{content}</div> : null}
      </section>
    )
  }

  function renderCompositionEntry(item: PromptCompositionEntry, isLast = false) {
    return (
      <div
        className={styles.compositionNode}
        data-drop-position={compositionDropTarget?.id === item.id ? compositionDropTarget.position : undefined}
        key={item.id}
        onDragOver={event => {
          if (dragging?.type === 'zone') previewCompositionDrop(event, item.id, readDropPosition(item.id))
        }}
        onDrop={event => {
          if (dragging?.type === 'zone') commitCompositionDrop(event, item.id, readDropPosition(item.id))
        }}
      >
        <span className={styles.dragHandleSpacer} aria-hidden="true" />
        <span className={styles.positionSpacer} aria-hidden="true" />
        <span className={isLast ? styles.guideEnd : styles.guideBranch} aria-hidden="true" />
        <span className={styles.disclosureSpacer} aria-hidden="true" />
        <span className={styles.nodeIconSpacer} aria-hidden="true" />
        <button className={styles.compositionNodeLabel} type="button" onClick={() => props.onSelect?.(item.id)}>
          <strong>{item.displayName}</strong>
          <small>{item.source.kind === 'binding' ? item.source.bindingId : item.source.nodeId}</small>
        </button>
      </div>
    )
  }

  function renderRootDropGap(targetId: string, position: 'before' | 'after', key: string) {
    return (
      <div
        className={styles.compositionDropGap}
        data-active={compositionDropTarget?.id === targetId && compositionDropTarget.position === position ? 'true' : undefined}
        key={key}
        onDragOver={event => {
          if (dragging?.type === 'block' || dragging?.type === 'zone') previewCompositionDrop(event, targetId, position)
        }}
        onDrop={event => {
          if (dragging?.type === 'block' || dragging?.type === 'zone') commitCompositionDrop(event, targetId, position)
        }}
      />
    )
  }

  return (
    <div className={styles.runlist} data-loom-component="projection-runlist">
      {props.showSummary ? (
        <div className={styles.summary}>
          <span>{props.t('context.orderProfileLabel')}</span>
          <strong>{props.t('context.orderCount', { count: props.entries.length })}</strong>
        </div>
      ) : null}

      {props.compositionItems ? (
        <div className={styles.messageCompositionToolbar}>
          <span>{props.t('context.compositionLabel')}</span>
          <div className={styles.messageCompositionToolbarActions}>
            <button
              aria-pressed={messageViewEnabled}
              className={styles.messageViewToggle}
              type="button"
              onClick={() => setMessageViewEnabled(enabled => !enabled)}
            >
              {messageViewEnabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              <span>{props.t(messageViewEnabled ? 'context.actionHideMessageView' : 'context.actionShowMessageView')}</span>
            </button>
            {props.onAddMessageBlock ? (
              <button aria-label={props.t('context.actionAddMessageBlock')} type="button" onClick={props.onAddMessageBlock}>
                <Plus aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {props.providerTools?.length ? (
        <section className={styles.providerTools} aria-label={props.t('context.providerTools.label')}>
          <button
            aria-expanded={!collapsedIds.has('provider-tools')}
            aria-label={props.t(collapsedIds.has('provider-tools') ? 'context.tree.expand' : 'context.tree.collapse', { label: props.t('context.providerTools.label') })}
            className={styles.providerToolsIcon}
            type="button"
            onClick={() => toggle('provider-tools')}
          >
            <Wrench aria-hidden="true" />
          </button>
          {!collapsedIds.has('provider-tools') ? <div className={styles.providerToolRows}>
            {props.providerTools.map((tool, index) => (
              <button
                aria-current={tool.toolId === props.selectedProviderToolId ? 'true' : undefined}
                className={`${styles.providerToolRow} ${tool.toolId === props.selectedProviderToolId ? styles.providerToolSelected : ''}`}
                key={tool.toolId}
                type="button"
                onClick={() => props.onSelectProviderTool?.(tool.toolId)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{tool.name}</strong>
              </button>
            ))}
          </div> : null}
        </section>
      ) : null}

      <div className={styles.zones} role="list">
        {messageViewEnabled && props.compositionItems
          ? compositionItems.flatMap((item, index) => {
              const rendered = item.kind === 'message'
                ? renderBlock(item)
                : item.kind === 'slot'
                  ? renderCompositionSlot(item, true)
                  : item.kind === 'zone'
                    ? zonesById.has(item.id) ? renderZone(zonesById.get(item.id)!) : null
                    : renderCompositionEntry(item)
              return [
                renderRootDropGap(item.id, 'before', `drop-before:${item.id}`),
                rendered,
                ...(index === compositionItems.length - 1 ? [renderRootDropGap(item.id, 'after', `drop-after:${item.id}`)] : []),
              ]
            })
          : visibleZones.map(renderZone)}
      </div>

      {props.onAddZone ? (
        <div className={styles.addZoneContainer}>
          <button
            className={styles.addZoneButton}
            type="button"
            onClick={() => props.onAddZone!()}
          >
            <Plus aria-hidden="true" />
            <span>{props.t('context.actionAddZone')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ProjectionRow(props: {
  collapsedIds: Set<string>
  displayPositionById: Map<string, number>
  dropTarget?: ProjectionDropTarget
  getNeighbors: (id: string) => { nextId?: string; prevId?: string }
  isLast: boolean
  onDeleteNode?: (id: string) => void
  onDragEnd(): void
  onDragOver(id: string): void
  onDragStart(id: string): void
  onDrop(id: string): void
  onDuplicateNode?: (id: string) => void
  onRename?: (id: string) => void
  onReorder?: (draggedId: string, targetId: string) => void
  onSelect?: (id: string) => void
  onToggleEnabled?: (id: string, enabled: boolean) => void
  reorderable: boolean
  row: ProjectionOrderRow
  selectedId?: string
  t: Translator
  toggle(id: string): void
}) {
  const slotCollapsed = props.collapsedIds.has(props.row.id)
  const selected = props.row.entries.some(entry => entry.node.id === props.selectedId)
  const primary = props.row.primary

  const { prevId: primaryPrevId, nextId: primaryNextId } = props.getNeighbors(primary.node.id)
  const primaryActions = readProjectionEntryActions(primary, {
    canMoveDown: Boolean(props.reorderable && primaryNextId),
    canMoveUp: Boolean(props.reorderable && primaryPrevId),
    onDeleteNode: props.onDeleteNode,
    onDuplicateNode: props.onDuplicateNode,
    onMoveDown: primaryNextId && props.onReorder ? () => props.onReorder!(primary.node.id, primaryNextId) : undefined,
    onMoveUp: primaryPrevId && props.onReorder ? () => props.onReorder!(primary.node.id, primaryPrevId) : undefined,
    onRename: props.onRename,
    onToggleEnabled: props.onToggleEnabled,
    t: props.t,
  })

  return (
    <div className={styles.rowGroup}>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={primaryActions.length === 0}>
          <div
            className={`${styles.row} ${selected ? styles.selected : ''}`}
            data-drop-position={props.dropTarget?.id === primary.node.id ? props.dropTarget.position : undefined}
            data-drop-state={props.dropTarget?.id === primary.node.id && !props.dropTarget.valid ? 'invalid' : undefined}
            draggable={props.reorderable}
            onDragEnd={event => {
              event.stopPropagation()
              props.onDragEnd()
            }}
            onDragOver={event => {
              event.preventDefault()
              event.stopPropagation()
              props.onDragOver(primary.node.id)
            }}
            onDragStart={event => {
              hideNativeDragPreview(event)
              event.stopPropagation()
              props.onDragStart(primary.node.id)
            }}
            onDrop={event => {
              event.stopPropagation()
              props.onDrop(primary.node.id)
            }}
          >
            {props.reorderable ? <GripVertical className={styles.dragHandle} aria-hidden="true" /> : null}
            {props.row.type === 'slot'
              ? <span className={styles.positionSpacer} aria-hidden="true" />
              : <span className={styles.position}>{String(props.displayPositionById.get(primary.node.id) ?? 0).padStart(2, '0')}</span>}
            <span className={props.isLast ? styles.guideEnd : styles.guideBranch} aria-hidden="true" />
            {props.row.type === 'slot' ? (
              <button
                aria-expanded={!slotCollapsed}
                aria-label={props.t(slotCollapsed ? 'context.tree.expand' : 'context.tree.collapse', { label: props.row.label })}
                className={`${styles.disclosure} ${styles.slotDisclosure}`}
                type="button"
                onClick={() => props.toggle(props.row.id)}
              >
                {slotCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>
            ) : null}
            {props.onSelect ? (
              <button className={styles.rowLabel} type="button" onClick={() => props.onSelect?.(primary.node.id)}>
                <strong>{props.row.label}</strong>
                <small>{props.row.type === 'slot' ? readSlotEntrySummary(props.row.entries) : primary.node.meta}</small>
              </button>
            ) : (
              <span className={styles.rowLabel}>
                <strong>{props.row.label}</strong>
                <small>{props.row.type === 'slot' ? readSlotEntrySummary(props.row.entries) : primary.node.meta}</small>
              </span>
            )}
            <span className={styles.source} data-loom-source-kind={primary.sourceKind}>
              {primary.sourceKind === 'virtual' ? props.t('context.sourceVirtual') : props.t('context.sourceActual')}
            </span>
          </div>
        </ContextMenuTrigger>
        {primaryActions.length > 0 ? (
          <ContextMenuContent>
            {renderContextMenuItems(primaryActions)}
          </ContextMenuContent>
        ) : null}
      </ContextMenu>

      {props.row.type === 'slot' && !slotCollapsed ? (
        <div className={styles.slotEntries}>
          {props.row.entries.map((entry, index) => {
            const { prevId, nextId } = props.getNeighbors(entry.node.id)
            const entryActions = readProjectionEntryActions(entry, {
              canMoveDown: Boolean(props.reorderable && nextId),
              canMoveUp: Boolean(props.reorderable && prevId),
              onDeleteNode: props.onDeleteNode,
              onDuplicateNode: props.onDuplicateNode,
              onMoveDown: nextId && props.onReorder ? () => props.onReorder!(entry.node.id, nextId) : undefined,
              onMoveUp: prevId && props.onReorder ? () => props.onReorder!(entry.node.id, prevId) : undefined,
              onRename: props.onRename,
              onToggleEnabled: props.onToggleEnabled,
              t: props.t,
            })

            return (
              <ContextMenu key={entry.node.id}>
                <ContextMenuTrigger asChild disabled={entryActions.length === 0}>
                  <div
                    className={`${styles.row} ${styles.slotEntry} ${entry.node.id === props.selectedId ? styles.selected : ''}`}
                    data-drop-position={props.dropTarget?.id === entry.node.id ? props.dropTarget.position : undefined}
                    data-drop-state={props.dropTarget?.id === entry.node.id && !props.dropTarget.valid ? 'invalid' : undefined}
                    draggable={props.reorderable && entry.sourceKind === 'actual'}
                    onDragEnd={event => {
                      event.stopPropagation()
                      props.onDragEnd()
                    }}
                    onDragOver={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      props.onDragOver(entry.node.id)
                    }}
                    onDragStart={event => {
                      hideNativeDragPreview(event)
                      event.stopPropagation()
                      props.onDragStart(entry.node.id)
                    }}
                    onDrop={event => {
                      event.stopPropagation()
                      props.onDrop(entry.node.id)
                    }}
                  >
                    {props.reorderable ? <GripVertical className={styles.dragHandle} aria-hidden="true" /> : null}
                    <span className={styles.position}>{String(props.displayPositionById.get(entry.node.id) ?? 0).padStart(2, '0')}</span>
                    <span className={props.isLast ? styles.guideEmpty : styles.guidePass} aria-hidden="true" />
                    <span className={index === props.row.entries.length - 1 ? styles.guideEnd : styles.guideBranch} aria-hidden="true" />
                    {props.onSelect ? (
                      <button className={styles.rowLabel} type="button" onClick={() => props.onSelect?.(entry.node.id)}>
                        <strong>{entry.node.label}</strong>
                        <small>{entry.node.meta}</small>
                      </button>
                    ) : (
                      <span className={styles.rowLabel}>
                        <strong>{entry.node.label}</strong>
                        <small>{entry.node.meta}</small>
                      </span>
                    )}
                    <span className={styles.source} data-loom-source-kind={entry.sourceKind}>
                      {entry.sourceKind === 'virtual' ? props.t('context.sourceVirtual') : props.t('context.sourceActual')}
                    </span>
                  </div>
                </ContextMenuTrigger>
                {entryActions.length > 0 ? (
                  <ContextMenuContent>
                    {renderContextMenuItems(entryActions)}
                  </ContextMenuContent>
                ) : null}
              </ContextMenu>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
