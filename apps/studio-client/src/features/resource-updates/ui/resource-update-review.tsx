import { useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import { Copy, Check } from 'lucide-react'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import styles from './resource-update-review.module.scss'

export type ReviewItem = {
  id: string
  kind: string
  title: string
  local: string | null
  incoming: string | null
  /** Whole resource identity, shared by its entries. Copy never extracts an entry. */
  copyResourceId?: string
  copyResourceTitle?: string
}
export type ReviewChoice = 'local' | 'incoming'
export type Resolution = { choice: ReviewChoice }
export type ResourceCopyResult = { id: string; label: string }

export function reviewStatus(item: ReviewItem): string {
  if (item.local === item.incoming) return '内容一致'
  if (item.local === null) return '新增内容'
  if (item.incoming === null) return '新版移除'
  return '内容不同'
}

export function ResourceUpdateReview(props: {
  items: ReviewItem[]
  selected: string
  onSelect(id: string): void
  resolutions: Record<string, Resolution>
  onResolve(id: string, value: Resolution): void
  query: string
  onQuery(value: string): void
  busy?: boolean
  onSaveCopy?(resourceId: string, name: string): Promise<ResourceCopyResult>
  onOpenCopy?(result: ResourceCopyResult): void
}) {
  const [pane, setPane] = useState<'master' | 'detail'>('master')
  const [copy, setCopy] = useState<{ resourceId: string; title: string }>()
  const [copyName, setCopyName] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [savedCopy, setSavedCopy] = useState<ResourceCopyResult>()
  const item = props.items.find(entry => entry.id === props.selected)
  const visible = props.items.filter(entry => `${entry.title}${entry.kind}`.toLocaleLowerCase().includes(props.query.toLocaleLowerCase()))
  const resolution = item ? props.resolutions[item.id] : undefined
  function prepareCopy() {
    if (!item?.copyResourceId || !props.onSaveCopy) return
    const title = item.copyResourceTitle ?? item.title
    setCopy({ resourceId: item.copyResourceId, title })
    setCopyName(`${title} · 我的版本`)
    setCopyError('')
  }
  async function saveCopy() {
    if (!copy || !copyName.trim() || !props.onSaveCopy || copyBusy) return
    setCopyBusy(true)
    setCopyError('')
    try {
      const result = await props.onSaveCopy(copy.resourceId, copyName.trim())
      setSavedCopy(result)
      setCopy(undefined)
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error))
    } finally { setCopyBusy(false) }
  }
  return <>
    <MasterDetailWorkbench navigationScope="local" defaultMasterWidth={290} hasSelection={!!item} mobilePane={pane} onMobilePaneChange={setPane} backLabel="资源列表" master={<div className={styles.catalog}>
      <h2>内容比较</h2><p>选择本次要保留的内容</p>
      <input aria-label="搜索资源" placeholder="搜索条目或类型" value={props.query} onChange={event => props.onQuery(event.target.value)} />
      <div className={styles.list}>{visible.map(entry => <button key={entry.id} className={styles.row} aria-pressed={entry.id === props.selected} onClick={() => { props.onSelect(entry.id); setPane('detail') }}>
        <small>{entry.kind}</small><strong>{entry.title}</strong><span>{props.resolutions[entry.id]?.choice === 'local' ? '保留当前内容' : props.resolutions[entry.id]?.choice === 'incoming' ? '采用新版' : reviewStatus(entry)}</span>
      </button>)}{!visible.length && <p role="status">没有匹配条目，试试其他关键词。</p>}</div>
    </div>}>
      {item ? <article className={styles.detail}>
        <small>{item.kind} · {reviewStatus(item)}</small><h2>{item.title}</h2>
        <p>比较当前使用的内容与下载包中的新版。这里的选择只在本次更新中有效。</p>
        <div className={styles.compare}>
          <section><h3>当前使用</h3><pre>{item.local ?? '（当前没有此项）'}</pre></section>
          <section><h3>下载包中的新版</h3><pre>{item.incoming ?? '（新版不再提供此项）'}</pre></section>
        </div>
        {item.local !== item.incoming && <div className={styles.actions}>
          <Button disabled={props.busy} variant={resolution?.choice === 'local' ? 'default' : 'secondary'} onClick={() => props.onResolve(item.id, { choice: 'local' })}>{resolution?.choice === 'local' && <Check size={14} />}保留当前内容</Button>
          <Button disabled={props.busy} variant={resolution?.choice === 'incoming' ? 'default' : 'secondary'} onClick={() => props.onResolve(item.id, { choice: 'incoming' })}>{resolution?.choice === 'incoming' && <Check size={14} />}采用新版</Button>
        </div>}
        {item.copyResourceId && props.onSaveCopy && <div className={styles.copyAction}><Button variant="ghost" disabled={props.busy || copyBusy} onClick={prepareCopy}><Copy size={14} />我的版本另存为副本</Button><small>保存整份{item.kind.includes('Lore') ? ' Lore' : '资源'}；不自动切换当前引用。</small></div>}
        {savedCopy && <div className={styles.savedCopy} role="status"><span>已保存到个人资源：{savedCopy.label}</span>{props.onOpenCopy && <Button variant="ghost" size="small" onClick={() => props.onOpenCopy?.(savedCopy)}>查看副本</Button>}</div>}
      </article> : <div className={styles.detail}><p>选择一项查看内容。</p></div>}
    </MasterDetailWorkbench>
    <Dialog open={!!copy} title="另存我的版本" dismissible={!copyBusy} onClose={() => setCopy(undefined)} actions={<><Button variant="ghost" disabled={copyBusy} onClick={() => setCopy(undefined)}>取消</Button><Button disabled={copyBusy || !copyName.trim()} onClick={() => void saveCopy()}>{copyBusy ? '正在保存…' : '保存副本'}</Button></>}>
      <div className={styles.copyDialog}><p>保存整份“{copy?.title}”，包括当前排序、正文与宏配置。外部资源继续引用，不复制故事，也不跟随原包更新。</p><label>副本名称<input autoFocus value={copyName} disabled={copyBusy} onChange={event => setCopyName(event.target.value)} /></label><p>保存成功后，即使取消本次更新，副本也会保留。</p>{copyError && <p role="alert">{copyError}</p>}</div>
    </Dialog>
  </>
}
