import { createId } from '@loom-studio/shared'
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, TextInput, SearchField, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, type MenuAction } from '@loom-studio/ui'
import { ArrowLeft, Check, ChevronRight, Copy, Download, File, FileCode2, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Image, MoreHorizontal, Pencil, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import { FileTree, type FileTreeNode } from '../../shared/ui/file-tree/file-tree.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { LongTextEditor } from '../../shared/ui/long-text-editor/long-text-editor.js'
import styles from './workspace-browser.module.scss'

type Revision = Awaited<ReturnType<StudioApi['workspace']['get']>>
type Entry = Revision['entries'][number]
type Operation = Parameters<StudioApi['workspace']['mutate']>[0]['operations'][number]
type Draft = { text: string; baselineText: string; revisionId: string }
const draftsByApi = new WeakMap<StudioApi, Map<string, Draft>>()
const unloadGuards = new WeakMap<Map<string, Draft>, (event: BeforeUnloadEvent) => void>()
function syncUnloadGuard(drafts: Map<string, Draft>) {
  const existing = unloadGuards.get(drafts)
  if (!drafts.size && existing) {
    window.removeEventListener('beforeunload', existing); unloadGuards.delete(drafts)
  } else if (drafts.size && !existing) {
    const listener = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    unloadGuards.set(drafts, listener); window.addEventListener('beforeunload', listener)
  }
}
const workspaceRootId = 'workspace:root'
const maxBytes = 32 * 1024 * 1024
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function WorkspaceBrowser({ api, timelineId, branchId, onDirtyChange }: {
  api: StudioApi; timelineId: string; branchId: string; onDirtyChange?(dirty: boolean): void
}) {
  const [explorerWidth, setExplorerWidth] = useState(280)
  const [mobilePane, setMobilePane] = useState<'explorer' | 'detail'>('explorer')
  const [expandedIds, setExpandedIds] = useState<string[]>([workspaceRootId])
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'file' | 'directory' | 'rename' | 'move' | 'copy' | 'delete'; entry?: Entry; parentId?: string }>()
  const [name, setName] = useState('')
  const [destination, setDestination] = useState('')
  const [editorMode, setEditorMode] = useState<'source' | 'preview'>('source')
  const [revision, setRevision] = useState<Revision>()
  const [directoryId, setDirectoryId] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [baseline, setBaseline] = useState({ text: '', revisionId: '' })
  const drafts = draftsByApi.get(api) ?? new Map<string, Draft>()
  if (!draftsByApi.has(api)) draftsByApi.set(api, drafts)
  const draftKey = (entryId: string) => JSON.stringify([timelineId, branchId, entryId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadDirectoryRef = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const selected = revision?.entries.find(entry => entry.id === selectedId)
  const text = selected?.kind === 'file' && 'text' in selected.content ? selected.content.text
    : selectedId && drafts.has(draftKey(selectedId)) ? baseline.text : undefined
  const dirty = text !== undefined && baseline.text !== draft
  const target = { timelineId, branchId }
  // Unsaved text stays in the per-file draft cache when navigating the tree.
  function restoreDraft(entry: Entry | undefined, value: Revision) {
    const saved = entry?.kind === 'file' && 'text' in entry.content ? entry.content.text : ''
    const cached = entry ? drafts?.get(draftKey(entry.id)) : undefined
    setDraft(cached?.text ?? saved)
    setBaseline({ text: cached?.baselineText ?? saved, revisionId: cached?.revisionId ?? value.id })
  }
  function editDraft(value: string) {
    setDraft(value)
    if (!selectedId) return
    if (value === baseline.text) drafts?.delete(draftKey(selectedId))
    else drafts?.set(draftKey(selectedId), { text: value, baselineText: baseline.text, revisionId: baseline.revisionId })
    if (drafts) syncUnloadGuard(drafts)
  }

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    const token = ++generation.current
    setRevision(undefined); setSelectedId(undefined); setDirectoryId(undefined); setDraft(''); setError(''); setBusy(true)
    api.workspace.get({ timelineId, branchId }).then(value => {
      if (token !== generation.current) return
      setRevision(value)
      const initial = value.entries.find(entry => !entry.parentId && entry.name === 'MEMORY.md' && entry.kind === 'file')
      setSelectedId(initial?.id)
      restoreDraft(initial, value)
    }).catch(reason => { if (token === generation.current) setError(message(reason)) })
      .finally(() => { if (token === generation.current) setBusy(false) })
    return () => { generation.current++ }
  }, [api, timelineId, branchId])

  useEffect(() => {
    setPreview(''); setPreviewLoading(false)
    if (selected?.kind !== 'file' || !('blobId' in selected.content) || !imageTypes.has(selected.content.mediaType ?? '')) return
    let disposed = false
    let url: string | undefined
    const mediaType = selected.content.mediaType
    setPreviewLoading(true)
    api.workspace.read({ timelineId, branchId, entryId: selected.id }).then(result => {
      if (disposed) return
      if (result.revisionId !== revision?.id) throw new Error('工作区已更新，请刷新后预览。')
      url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: mediaType }))
      setPreview(url)
    }).catch(reason => { if (!disposed) setError(message(reason)) })
      .finally(() => { if (!disposed) setPreviewLoading(false) })
    return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
  }, [api, timelineId, branchId, selected, revision?.id])

  function select(entry?: Entry) {
    if (busy) return
    setSelectedId(entry?.id)
    setDirectoryId(entry?.kind === 'directory' ? entry.id : entry?.parentId)
    setMobilePane('detail')
    if (entry?.kind === 'directory') setExpandedIds(ids => [...new Set([...ids, entry.id])])
    if (revision) restoreDraft(entry, revision)
    setError('')
  }
  async function mutate(operations: Operation[], nextId = selectedId, expectedRevisionId = revision?.id) {
    if (!revision || !expectedRevisionId || busy) return
    const token = generation.current
    setBusy(true); setError('')
    try {
      const result = await api.workspace.mutate({ ...target, expectedRevisionId, operations })
      for (const entry of revision.entries) {
        const key = draftKey(entry.id)
        const cached = drafts.get(key)
        const committed = result.revision.entries.find(item => item.id === entry.id)
        const write = operations.find(operation => operation.kind === 'write' && operation.entryId === entry.id)
        if (!committed || (write?.kind === 'write' && cached?.text === write.content)) drafts.delete(key)
        else if (cached?.revisionId === revision.id && committed.kind === 'file' && 'text' in committed.content
          && committed.content.text === cached.baselineText) {
          // Our successful CAS changed other files or metadata, not this draft's source.
          drafts.set(key, { ...cached, revisionId: result.revision.id })
        }
      }
      syncUnloadGuard(drafts)
      if (token !== generation.current) return true
      setRevision(result.revision)
      const next = result.revision.entries.find(entry => entry.id === nextId)
      setSelectedId(next?.id)
      setMobilePane('detail')
      setExpandedIds(ids => [...new Set([...ids, workspaceRootId, ...(next?.parentId ? [next.parentId] : [])])])
      restoreDraft(next, result.revision)
      setDirectoryId(next?.kind === 'directory' ? next.id : next?.parentId)
      return true
    } catch (reason) {
      if (token === generation.current) setError(`${message(reason)}。草稿已保留；若工作区已被更新，请先复制草稿，再刷新。`)
    } finally { if (token === generation.current) setBusy(false) }
  }
  async function refresh() {
    if (busy) return
    if (dirty && !window.confirm('刷新将丢弃当前文件草稿并读取最新版本。请先复制需要保留的内容。继续吗？')) return
    const token = generation.current
    setBusy(true); setError('')
    try {
      const value = await api.workspace.get(target)
      if (token !== generation.current) return
      setRevision(value)
      const next = value.entries.find(entry => entry.id === selectedId)
      if (selectedId) drafts?.delete(draftKey(selectedId))
      if (drafts) syncUnloadGuard(drafts)
      setSelectedId(next?.id); restoreDraft(next, value)
      if (!value.entries.some(entry => entry.id === directoryId)) setDirectoryId(undefined)
    } catch (reason) { if (token === generation.current) setError(message(reason)) }
    finally { if (token === generation.current) setBusy(false) }
  }
  function openDialog(kind: NonNullable<typeof dialog>['kind'], entry = selected, creationTarget?: { parentId?: string }) {
    if (busy) return
    setName(kind === 'file' ? '未命名.md' : kind === 'directory' ? '新目录' : entry?.name ?? '')
    setDestination(entry?.parentId ?? '')
    setDialog({ kind, entry, parentId: creationTarget ? creationTarget.parentId : entry?.kind === 'directory' ? entry.id : directoryId })
    setError('')
  }
  async function submitDialog() {
    if (!dialog || busy) return
    const { kind, entry } = dialog
    let operations: Operation[]
    let nextId = selectedId
    if (kind === 'file' || kind === 'directory') {
      nextId = createId()
      operations = [{ kind: 'create', entry: kind === 'file'
        ? { id: nextId, kind, name: name.trim(), parentId: dialog.parentId, content: { text: '' } }
        : { id: nextId, kind, name: name.trim(), parentId: dialog.parentId } }]
    } else if (!entry) return
    else if (kind === 'delete') operations = [{ kind, entryId: entry.id }]
    else operations = [{ kind: kind === 'rename' ? 'move' : kind, entryId: entry.id,
      name: name.trim(), parentId: kind === 'rename' ? entry.parentId : destination || undefined }]
    if (await mutate(operations, nextId)) setDialog(undefined)
  }
  function directoryPath(id?: string): string {
    const entry = revision?.entries.find(item => item.id === id)
    return entry ? `${directoryPath(entry.parentId)}${entry.name}/` : '/'
  }
  function chooseUpload(parentId?: string) {
    uploadDirectoryRef.current = parentId
    uploadRef.current?.click()
  }
  async function upload(file: File) {
    const parentId = uploadDirectoryRef.current
    if (file.size > maxBytes) { setError('文件不能超过 32 MiB。'); return }
    const token = generation.current
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (token !== generation.current) return
      const id = createId()
      // Text uploads remain editable; invalid UTF-8 and other file types remain immutable binary blobs.
      const isText = file.type.startsWith('text/') || /\.(md|txt|json|ya?ml|toml|csv|tsv|log|js|ts|css|html|xml|svg)$/i.test(file.name)
      let content: string | number[] = Array.from(bytes)
      if (isText) {
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { /* Preserve non-UTF-8 bytes. */ }
      }
      await mutate([{ kind: 'create', entry: { id, parentId, name: file.name, kind: 'file', content: { text: '' } } },
        { kind: 'write', entryId: id, content, mediaType: file.type || undefined }], id)
    } catch (reason) { if (token === generation.current) setError(message(reason)) }
  }
  async function download() {
    if (selected?.kind !== 'file') return
    setBusy(true); setError('')
    const token = generation.current
    try {
      const result = await api.workspace.read({ ...target, entryId: selected.id })
      if (token !== generation.current) return
      if (result.revisionId !== revision?.id) throw new Error('工作区已更新，请刷新后下载。')
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'application/octet-stream' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = selected.name; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) { if (token === generation.current) setError(message(reason)) }
    finally { if (token === generation.current) setBusy(false) }
  }
  const entries = revision?.entries ?? []
  const sorted = (items: Entry[]) => items.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))
  function tree(parentId?: string): FileTreeNode[] {
    return sorted(entries.filter(entry => entry.parentId === parentId)).flatMap(entry => {
      const children = entry.kind === 'directory' ? tree(entry.id) : undefined
      if (search && !entry.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && !children?.length) return []
      return [{ id: entry.id, label: entry.name, kind: entry.kind === 'directory' ? 'folder' : 'file', children,
        meta: drafts.has(draftKey(entry.id)) ? '未保存' : undefined }]
    })
  }
  const children = sorted(entries.filter(entry => entry.parentId === directoryId))
  const orphanDrafts = [...drafts].filter(([key]) => {
    const [owner, branch, id] = JSON.parse(key) as string[]
    return owner === timelineId && branch === branchId && revision && !entries.some(entry => entry.id === id)
  })
  function icon(entry?: Entry, expanded = false) {
    if (entry?.kind === 'directory' || !entry) return expanded ? <FolderOpen size={16} /> : <Folder size={16} />
    if ('blobId' in entry.content) return entry.content.mediaType?.startsWith('image/') ? <Image size={16} /> : <File size={16} />
    return /\.(js|ts|json|html|css)$/i.test(entry.name) ? <FileCode2 size={16} /> : <FileText size={16} />
  }
  function actions(entry: Entry): MenuAction[] {
    return [
      { id: 'rename', label: '重命名', icon: <Pencil size={14} />, disabled: busy, onSelect: () => openDialog('rename', entry) },
      { id: 'move', label: '移动到…', icon: <Folder size={14} />, disabled: busy, onSelect: () => openDialog('move', entry) },
      { id: 'copy', label: '复制到…', icon: <Copy size={14} />, disabled: busy, onSelect: () => openDialog('copy', entry) },
      { id: 'delete', label: '删除', icon: <Trash2 size={14} />, tone: 'danger', disabled: busy, onSelect: () => openDialog('delete', entry) },
    ]
  }
  function rootActions(): MenuAction[] {
    return [
      { id: 'file', label: '新建文件', icon: <FilePlus2 size={14} />, disabled: busy, onSelect: () => openDialog('file', undefined, {}) },
      { id: 'directory', label: '新建目录', icon: <FolderPlus size={14} />, disabled: busy, onSelect: () => openDialog('directory', undefined, {}) },
      { id: 'upload', label: '上传文件', icon: <Upload size={14} />, disabled: busy, onSelect: () => chooseUpload() },
      { id: 'refresh', label: '刷新工作区', icon: <RefreshCw size={14} />, disabled: busy, onSelect: () => void refresh() },
    ]
  }
  function save() {
    if (!selected || !dirty) return
    if (new TextEncoder().encode(draft).byteLength > maxBytes) { setError('文件不能超过 32 MiB。'); return }
    void mutate([{ kind: 'write', entryId: selected.id, content: draft }], selected.id, baseline.revisionId)
  }
  const dialogTitle = dialog && ({ file: '新建文件', directory: '新建目录', rename: '重命名', move: '移动文件', copy: '复制文件', delete: '删除确认' })[dialog.kind]
  return <section className={styles.browser} aria-label="共享工作区" aria-busy={busy}>
    <AssetWorkbenchLayout explorerWidth={explorerWidth} onExplorerWidthChange={setExplorerWidth}
      viewMode="master-detail" hasSelection={Boolean(revision)} mobilePane={mobilePane} onMobilePaneChange={setMobilePane} resizeLabel="调整工作区目录宽度"
      header={<div className={styles.explorerHeading}><span>文件</span><div className={styles.actions}>
        <DropdownMenu><DropdownMenuTrigger asChild><Button size="small" variant="ghost" disabled={busy || !revision} aria-label="新建或上传" title="新建或上传"><Plus size={16} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent><DropdownMenuItem icon={<FilePlus2 size={15} />} onSelect={() => openDialog('file')}>新建文件</DropdownMenuItem>
            <DropdownMenuItem icon={<FolderPlus size={15} />} onSelect={() => openDialog('directory')}>新建目录</DropdownMenuItem>
            <DropdownMenuItem icon={<Upload size={15} />} onSelect={() => chooseUpload(directoryId)}>上传文件</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
        <Button size="small" variant="ghost" disabled={busy} onClick={() => void refresh()} aria-label="刷新工作区" title="刷新工作区"><RefreshCw size={15} /></Button>
      </div></div>}
      toolbar={<SearchField clearLabel="清除搜索" onClear={() => setSearch('')} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索文件" aria-label="搜索工作区文件" />}
      explorer={<div className={styles.explorer}>
        {revision ? <FileTree ariaLabel="工作区文件" nodes={[{ id: workspaceRootId, label: '/workspace', kind: 'folder', children: tree() }]} selectedId={selectedId ?? workspaceRootId}
          expandedIds={search ? [workspaceRootId, ...entries.filter(entry => entry.kind === 'directory').map(entry => entry.id)] : expandedIds}
          onExpandedIdsChange={setExpandedIds} onSelect={node => select(entries.find(entry => entry.id === node.id))}
          getDisclosureLabel={(node, expanded) => `${expanded ? '折叠' : '展开'} ${node.label}`} getDragLabel={node => node.label}
          moreActionsLabel="文件操作" getActions={node => { if (node.id === workspaceRootId) return rootActions(); const entry = entries.find(entry => entry.id === node.id); return entry ? actions(entry) : [] }}
          renderIcon={(node, expanded) => icon(entries.find(entry => entry.id === node.id), expanded)} />
          : <p className={styles.treeHint}>{busy ? '正在加载文件…' : '工作区读取失败，请刷新重试。'}</p>}
        {revision && !tree().length && <p className={styles.treeHint}>{search ? '没有匹配的文件' : '工作区为空，可新建或上传文件。'}</p>}
      </div>}>
      <div className={styles.detail}>
        <header className={styles.fileHeader}>
          <div className={styles.fileIdentity}><Button className={styles.back} size="small" variant="ghost" onClick={() => setMobilePane('explorer')} aria-label="返回文件树"><ArrowLeft size={16} /></Button>
            {icon(selected)}<div><strong>{selected?.name ?? '工作区'}</strong><span>{selected ? `/workspace${directoryPath(selected.parentId)}` : '/workspace'}</span></div>
          </div>
          <div className={styles.actions}>
            {text !== undefined && <><span className={styles.saveState}>{dirty ? '未保存' : <><Check size={12} />已保存</>}</span><Button size="small" disabled={busy || !dirty} onClick={save}><Save size={14} />保存</Button></>}
            {selected && <DropdownMenu><DropdownMenuTrigger asChild><Button size="small" variant="ghost" disabled={busy} aria-label="更多文件操作" title="更多文件操作"><MoreHorizontal size={17} /></Button></DropdownMenuTrigger>
              <DropdownMenuContent>{selected.kind === 'file' && <DropdownMenuItem icon={<Download size={14} />} onSelect={() => void download()}>下载已保存文件</DropdownMenuItem>}
                {actions(selected).map(action => action.type === 'separator' ? null : <DropdownMenuItem key={action.id} icon={action.icon} tone={action.tone} disabled={action.disabled} onSelect={action.onSelect}>{action.label}</DropdownMenuItem>)}
              </DropdownMenuContent></DropdownMenu>}
          </div>
        </header>
        <div className={styles.content}>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {busy && <p role="status" className={styles.hint}>正在处理…</p>}
          {orphanDrafts.map(([key, cached]) => <details key={key} className={styles.recovered}><summary>原文件已移除 · 有一份未保存草稿</summary><textarea aria-label="已移除文件的草稿" readOnly value={cached.text} rows={6} /><Button size="small" onClick={() => {
            if (!window.confirm('永久丢弃这份未保存草稿？')) return
            drafts.delete(key); syncUnloadGuard(drafts); setRevision(value => value ? { ...value } : value)
          }}>丢弃草稿</Button></details>)}
          {selected && text !== undefined ? <>
            {dirty && baseline.revisionId !== revision?.id && <p role="status" className={styles.hint}>工作区已有新版本。草稿仍基于原版本；请复制草稿，刷新后合并。</p>}
            <LongTextEditor key={selected.id} {...(/\.md$/i.test(selected.name) ? { mode: editorMode, onModeChange: setEditorMode, disableCodeWrapLabel: '关闭换行', enableCodeWrapLabel: '自动换行', previewEmptyLabel: '文件为空', previewModeLabel: '预览', sourceModeLabel: '源码' } : { sourceOnly: true as const, mode: 'source' as const })} label="文件内容" value={draft} disabled={busy}
              onChange={editDraft} onCommit={editDraft} clearLabel="清空" clearedLabel="已清空" copiedLabel="已复制" copyFailedLabel="复制失败"
              copyLabel="复制全文" restoreInitialLabel="恢复初始内容" undoEditLabel="撤销编辑" undoLabel="撤销" minHeight={360} />
            <p className={styles.hint}>保存后写入当前 Timeline，随剧情恢复。{selected.name === 'MEMORY.md' ? ' MEMORY.md 用于共同工作记忆。' : ''}</p>
          </> : selected?.kind === 'file' ? <div className={styles.binary}>
            {previewLoading ? <p role="status">正在读取预览…</p> : preview ? <img src={preview} alt={selected.name} /> : <><File size={32} /><p>此文件不支持预览</p><Button size="small" onClick={() => void download()}>下载文件</Button></>}
          </div> : <div className={styles.directory}>
            <div className={styles.directoryHeading}><span>{children.length} 个项目</span><Button size="small" variant="ghost" disabled={busy || !revision} onClick={() => openDialog('file')}><Plus size={14} />新建文件</Button></div>
            {children.map(entry => <button type="button" className={styles.directoryRow} key={entry.id} disabled={busy} onClick={() => select(entry)}>{icon(entry)}<span>{entry.name}</span><ChevronRight size={14} /></button>)}
            {revision && !children.length && <div className={styles.empty}><FolderOpen size={30} /><p>这个目录还是空的</p><span>从左侧“＋”新建文件、目录或上传资源。</span></div>}
          </div>}
        </div>
      </div>
    </AssetWorkbenchLayout>
    <input hidden ref={uploadRef} type="file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />
    <Dialog open={Boolean(dialog)} onClose={() => setDialog(undefined)} dismissible={!busy} closeOnBackdrop title={dialogTitle ?? ''}
      actions={<><Button variant="secondary" disabled={busy} onClick={() => setDialog(undefined)}>取消</Button><Button variant={dialog?.kind === 'delete' ? 'danger' : 'default'} disabled={busy || (dialog?.kind !== 'delete' && !name.trim())} onClick={() => void submitDialog()}>{busy ? '正在处理…' : dialog?.kind === 'delete' ? '删除' : '确定'}</Button></>}>
      {dialog?.kind === 'delete' ? <p>删除“{dialog.entry?.name}”{dialog.entry?.kind === 'directory' ? '及其中的全部文件' : ''}？相关未保存草稿也将被丢弃。</p>
        : <div className={styles.dialogFields}><label>名称<TextInput autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && name.trim()) void submitDialog() }} /></label>
          {(dialog?.kind === 'move' || dialog?.kind === 'copy') ? <label>目标目录<select value={destination} onChange={event => setDestination(event.target.value)}><option value="">/workspace</option>{entries.filter(entry => entry.kind === 'directory' && entry.id !== dialog.entry?.id).map(entry => <option key={entry.id} value={entry.id}>{`/workspace${directoryPath(entry.id)}`}</option>)}</select></label>
            : dialog?.kind === 'file' || dialog?.kind === 'directory' ? <p className={styles.hint}>创建于 /workspace{directoryPath(dialog.parentId)}</p> : null}</div>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </Dialog>
  </section>
}
