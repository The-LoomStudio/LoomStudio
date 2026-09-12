import { Check, Copy, FileDown, FileText, Image, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CardDirectoryAttachment, CardDirectoryCatalog, CardDirectoryPreview, OpenCardDirectoryResult } from '@loom-studio/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Translator } from '../../shared/i18n/index.js'
import { Dialog } from '../../shared/ui/dialog/dialog.js'
import { ImageViewer } from '../../shared/ui/media-viewer/image-viewer.js'
import styles from './card-resource-overview.module.scss'

export type CardDirectoryApi = {
  list(): Promise<CardDirectoryCatalog>
  scan(): Promise<CardDirectoryCatalog>
  open(directory: string): Promise<OpenCardDirectoryResult>
  attachment(directory: string, path: string): Promise<CardDirectoryAttachment>
  importDirectory(directory: string, token: string): Promise<{ cardId: string }>
  previewApply(cardId: string): Promise<CardDirectoryPreview>
  apply(cardId: string, token: string): Promise<{ cardId: string }>
}

export function CardResourceOverview({ api, cardId, onRefresh, t }: { api: CardDirectoryApi; cardId: string; onRefresh?(): Promise<unknown>; t: Translator }) {
  const [overview, setOverview] = useState<OpenCardDirectoryResult>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [applyPreview, setApplyPreview] = useState<CardDirectoryPreview>()
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const pending = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  async function previewApply() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setActionError('')
    try {
      const result = await api.previewApply(cardId)
      if (active.current) setApplyPreview(result)
    } catch (cause) { if (active.current) setActionError(message(cause)) }
    finally { pending.current = false; if (active.current) setBusy(false) }
  }
  async function apply() {
    if (!applyPreview || pending.current || applyPreview.conflicts.length || !applyPreview.changes.length) return
    pending.current = true
    setBusy(true)
    setActionError('')
    let applied = false
    try {
      await api.apply(cardId, applyPreview.token)
      applied = true
      if (active.current) { setApplyPreview(undefined); setRevision(value => value + 1) }
      await onRefresh?.()
    } catch (cause) {
      let failure = applied ? `${t('directory.appliedRefreshFailed')} ${message(cause)}` : message(cause)
      if (!applied) {
        if (active.current) setRevision(value => value + 1)
        try { await onRefresh?.() }
        catch (refreshCause) { failure += `\n${t('directory.refreshFailed')} ${message(refreshCause)}` }
      }
      if (active.current) { setApplyPreview(undefined); setActionError(failure) }
    } finally { pending.current = false; if (active.current) setBusy(false) }
  }
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    void (async () => {
      const catalog = await api.scan()
      if (catalog.error) throw new Error(catalog.error)
      const entry = catalog.entries.find(item => item.registeredCardId === cardId)
      if (current && entry?.error) setError(entry.error)
      const result = entry ? await api.open(entry.directory) : undefined
      if (current) setOverview(result)
    })().catch(cause => { if (current) setError(previous => [previous, message(cause)].filter(Boolean).join('\n')) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [api, cardId, revision])
  return <section className={styles.overview} aria-busy={loading}>
    <header className={styles.header}><h3>{t('directory.attachments')}</h3><div><button type="button" className={styles.iconButton} disabled={loading || busy || !overview} title={t('directory.apply')} aria-label={t('directory.apply')} onClick={() => void previewApply()}><FileDown /></button><button type="button" className={styles.iconButton} disabled={loading || busy} title={t('directory.refresh')} aria-label={t('directory.refresh')} onClick={() => setRevision(value => value + 1)}><RefreshCw /></button></div></header>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {actionError ? <p role="alert" className={styles.error}>{actionError}</p> : null}
    {overview ? <CardResourceSummary key={overview.directory} overview={overview} api={api} t={t} /> : loading || !error ? <p className={styles.empty}>{t(loading ? 'directory.loading' : 'directory.unsaved')}</p> : null}
    {applyPreview ? <Dialog open title={t('directory.apply')} onClose={() => { if (!busy) setApplyPreview(undefined) }} headerActions={<button type="button" className={styles.iconButton} disabled={busy} title={t('character.cancel')} aria-label={t('character.cancel')} onClick={() => setApplyPreview(undefined)}><X /></button>}>
      <div className={styles.preview}>
        <p>{applyPreview.changes.length ? t('directory.changeSummary', { added: applyPreview.changes.filter(item => item.kind === 'added').length, modified: applyPreview.changes.filter(item => item.kind === 'modified').length, deleted: applyPreview.changes.filter(item => item.kind === 'deleted').length }) : t('directory.noChanges')}</p>
        {applyPreview.conflicts.length ? <><p className={styles.error}>{t('directory.conflicts', { count: applyPreview.conflicts.length })}</p><ul>{applyPreview.conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}</ul></> : null}
        <button type="button" disabled={busy || !!applyPreview.conflicts.length || !applyPreview.changes.length} onClick={() => void apply()}>{t('directory.confirmApply')}</button>
      </div>
    </Dialog> : null}
  </section>
}

export function CardResourceSummary({ overview, api, t }: { overview: OpenCardDirectoryResult; api: Pick<CardDirectoryApi, 'attachment'>; t: Translator }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [selected, setSelected] = useState<string>()
  const [preview, setPreview] = useState<CardDirectoryAttachment>()
  const [error, setError] = useState('')
  const attachments = overview.attachments ?? []
  const selectedAttachment = attachments.find(item => item.path === selected)
  const media = attachments.filter(item => item.kind === 'image')
  const documents = attachments.filter(item => item.kind === 'document')
  useEffect(() => {
    let current = true
    setPreview(undefined)
    setError('')
    if (selected) void api.attachment(overview.directory, selected)
      .then(result => { if (current) setPreview(result) })
      .catch(cause => { if (current) setError(message(cause)) })
    return () => { current = false }
  }, [api, overview.directory, selected])
  async function copy() {
    try { await navigator.clipboard.writeText(overview.directory); setCopied(true); setCopyError('') }
    catch { setCopyError(t('directory.copyFailed')) }
  }
  return <>
    <div className={styles.stats}>
      <div><strong>{formatSize(overview.totalBytes)}</strong><span>{t('directory.savedSize')}</span></div>
      <div><strong>{media.length}</strong><span>{t('directory.media')} · {formatSize(media.reduce((sum, item) => sum + item.sizeBytes, 0))}</span></div>
      <div><strong>{documents.length}</strong><span>{t('directory.documents')}</span></div>
    </div>
    {attachments.length ? <div className={styles.attachments}>{attachments.map(item => <button type="button" key={item.path} className={styles.attachment} onClick={() => { setPreview(undefined); setError(''); setSelected(item.path) }}>
      {item.kind === 'image' ? <Image aria-hidden="true" /> : <FileText aria-hidden="true" />}
      <span>{item.label === 'avatar' ? t('directory.avatar') : item.label === 'background' ? t('directory.background') : item.label}</span><small>{formatSize(item.sizeBytes)}</small>
    </button>)}</div> : null}
    <footer className={styles.location}><span title={overview.directory}>{t('directory.localProject')}</span><button type="button" className={styles.iconButton} title={t('directory.copyPath')} aria-label={t('directory.copyPath')} onClick={() => void copy()}>{copied ? <Check /> : <Copy />}</button></footer>
    {copyError ? <p role="alert" className={styles.error}>{copyError}</p> : null}
    <span role="status" className={styles.status}>{copied ? t('directory.copied') : ''}</span>
    {selectedAttachment?.kind === 'image' ? <ImageViewer title={selectedAttachment.label === 'avatar' ? t('directory.avatar') : selectedAttachment.label === 'background' ? t('directory.background') : selectedAttachment.label} src={preview?.content} fileName={selectedAttachment.path.split('/').pop() ?? 'image.png'} error={error} onClose={() => setSelected(undefined)} t={t} /> : null}
    {selectedAttachment?.kind === 'document' ? <Dialog open title={selectedAttachment.label} onClose={() => setSelected(undefined)} headerActions={<button type="button" className={styles.iconButton} title={t('character.cancel')} aria-label={t('character.cancel')} onClick={() => setSelected(undefined)}><X /></button>}><div className={styles.preview}>{error ? <p role="alert">{error}</p> : preview ? <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt}</span>, a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> }}>{preview.content}</Markdown> : <p role="status">{t('directory.loading')}</p>}</div></Dialog> : null}
  </>
}

export function DirectoryDiscoveryNotice({ catalog, api, onRefresh, t, onClose }: { catalog: CardDirectoryCatalog; api: CardDirectoryApi; onRefresh?(): Promise<unknown>; t: Translator; onClose(): void }) {
  const [imported, setImported] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(false)
  const pending = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  async function importDirectory(directory: string) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    let committed = false
    try {
      const opened = await api.open(directory)
      if (!active.current) return
      await api.importDirectory(directory, opened.token)
      committed = true
      if (active.current) setImported(current => [...current, directory])
      await onRefresh?.()
    } catch (cause) {
      let failure = committed ? `${t('directory.importedRefreshFailed')} ${message(cause)}` : message(cause)
      if (!committed) {
        try { await onRefresh?.() }
        catch (refreshCause) { failure += `\n${t('directory.refreshFailed')} ${message(refreshCause)}` }
      }
      if (active.current) setError(failure)
    }
    finally { pending.current = false; if (active.current) setBusy(false) }
  }
  return <Dialog open title={t('directory.found')} onClose={() => { if (!busy) onClose() }} headerActions={<button type="button" disabled={busy} className={styles.iconButton} title={t('character.cancel')} aria-label={t('character.cancel')} onClick={onClose}><X /></button>}>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.discovery}>{catalog.entries.filter(entry => !entry.registeredCardId && !imported.includes(entry.directory)).map(entry => <div key={entry.directory}><strong>{entry.name}</strong>{entry.sameSourceCount ? <small>{t('directory.sameSource', { count: entry.sameSourceCount })}</small> : null}{entry.error ? <p className={styles.error}>{entry.error}</p> : null}<button type="button" disabled={busy || !!entry.error} onClick={() => void importDirectory(entry.directory)}>{t('directory.confirmImport')}</button></div>)}</div>
  </Dialog>
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${(bytes / 1024 ** (index + 1)).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[index]}`
}
