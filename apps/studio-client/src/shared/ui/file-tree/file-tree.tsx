import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import { DndContext, DragOverlay, useDraggable, useDroppable, defaultDropAnimationSideEffects, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { findNodeById, readDropPosition } from './file-tree-model.js'
import styles from './file-tree.module.css'

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
  nodes: FileTreeNode[]
  onMoveNode?: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onSelect: (node: FileTreeNode) => void
  renderActions?: (node: FileTreeNode) => ReactNode
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
  selectedId?: string
}

export function FileTree(props: FileTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(props.defaultExpandedIds ?? props.nodes.map(node => node.id))
  )
  const [activeNode, setActiveNode] = useState<FileTreeNode>()

  function toggleExpand(id: string) {
    setExpandedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
      <div className={styles.tree} role="tree" aria-label={props.ariaLabel} data-loom-component="file-tree">
        {props.nodes.map(node => (
          <FileTreeRow
            expandedIds={expandedIds}
            key={node.id}
            level={1}
            node={node}
            onSelect={props.onSelect}
            onToggleExpand={toggleExpand}
            renderActions={props.renderActions}
            renderIcon={props.renderIcon}
            selectedId={props.selectedId}
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
  level: number
  node: FileTreeNode
  onSelect: (node: FileTreeNode) => void
  onToggleExpand: (id: string) => void
  renderActions?: (node: FileTreeNode) => ReactNode
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
  selectedId?: string
}) {
  const hasChildren = Boolean(props.node.children)
  const expanded = props.node.isSection || (hasChildren && props.expandedIds.has(props.node.id))
  const selected = props.node.id === props.selectedId

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
          <div
            ref={setDraggableRef}
            className={styles.dragHandle}
            {...attributes}
            {...listeners}
            aria-hidden="true"
          >
            <GripVertical size={12} strokeWidth={2} />
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
              expanded ? <ChevronDown absoluteStrokeWidth size={14} strokeWidth={1.5} /> : <ChevronRight absoluteStrokeWidth size={14} strokeWidth={1.5} />
            ) : null}
          </button>

          <div
            className={styles.rowContent}
            onClick={() => props.onSelect(props.node)}
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

          {props.renderActions ? (
            <span
              className={styles.actions}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {props.renderActions(props.node)}
            </span>
          ) : null}
        </div>
      )}
      {expanded ? props.node.children?.map(child => (
        <FileTreeRow
          expandedIds={props.expandedIds}
          key={child.id}
          level={props.node.isSection ? props.level : props.level + 1}
          node={child}
          onSelect={props.onSelect}
          onToggleExpand={props.onToggleExpand}
          renderActions={props.renderActions}
          renderIcon={props.renderIcon}
          selectedId={props.selectedId}
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
