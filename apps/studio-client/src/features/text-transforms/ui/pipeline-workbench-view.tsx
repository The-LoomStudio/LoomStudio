import { Braces, Code2, Component, FileSearch, Search, Variable } from 'lucide-react'
import type { ReactNode } from 'react'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import styles from './pipeline-workbench-view.module.scss'

export type PipelineWorkbenchItemKind = 'macro' | 'rule' | 'extractor' | 'renderer' | 'script'

export type PipelineWorkbenchItem = {
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
  ariaLabel: string
  groups: PipelineWorkbenchGroup[]
  selectedId?: string
  searchValue: string
  searchPlaceholder: string
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
  const query = props.searchValue.trim().toLocaleLowerCase()
  const groups = props.groups.map(group => ({
    ...group,
    items: query
      ? group.items.filter(item => `${item.label} ${item.description} ${item.owner}`.toLocaleLowerCase().includes(query))
      : group.items,
  })).filter(group => group.items.length > 0)

  return (
    <MasterDetailWorkbench
      backLabel={props.backLabel}
      dataComponent="pipeline-workbench-view"
      defaultMasterWidth={272}
      detailMinWidth={360}
      mobilePane={props.mobilePane}
      onBack={() => props.onMobilePaneChange('master')}
      onMobilePaneChange={props.onMobilePaneChange}
      master={(
        <div className={styles.master}>
          <label className={styles.searchField}>
            <Search aria-hidden="true" size={14} />
            <input
              aria-label={props.searchPlaceholder}
              placeholder={props.searchPlaceholder}
              type="search"
              value={props.searchValue}
              onChange={event => props.onSearchChange(event.target.value)}
            />
          </label>
          {props.filters ? <div className={styles.filters}>{props.filters}</div> : null}
          <nav aria-label={props.ariaLabel} className={styles.groups}>
            {groups.map(group => (
              <section className={styles.group} key={group.id}>
                <header><span>{group.label}</span><small>{group.items.length}</small></header>
                {group.items.map(item => (
                  <button
                    aria-current={item.id === props.selectedId ? 'page' : undefined}
                    className={styles.item}
                    key={item.id}
                    type="button"
                    onClick={() => {
                      props.onSelect(item.id)
                      props.onMobilePaneChange('detail')
                    }}
                  >
                    <ItemIcon kind={item.kind} />
                    <span className={styles.itemText}>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                      <span>{item.owner}</span>
                    </span>
                    {item.order !== undefined ? <span className={styles.order}>{item.order}</span> : null}
                    {item.status ? <span className={styles.status} data-status={item.status}>{item.status}</span> : null}
                  </button>
                ))}
              </section>
            ))}
            {groups.length === 0 ? <p className={styles.empty}>{props.emptyLabel}</p> : null}
          </nav>
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
