import { Braces, Code2, Component, FileSearch, Folder, FolderOpen, Variable } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { Translator } from '../../../shared/i18n/index.js'
import { SearchField } from '@loom-studio/ui'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { FileTree, type FileTreeNode } from '../../../shared/ui/file-tree/file-tree.js'
import { normalizeSearchText } from '../../../shared/lib/text.js'
import styles from './pipeline-workbench-view.module.scss'

type PipelineWorkbenchItemKind = 'macro' | 'rule' | 'extractor' | 'renderer' | 'script'

type PipelineWorkbenchItem = {
  id: string
  kind: PipelineWorkbenchItemKind
  label: string
  description: string
  owner: string
  effect?: string
  status?: 'active' | 'disabled' | 'conflict' | 'degraded'
  order?: number
}

export type PipelineWorkbenchGroup = {
  id: string
  label: string
  items: PipelineWorkbenchItem[]
}

export type PipelineWorkbenchViewProps = {
  t: Translator
  ariaLabel: string
  groups: PipelineWorkbenchGroup[]
  selectedId?: string
  searchValue: string
  searchPlaceholder: string
  searchClearLabel: string
  emptyLabel: string
  backLabel: string
  mobilePane: 'master' | 'detail'
  detail: ReactNode
  filters?: ReactNode
  preview?: ReactNode
  onSearchChange(value: string): void
  onSelect(id: string): void
  onMobilePaneChange(pane: 'master' | 'detail'): void
}

export function PipelineWorkbenchView(props: PipelineWorkbenchViewProps) {
  const query = normalizeSearchText(props.searchValue)
  const groups = props.groups.map(group => ({
    ...group,
    items: query
      ? group.items.filter(item => `${item.label} ${item.description} ${item.owner}`.toLocaleLowerCase().includes(query))
      : group.items,
  })).filter(group => group.items.length > 0)

  const [expandedIds, setExpandedIds] = useState<string[]>(() => props.groups.map(group => `group:${group.id}`))

  const allItemMap = useMemo(() => {
    const map = new Map<string, PipelineWorkbenchItem>()
    for (const group of props.groups) {
      for (const item of group.items) {
        map.set(item.id, item)
      }
    }
    return map
  }, [props.groups])

  const nodes: FileTreeNode[] = useMemo(() => {
    return groups.map(group => ({
      id: `group:${group.id}`,
      label: group.label,
      kind: 'folder' as const,
      meta: String(group.items.length),
      children: group.items.map(item => ({
        id: item.id,
        label: item.label,
        kind: 'entry' as const,
        meta: item.owner,
      })),
    }))
  }, [groups])

  return (
    <MasterDetailWorkbench
      resizeLabel={props.t('stateVariables.resizeSidebar')}
      backLabel={props.backLabel}
      dataComponent="pipeline-workbench-view"
      defaultMasterWidth={280}
      detailMinWidth={360}
      mobilePane={props.mobilePane}
      onBack={() => props.onMobilePaneChange('master')}
      onMobilePaneChange={props.onMobilePaneChange}
      master={(
        <div className={styles.master}>
          <SearchField
            aria-label={props.searchPlaceholder}
            clearLabel={props.searchClearLabel}
            containerClassName={styles.searchField}
            placeholder={props.searchPlaceholder}
            value={props.searchValue}
            onChange={event => {
              props.onSearchChange(event.target.value)
              if (event.target.value) {
                setExpandedIds(props.groups.map(group => `group:${group.id}`))
              }
            }}
            onClear={() => props.onSearchChange('')}
          />
          {props.filters ? <div className={styles.filters}>{props.filters}</div> : null}
          <div className={styles.treeContainer}>
            {nodes.length === 0 ? (
              <p className={styles.empty}>{props.emptyLabel}</p>
            ) : (
              <FileTree
                ariaLabel={props.ariaLabel}
                nodes={nodes}
                selectedId={props.selectedId}
                expandedIds={expandedIds}
                onExpandedIdsChange={setExpandedIds}
                onSelect={node => {
                  if (node.kind === 'folder') {
                    setExpandedIds(prev => prev.includes(node.id) ? prev.filter(id => id !== node.id) : [...prev, node.id])
                  } else {
                    props.onSelect(node.id)
                    props.onMobilePaneChange('detail')
                  }
                }}
                renderIcon={(node, expanded) => {
                  if (node.kind === 'folder') {
                    return expanded ? <FolderOpen size={16} /> : <Folder size={16} />
                  }
                  const item = allItemMap.get(node.id)
                  return <ItemIcon kind={item?.kind ?? 'rule'} />
                }}
                renderTrailing={node => {
                  const item = allItemMap.get(node.id)
                  if (!item) return null
                  return (
                    <span className={styles.treeTrailing}>
                      {item.order !== undefined ? <span className={styles.order}>{item.order}</span> : null}
                      {item.status ? <span className={styles.status} data-status={item.status}>{props.t(`textTransform.status.${item.status}`)}</span> : null}
                    </span>
                  )
                }}
                getDisclosureLabel={(node, expanded) => `${expanded ? '折叠' : '展开'} ${node.label}`}
                getDragLabel={node => `拖动 ${node.label}`}
                moreActionsLabel="更多操作"
                variant="flat"
              />
            )}
          </div>
        </div>
      )}
    >
      <div className={`${styles.detailLayout} ${props.preview ? '' : styles.detailOnly}`}>
        <div className={styles.detail}>{props.detail}</div>
        {props.preview ? <section className={styles.preview}>{props.preview}</section> : null}
      </div>
    </MasterDetailWorkbench>
  )
}

function ItemIcon(props: { kind: PipelineWorkbenchItemKind }) {
  if (props.kind === 'macro') return <Variable aria-hidden="true" size={15} />
  if (props.kind === 'rule') return <Braces aria-hidden="true" size={15} />
  if (props.kind === 'extractor') return <FileSearch aria-hidden="true" size={15} />
  if (props.kind === 'renderer') return <Component aria-hidden="true" size={15} />
  return <Code2 aria-hidden="true" size={15} />
}
