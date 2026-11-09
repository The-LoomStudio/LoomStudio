import { ResourceListRow } from '../../../../shared/ui/resource-list/resource-list-row.js'
import { ExtensionIcon } from '../../../../shared/ui/extension-icon/extension-icon.js'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button, SearchField } from '@loom-studio/ui'
import { ChevronDown, ChevronRight, MessageSquare, SlidersHorizontal, User, Cpu, Wrench, Layers } from 'lucide-react'
import styles from './preset-library-catalog.module.scss'

export type PresetCatalogSource = { id: string; name: string; kind: 'personal' | 'package' | 'official'; description?: string; iconUrl?: string }
export type PresetCatalogItem = { id: string; sourceId: string; name: string; description?: string; modelLabel: string; toolCount: number; resourceCount: number; draft?: boolean; iconUrl?: string }
export function PresetLibraryCatalog(props: {
  active?: boolean
  items: PresetCatalogItem[]
  sources: PresetCatalogSource[]
  actions?: ReactNode
  itemActions?: (item: PresetCatalogItem) => ReactNode
  renderModelAction?: (item: PresetCatalogItem) => ReactNode
  sourceContent?: (sourceId: string) => ReactNode
  onConfigure(id: string): void
  onOpen(id: string): void
}) {
  const contentId = useId()
  const [query, setQuery] = useState('')
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  const active = props.active ?? true
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(0)
  useLayoutEffect(() => {
    if (active && contentRef.current) contentRef.current.scrollTop = scrollTop.current
  }, [active])
  if (!active) return null
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
    <div className={styles.search}><SearchField aria-label="搜索预设或来源" placeholder="搜索预设或来源" clearLabel="清除搜索" value={query} onClear={() => search('')} onChange={event => search(event.target.value)} /></div>
    <div ref={contentRef} className={styles.content} onScroll={event => { scrollTop.current = event.currentTarget.scrollTop }}>
      {sourceGroups.map(group => {
        const sources = props.sources.filter(source => (source.kind === group.kind || (group.kind === 'package' && source.kind === 'official')) && (source.kind === 'personal' || visible.some(item => item.sourceId === source.id)))
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
              {personal ? <div className={styles.sourceHeading}>{heading}<div className={styles.actions}>{props.actions}</div></div> :
                <button type="button" className={styles.sourceHeading} aria-expanded={expanded} aria-controls={id}
                  onClick={() => setCollapsedIds(current => expanded ? [...current, source.id] : current.filter(item => item !== source.id))}>{heading}</button>}
              <div id={id} hidden={!expanded} className={personal ? undefined : styles.packageItems}>
                {items.map(item => <ResourceListRow key={item.id} itemId={item.id}
                  name={item.name} description={item.description}
                  icon={item.iconUrl ? <ExtensionIcon iconUrl={item.iconUrl} size={32} /> : <MessageSquare size={24} />}
                  badge={item.draft ? '未保存修改' : undefined}
                  openLabel={`打开${item.name}的编排目录`} onOpen={() => props.onOpen(item.id)}
                  metadata={<>
                    {props.renderModelAction ? (
                      props.renderModelAction(item)
                    ) : (
                      <span><Cpu size={13} />{item.modelLabel}</span>
                    )}
                    {item.toolCount > 0 && <span><Wrench size={13} />{item.toolCount} 项工具</span>}
                    {item.resourceCount > 0 && <span><Layers size={13} />{item.resourceCount} 项资源</span>}
                  </>}
                  actions={<>
                    {props.itemActions?.(item)}
                    <Button size="small" variant="ghost" aria-label={`配置${item.name}`} onClick={() => props.onConfigure(item.id)}><SlidersHorizontal size={14} /><span>配置</span></Button>
                    <Button size="small" variant="ghost" aria-label={`编排${item.name}`} onClick={() => props.onOpen(item.id)}><span>编排</span><ChevronRight size={14} /></Button>
                  </>}
                />)}
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
