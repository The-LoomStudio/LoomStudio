import { AlignLeft, Code2, Copy, FileText, Folder, GripVertical, Package, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FileTree } from '../../shared/ui/file-tree/FileTree.js'
import {
  findContextNode,
} from '../../features/context-assets/model/projection-order.js'
import { transformForProjectionView } from '../../features/context-assets/model/projection-view.js'
import {
  buildProjectionWorkbenchModel,
  findRootContextModule,
  readContextProjectionMoveUpdate,
  readProjectionOrderReorderUpdates,
} from '../../features/context-assets/model/projection-workbench.js'
import { ContextAssetDetail } from '../../features/context-assets/ui/context-asset-detail/ContextAssetDetail.js'
import { ProjectionOrderEditor } from '../../features/context-assets/ui/projection-order-editor/ProjectionOrderEditor.js'
import type { ContextAssetNode } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './ContextWorkbench.module.css'

type ContextWorkbenchProps = {
  nodes: ContextAssetNode[]
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onAddNode: (parentId: string) => void
  onDuplicateNode: (id: string) => void
  onDeleteNode: (id: string) => void
  onSelectNode: (id: string) => void
  selectedId?: string
  t: Translator
}

export function ContextWorkbench(props: ContextWorkbenchProps) {
  const [activeCategory, setActiveCategory] = useState<'preset' | 'setting' | 'logic' | 'runtime' | 'history'>('setting')
  const [viewModes, setViewModes] = useState<Record<string, 'asset' | 'projection'>>({})
  const selectedNode = findContextNode(props.nodes, props.selectedId)
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(props.nodes), [props.nodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel

  const displayNodes = useMemo(() => {
    return props.nodes
      .filter(node => node.category === activeCategory)
      .map(node => {
        const isProjection = viewModes[node.id] === 'projection'
        if (node.kind === 'module' && isProjection) {
          return transformForProjectionView(node, orderedProjectionEntries, { groupSettingLayerSlots: true })
        }
        return node
      })
  }, [props.nodes, viewModes, activeCategory, orderedProjectionEntries])

  const TABS: Array<{ value: 'setting' | 'logic' | 'runtime' | 'history', label: string }> = [
    { value: 'setting', label: 'Setting' },
    { value: 'logic', label: 'Logic' },
    { value: 'runtime', label: 'Runtime' },
    { value: 'history', label: 'History' },
  ]

  return (
    <section className={styles.shell} data-airp-component="context-workbench">
      <aside className={styles.assetPane} data-airp-component="context-asset-explorer">
        <header className={styles.paneHeader}>
          <div className={styles.paneHeaderTop}>
            <p>{props.t('context.assetsLabel')}</p>
            <h2>{props.t('context.title')}</h2>
          </div>
          <nav className={styles.categoryTabs}>
            {TABS.map(tab => (
              <button
                key={tab.value}
                className={`${styles.categoryTab} ${activeCategory === tab.value ? styles.categoryTabActive : ''}`}
                onClick={() => setActiveCategory(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </header>
        <FileTree
          ariaLabel={props.t('context.assetsLabel')}
          nodes={displayNodes}
          onMoveNode={(draggedId, targetId, position) => {
             const rootModule = findRootContextModule(props.nodes, draggedId)
             const isProjectionView = rootModule && viewModes[rootModule.id] === 'projection'

             if (isProjectionView) {
               const update = readContextProjectionMoveUpdate(props.nodes, projectionEntries, draggedId, targetId, position)
               if (update) props.onChangeNode(update.id, update.partial)
               return
             }

             props.onMoveNode(draggedId, targetId, position)
          }}
          onSelect={node => props.onSelectNode(node.id)}
          renderActions={node => renderTreeActions(
            node as ContextAssetNode,
            viewModes[node.id],
            () => setViewModes(current => ({ ...current, [node.id]: current[node.id] === 'projection' ? 'asset' : 'projection' })),
            props.onAddNode,
            props.onDuplicateNode,
            props.onDeleteNode,
            props.t
          )}
          renderIcon={(node, expanded) => renderTreeIcon(node as ContextAssetNode, expanded)}
          selectedId={props.selectedId}
        />
      </aside>

      <section className={styles.detailPane} data-airp-component="context-detail-editor">
        <div className={styles.detailColumn}>
          <header className={styles.detailHeader}>
            <p>{readKindLabel(selectedNode, props.t)}</p>
            <h1>{selectedNode?.label ?? props.t('context.emptyTitle')}</h1>
            <span>{selectedNode?.meta ?? props.t('context.emptyBody')}</span>
          </header>

          {selectedNode ? (
            selectedNode.kind === 'order' ? (
              <ProjectionOrderEditor
                entries={orderedProjectionEntries}
                onReorder={(draggedId, targetId) => {
                  readProjectionOrderReorderUpdates({
                    draggedId,
                    orderedProjectionEntries,
                    orderNode,
                    projectionEntries,
                    projectionOrderIds,
                    targetId,
                  }).forEach(update => props.onChangeNode(update.id, update.partial))
                }}
                selectedId={props.selectedId}
                t={props.t}
              />
            ) : (
              <ContextAssetDetail
                node={selectedNode}
                onChangeNode={partial => props.onChangeNode(selectedNode.id, partial)}
                t={props.t}
              />
            )
          ) : (
            <div className={styles.emptyState}>{props.t('context.emptyBody')}</div>
          )}
        </div>
      </section>
    </section>
  )
}

function renderTreeIcon(node: ContextAssetNode, expanded: boolean) {
  if (node.kind === 'module') return <Package absoluteStrokeWidth size={15} strokeWidth={1.5} />
  if (node.kind === 'folder') return <Folder absoluteStrokeWidth size={15} strokeWidth={1.5} fill={expanded ? 'currentColor' : 'none'} />
  if (node.kind === 'script') return <Code2 absoluteStrokeWidth size={15} strokeWidth={1.5} />
  if (node.kind === 'virtual') return <FileText absoluteStrokeWidth size={15} strokeWidth={1.5} />
  if (node.kind === 'order') return <GripVertical absoluteStrokeWidth size={15} strokeWidth={1.5} />
  return <FileText absoluteStrokeWidth size={15} strokeWidth={1.5} />
}

function renderTreeActions(
  node: ContextAssetNode,
  viewMode: 'asset' | 'projection' | undefined,
  onToggleViewMode: () => void,
  onAddNode: (parentId: string) => void,
  onDuplicateNode: (id: string) => void,
  onDeleteNode: (id: string) => void,
  t: Translator,
) {
  const canAdd = (node.kind === 'module' || node.kind === 'folder') && !isReadOnlyTreeNode(node)
  const canDuplicate = node.kind !== 'module' && node.kind !== 'order' && !isReadOnlyTreeNode(node)
  const canDelete = canDuplicate
  const isSettingLayer = node.category === 'setting' && node.kind === 'module'

  return (
    <>
      {isSettingLayer ? (
        <span
          title={viewMode === 'projection' ? 'Switch to Asset View' : 'Switch to Projection View'}
          onClick={(e) => { e.stopPropagation(); onToggleViewMode(); }}
        >
          {viewMode === 'projection' ? <Folder aria-hidden="true" size={13} strokeWidth={1.5} /> : <AlignLeft aria-hidden="true" size={13} strokeWidth={1.5} />}
        </span>
      ) : null}
      {canAdd ? (
        <span title={t('context.actionAdd')} onClick={() => onAddNode(node.id)}>
          <Plus aria-hidden="true" size={13} strokeWidth={1.5} />
        </span>
      ) : null}
      {canDuplicate ? (
        <span title={t('context.actionDuplicate')} onClick={() => onDuplicateNode(node.id)}>
          <Copy aria-hidden="true" size={13} strokeWidth={1.5} />
        </span>
      ) : null}
      {canDelete ? (
        <span title={t('context.actionDelete')} onClick={() => onDeleteNode(node.id)}>
          <Trash2 aria-hidden="true" size={13} strokeWidth={1.5} />
        </span>
      ) : null}
    </>
  )
}

function isReadOnlyTreeNode(node: ContextAssetNode): boolean {
  return node.category === 'runtime'
    || node.category === 'history'
    || node.projection?.sourceKind === 'virtual'
    || node.id.startsWith('history-')
}

function readKindLabel(node: ContextAssetNode | undefined, t: Translator): string {
  if (!node) return t('context.detailLabel')
  if (node.kind === 'module') return t('context.kind.module')
  if (node.kind === 'folder') return t('context.kind.folder')
  if (node.kind === 'script') return t('context.kind.script')
  if (node.kind === 'virtual') return t('context.kind.virtual')
  if (node.kind === 'order') return t('context.kind.order')
  return t('context.kind.entry')
}
