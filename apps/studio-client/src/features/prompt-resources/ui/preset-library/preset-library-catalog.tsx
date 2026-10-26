import { useState, type ReactNode } from 'react'
import { Button, SearchField } from '@loom-studio/ui'
import { ChevronRight, MessageSquare, Package, SlidersHorizontal, User } from 'lucide-react'
import { MasterDetailWorkbench } from '../../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import styles from './preset-library-catalog.module.scss'

export type PresetCatalogSource = { id: string; name: string; kind: 'personal' | 'package' | 'official'; description?: string }
export type PresetCatalogItem = { id: string; sourceId: string; name: string; description?: string; modelLabel: string; toolCount: number; resourceCount: number; draft?: boolean }
export function PresetLibraryCatalog(props: {
  items: PresetCatalogItem[]
  sources: PresetCatalogSource[]
  actions?: ReactNode
  sourceContent?: (sourceId: string) => ReactNode
  onConfigure(id: string): void
  onOpen(id: string): void
}) {
  const [sourceId, setSourceId] = useState('all')
  const [query, setQuery] = useState('')
  const [pane, setPane] = useState<'master' | 'detail'>('detail')
  const source = props.sources.find(item => item.id === sourceId)
  const activeSourceId = source?.id ?? 'all'
  const visible = props.items.filter(item => (activeSourceId === 'all' || item.sourceId === activeSourceId)
    && `${item.name} ${item.description ?? ''} ${props.sources.find(s => s.id === item.sourceId)?.name ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const sourceGroups = [
    { kind: 'personal', label: undefined },
    { kind: 'official', label: '官方' },
    { kind: 'package', label: '扩展' },
  ] as const
  return <MasterDetailWorkbench navigationScope="local" masterWidth="minmax(200px, 0.24fr)" mobilePane={pane} onMobilePaneChange={setPane} backLabel="预设来源" master={
    <nav className={styles.directory} aria-label="预设来源">
      <button type="button" className={styles.directoryHeader} aria-current={activeSourceId === 'all' ? 'page' : undefined}
        onClick={() => { setSourceId('all'); setPane('detail') }}><strong>预设库</strong><span>{props.items.length}</span></button>
      <div className={styles.directoryBody}>
        {sourceGroups.map(group => {
          const sources = props.sources.filter(item => item.kind === group.kind)
          if (!sources.length) return null
          return <section key={group.kind} className={styles.sourceGroup} aria-label={group.label}>
            {group.label && <h3 className={styles.sourceGroupLabel}>{group.label}</h3>}
            {sources.map(item => <button type="button" key={item.id} className={styles.source} aria-current={activeSourceId === item.id ? 'page' : undefined} onClick={() => { setSourceId(item.id); setPane('detail') }}>{item.kind === 'personal' ? <User size={16} /> : <Package size={16} />}<span>{item.name}</span><small>{props.items.filter(p => p.sourceId === item.id).length}</small></button>)}
          </section>
        })}
      </div>
    </nav>
  }>
    <section className={styles.catalog}>
      <header className={styles.header}><strong>{source?.name ?? '预设库'}</strong><div className={styles.actions}>{props.actions}</div></header>
      <div className={styles.search}><SearchField aria-label="搜索预设或来源" placeholder="搜索预设或来源" clearLabel="清除搜索" value={query} onClear={() => setQuery('')} onChange={event => setQuery(event.target.value)} /></div>
      <div className={styles.content}>
        {source?.description && <p className={styles.sourceDescription}>{source.description}</p>}
        {props.sources.filter(s => activeSourceId === 'all' || s.id === activeSourceId).map(s => {
          const items = visible.filter(item => item.sourceId === s.id)
          if (!items.length) return null
          return <section className={styles.group} key={s.id}>
            {activeSourceId === 'all' && <h3>{s.name}<span>{items.length}</span></h3>}
            {items.map(item => <div className={styles.row} key={item.id}>
              <button data-preset-id={item.id} className={styles.item} aria-label={`打开${item.name}的编排目录`} onClick={() => props.onOpen(item.id)}><MessageSquare size={17} className={styles.presetIcon} /><span className={styles.itemText}><strong>{item.name}{item.draft && <small>未保存修改</small>}</strong>{item.description && <span>{item.description}</span>}<small>{item.modelLabel} · {item.toolCount} 项工具 · {item.resourceCount} 项资源</small></span></button>
              <div className={styles.rowActions}><Button size="small" variant="ghost" aria-label={`配置${item.name}`} onClick={() => props.onConfigure(item.id)}><SlidersHorizontal size={14} /><span>配置</span></Button><Button size="small" variant="ghost" aria-label={`编排${item.name}`} onClick={() => props.onOpen(item.id)}><span>编排</span><ChevronRight size={14} /></Button></div>
            </div>)}
          </section>
        })}
        {!visible.length && <p className={styles.empty}>{query ? '没有匹配的预设。' : '暂无预设，可以新建或导入。'}</p>}
        {source && props.sourceContent?.(source.id)}
      </div>
    </section>
  </MasterDetailWorkbench>
}
