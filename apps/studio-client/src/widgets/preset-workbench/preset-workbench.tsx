import { Code2, Copy, FileText, Folder, GripVertical, Package, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FileTree } from '../../shared/ui/file-tree/file-tree.js'
import type { Translator } from '../../shared/i18n/index.js'
import {
  findContextNode,
} from '../../features/context-assets/model/projection-order.js'
import { transformForProjectionView } from '../../features/context-assets/model/projection-view.js'
import {
  buildProjectionWorkbenchModel,
  findRootContextModule,
  readPresetProjectionMoveUpdates,
  readProjectionOrderReorderUpdates,
} from '../../features/context-assets/model/projection-workbench.js'
import { ContextAssetDetail } from '../../features/context-assets/ui/context-asset-detail/context-asset-detail.js'
import { ProjectionOrderEditor } from '../../features/context-assets/ui/projection-order-editor/projection-order-editor.js'
import type { AgentRuntimeProfile, ContextAssetNode, ModelProfile } from '../../entities/index.js'
import { AgentRuntimeManager } from './agent-runtime-manager.js'
import styles from './preset-workbench.module.css'

type PresetWorkbenchProps = {
  nodes: ContextAssetNode[]
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onAddNode: (parentId: string) => void
  onDuplicateNode: (id: string) => void
  onDeleteNode: (id: string) => void
  onSelectNode: (id: string) => void
  selectedId?: string
  t: Translator
  agentRuntimeProfiles: AgentRuntimeProfile[]
  modelProfiles: ModelProfile[]
  selectedAgentRuntimeProfileId?: string
  onSelectAgentRuntimeProfile: (id: string) => void
  onCreateAgentRuntimeProfile: (input: { name: string; purpose: string; presetId?: string; modelProfileId?: string }) => void
  onUpdateAgentRuntimeProfile: (id: string, updates: { name?: string; purpose?: string; modelProfileId?: string }) => void
  onDeleteAgentRuntimeProfile: (id: string) => void
}

export function PresetWorkbench(props: PresetWorkbenchProps) {
  const [activePresetPanel, setActivePresetPanel] = useState<'assets' | 'order'>('assets')
  const selectedNode = findContextNode(props.nodes, props.selectedId)
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(props.nodes), [props.nodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel
  const detailNode = activePresetPanel === 'order' ? orderNode : selectedNode

  const displayNodes = useMemo(() => {
    return props.nodes
      .filter(node => node.category === 'preset')
      .map(node => {
        if (node.kind === 'module') {
          return transformForProjectionView(node, orderedProjectionEntries)
        }
        return node
      })
  }, [props.nodes, orderedProjectionEntries])

  function handleProjectionReorder(draggedId: string, targetId: string) {
    readProjectionOrderReorderUpdates({
      draggedId,
      orderedProjectionEntries,
      orderNode,
      projectionEntries,
      projectionOrderIds,
      targetId,
    }).forEach(update => props.onChangeNode(update.id, update.partial))
  }

  return (
    <section className={styles.shell} data-loom-component="context-workbench">
      <aside className={styles.assetPane} data-loom-component="context-asset-explorer">
        <header className={styles.paneHeader}>
          <div className={styles.paneHeaderTop}>
            <p>{props.t('context.assetsLabel')}</p>
            <h2>{props.t('rail.preset')}</h2>
          </div>
          <nav className={styles.categoryTabs}>
            <button
              className={`${styles.categoryTab} ${activePresetPanel === 'assets' ? styles.categoryTabActive : ''}`}
              onClick={() => setActivePresetPanel('assets')}
            >
              {props.t('preset.panel.assets')}
            </button>
            <button
              className={`${styles.categoryTab} ${activePresetPanel === 'order' ? styles.categoryTabActive : ''}`}
              onClick={() => setActivePresetPanel('order')}
            >
              {props.t('preset.panel.mainOrder')}
            </button>
          </nav>
        </header>
        <FileTree
          ariaLabel={props.t('context.assetsLabel')}
          nodes={displayNodes}
          onMoveNode={(draggedId, targetId, position) => {
             const rootModule = findRootContextModule(props.nodes, draggedId)
             const isProjectionView = rootModule?.category === 'preset'

             if (isProjectionView) {
               readPresetProjectionMoveUpdates({
                 draggedId,
                 nodes: props.nodes,
                 orderedProjectionEntries,
                 orderNode,
                 position,
                 projectionEntries,
                 projectionOrderIds,
                 targetId,
               }).forEach(update => props.onChangeNode(update.id, update.partial))
               return
             }

             props.onMoveNode(draggedId, targetId, position)
          }}
          onSelect={node => {
            setActivePresetPanel('assets')
            props.onSelectNode(node.id)
          }}
          renderActions={node => renderTreeActions(
            node as ContextAssetNode,
            props.onAddNode,
            props.onDuplicateNode,
            props.onDeleteNode,
            props.t
          )}
          renderIcon={(node, expanded) => renderTreeIcon(node as ContextAssetNode, expanded)}
          selectedId={props.selectedId}
        />
      </aside>

      <section className={styles.detailPane} data-loom-component="context-detail-editor">
        <AgentRuntimeManager
          profiles={props.agentRuntimeProfiles}
          models={props.modelProfiles}
          selectedId={props.selectedAgentRuntimeProfileId}
          onSelect={props.onSelectAgentRuntimeProfile}
          onCreate={props.onCreateAgentRuntimeProfile}
          onUpdate={props.onUpdateAgentRuntimeProfile}
          onDelete={props.onDeleteAgentRuntimeProfile}
          t={props.t}
        />
        <div className={styles.detailColumn}>
          <header className={styles.detailHeader}>
            <p>{readKindLabel(detailNode, props.t)}</p>
            <h1>{detailNode?.label ?? props.t('context.emptyTitle')}</h1>
            <span>{detailNode?.meta ?? props.t('context.emptyBody')}</span>
          </header>

          {detailNode ? (
            detailNode.kind === 'order' ? (
              <ProjectionOrderEditor
                entries={orderedProjectionEntries}
                onReorder={handleProjectionReorder}
                selectedId={props.selectedId}
                t={props.t}
              />
            ) : (
              <ContextAssetDetail
                activationEditable
                node={detailNode}
                onChangeNode={partial => props.onChangeNode(detailNode.id, partial)}
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
  onAddNode: (parentId: string) => void,
  onDuplicateNode: (id: string) => void,
  onDeleteNode: (id: string) => void,
  t: Translator,
) {
  const canAdd = (node.kind === 'module' || node.kind === 'folder') && !isReadOnlyTreeNode(node)
  const canDuplicate = node.kind !== 'module' && node.kind !== 'order' && !isReadOnlyTreeNode(node)
  const canDelete = canDuplicate

  return (
    <>
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
