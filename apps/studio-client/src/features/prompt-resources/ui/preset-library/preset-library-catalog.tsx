import { ExtensionIcon } from '../../../../shared/ui/extension-icon/extension-icon.js'
import { useId, useState, type ReactNode } from 'react'
import { Button, SearchField } from '@loom-studio/ui'
import { ChevronDown, ChevronRight, MessageSquare, SlidersHorizontal, User } from 'lucide-react'
import styles from './preset-library-catalog.module.scss'

export type PresetCatalogSource = { id: string; name: string; kind: 'personal' | 'package' | 'official'; description?: string; iconUrl?: string }
export type PresetCatalogItem = { id: string; sourceId: string; name: string; description?: string; modelLabel: string; toolCount: number; resourceCount: number; draft?: boolean; iconUrl?: string }
export function PresetLibraryCatalog(props: {
  items: PresetCatalogItem[]
  sources: PresetCatalogSource[]
  actions?: ReactNode
  sourceContent?: (sourceId: string) => ReactNode
  onConfigure(id: string): void
  onOpen(id: string): void
}) {
  const contentId = useId()
  const [query, setQuery] = useState('')
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  const visible = props.items.filter(item =>
    `${item.name} ${item.description ?? ''} ${props.sources.find(source => source.id === item.sourceId)?.name ?? ''}`
      .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const sourceGroups = [
    { kind: 'package', label: '扩展' },
    { kind: 'personal', label: '个人' },
  ] as const

  function search(value: string) {
    setQuery(value)
    setCollapsedIds([])
  }

  return <section className={styles.catalog} aria-label="预设库">
    <header className={styles.header}>
      <div className={styles.title}><strong>预设库</strong><span>{props.items.length}</span></div>
      <div className={styles.actions}>{props.actions}</div>
    </header>
    <div className={styles.search}><SearchField aria-label="搜索预设或来源" placeholder="搜索预设或来源" clearLabel="清除搜索" value={query} onClear={() => search('')} onChange={event => search(event.target.value)} /></div>
    <div className={styles.content}>
      {sourceGroups.map(group => {
        const sources = props.sources.filter(source => (source.kind === group.kind || (group.kind === 'package' && source.kind === 'official')) && visible.some(item => item.sourceId === source.id))
        if (!sources.length) return null
        return <section key={group.kind} className={styles.sourceGroup} aria-label={group.label}>
          {group.label && <h2 className={styles.sourceGroupLabel}>{group.label}</h2>}
          {sources.map((source, index) => {
            const items = visible.filter(item => item.sourceId === source.id)
            const personal = source.kind === 'personal'
            const expanded = personal || !collapsedIds.includes(source.id)
            const id = `${contentId}-${group.kind}-${index}`
            const heading = <>
              {personal ? <User size={19} /> : <ExtensionIcon iconUrl={source.iconUrl} size={24} />}
              <span className={styles.sourceText}><strong>{source.name}</strong>{source.description && <small>{source.description}</small>}</span>
              <span className={styles.count}>{items.length}</span>
              {!personal && (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
            </>
            return <section className={styles.group} key={source.id} aria-label={source.name}>
              {personal ? null :
                <button type="button" className={styles.sourceHeading} aria-expanded={expanded} aria-controls={id}
                  onClick={() => setCollapsedIds(current => expanded ? [...current, source.id] : current.filter(item => item !== source.id))}>{heading}</button>}
              <div id={id} hidden={!expanded} className={personal ? undefined : styles.packageItems}>
                {items.map(item => <div className={styles.row} key={item.id}>
                  <button type="button" data-preset-id={item.id} className={styles.item} aria-label={`打开${item.name}的编排目录`} onClick={() => props.onOpen(item.id)}>
                    {item.iconUrl ? <ExtensionIcon iconUrl={item.iconUrl} size={24} /> : <MessageSquare size={24} className={styles.presetIcon} />}
                    <span className={styles.itemText}><strong>{item.name}{item.draft && <small>未保存修改</small>}</strong>{item.description && <span>{item.description}</span>}<small>{item.modelLabel} · {item.toolCount} 项工具 · {item.resourceCount} 项资源</small></span>
                  </button>
                  <div className={styles.rowActions}>
                    <Button size="small" variant="ghost" aria-label={`配置${item.name}`} onClick={() => props.onConfigure(item.id)}><SlidersHorizontal size={14} /><span>配置</span></Button>
                    <Button size="small" variant="ghost" aria-label={`编排${item.name}`} onClick={() => props.onOpen(item.id)}><span>编排</span><ChevronRight size={14} /></Button>
                  </div>
                </div>)}
                {props.sourceContent?.(source.id)}
              </div>
            </section>
          })}
        </section>
      })}
      {!visible.length && <p className={styles.empty}>{query.trim() ? '没有匹配的预设。' : '暂无预设，可以新建或导入。'}</p>}
    </div>
  </section>
}
