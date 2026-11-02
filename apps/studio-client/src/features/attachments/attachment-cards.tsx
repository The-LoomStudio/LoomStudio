import { TextAttachmentViewer } from './text-attachment-viewer.js'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ChevronLeft, ChevronRight, FileText, LoaderCircle, X } from 'lucide-react'
import { t as defaultTranslator, type Translator } from '../../shared/i18n/index.js'
import { ImageViewer } from '../../shared/ui/media-viewer/image-viewer.js'
import type { AttachmentDraft } from './use-attachment-drafts.js'
import styles from './attachment-cards.module.scss'

type Props = { items: AttachmentDraft[]; singleRow?: boolean; onRemove?(id: string): void; onRetry?(id: string, file?: File): void; t?: Translator }

export function AttachmentCards({ items, singleRow = false, onRemove, onRetry, t = defaultTranslator }: Props) {
  const [selectedId, setSelectedId] = useState<string>()
  const list = useRef<HTMLUListElement>(null)
  const previousIds = useRef<string[]>(items.map(item => item.id))
  const [edges, setEdges] = useState({ left: false, right: false })
  const available = items.filter(item => item.attachment || item.previewUrl)
  const index = available.findIndex(item => item.id === selectedId)
  const selected = available[index]
  const previous = index > 0 ? () => setSelectedId(available[index - 1]!.id) : undefined
  const next = index >= 0 && index < available.length - 1 ? () => setSelectedId(available[index + 1]!.id) : undefined
  function measure() {
    const element = list.current
    if (element) setEdges({ left: element.scrollLeft > 1, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 })
  }
  useEffect(() => {
    const element = list.current
    if (!element || !singleRow) return
    if (items.some(item => !previousIds.current.includes(item.id))) element.scrollLeft = element.scrollWidth
    previousIds.current = items.map(item => item.id)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [items, singleRow])
  useEffect(() => {
    if (!selected) return
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      if (event.key === 'ArrowLeft' && previous) { event.preventDefault(); previous() }
      if (event.key === 'ArrowRight' && next) { event.preventDefault(); next() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [selectedId, items])
  if (!items.length) return null
  const navigation = available.length ? <div className={styles.navigation} aria-label="附件导航">
    <button className={styles.previous} type="button" aria-label="上一个附件" disabled={!previous} onClick={previous}><ChevronLeft size={18} /></button>
    <div className={styles.filmstripDock}>
      <span>{index + 1} / {available.length}</span>
      <div className={styles.filmstrip} aria-label="附件缩略图">
        {available.map(item => <button key={item.id} type="button" aria-label={`切换到 ${item.name}`} aria-current={item.id === selectedId ? 'true' : undefined}
          title={item.name} onClick={() => setSelectedId(item.id)} ref={element => {
            if (element && item.id === selectedId && element.parentElement) {
              const parent = element.parentElement
              parent.scrollLeft = element.offsetLeft - parent.clientWidth / 2 + element.clientWidth / 2
            }
          }}>
          {item.attachment?.kind === 'image' || item.previewUrl ? <img src={assetUrl(item)} alt="" /> : <><FileText size={20} /><span>{item.name.split('.').at(-1)?.toUpperCase()}</span></>}
        </button>)}
      </div>
    </div>
    <button className={styles.next} type="button" aria-label="下一个附件" disabled={!next} onClick={next}><ChevronRight size={18} /></button>
  </div> : null
  return <>
    <div className={styles.strip} data-left={singleRow && edges.left || undefined} data-right={singleRow && edges.right || undefined}>
      <ul ref={list} onScroll={measure} className={styles.list} data-single-row={singleRow || undefined} aria-label="附件">
        {items.map(item => <AttachmentCard key={item.id} item={item} onRemove={onRemove} onRetry={onRetry} onPreview={() => setSelectedId(item.id)} />)}
      </ul>
    </div>
    {selected && (selected.attachment?.kind === 'image' || selected.previewUrl) ? <ImageViewer key={selected.id} title={selected.name} fileName={selected.name}
      navigation={navigation} onPrevious={previous} onNext={next} src={assetUrl(selected)} t={t} onClose={() => setSelectedId(undefined)} />
      : selected?.attachment ? <TextAttachmentViewer key={selected.id} navigation={navigation} onPrevious={previous} onNext={next} attachment={selected.attachment} onClose={() => setSelectedId(undefined)} /> : null}
  </>
}

function assetUrl(item: AttachmentDraft) {
  return item.attachment ? `/assets/${encodeURIComponent(item.attachment.assetId)}` : item.previewUrl
}

function AttachmentCard({ item, onRemove, onRetry, onPreview }: { item: AttachmentDraft; onRemove?: Props['onRemove']; onRetry?: Props['onRetry']; onPreview(): void }) {
  const replacement = useRef<HTMLInputElement>(null)
  const host = useRef<HTMLLIElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const origin = useRef<{ x: number; y: number } | undefined>(undefined)
  const suppressClick = useRef(false)
  const [revealed, setRevealed] = useState(false)
  const [preview, setPreview] = useState<{ left: number; top: number }>()
  const image = item.attachment?.kind === 'image' || Boolean(item.previewUrl)
  const extension = item.name.includes('.') ? item.name.split('.').at(-1)!.toUpperCase() : 'FILE'
  const format = extension === 'MARKDOWN' ? 'MD' : extension.slice(0, 8)
  const label = item.name.replace(/\.[^.]+$/, '') || item.name
  const uploading = !item.attachment && !item.error
  const url = assetUrl(item)

  function cancelPress() { clearTimeout(timer.current); timer.current = undefined }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!revealed && !preview) return
    const dismiss = () => { setRevealed(false); setPreview(undefined) }
    const outside = (event: globalThis.PointerEvent) => { if (!host.current?.contains(event.target as Node)) dismiss() }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [revealed, preview])

  function showPreview() {
    const rect = host.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(240, window.innerWidth - 24)
    const height = image ? 224 : 80
    setPreview({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: rect.top > height + 16 ? rect.top - height - 8 : Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - height - 12)) })
  }
  function startPress(event: PointerEvent<HTMLLIElement>) {
    cancelPress()
    suppressClick.current = false
    if (event.pointerType === 'mouse' || event.button !== 0 || (event.target as Element).closest('[data-remove-attachment]')) return
    origin.current = { x: event.clientX, y: event.clientY }
    timer.current = setTimeout(() => { suppressClick.current = true; setRevealed(true); showPreview() }, 450)
  }
  const face = <>
    {image ? <img className={styles.thumbnail} src={url} alt="" draggable={false} /> : <span className={styles.document}>
      <FileText size={22} strokeWidth={1.5} aria-hidden="true" /><strong>{format}</strong>
    </span>}
    <span className={styles.name}>{label}</span>
    {uploading || item.error ? <span className={styles.status} role={item.error ? 'alert' : 'status'}>
      {item.error ? <AlertCircle size={18} /> : <LoaderCircle className={styles.spinner} size={18} />}
      {item.error ? '上传失败' : '上传中'}
    </span> : null}
  </>
  const dismissPreview = () => setPreview(undefined)
  return <li ref={host} className={styles.card} data-tone={image ? 'image' : format === 'MD' ? 'markdown' : 'text'} data-revealed={revealed || undefined}
    onMouseEnter={showPreview} onMouseLeave={dismissPreview}
    onFocus={event => { if (event.target.matches(':focus-visible')) showPreview() }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { dismissPreview(); setRevealed(false) } }}
    onKeyDown={event => { if (event.key === 'Escape') { dismissPreview(); setRevealed(false); event.stopPropagation() } }}
    onPointerDown={startPress} onPointerUp={cancelPress} onPointerCancel={cancelPress}
    onPointerMove={event => { if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) cancelPress() }}
    onContextMenu={event => event.preventDefault()}
    onClickCapture={event => {
      if (suppressClick.current && !(event.target as Element).closest('[data-remove-attachment]')) { event.preventDefault(); event.stopPropagation() }
      suppressClick.current = false
    }}>
    {image ? <button type="button" className={styles.face} aria-label={`查看图片 ${item.name}`} onClick={() => { dismissPreview(); setRevealed(false); onPreview() }}>{face}</button>
      : url ? <button type="button" className={styles.face} aria-label={`预览文件 ${item.name}`} onClick={() => { dismissPreview(); setRevealed(false); onPreview() }}>{face}</button>
        : <div className={styles.face} tabIndex={0} aria-label={`${item.name} · ${item.error ?? '上传中'}`}>{face}</div>}
    {item.error ? <><span className={styles.error}>{item.error}</span>
      {onRetry ? <><button type="button" className={styles.retry} onClick={() => item.retryable ? onRetry(item.id) : replacement.current?.click()}>{item.retryable ? '重试' : '重新选择'}</button>
      <input ref={replacement} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,.md,.markdown,.txt" onChange={event => { const file = event.target.files?.[0]; if (file) onRetry(item.id, file); event.target.value = '' }} /></> : null}</> : null}
    {onRemove ? <button type="button" data-remove-attachment className={styles.remove} aria-label={`移除 ${item.name}`}
      onClick={() => onRemove(item.id)}><X size={16} strokeWidth={2} /></button> : null}
    {preview ? createPortal(<div className={styles.preview} style={preview} role="tooltip">
      {image ? <img src={url} alt="" /> : null}
      <strong>{item.name}</strong>
      <span>{item.error ?? (item.attachment ? `${format} · ${Math.max(1, Math.ceil(item.attachment.sizeBytes / 1024))} KB${image ? ' · 点击放大' : ' · 点击预览'}` : '上传中…')}</span>
    </div>, document.body) : null}
  </li>
}
