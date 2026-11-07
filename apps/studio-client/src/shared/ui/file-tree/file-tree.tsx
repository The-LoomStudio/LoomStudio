import { ChevronDown, ChevronRight, Info, GripVertical, MoreHorizontal, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { measureFileTreeElement, observeFileTreeOffset } from './file-tree-virtual-scroll.js'
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type ElementType } from 'react'
import { Button, Dialog, ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, type MenuAction } from '@loom-studio/ui'
import { useEffectiveMotion } from '../../hooks/use-motion-preference.js'
import { useSlidingHover } from '../../hooks/use-sliding-hover.js'
import { readDragTopScrollSpeed, readDropPosition, readFileTreeKeyboardTarget, readVisibleFileTreeNodes, type FileTreeNode } from './file-tree-model.js'
import { createTranslator, resolveCurrentLocale } from '../../i18n/index.js'
import { useListSelection } from './use-list-selection.js'
import styles from './file-tree.module.scss'

export type { FileTreeNode } from './file-tree-model.js'

export type FileTreeBatchAction = {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  tone?: 'default' | 'danger'
  confirm?: boolean
  run(nodes: FileTreeNode[]): void | Promise<void | { failedIds: string[]; error?: string }>
}

type FileTreeProps = {
  getBatchActions?: (nodes: FileTreeNode[]) => FileTreeBatchAction[]
  canBatchSelect?: (node: FileTreeNode) => boolean
  batchDisabled?: boolean
  active?: boolean
  highlightMessages?: boolean
  ariaLabel: string
  renderLabel?: (node: FileTreeNode) => ReactNode
  formatLabel?: (node: FileTreeNode) => string
  formatMeta?: (node: FileTreeNode) => string | undefined
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
  canDrop?: (sourceId: string, targetId: string, position: 'before' | 'inside' | 'after') => boolean
  canDrag?: (node: FileTreeNode) => boolean
  onMoveNode?: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onEditCommit?: (id: string, newLabel: string) => void
  onEditCancel?: (id: string) => void
  onExpandedIdsChange: (expandedIds: string[]) => void
  onSelect: (node: FileTreeNode) => void
  canOpenFolderDetails?: (node: FileTreeNode) => boolean
  renderIcon?: (node: FileTreeNode, expanded: boolean) => ReactNode
  renderLabelSuffix?: (node: FileTreeNode) => ReactNode
  renderMetaLeading?: (node: FileTreeNode) => ReactNode
  renderTrailing?: (node: FileTreeNode) => ReactNode
  renderExpandedRow?: (node: FileTreeNode) => ReactNode
  selectedId?: string
  revealId?: string
  variant?: 'tree' | 'flat' | 'indented'
  virtualized?: boolean
}

export function FileTree(props: FileTreeProps) {
  const [contextOpen, setContextOpen] = useState(false)
  const [contextActions, setContextActions] = useState<MenuAction[]>([])
  const lastContextMenuTimeRef = useRef(0)
  const [focusedId, setFocusedId] = useState<string>()
  const draggedIdRef = useRef<string | undefined>(undefined)
  const draggedElementRef = useRef<HTMLElement | undefined>(undefined)
  const dragOverElementRef = useRef<HTMLElement | undefined>(undefined)
  const stopDragScrollRef = useRef<(() => void) | undefined>(undefined)
  const treeRef = useRef<HTMLDivElement>(null)
  const virtualContentRef = useRef<HTMLDivElement>(null)
  const treeItemRefs = useRef(new Map<string, HTMLDivElement>())
  const revealedIdRef = useRef<string | undefined>(undefined)
  const virtualRowRefs = useRef(new Map<string, HTMLDivElement>())
  const virtualFirstPositionsRef = useRef(new Map<string, number>())
  const virtualAnimationsRef = useRef(new Map<string, Animation>())
  const virtualOpeningRef = useRef(false)
  const previousVisibleIdsRef = useRef(new Set<string>())
  const effectiveMotion = useEffectiveMotion()
  const slidingHover = useSlidingHover<HTMLDivElement>({
    itemSelector: '[role="treeitem"][data-file-tree-node-id]',
    insetX: 6,
    activeId: props.selectedId,
  })
  const setTreeContainerRef = useCallback((element: HTMLDivElement | null) => {
    treeRef.current = element
    slidingHover.containerRef.current = element
  }, [slidingHover.containerRef])
  const expandedIds = useMemo(() => new Set(props.expandedIds), [props.expandedIds])
  const visibleNodes = useMemo(() => readVisibleFileTreeNodes(props.nodes, expandedIds), [expandedIds, props.nodes])
  const batchNodes = visibleNodes.map(item => item.node).filter(node => props.canBatchSelect?.(node) ?? node.kind !== 'folder')
  const selection = useListSelection(batchNodes.map(node => node.id))
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchError, setBatchError] = useState('')
  const [confirmation, setConfirmation] = useState<{ action: FileTreeBatchAction; nodes: FileTreeNode[] }>()
  const t = createTranslator(resolveCurrentLocale())
  const selectedNodes = batchNodes.filter(node => selection.selected.has(node.id))
  const batchActions = props.getBatchActions?.(selectedNodes) ?? []
  const batchLocked = batchBusy || props.batchDisabled
  async function runBatch(action: FileTreeBatchAction, nodes: FileTreeNode[]) {
    setBatchBusy(true)
    setBatchError('')
    try {
      const result = await action.run(nodes)
      selection.setSelected(new Set(result?.failedIds ?? []))
      setBatchError(result?.error ?? '')
      setConfirmation(undefined)
    } catch (cause) {
      setBatchError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBatchBusy(false) }
  }
  function requestBatch(action: FileTreeBatchAction, nodes: FileTreeNode[]) {
    if (action.disabled || batchLocked) return
    if (action.confirm) setConfirmation({ action, nodes })
    else void runBatch(action, nodes)
  }
  function eventNode(target: EventTarget | null) {
    const id = target instanceof Element ? target.closest<HTMLElement>('[data-file-tree-node-id]')?.dataset.fileTreeNodeId : undefined
    return batchNodes.find(node => node.id === id)
  }
  const selectionEnterRef = useRef(selection.enter)
  selectionEnterRef.current = selection.enter
  useEffect(() => {
    if (!selection.selecting) return
    const scroll = props.getVirtualScrollElement?.() ?? treeRef.current
    if (!scroll) return
    let pointer: { x: number; y: number } | undefined
    let frame = 0
    const onMove = (event: globalThis.PointerEvent) => { pointer = { x: event.clientX, y: event.clientY } }
    const tick = () => {
      if (pointer) {
        const rect = scroll.getBoundingClientRect()
        if (pointer.x >= rect.left && pointer.x <= rect.right) {
          const speed = pointer.y < rect.top + 28 ? -8 : pointer.y > rect.bottom - 28 ? 8 : 0
          if (speed) {
            scroll.scrollTop += speed
            const target = document.elementFromPoint(pointer.x, Math.max(rect.top + 2, Math.min(rect.bottom - 2, pointer.y)))
            const id = target?.closest<HTMLElement>('[data-file-tree-node-id]')?.dataset.fileTreeNodeId
            if (id && treeRef.current?.contains(target) && batchNodes.some(node => node.id === id)) selectionEnterRef.current(id)
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', onMove)
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', onMove) }
  }, [selection.selecting, props.getVirtualScrollElement])
  const rovingId = visibleNodes.some(item => item.node.id === focusedId)
    ? focusedId
    : visibleNodes.some(item => item.node.id === props.selectedId)
      ? props.selectedId
      : visibleNodes[0]?.node.id
  const virtualizer = useVirtualizer({
    count: props.virtualized ? visibleNodes.length : 0,
    enabled: Boolean(props.virtualized && props.active !== false),
    estimateSize: () => 34,
    getItemKey: index => visibleNodes[index]?.node.id ?? index,
    getScrollElement: () => props.getVirtualScrollElement?.() ?? treeRef.current,
    overscan: 8,
    observeElementOffset: observeFileTreeOffset,
    measureElement: measureFileTreeElement,
  })

  useEffect(() => {
    if (focusedId && !visibleNodes.some(item => item.node.id === focusedId)) setFocusedId(rovingId)
  }, [focusedId, rovingId, visibleNodes])

  useLayoutEffect(() => {
    const previousIds = previousVisibleIdsRef.current
    const currentIds = new Set(visibleNodes.map(item => item.node.id))
    if (effectiveMotion === 'reduce') {
      for (const animation of virtualAnimationsRef.current.values()) animation.cancel()
      virtualAnimationsRef.current.clear()
    }
    if (props.virtualized && effectiveMotion === 'full') {
      for (const [id, row] of virtualRowRefs.current) {
        const motionLayer = row.firstElementChild as HTMLElement | null
        if (!motionLayer) continue
        virtualAnimationsRef.current.get(id)?.cancel()
        const firstTop = virtualFirstPositionsRef.current.get(id)
        const deltaY = firstTop === undefined ? 0 : firstTop - row.getBoundingClientRect().top
        const entering = virtualOpeningRef.current && !previousIds.has(id)
        if (deltaY === 0 && !entering) continue
        const animation = motionLayer.animate([
          { opacity: entering ? 0 : 1, transform: deltaY === 0 ? 'translateY(4px)' : `translateY(${deltaY}px)` },
          { opacity: 1, transform: 'translateY(0)' },
        ], {
          duration: entering ? 140 : 180,
          easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
        })
        virtualAnimationsRef.current.set(id, animation)
        animation.finished.finally(() => {
          if (virtualAnimationsRef.current.get(id) === animation) virtualAnimationsRef.current.delete(id)
        }).catch(() => {})
      }
    }
    previousVisibleIdsRef.current = currentIds
    virtualFirstPositionsRef.current.clear()
    virtualOpeningRef.current = false
  }, [effectiveMotion, props.virtualized, visibleNodes])

  useEffect(() => () => {
    for (const animation of virtualAnimationsRef.current.values()) animation.cancel()
    stopDragScrollRef.current?.()
  }, [])

  function toggleExpand(id: string) {
    if (props.virtualized && effectiveMotion === 'full') {
      virtualFirstPositionsRef.current = new Map(
        [...virtualRowRefs.current].map(([rowId, row]) => [rowId, row.getBoundingClientRect().top]),
      )
      virtualOpeningRef.current = !expandedIds.has(id)
    }
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

  useEffect(() => {
    if (!props.revealId) {
      revealedIdRef.current = undefined
      return
    }
    if (revealedIdRef.current === props.revealId || !visibleNodes.some(item => item.node.id === props.revealId)) return
    revealedIdRef.current = props.revealId
    focusNode(props.revealId)
  }, [props.revealId, visibleNodes])

  function selectNode(node: FileTreeNode) {
    if (node.kind !== 'folder' || node.isSection) props.onSelect(node)
    if (node.kind === 'folder' && node.children && !node.isSection) toggleExpand(node.id)
  }

  function handleTreeItemKeyDown(event: KeyboardEvent<HTMLDivElement>, node: FileTreeNode) {
    if (props.getBatchActions && !batchLocked && event.key === ' ' && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      event.preventDefault()
      selection.begin(node.id, event.shiftKey, event.ctrlKey || event.metaKey, props.selectedId)
      selection.finishKeyboard()
      return
    }
    if (props.getBatchActions && !batchLocked && event.shiftKey && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const target = readFileTreeKeyboardTarget({ expandedIds, key: event.key, nodeId: node.id, visibleNodes })
      if (target.focusId) { selection.selectRange(target.focusId, event.ctrlKey || event.metaKey, node.id); focusNode(target.focusId) }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectNode(node)
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
    startDragScroll()
  }

  function startDragScroll() {
    stopDragScrollRef.current?.()
    const scroll = props.getVirtualScrollElement?.() ?? treeRef.current
    if (!scroll) return
    let speed = 0
    let frame = 0
    const tick = () => {
      scroll.scrollTop = Math.max(0, scroll.scrollTop - speed)
      frame = speed && scroll.scrollTop > 0 ? requestAnimationFrame(tick) : 0
    }
    const stop = () => {
      speed = 0
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
    const onDragOver = (event: globalThis.DragEvent) => {
      const rect = scroll.getBoundingClientRect()
      speed = readDragTopScrollSpeed(event.clientX, event.clientY, rect)
      if (speed && event.clientY < rect.top) {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      }
      if (!speed || scroll.scrollTop <= 0) {
        stop()
        return
      }
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const onDrop = (event: globalThis.DragEvent) => {
      const rect = scroll.getBoundingClientRect()
      if (event.clientY < rect.top && readDragTopScrollSpeed(event.clientX, event.clientY, rect)) {
        event.preventDefault()
      }
      if (!treeRef.current?.contains(event.target as Node)) clearDragState()
      else stop()
    }
    const onWindowLeave = (event: globalThis.DragEvent) => {
      if (!event.relatedTarget) stop()
    }
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    window.addEventListener('dragleave', onWindowLeave)
    stopDragScrollRef.current = () => {
      stop()
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragleave', onWindowLeave)
    }
  }

  function isNodeContainer(node: FileTreeNode): boolean {
    return node.children !== undefined
      || node.container === true
      || node.kind === 'folder'
      || node.kind === 'module'
      || node.kind === 'message'
      || node.kind === 'slot'
  }

  function dropPosition(sourceId: string, target: FileTreeNode): 'before' | 'inside' | 'after' | undefined {
    if (isNodeContainer(target) && (props.canDrop?.(sourceId, target.id, 'inside') ?? true)) return 'inside'
    const position = readDropPosition(props.nodes, sourceId, target.id)
    return (props.canDrop?.(sourceId, target.id, position) ?? true) ? position : undefined
  }

  function handleDragOver(event: DragEvent<HTMLElement>, node: FileTreeNode) {
    if (!draggedIdRef.current || draggedIdRef.current === node.id) return
    if (!dropPosition(draggedIdRef.current, node)) {
      event.dataTransfer.dropEffect = 'none'
      dragOverElementRef.current?.classList.remove(styles.dragOver)
      dragOverElementRef.current = undefined
      return
    }
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

    const position = dropPosition(sourceId, targetNode)
    if (position) props.onMoveNode(sourceId, targetNode.id, position)
  }

  function handleDragEnd() {
    clearDragState()
  }

  function clearDragState() {
    stopDragScrollRef.current?.()
    stopDragScrollRef.current = undefined
    draggedElementRef.current?.classList.remove(styles.dragging)
    dragOverElementRef.current?.classList.remove(styles.dragOver)
    draggedIdRef.current = undefined
    draggedElementRef.current = undefined
    dragOverElementRef.current = undefined
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    lastContextMenuTimeRef.current = Date.now()
    const id = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-file-tree-node-id]')?.dataset.fileTreeNodeId
      : undefined
    const node = visibleNodes.find(item => item.node.id === id)?.node
    const singleActions = node ? props.getActions?.(node) ?? [] : []
    const batch = node && props.getBatchActions && batchNodes.some(item => item.id === node.id)
      ? (selection.selected.has(node.id) ? selectedNodes : singleActions.length ? [] : [node]) : []
    if (batch.length && node && !selection.selected.has(node.id)) selection.setSelected(new Set([node.id]))
    const actions: MenuAction[] = batch.length ? (props.getBatchActions?.(batch) ?? []).map(action => ({
      id: action.id, label: action.label, icon: action.icon, tone: action.tone,
      disabled: action.disabled || batchLocked, onSelect: () => requestBatch(action, batch),
    })) : singleActions
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
        highlightMessages={props.highlightMessages}
        editingId={props.editingId}
        expandedIds={expandedIds}
        hasDragGutter={Boolean(props.onMoveNode)}
        canDrag={Boolean(props.onMoveNode) && (props.canDrag?.(node) ?? true)}
        canDragNode={props.canDrag}
        renderLabel={props.renderLabel}
        formatLabel={props.formatLabel}
        formatMeta={props.formatMeta}
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
        onSelect={selectNode}
        onToggleExpand={toggleExpand}
        renderChildren={renderChildren}
        renderIcon={props.renderIcon}
        renderLabelSuffix={props.renderLabelSuffix}
        renderMetaLeading={props.renderMetaLeading}
        renderTrailing={node => node.kind === 'folder' && !node.isSection && props.canOpenFolderDetails?.(node) ? <>
            <button type="button" className={styles.folderDetails} title={t('fileTree.folderDetails')}
              aria-label={`${t('fileTree.folderDetails')}: ${node.label}`}
              onClick={event => { event.stopPropagation(); props.onSelect(node) }}><Info size={16} aria-hidden="true" /></button>
          {props.renderTrailing?.(node)}
        </> : props.renderTrailing?.(node)}
        renderExpandedRow={props.renderExpandedRow}
        rovingId={rovingId}
        selectedId={props.selectedId}
        batchSelectedIds={props.getBatchActions ? selection.selected : undefined}
        isContextMenuActive={isContextMenuActive}
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

  const isContextMenuActive = useCallback(() => {
    return contextOpen || Date.now() - lastContextMenuTimeRef.current < 400
  }, [contextOpen])

  const hoverIndicatorElement = (
    <div
      className={styles.hoverIndicator}
      style={slidingHover.indicatorStyle}
      aria-hidden="true"
    />
  )

  return (
    <>
    <ContextMenu onOpenChange={open => {
      setContextOpen(open)
      lastContextMenuTimeRef.current = Date.now()
      if (!open) setContextActions([])
    }}>
      <ContextMenuTrigger asChild disabled={!props.getActions && !props.getBatchActions}>
        <div
          ref={setTreeContainerRef}
          className={[
            styles.tree,
            props.variant === 'flat' ? styles.flatTree : '',
            props.virtualized ? styles.virtualTree : '',
          ].filter(Boolean).join(' ')}
          role="tree"
          aria-label={props.ariaLabel}
          data-loom-component="file-tree"
          aria-busy={batchBusy || undefined}
          data-selecting={selection.selecting ? true : undefined}
          aria-multiselectable={props.getBatchActions ? true : undefined}
          onPointerDownCapture={event => {
            if (batchLocked && eventNode(event.target)) { event.preventDefault(); event.stopPropagation(); return }
            if (!props.getBatchActions || batchLocked || event.button !== 0 || !(event.ctrlKey || event.metaKey || event.shiftKey)) return
            if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a')) return
            const node = eventNode(event.target)
            if (!node) return
            event.preventDefault()
            treeItemRefs.current.get(node.id)?.focus()
            selection.begin(node.id, event.shiftKey, event.ctrlKey || event.metaKey, props.selectedId)
          }}
          onPointerMove={event => {
            if (!selection.selecting || batchLocked) return
            const node = eventNode(event.target)
            if (node) selection.enter(node.id)
          }}
          onClickCapture={event => {
            if (isContextMenuActive()) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
            if (batchLocked && eventNode(event.target)) { event.preventDefault(); event.stopPropagation(); return }
            if (selection.consumeClick()) { event.preventDefault(); event.stopPropagation(); return }
            if (props.getBatchActions && event.target instanceof Element && !event.target.closest('button, input, textarea, select, a')) selection.clear()
          }}
          onKeyDownCapture={event => {
            if (batchLocked && eventNode(event.target)) { event.preventDefault(); event.stopPropagation(); return }
            if (!props.getBatchActions || batchLocked || (event.target instanceof Element && event.target.closest('input, textarea, select'))) return
            if (event.key === 'Escape' && selection.selected.size) { event.preventDefault(); event.stopPropagation(); selection.clear() }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); selection.setSelected(new Set(batchNodes.map(node => node.id))) }
          }}
          onContextMenu={handleContextMenu}
          onPointerOver={slidingHover.onPointerOver}
          onPointerLeave={slidingHover.onPointerLeave}
        >
          {props.getBatchActions && selectedNodes.length > 0 && !selection.selecting && !contextOpen ? <div className={styles.batchAnchor}>
            <div className={styles.batchBar} role="toolbar" aria-label={t('common.batchSelected', { count: selectedNodes.length })}>
              <span>{t('common.batchSelected', { count: selectedNodes.length })}</span>
              {batchActions.map(action => <Button key={action.id} size="small" variant={action.tone === 'danger' ? 'danger' : 'secondary'} disabled={batchLocked || action.disabled}
                onClick={() => requestBatch(action, selectedNodes)}>{action.icon}{action.label}</Button>)}
              <Button size="small" disabled={batchLocked} aria-label={t('common.clearSelection')} onClick={selection.clear}><X size={14} aria-hidden="true" /></Button>
            </div>
          </div> : null}
          {batchError ? <p className={styles.batchError} role="alert">{batchError}</p> : null}
          {hoverIndicatorElement}
          {props.virtualized ? (
            <div
              ref={virtualContentRef}
              className={styles.virtualContent}
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map(item => {
                const visible = visibleNodes[item.index]
                if (!visible) return null
                return (
                  <div
                    className={styles.virtualRow}
                    data-index={item.index}
                    key={item.key}
                    ref={element => {
                      virtualizer.measureElement(element)
                      if (element) virtualRowRefs.current.set(visible.node.id, element)
                      else virtualRowRefs.current.delete(visible.node.id)
                    }}
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <div className={styles.virtualRowMotion}>
                      {renderRow(visible.node, visible.level, false)}
                    </div>
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
    {confirmation ? <Dialog open title={confirmation.action.label} onClose={() => { if (!batchBusy) setConfirmation(undefined) }} dismissible={!batchBusy}
      actions={<><Button disabled={batchBusy} onClick={() => setConfirmation(undefined)}>{t('promptResource.cancel')}</Button><Button variant="danger" disabled={batchBusy} onClick={() => void runBatch(confirmation.action, confirmation.nodes)}>{confirmation.action.label}</Button></>}>
      <p>{t('common.batchConfirm', { count: confirmation.nodes.length })}</p>
      {batchError ? <p role="alert">{batchError}</p> : null}
    </Dialog> : null}
    </>
  )
}

function FileTreeRow(props: {
  highlightMessages?: boolean
  editingId?: string
  expandedIds: Set<string>
  canDrag: boolean
  hasDragGutter: boolean
  canDragNode?: (node: FileTreeNode) => boolean
  renderLabel?: (node: FileTreeNode) => ReactNode
  formatLabel?: (node: FileTreeNode) => string
  formatMeta?: (node: FileTreeNode) => string | undefined
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
  renderLabelSuffix?: (node: FileTreeNode) => ReactNode
  renderMetaLeading?: (node: FileTreeNode) => ReactNode
  renderTrailing?: (node: FileTreeNode) => ReactNode
  renderExpandedRow?: (node: FileTreeNode) => ReactNode
  rovingId?: string
  selectedId?: string
  batchSelectedIds?: Set<string>
  isContextMenuActive?: () => boolean
  setTreeItemRef: (id: string, element: HTMLDivElement | null) => void
  variant?: 'tree' | 'flat' | 'indented'
  onFocusNode: (id: string) => void
  onTreeItemKeyDown: (event: KeyboardEvent<HTMLDivElement>, node: FileTreeNode) => void
}) {
  const hasChildren = Boolean(props.node.children)
  const expanded = props.node.isSection || (hasChildren && props.expandedIds.has(props.node.id))
  const selected = props.batchSelectedIds?.size ? props.batchSelectedIds.has(props.node.id) : props.node.id === props.selectedId
  const [actionsOpen, setActionsOpen] = useState(false)
  const actions = actionsOpen ? props.getActions?.(props.node) ?? [] : []
  const metaLeading = props.renderMetaLeading?.(props.node)
  const labelSuffixElement = props.renderLabelSuffix?.(props.node)
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
  const meta = props.formatMeta ? props.formatMeta(props.node) : props.node.meta
  const showMeta = Boolean(meta || metaLeading)

  let rowClass = styles.row
  if (selected) rowClass += ` ${styles.selected}`
  if (props.highlightMessages && props.node.kind === 'message') rowClass += ` ${styles.messageHighlight}`
  if (props.isMuted?.(props.node)) rowClass += ` ${styles.muted}`
  if (!props.hasDragGutter) rowClass += ` ${styles.noDrag}`

  const iconElement = props.renderIcon?.(props.node, expanded)

  const rowElement = (
    <div
          ref={element => {
            props.setTreeItemRef(props.node.id, element)
          }}
          className={rowClass}
          data-file-tree-node-id={props.node.id}
          data-message-role={props.highlightMessages && props.node.kind === 'message' ? String(props.node.capabilities?.roleHint ?? '') : undefined}
          style={{ '--loom-tree-level': props.level } as CSSProperties}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-haspopup={props.hasActions ? 'menu' : undefined}
          aria-level={props.level}
          aria-labelledby={labelId}
          aria-selected={selected}
          role="treeitem"
          tabIndex={props.node.id === props.rovingId ? 0 : -1}
          onClick={event => {
            if (event.button !== 0 || event.ctrlKey) return
            if (props.isContextMenuActive?.()) return
            props.onSelect(props.node)
          }}
          onFocus={() => props.onFocusNode(props.node.id)}
          onDragOver={event => props.onDragOver(event, props.node)}
          onDrop={event => props.onDrop(event, props.node)}
          onKeyDown={event => {
            if (!event.defaultPrevented && event.target === event.currentTarget) props.onTreeItemKeyDown(event, props.node)
          }}
        >
          {props.variant !== 'flat' && props.variant !== 'indented' && props.level > 1 ? (
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
          ) : props.hasDragGutter ? <span className={styles.dragSpacer} aria-hidden="true" /> : null}

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
          {props.variant !== 'flat' && props.variant !== 'indented' && expanded && hasChildren ? <span className={styles.branchContinuation} aria-hidden="true" /> : null}

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
                    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
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
                <span className={styles.labelRow}>
                  <span className={styles.label} id={labelId}>
                    {props.renderLabel ? props.renderLabel(props.node) : props.formatLabel ? props.formatLabel(props.node) : props.node.label}
                    {hasCount ? <sup className={styles.childCountSup}>{childCount}</sup> : null}
                  </span>
                  {labelSuffixElement}
                </span>
              )}
              {showMeta ? (
                <span className={styles.metaRow}>
                  {metaLeading ? <span className={styles.metaLeading}>{metaLeading}</span> : null}
                  {meta ? <span className={styles.meta}>{meta}</span> : null}
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

  const childrenElements = props.renderChildren && props.node.children?.length ? props.node.children.map(child => (
      <FileTreeRow
        highlightMessages={props.highlightMessages}
        editingId={props.editingId}
      expandedIds={props.expandedIds}
      hasDragGutter={props.hasDragGutter}
      canDrag={props.hasDragGutter && (props.canDragNode?.(child) ?? props.canDrag)}
      canDragNode={props.canDragNode}
      renderLabel={props.renderLabel}
        formatLabel={props.formatLabel}
      formatMeta={props.formatMeta}
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
      batchSelectedIds={props.batchSelectedIds}
      isContextMenuActive={props.isContextMenuActive}
      setTreeItemRef={props.setTreeItemRef}
      variant={props.variant}
      onFocusNode={props.onFocusNode}
      onTreeItemKeyDown={props.onTreeItemKeyDown}
    />
  )) : null

  return (
    <>
      {props.node.isSection ? (
        <div
          className={styles.sectionRow}
          data-file-tree-section-id={props.node.id}
          role="presentation"
          onDragOver={event => props.onDragOver(event, props.node)}
          onDrop={event => props.onDrop(event, props.node)}
        >
          <span className={styles.sectionLabel}>{props.renderLabel ? props.renderLabel(props.node) : props.formatLabel ? props.formatLabel(props.node) : props.node.label}</span>
        </div>
      ) : (
        <>
          {rowElement}
          {expandedRowElement ? (
            <div
              className={`${styles.expandedRow} ${!props.hasDragGutter ? styles.noDrag : ''}`}
              style={{ '--loom-tree-level': props.level } as CSSProperties}
            >
              {props.variant !== 'flat' && props.variant !== 'indented' && props.level > 1 ? (
                <span className={styles.guideColumns} aria-hidden="true">
                  {Array.from({ length: props.level - 1 }, (_, index) => (
                    <span
                      className={styles.guideColumn}
                      key={index}
                    />
                  ))}
                </span>
              ) : null}
              <div className={styles.expandedRowContent}>
                {expandedRowElement}
              </div>
            </div>
          ) : null}
        </>
      )}
      {childrenElements ? (
        <div className={styles.treeChildren} data-expanded={expanded} inert={!expanded}>
          <div>{childrenElements}</div>
        </div>
      ) : null}
    </>
  )
}

function renderMenuContent(actions: MenuAction[], Item: ElementType, CheckboxItem: ElementType, Separator: ElementType) {
  return actions.map((action, index) => {
    if (action.type === 'separator') return (
      <Fragment key={action.id}>
        {index > 0 ? <Separator /> : null}
        {action.label ? <div className="loom-ui-menu-group-label">{action.label}</div> : null}
      </Fragment>
    )
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
