import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Diamond, Eye, EyeOff, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PromptCompositionItem, PromptMessageBlock } from '../../../../entities/index.js'
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
import { readSlotEntrySummary } from '../../model/projection-slot.js'
import styles from './projection-runlist.module.scss'

type DragTarget = { id: string; type: 'row' | 'zone' }

type ProjectionRunlistProps = {
  compositionItems?: PromptCompositionItem[]
  entries: ProjectionOrderEntry[]
  onReorder?: (draggedId: string, targetId: string) => void
  onReorderZone?: (draggedZoneId: string, targetZoneId: string) => void
  onSelect?: (id: string) => void
  selectedId?: string
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

type MessageProjectionSegment = {
  block?: PromptMessageBlock
  zones: ReturnType<typeof buildProjectionZones>
}

function readMessageBlockByZone(items: PromptCompositionItem[] | undefined): Map<string, PromptMessageBlock> {
  const result = new Map<string, PromptMessageBlock>()
  for (const item of items ?? []) {
    if (item.kind !== 'message') continue
    for (const child of item.items) {
      if (child.kind === 'zone' || child.kind === 'slot' && child.zoneId) {
        result.set(child.kind === 'zone' ? child.id : child.zoneId!, item)
      }
    }
  }
  return result
}

function splitMessageProjectionSegments(
  zones: ReturnType<typeof buildProjectionZones>,
  compositionItems: PromptCompositionItem[] | undefined,
): MessageProjectionSegment[] {
  const blockByZone = readMessageBlockByZone(compositionItems)
  const segments: MessageProjectionSegment[] = []
  for (const zone of zones) {
    const block = blockByZone.get(zone.id)
    const previous = segments[segments.length - 1]
    if (previous && previous.block?.id === block?.id) {
      previous.zones.push(zone)
    } else {
      segments.push({ block, zones: [zone] })
    }
  }
  return segments
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

function messageRoleLabel(role: PromptMessageBlock['role']): string {
  return role[0]!.toUpperCase() + role.slice(1)
}

export function ProjectionRunlist(props: ProjectionRunlistProps) {
  const zones = useMemo(() => buildProjectionZones(props.entries, props.zoneDefinitions), [props.entries, props.zoneDefinitions])
  const messageBlocks = useMemo(() => (props.compositionItems ?? []).filter((item): item is PromptMessageBlock => item.kind === 'message').sort((left, right) => left.orderIndex - right.orderIndex), [props.compositionItems])
  const [collapsedIds, setCollapsedIds] = useState(() => new Set<string>())
  const [messageViewEnabled, setMessageViewEnabled] = useState(true)
  const [dragging, setDragging] = useState<DragTarget>()
  const messageSegments = useMemo(() => messageViewEnabled
    ? splitMessageProjectionSegments(zones, props.compositionItems)
    : zones.map(zone => ({ zones: [zone] })), [messageViewEnabled, props.compositionItems, zones])

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
    else props.onReorder?.(dragging.id, target.id)
  }

  function renderZone(zone: (typeof zones)[number]) {
    const zoneIndex = zones.findIndex(candidate => candidate.id === zone.id)
    const collapsed = collapsedIds.has(zone.id)
    const prevZoneId = zoneIndex > 0 ? zones[zoneIndex - 1]?.id : undefined
    const nextZoneId = zoneIndex < zones.length - 1 ? zones[zoneIndex + 1]?.id : undefined
    const zoneActions = readProjectionZoneActions(zone.id, {
      canMoveDown: Boolean(props.onReorderZone && nextZoneId),
      canMoveUp: Boolean(props.onReorderZone && prevZoneId),
      onAddEntryInZone: props.onAddEntryInZone,
      onAddZone: props.onAddZone,
      onDeleteZone: props.onDeleteZone,
      onMoveDown: nextZoneId && props.onReorderZone ? () => props.onReorderZone!(zone.id, nextZoneId) : undefined,
      onMoveUp: prevZoneId && props.onReorderZone ? () => props.onReorderZone!(zone.id, prevZoneId) : undefined,
      t: props.t,
    })

    return (
      <section
        className={`${styles.zone} ${props.selectedZoneId === zone.id ? styles.selectedZone : ''}`}
        draggable={Boolean(props.onReorderZone)}
        key={zone.id}
        role="listitem"
        onDragEnd={() => setDragging(undefined)}
        onDragOver={event => event.preventDefault()}
        onDragStart={() => setDragging({ id: zone.id, type: 'zone' })}
        onDrop={() => drop({ id: zone.id, type: 'zone' })}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={zoneActions.length === 0}>
            <div className={styles.zoneHeader}>
              {props.onReorderZone ? <GripVertical className={styles.dragHandle} aria-hidden="true" /> : null}
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
              <Diamond className={styles.zoneIcon} aria-hidden="true" />
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
                getNeighbors={getNeighbors}
                isLast={index === zone.rows.length - 1}
                key={row.id}
                row={row}
                selectedId={props.selectedId}
                t={props.t}
                toggle={toggle}
                onDeleteNode={props.onDeleteNode}
                onDragEnd={() => setDragging(undefined)}
                onDragStart={id => setDragging({ id, type: 'row' })}
                onDrop={id => drop({ id, type: 'row' })}
                onDuplicateNode={props.onDuplicateNode}
                onRename={props.onRename}
                onReorder={props.onReorder}
                onSelect={props.onSelect}
                onToggleEnabled={props.onToggleEnabled}
                reorderable={Boolean(props.onReorder)}
              />
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  function renderSegment(segment: MessageProjectionSegment, segmentIndex: number) {
    if (!segment.block) return segment.zones.map(renderZone)
    const blockIndex = messageBlocks.findIndex(block => block.id === segment.block?.id)
    const actions = readMessageBlockActions(segment.block, {
      canMoveDown: blockIndex >= 0 && blockIndex < messageBlocks.length - 1,
      canMoveUp: blockIndex > 0,
      onAddDirectEntry: props.onAddDirectEntry,
      onAddSlot: props.onAddSlotToMessageBlock,
      onAddZone: props.onAddZoneToMessageBlock,
      onDelete: props.onDeleteCompositionItem,
      onMove: props.onMoveCompositionItem,
      t: props.t,
    })
    return (
      <section
        className={`${styles.messageBlock} ${messageRoleClass(segment.block.role)}`}
        data-message-block-id={segment.block.id}
        key={`${segment.block.id}:${segmentIndex}`}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={actions.length === 0}>
            <button
              aria-label={segment.block.displayName}
              className={styles.messageBlockHeader}
              type="button"
              onClick={() => props.onSelect?.(segment.block!.id)}
            >
              <span>{messageRoleLabel(segment.block.role)}</span>
              <small>{segment.block.items.length} {props.t('context.compositionItems')}</small>
            </button>
          </ContextMenuTrigger>
          {actions.length > 0 ? <ContextMenuContent>{renderContextMenuItems(actions)}</ContextMenuContent> : null}
        </ContextMenu>
        <div className={styles.messageBlockZones}>{segment.zones.map(renderZone)}</div>
      </section>
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

      <div className={styles.zones} role="list">
        {messageSegments.flatMap(renderSegment)}
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
  getNeighbors: (id: string) => { nextId?: string; prevId?: string }
  isLast: boolean
  onDeleteNode?: (id: string) => void
  onDragEnd(): void
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
            draggable={props.reorderable}
            onDragEnd={event => {
              event.stopPropagation()
              props.onDragEnd()
            }}
            onDragOver={event => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onDragStart={event => {
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
              : <span className={styles.position}>{String(primary.position).padStart(2, '0')}</span>}
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
                    draggable={props.reorderable}
                    onDragEnd={event => {
                      event.stopPropagation()
                      props.onDragEnd()
                    }}
                    onDragOver={event => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onDragStart={event => {
                      event.stopPropagation()
                      props.onDragStart(entry.node.id)
                    }}
                    onDrop={event => {
                      event.stopPropagation()
                      props.onDrop(entry.node.id)
                    }}
                  >
                    {props.reorderable ? <GripVertical className={styles.dragHandle} aria-hidden="true" /> : null}
                    <span className={styles.position}>{String(entry.position).padStart(2, '0')}</span>
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
