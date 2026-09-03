import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type ElementType } from 'react'
import { DndContext, DragOverlay, useDraggable, useDroppable, defaultDropAnimationSideEffects, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import type { MenuAction } from '../menu-action.js'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem, ContextMenuSeparator } from '../context-menu/context-menu.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator } from '../dropdown-menu/dropdown-menu.js'
import { findNodeById, readDropPosition, readFileTreeKeyboardTarget, readVisibleFileTreeNodes, type FileTreeNode } from './file-tree-model.js'
import styles from './file-tree.module.scss'

export type { FileTreeNode } from './file-tree-model.js'

type FileTreeProps = {
  ariaLabel: string
  formatLabel?: (node: FileTreeNode) => string
  getDisclosureLabel: (node: FileTreeNode, expanded: boolean) => string
  getDragLabel: (node: FileTreeNode) => string
  editingId?: string
  expandedIds: string[]
  getActions?: (node: FileTreeNode) => MenuAction[]
  isMuted?: (node: FileTreeNode) => boolean
  moreActionsLabel: string
  nodes: FileTreeNode[]
  onMoveNode?: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onEditCommit?: (id: string, newLabel: string) => void
  onEditCancel?: (id: string) => void
  onExpandedIdsChange: (expandedIds: string[]) => void
  onSelect: (node: FileTreeNode) => void
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
  renderMetaLeading?: (node: FileTreeNode) => ReactNode
  selectedId?: string
  variant?: 'tree' | 'flat'
}

export function FileTree(props: FileTreeProps) {
  const [draggedNode, setDraggedNode] = useState<FileTreeNode>()
  const [focusedId, setFocusedId] = useState<string>()
  const treeItemRefs = useRef(new Map<string, HTMLDivElement>())
  const expandedIds = useMemo(() => new Set(props.expandedIds), [props.expandedIds])
  const visibleNodes = useMemo(() => readVisibleFileTreeNodes(props.nodes, expandedIds), [expandedIds, props.nodes])
  const rovingId = visibleNodes.some(item => item.node.id === focusedId)
    ? focusedId
    : visibleNodes.some(item => item.node.id === props.selectedId)
      ? props.selectedId
      : visibleNodes[0]?.node.id

  useEffect(() => {
    if (focusedId && !visibleNodes.some(item => item.node.id === focusedId)) setFocusedId(rovingId)
  }, [focusedId, rovingId, visibleNodes])

  function toggleExpand(id: string) {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    props.onExpandedIdsChange([...next])
  }

  function focusNode(id: string | undefined) {
    if (!id) return
    setFocusedId(id)
    requestAnimationFrame(() => treeItemRefs.current.get(id)?.focus())
  }

  function handleTreeItemKeyDown(event: KeyboardEvent<HTMLDivElement>, node: FileTreeNode) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      props.onSelect(node)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const target = readFileTreeKeyboardTarget({ expandedIds, key: event.key, nodeId: node.id, visibleNodes })
    if (target.toggleId) toggleExpand(target.toggleId)
    else focusNode(target.focusId)
  }

  function handleDragStart(event: DragStartEvent) {
    const node = findNodeById(props.nodes, event.active.id as string)
    setDraggedNode(node)
  }

  function isNodeContainer(node: FileTreeNode): boolean {
    return node.children !== undefined
      || node.container === true
      || node.kind === 'folder'
      || node.kind === 'module'
      || node.kind === 'message'
      || node.kind === 'slot'
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedNode(undefined)
    if (!props.onMoveNode || !event.over || event.active.id === event.over.id) return

    const draggedId = event.active.id as string
    const overId = event.over.id as string

    const targetNode = findNodeById(props.nodes, overId)
    if (!targetNode) return

    const position = isNodeContainer(targetNode) ? 'inside' : readDropPosition(props.nodes, draggedId, overId)
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
            editingId={props.editingId}
            expandedIds={expandedIds}
            canDrag={Boolean(props.onMoveNode)}
            formatLabel={props.formatLabel}
            getDisclosureLabel={props.getDisclosureLabel}
            getDragLabel={props.getDragLabel}
            getActions={props.getActions}
            isMuted={props.isMuted}
            key={node.id}
            level={1}
            moreActionsLabel={props.moreActionsLabel}
            node={node}
            onEditCommit={props.onEditCommit}
            onEditCancel={props.onEditCancel}
            onSelect={props.onSelect}
            onToggleExpand={toggleExpand}
            renderIcon={props.renderIcon}
            renderMetaLeading={props.renderMetaLeading}
            rovingId={rovingId}
            selectedId={props.selectedId}
            setTreeItemRef={(id, element) => {
              if (element) treeItemRefs.current.set(id, element)
              else treeItemRefs.current.delete(id)
            }}
            variant={props.variant}
            onFocusNode={setFocusedId}
            onTreeItemKeyDown={handleTreeItemKeyDown}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }) }}>
        {draggedNode ? (
          <FileTreeRowOverlay
            formatLabel={props.formatLabel}
            level={1}
            node={draggedNode}
            renderIcon={props.renderIcon}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function FileTreeRow(props: {
  editingId?: string
  expandedIds: Set<string>
  canDrag: boolean
  formatLabel?: (node: FileTreeNode) => string
  getDisclosureLabel: (node: FileTreeNode, expanded: boolean) => string
  getDragLabel: (node: FileTreeNode) => string
  getActions?: (node: FileTreeNode) => MenuAction[]
  isMuted?: (node: FileTreeNode) => boolean
  level: number
  moreActionsLabel: string
  node: FileTreeNode
  onEditCommit?: (id: string, newLabel: string) => void
  onEditCancel?: (id: string) => void
  onSelect: (node: FileTreeNode) => void
  onToggleExpand: (id: string) => void
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
  renderMetaLeading?: (node: FileTreeNode) => ReactNode
  rovingId?: string
  selectedId?: string
  setTreeItemRef: (id: string, element: HTMLDivElement | null) => void
  variant?: 'tree' | 'flat'
  onFocusNode: (id: string) => void
  onTreeItemKeyDown: (event: KeyboardEvent<HTMLDivElement>, node: FileTreeNode) => void
}) {
  const hasChildren = Boolean(props.node.children)
  const expanded = props.node.isSection || (hasChildren && props.expandedIds.has(props.node.id))
  const selected = props.node.id === props.selectedId
  const actions = props.getActions?.(props.node) ?? []
  const metaLeading = props.renderMetaLeading?.(props.node)
  const labelId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draftLabel, setDraftLabel] = useState(props.node.label)
  const isEditing = props.editingId === props.node.id

  useEffect(() => {
    setDraftLabel(props.node.label)
  }, [props.node.label, isEditing])

  useEffect(() => {
    if (isEditing) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isEditing])

  const commitEdit = () => {
    if (draftLabel.trim() && draftLabel !== props.node.label) {
      props.onEditCommit?.(props.node.id, draftLabel.trim())
    } else {
      props.onEditCancel?.(props.node.id)
    }
  }

  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id: props.node.id,
    data: props.node,
    disabled: props.node.isSection || !props.canDrag,
  })

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: props.node.id,
    data: props.node,
  })

  const hasCount = props.level === 1 && Boolean(props.node.children && props.node.children.length > 0)
  const childCount = props.node.children?.length ?? 0
  const isMessageBlock = props.node.kind === 'message'
  const showMeta = !isMessageBlock && Boolean(props.node.meta || metaLeading)

  let rowClass = styles.row
  if (isMessageBlock) rowClass += ` ${styles.messageBlockRow}`
  if (selected) rowClass += ` ${styles.selected}`
  if (isDragging) rowClass += ` ${styles.dragging}`
  if (isOver) rowClass += ` ${styles.dragOver}`
  if (props.isMuted?.(props.node)) rowClass += ` ${styles.muted}`

  const renderMenuContent = (Item: ElementType, CheckboxItem: ElementType, Separator: ElementType) => {
    return actions.map(action => {
      if (action.type === 'separator') return <Separator key={action.id} />
      if (action.checked !== undefined) {
        return (
          <CheckboxItem key={action.id} checked={action.checked} onCheckedChange={() => action.onSelect()} disabled={action.disabled}>
            {action.label}
          </CheckboxItem>
        )
      }
      return (
        <Item key={action.id} icon={action.icon} tone={action.tone} disabled={action.disabled} onSelect={() => action.onSelect()}>
          {action.label}
        </Item>
      )
    })
  }

  const iconElement = props.renderIcon?.(props.node, expanded)

  const rowElement = (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={actions.length === 0}>
        <div
          ref={element => {
            setDroppableRef(element)
            props.setTreeItemRef(props.node.id, element)
          }}
          className={rowClass}
          style={{ '--loom-tree-level': props.level } as CSSProperties}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-haspopup={actions.length > 0 ? 'menu' : undefined}
          aria-level={props.level}
          aria-labelledby={labelId}
          aria-selected={selected}
          role="treeitem"
          tabIndex={props.node.id === props.rovingId ? 0 : -1}
          onClick={() => props.onSelect(props.node)}
          onFocus={() => props.onFocusNode(props.node.id)}
          onKeyDown={event => {
            if (!event.defaultPrevented) props.onTreeItemKeyDown(event, props.node)
          }}
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
          {props.canDrag ? (
            <button
              ref={setDraggableRef}
              className={styles.dragHandle}
              type="button"
              {...attributes}
              {...listeners}
              aria-label={props.getDragLabel(props.node)}
              tabIndex={-1}
              onClick={event => event.stopPropagation()}
            >
              <GripVertical aria-hidden="true" />
            </button>
          ) : null}

          {hasChildren ? (
            <button
              aria-label={props.getDisclosureLabel(props.node, expanded)}
              aria-expanded={expanded}
              className={styles.disclosure}
              tabIndex={-1}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                props.onToggleExpand(props.node.id)
              }}
            >
              {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
          ) : <span className={styles.disclosure} aria-hidden="true" />}
          {props.variant !== 'flat' && expanded && hasChildren ? <span className={styles.branchContinuation} aria-hidden="true" /> : null}

          <div
            className={styles.rowContent}
          >
            {iconElement ? (
              <span className={styles.icon} aria-hidden="true">
                {iconElement}
              </span>
            ) : null}
            <span className={styles.labelBlock}>
              {isEditing ? (
                <input
                  ref={inputRef}
                  className={styles.editInput}
                  value={draftLabel}
                  onChange={e => setDraftLabel(e.target.value)}
                  onBlur={commitEdit}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitEdit()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      props.onEditCancel?.(props.node.id)
                    }
                  }}
                />
              ) : (
                <span className={styles.label} id={labelId}>
                  {props.formatLabel ? props.formatLabel(props.node) : props.node.label}
                  {hasCount ? <sup className={styles.childCountSup}>{childCount}</sup> : null}
                </span>
              )}
              {showMeta ? (
                <span className={styles.metaRow}>
                  {metaLeading ? <span className={styles.metaLeading}>{metaLeading}</span> : null}
                  {props.node.meta ? <span className={styles.meta}>{props.node.meta}</span> : null}
                </span>
              ) : null}
            </span>
          </div>

          {actions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={props.moreActionsLabel}
                  className={styles.actions}
                  tabIndex={-1}
                  title={props.moreActionsLabel}
                  type="button"
                  onClick={event => event.stopPropagation()}
                >
                  <MoreHorizontal aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom">
                {renderMenuContent(DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator)}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </ContextMenuTrigger>
      {actions.length > 0 ? (
        <ContextMenuContent>
          {renderMenuContent(ContextMenuItem, ContextMenuCheckboxItem, ContextMenuSeparator)}
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  )

  const childrenElements = expanded && props.node.children?.length ? props.node.children.map(child => (
    <FileTreeRow
      editingId={props.editingId}
      expandedIds={props.expandedIds}
      canDrag={props.canDrag}
      formatLabel={props.formatLabel}
      getDisclosureLabel={props.getDisclosureLabel}
      getDragLabel={props.getDragLabel}
      getActions={props.getActions}
      isMuted={props.isMuted}
      key={child.id}
      level={props.node.isSection ? props.level : props.level + 1}
      moreActionsLabel={props.moreActionsLabel}
      node={child}
      onEditCommit={props.onEditCommit}
      onEditCancel={props.onEditCancel}
      onSelect={props.onSelect}
      onToggleExpand={props.onToggleExpand}
      renderIcon={props.renderIcon}
      renderMetaLeading={props.renderMetaLeading}
      rovingId={props.rovingId}
      selectedId={props.selectedId}
      setTreeItemRef={props.setTreeItemRef}
      variant={props.variant}
      onFocusNode={props.onFocusNode}
      onTreeItemKeyDown={props.onTreeItemKeyDown}
    />
  )) : null

  if (isMessageBlock) {
    let containerClass = styles.messageBlockContainer
    if (selected) containerClass += ` ${styles.messageBlockContainerSelected}`

    return (
      <div
        className={containerClass}
        data-message-block={props.node.id}
      >
        {rowElement}
        {childrenElements ? (
          <div className={styles.messageBlockChildren}>
            {childrenElements}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
      {props.node.isSection ? (
        <div
          ref={setDroppableRef}
          className={styles.sectionRow}
          role="presentation"
        >
          <div className={styles.sectionDivider} />
          <span className={styles.sectionLabel}>{props.formatLabel ? props.formatLabel(props.node) : props.node.label}</span>
          <div className={styles.sectionDivider} />
        </div>
      ) : rowElement}
      {childrenElements}
    </>
  )
}

function FileTreeRowOverlay(props: {
  formatLabel?: (node: FileTreeNode) => string
  level: number
  node: FileTreeNode
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
}) {
  const iconElement = props.renderIcon?.(props.node, false)

  return (
    <div
      className={`${styles.row} ${styles.draggingOverlay}`}
      style={{ '--loom-tree-level': props.level } as CSSProperties}
    >
      <span className={styles.disclosure} />
      <div className={styles.rowContent}>
        {iconElement ? (
          <span className={styles.icon}>
            {iconElement}
          </span>
        ) : null}
        <span className={styles.labelBlock}>
          <span className={styles.label}>{props.formatLabel ? props.formatLabel(props.node) : props.node.label}</span>
          {props.node.meta ? <span className={styles.meta}>{props.node.meta}</span> : null}
        </span>
      </div>
      <div className={styles.dragHandle} />
    </div>
  )
}
