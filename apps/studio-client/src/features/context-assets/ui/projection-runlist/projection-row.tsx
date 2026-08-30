import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import type { Translator } from '../../../../shared/i18n/index.js'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from '../../../../shared/ui/context-menu/context-menu.js'
import type { ProjectionOrderRow } from '../../model/projection-order.js'
import { readSlotEntrySummary } from '../../model/projection-slot.js'
import {
  hideNativeDragPreview,
  type ProjectionDropTarget,
} from './projection-runlist-types.js'
import {
  readProjectionEntryActions,
  renderContextMenuItems,
} from './projection-runlist-actions.js'
import styles from './projection-runlist.module.scss'

export function ProjectionRow(props: {
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
}): ReactNode {
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
