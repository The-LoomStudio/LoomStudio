import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type ElementType } from 'react'
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, type MenuAction } from '@loom-studio/ui'
import { readDropPosition, readFileTreeKeyboardTarget, readVisibleFileTreeNodes, type FileTreeNode } from './file-tree-model.js'
import styles from './file-tree.module.scss'

export type { FileTreeNode } from './file-tree-model.js'

type FileTreeProps = {
  ariaLabel: string
  formatLabel?: (node: FileTreeNode) => string
  getDisclosureLabel: (node: FileTreeNode, expanded: boolean) => string
  getDragLabel: (node: FileTreeNode) => string
  getVirtualScrollElement?: () => HTMLElement | null
  editingId?: string
  expandedIds: string[]
  getActions?: (node: FileTreeNode) => MenuAction[]
  hasActions?: (node: FileTreeNode) => boolean
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
  renderTrailing?: (node: FileTreeNode) => ReactNode
  renderExpandedRow?: (node: FileTreeNode) => ReactNode
  selectedId?: string
  variant?: 'tree' | 'flat'
  virtualized?: boolean
}

export function FileTree(props: FileTreeProps) {
  const [contextActions, setContextActions] = useState<MenuAction[]>([])
  const [focusedId, setFocusedId] = useState<string>()
  const draggedIdRef = useRef<string | undefined>(undefined)
  const draggedElementRef = useRef<HTMLElement | undefined>(undefined)
  const dragOverElementRef = useRef<HTMLElement | undefined>(undefined)
  const treeRef = useRef<HTMLDivElement>(null)
  const treeItemRefs = useRef(new Map<string, HTMLDivElement>())
  const expandedIds = useMemo(() => new Set(props.expandedIds), [props.expandedIds])
  const visibleNodes = useMemo(() => readVisibleFileTreeNodes(props.nodes, expandedIds), [expandedIds, props.nodes])
  const rovingId = visibleNodes.some(item => item.node.id === focusedId)
    ? focusedId
    : visibleNodes.some(item => item.node.id === props.selectedId)
      ? props.selectedId
      : visibleNodes[0]?.node.id
  const virtualizer = useVirtualizer({
    count: props.virtualized ? visibleNodes.length : 0,
    enabled: Boolean(props.virtualized),
    estimateSize: () => 34,
    getItemKey: index => visibleNodes[index]?.node.id ?? index,
    getScrollElement: () => props.getVirtualScrollElement?.() ?? treeRef.current,
    overscan: 8,
  })

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
    if (props.virtualized) {
      const index = visibleNodes.findIndex(item => item.node.id === id)
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
    }
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

  function handleDragStart(event: DragEvent<HTMLElement>, node: FileTreeNode) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', node.id)
    draggedIdRef.current = node.id
    draggedElementRef.current = event.currentTarget.closest<HTMLElement>('[data-file-tree-node-id]') ?? undefined
    draggedElementRef.current?.classList.add(styles.dragging)
  }

  function isNodeContainer(node: FileTreeNode): boolean {
    return node.children !== undefined
      || node.container === true
      || node.kind === 'folder'
      || node.kind === 'module'
      || node.kind === 'message'
      || node.kind === 'slot'
  }

  function handleDragOver(event: DragEvent<HTMLElement>, node: FileTreeNode) {
    if (!draggedIdRef.current || draggedIdRef.current === node.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverElementRef.current === event.currentTarget) return
    dragOverElementRef.current?.classList.remove(styles.dragOver)
    dragOverElementRef.current = event.currentTarget
    dragOverElementRef.current.classList.add(styles.dragOver)
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetNode: FileTreeNode) {
    event.preventDefault()
    event.stopPropagation()
    const sourceId = draggedIdRef.current || event.dataTransfer.getData('text/plain')
    clearDragState()
    if (!props.onMoveNode || !sourceId || sourceId === targetNode.id) return

    const position = isNodeContainer(targetNode) ? 'inside' : readDropPosition(props.nodes, sourceId, targetNode.id)
    props.onMoveNode(sourceId, targetNode.id, position)
  }

  function handleDragEnd() {
    clearDragState()
  }

  function clearDragState() {
    draggedElementRef.current?.classList.remove(styles.dragging)
    dragOverElementRef.current?.classList.remove(styles.dragOver)
    draggedIdRef.current = undefined
    draggedElementRef.current = undefined
    dragOverElementRef.current = undefined
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    const id = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-file-tree-node-id]')?.dataset.fileTreeNodeId
      : undefined
    const node = visibleNodes.find(item => item.node.id === id)?.node
    const actions = node ? props.getActions?.(node) ?? [] : []
    if (actions.length === 0) {
      event.preventDefault()
      return
    }
    setContextActions(actions)
  }

  function renderRow(node: FileTreeNode, level: number, renderChildren: boolean, key?: string) {
    return (
      <FileTreeRow
        key={key}
        editingId={props.editingId}
        expandedIds={expandedIds}
        canDrag={Boolean(props.onMoveNode)}
        formatLabel={props.formatLabel}
        getDisclosureLabel={props.getDisclosureLabel}
        getDragLabel={props.getDragLabel}
        getActions={props.getActions}
        hasActions={props.hasActions?.(node) ?? Boolean(props.getActions)}
        hasActionsForNode={props.hasActions}
        isMuted={props.isMuted}
        level={level}
        moreActionsLabel={props.moreActionsLabel}
        node={node}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
        onEditCommit={props.onEditCommit}
        onEditCancel={props.onEditCancel}
        onSelect={props.onSelect}
        onToggleExpand={toggleExpand}
        renderChildren={renderChildren}
        renderIcon={props.renderIcon}
        renderMetaLeading={props.renderMetaLeading}
        renderTrailing={props.renderTrailing}
        renderExpandedRow={props.renderExpandedRow}
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
    )
  }

  return (
    <ContextMenu onOpenChange={open => {
      if (!open) setContextActions([])
    }}>
      <ContextMenuTrigger asChild disabled={!props.getActions}>
        <div
          ref={treeRef}
          className={[
            styles.tree,
            props.variant === 'flat' ? styles.flatTree : '',
            props.virtualized ? styles.virtualTree : '',
          ].filter(Boolean).join(' ')}
          role="tree"
          aria-label={props.ariaLabel}
          data-loom-component="file-tree"
          onContextMenu={handleContextMenu}
        >
          {props.virtualized ? (
            <div className={styles.virtualContent} style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map(item => {
                const visible = visibleNodes[item.index]
                if (!visible) return null
                return (
                  <div
                    className={styles.virtualRow}
                    data-index={item.index}
                    key={item.key}
                    ref={virtualizer.measureElement}
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {renderRow(visible.node, visible.level, false)}
                  </div>
                )
              })}
            </div>
          ) : props.nodes.map(node => renderRow(node, 1, true, node.id))}
        </div>
      </ContextMenuTrigger>
      {contextActions.length > 0 ? (
        <ContextMenuContent>
          {renderMenuContent(contextActions, ContextMenuItem, ContextMenuCheckboxItem, ContextMenuSeparator)}
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
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
  hasActions: boolean
  hasActionsForNode?: (node: FileTreeNode) => boolean
  isMuted?: (node: FileTreeNode) => boolean
  level: number
  moreActionsLabel: string
  node: FileTreeNode
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLElement>, node: FileTreeNode) => void
  onDragStart: (event: DragEvent<HTMLElement>, node: FileTreeNode) => void
  onDrop: (event: DragEvent<HTMLElement>, node: FileTreeNode) => void
  onEditCommit?: (id: string, newLabel: string) => void
  onEditCancel?: (id: string) => void
  onSelect: (node: FileTreeNode) => void
  onToggleExpand: (id: string) => void
  renderChildren: boolean
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
  renderMetaLeading?: (node: FileTreeNode) => ReactNode
  renderTrailing?: (node: FileTreeNode) => ReactNode
  renderExpandedRow?: (node: FileTreeNode) => ReactNode
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
  const [actionsOpen, setActionsOpen] = useState(false)
  const actions = actionsOpen ? props.getActions?.(props.node) ?? [] : []
  const metaLeading = props.renderMetaLeading?.(props.node)
  const trailingElement = props.renderTrailing?.(props.node)
  const expandedRowElement = props.renderExpandedRow?.(props.node)
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

  const hasCount = props.level === 1 && Boolean(props.node.children && props.node.children.length > 0)
  const childCount = props.node.children?.length ?? 0
  const isMessageBlock = props.node.kind === 'message'
  const showMeta = !isMessageBlock && Boolean(props.node.meta || metaLeading)

  let rowClass = styles.row
  if (isMessageBlock) rowClass += ` ${styles.messageBlockRow}`
  if (selected) rowClass += ` ${styles.selected}`
  if (props.isMuted?.(props.node)) rowClass += ` ${styles.muted}`
  if (!props.canDrag) rowClass += ` ${styles.noDrag}`

  const iconElement = props.renderIcon?.(props.node, expanded)

  const rowElement = (
    <div
          ref={element => {
            props.setTreeItemRef(props.node.id, element)
          }}
          className={rowClass}
          data-file-tree-node-id={props.node.id}
          style={{ '--loom-tree-level': props.level } as CSSProperties}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-haspopup={props.hasActions ? 'menu' : undefined}
          aria-level={props.level}
          aria-labelledby={labelId}
          aria-selected={selected}
          role="treeitem"
          tabIndex={props.node.id === props.rovingId ? 0 : -1}
          onClick={() => props.onSelect(props.node)}
          onFocus={() => props.onFocusNode(props.node.id)}
          onDragOver={event => props.onDragOver(event, props.node)}
          onDrop={event => props.onDrop(event, props.node)}
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
              className={styles.dragHandle}
              draggable
              type="button"
              aria-label={props.getDragLabel(props.node)}
              tabIndex={-1}
              onClick={event => event.stopPropagation()}
              onDragEnd={props.onDragEnd}
              onDragStart={event => props.onDragStart(event, props.node)}
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

          {trailingElement ? (
            <div className={styles.trailing} onClick={event => event.stopPropagation()}>
              {trailingElement}
            </div>
          ) : null}

          {props.hasActions ? (
            <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
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
              {actionsOpen ? (
                <DropdownMenuContent align="start" side="bottom">
                  {renderMenuContent(actions, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator)}
                </DropdownMenuContent>
              ) : null}
            </DropdownMenu>
          ) : null}
        </div>
  )

  const childrenElements = props.renderChildren && expanded && props.node.children?.length ? props.node.children.map(child => (
    <FileTreeRow
      editingId={props.editingId}
      expandedIds={props.expandedIds}
      canDrag={props.canDrag}
      formatLabel={props.formatLabel}
      getDisclosureLabel={props.getDisclosureLabel}
      getDragLabel={props.getDragLabel}
      getActions={props.getActions}
      hasActions={props.hasActionsForNode?.(child) ?? Boolean(props.getActions)}
      hasActionsForNode={props.hasActionsForNode}
      isMuted={props.isMuted}
      key={child.id}
      level={props.node.isSection ? props.level : props.level + 1}
      moreActionsLabel={props.moreActionsLabel}
      node={child}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDragStart={props.onDragStart}
      onDrop={props.onDrop}
      onEditCommit={props.onEditCommit}
      onEditCancel={props.onEditCancel}
      onSelect={props.onSelect}
      onToggleExpand={props.onToggleExpand}
      renderChildren
      renderIcon={props.renderIcon}
      renderMetaLeading={props.renderMetaLeading}
      renderTrailing={props.renderTrailing}
      renderExpandedRow={props.renderExpandedRow}
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
        {expandedRowElement ? (
          <div className={styles.expandedRow} style={{ '--loom-tree-level': props.level } as CSSProperties}>
            {expandedRowElement}
          </div>
        ) : null}
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
          className={styles.sectionRow}
          data-file-tree-node-id={props.node.id}
          role="presentation"
          onDragOver={event => props.onDragOver(event, props.node)}
          onDrop={event => props.onDrop(event, props.node)}
        >
          <div className={styles.sectionDivider} />
          <span className={styles.sectionLabel}>{props.formatLabel ? props.formatLabel(props.node) : props.node.label}</span>
          <div className={styles.sectionDivider} />
        </div>
      ) : (
        <>
          {rowElement}
          {expandedRowElement ? (
            <div className={styles.expandedRow} style={{ '--loom-tree-level': props.level } as CSSProperties}>
              {expandedRowElement}
            </div>
          ) : null}
        </>
      )}
      {childrenElements}
    </>
  )
}

function renderMenuContent(actions: MenuAction[], Item: ElementType, CheckboxItem: ElementType, Separator: ElementType) {
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
