import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import { DndContext, DragOverlay, useDraggable, useDroppable, defaultDropAnimationSideEffects, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import type { ContextMenuItem } from '../context-menu/context-menu.js'
import { useContextMenuTrigger } from '../context-menu/use-context-menu-trigger.js'
import { findNodeById, readDropPosition } from './file-tree-model.js'
import styles from './file-tree.module.scss'

export type FileTreeNode = {
  children?: FileTreeNode[]
  id: string
  label: string
  meta?: string
  isSection?: boolean
}

type FileTreeProps = {
  ariaLabel: string
  defaultExpandedIds?: string[]
  expandedIds?: string[]
  getActions?: (node: FileTreeNode) => ContextMenuItem[]
  isMuted?: (node: FileTreeNode) => boolean
  moreActionsLabel: string
  nodes: FileTreeNode[]
  onMoveNode?: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onExpandedIdsChange?: (expandedIds: string[]) => void
  onSelect: (node: FileTreeNode) => void
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
  renderTrailing?: (node: FileTreeNode) => ReactNode
  selectedId?: string
  variant?: 'tree' | 'flat'
}

export function FileTree(props: FileTreeProps) {
  const [localExpandedIds, setLocalExpandedIds] = useState<Set<string>>(
    () => new Set(props.defaultExpandedIds ?? props.nodes.map(node => node.id))
  )
  const [activeNode, setActiveNode] = useState<FileTreeNode>()
  const expandedIds = props.expandedIds === undefined ? localExpandedIds : new Set(props.expandedIds)

  function toggleExpand(id: string) {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (props.expandedIds === undefined) setLocalExpandedIds(next)
    props.onExpandedIdsChange?.([...next])
  }

  function handleDragStart(event: DragStartEvent) {
    const node = findNodeById(props.nodes, event.active.id as string)
    setActiveNode(node)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveNode(undefined)
    if (!props.onMoveNode || !event.over || event.active.id === event.over.id) return

    const draggedId = event.active.id as string
    const overId = event.over.id as string

    const targetNode = findNodeById(props.nodes, overId)
    if (!targetNode) return

    const position = targetNode.children ? 'inside' : readDropPosition(props.nodes, draggedId, overId)
    props.onMoveNode(draggedId, overId, position)
  }

  return (
    <DndContext onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
      <div
        className={props.variant === 'flat' ? `${styles.tree} ${styles.flatTree}` : styles.tree}
        role="tree"
        aria-label={props.ariaLabel}
        data-loom-component="file-tree"
      >
        {props.nodes.map(node => (
          <FileTreeRow
            expandedIds={expandedIds}
            getActions={props.getActions}
            isMuted={props.isMuted}
            key={node.id}
            level={1}
            moreActionsLabel={props.moreActionsLabel}
            node={node}
            onSelect={props.onSelect}
            onToggleExpand={toggleExpand}
            renderIcon={props.renderIcon}
            renderTrailing={props.renderTrailing}
            selectedId={props.selectedId}
            variant={props.variant}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }) }}>
        {activeNode ? (
          <FileTreeRowOverlay
            level={1}
            node={activeNode}
            renderIcon={props.renderIcon}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function FileTreeRow(props: {
  expandedIds: Set<string>
  getActions?: (node: FileTreeNode) => ContextMenuItem[]
  isMuted?: (node: FileTreeNode) => boolean
  level: number
  moreActionsLabel: string
  node: FileTreeNode
  onSelect: (node: FileTreeNode) => void
  onToggleExpand: (id: string) => void
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
  renderTrailing?: (node: FileTreeNode) => ReactNode
  selectedId?: string
  variant?: 'tree' | 'flat'
}) {
  const hasChildren = Boolean(props.node.children)
  const expanded = props.node.isSection || (hasChildren && props.expandedIds.has(props.node.id))
  const selected = props.node.id === props.selectedId
  const actions = props.getActions?.(props.node) ?? []
  const trailing = props.renderTrailing?.(props.node)
  const contextMenu = useContextMenuTrigger(actions)

  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id: props.node.id,
    data: props.node,
    disabled: props.node.isSection,
  })

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: props.node.id,
    data: props.node,
  })

  let rowClass = styles.row
  if (selected) rowClass += ` ${styles.selected}`
  if (isDragging) rowClass += ` ${styles.dragging}`
  if (isOver) rowClass += ` ${styles.dragOver}`
  if (props.isMuted?.(props.node)) rowClass += ` ${styles.muted}`

  return (
    <>
      {props.node.isSection ? (
        <div
          ref={setDroppableRef}
          className={styles.sectionRow}
          role="treeitem"
        >
          <div className={styles.sectionDivider} />
          <span className={styles.sectionLabel}>{props.node.label}</span>
          <div className={styles.sectionDivider} />
        </div>
      ) : (
        <div
          ref={setDroppableRef}
          className={rowClass}
          style={{ '--loom-tree-level': props.level } as CSSProperties}
          role="treeitem"
        >
          {props.variant !== 'flat' && props.level > 1 ? (
            <span className={styles.guideColumns} aria-hidden="true">
              {Array.from({ length: props.level - 1 }, (_, index) => (
                <span
                  className={styles.guideColumn}
                  key={index}
                />
              ))}
            </span>
          ) : null}
          <div
            ref={setDraggableRef}
            className={styles.dragHandle}
            {...attributes}
            {...listeners}
            aria-hidden="true"
          >
            <GripVertical />
          </div>

          <button
            className={styles.disclosure}
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation()
              props.onToggleExpand(props.node.id)
            }}
          >
            {hasChildren ? (
              expanded ? <ChevronDown /> : <ChevronRight />
            ) : null}
          </button>
          {props.variant !== 'flat' && expanded && hasChildren ? <span className={styles.branchContinuation} aria-hidden="true" /> : null}

          <div
            {...contextMenu.triggerProps}
            aria-haspopup={actions.length > 0 ? 'menu' : undefined}
            className={styles.rowContent}
            onClick={() => props.onSelect(props.node)}
            onKeyDown={event => {
              contextMenu.triggerProps.onKeyDown?.(event)
              if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return
              event.preventDefault()
              props.onSelect(props.node)
            }}
            role="button"
            tabIndex={0}
          >
            <span className={styles.icon} aria-hidden="true">
              {props.renderIcon?.(props.node, expanded)}
            </span>
            <span className={styles.labelBlock}>
              <span className={styles.label}>{props.node.label}</span>
              {props.node.meta ? <span className={styles.meta}>{props.node.meta}</span> : null}
            </span>
          </div>

          {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
          {actions.length > 0 ? (
            <button
              {...contextMenu.triggerProps}
              aria-label={props.moreActionsLabel}
              className={styles.actions}
              title={props.moreActionsLabel}
              type="button"
              onClick={event => {
                event.stopPropagation()
                contextMenu.openFromElement(event.currentTarget)
              }}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}
      {expanded ? props.node.children?.map(child => (
        <FileTreeRow
          expandedIds={props.expandedIds}
          getActions={props.getActions}
          isMuted={props.isMuted}
          key={child.id}
          level={props.node.isSection ? props.level : props.level + 1}
          moreActionsLabel={props.moreActionsLabel}
          node={child}
          onSelect={props.onSelect}
          onToggleExpand={props.onToggleExpand}
          renderIcon={props.renderIcon}
          renderTrailing={props.renderTrailing}
          selectedId={props.selectedId}
          variant={props.variant}
        />
      )) : null}
    </>
  )
}

function FileTreeRowOverlay(props: {
  level: number
  node: FileTreeNode
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
}) {
  return (
    <div
      className={`${styles.row} ${styles.draggingOverlay}`}
      style={{ '--loom-tree-level': props.level } as CSSProperties}
    >
      <span className={styles.disclosure} />
      <div className={styles.rowContent}>
        <span className={styles.icon}>
          {props.renderIcon?.(props.node, false)}
        </span>
        <span className={styles.labelBlock}>
          <span className={styles.label}>{props.node.label}</span>
          {props.node.meta ? <span className={styles.meta}>{props.node.meta}</span> : null}
        </span>
      </div>
      <div className={styles.dragHandle} />
    </div>
  )
}
