import { Button, Dialog } from '@loom-studio/ui'
import { Download, GitBranch, Loader2, RefreshCw, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { notify } from '../../../shared/notifications/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ManagedExtensionPackage } from '../../../entities/extension.js'
import type { ExtensionDownloadSource } from '@loom-studio/extension-sdk'
import type { ResourceCandidate } from '../../../../../studio-server/src/resource-downloads/types.js'
import { encodeBase64 } from '../../../shared/browser/download.js'
import { PanelTabs } from '../../../shared/ui/panel-tabs/panel-tabs.js'
import { InstallResultDetails } from './extension-recovery-panel.js'
import styles from './remote-extension-install.module.scss'

type Preview = Awaited<ReturnType<StudioApi['extensions']['previewRemoteInstall']>>
type Official = Awaited<ReturnType<StudioApi['extensions']['officialSetup']>>
type InstallMethod = 'remote' | 'local' | 'official'

export function RemoteExtensionInstall(props: {
  api: StudioApi['extensions']
  downloadsApi?: StudioApi['resourceDownloads']
  t: Translator
  preview?: Preview
  onReprepare?(): Promise<Preview>
  initialMethod?: InstallMethod
  officialItems?: Official['items']
  firstSetup?: boolean
  onClose(): void
  onInstalled(): Promise<unknown>
}) {
  const [kind, setKind] = useState<'git' | 'zip'>('git')
  const [method, setMethod] = useState<InstallMethod>(props.initialMethod ?? 'remote')
  const [file, setFile] = useState<File>()
  const [official, setOfficial] = useState<Official['items']>()
  const [officialLoading, setOfficialLoading] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [url, setUrl] = useState('')
  const [ref, setRef] = useState('')
  const [candidates, setCandidates] = useState<ResourceCandidate[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('')
  const [resolving, setResolving] = useState(false)
  const [stagedTask, setStagedTask] = useState<{ taskId: string; token: string }>()
  const [downloadStatus, setDownloadStatus] = useState('')
  const [preview, setPreview] = useState(props.preview)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<StudioApi['extensions']['commitRemoteInstall']>>>()
  const [refreshError, setRefreshError] = useState('')
  const t = props.t
  const officialItems = props.officialItems ?? official
  useEffect(() => {
    if (method !== 'official' || props.officialItems) return
    let active = true
    setOfficialLoading(true)
    void props.api.officialSetup().then(result => {
      if (active) setOfficial(result.items)
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (active) setOfficialLoading(false)
    })
    return () => { active = false }
  }, [method, props.api, props.officialItems])

  async function handleResolveCandidates() {
    if (!props.downloadsApi || !url.trim()) return
    setResolving(true)
    setError('')
    try {
      const res = await props.downloadsApi.resolve({ url: url.trim(), kind: 'extension', ref: ref.trim() || undefined })
      setCandidates(res.candidates)
      const recommended = res.candidates.find(c => c.recommended) ?? res.candidates[0]
      if (recommended) setSelectedCandidateId(recommended.id)
      if (!res.candidates.length) {
        setError(t('renderer.remote.noReleaseCandidate'))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setResolving(false)
    }
  }

  const canPrepare = props.onReprepare ? true : method === 'local' ? !!file
      : method === 'official' ? !!selected.length && !!officialItems
        : !!url.trim()

  async function prepare() {
    setResult(undefined)
    setRefreshError('')
    setBusy(true)
    setError('')
    setDownloadStatus('')
    try {
      if (props.onReprepare) {
        setPreview(await props.onReprepare())
        return
      }
      if (method === 'local') {
        if (!file) return
        setPreview(await props.api.previewPackageZip(encodeBase64(new Uint8Array(await file.arrayBuffer()))))
        return
      }
      if (method === 'remote' && props.downloadsApi && selectedCandidateId) {
        setDownloadStatus(t('renderer.remote.startingDownload'))
        const task = await props.downloadsApi.start({ candidateId: selectedCandidateId })
        let current = task
        while (current.status === 'queued' || current.status === 'downloading') {
          setDownloadStatus(current.status === 'queued' ? t('renderer.remote.queuedDownload') : t('renderer.remote.downloading', { size: current.receivedBytes ? `${(current.receivedBytes / 1024 / 1024).toFixed(1)} MB` : '' }))
          await new Promise(r => setTimeout(r, 800))
          const list = await props.downloadsApi.list()
          const match = list.find(t => t.id === task.id)
          if (match) current = match
          if (match?.status === 'failed' || match?.status === 'cancelled') {
            throw new Error(match.error || t('renderer.remote.downloadFailed'))
          }
        }
        if (current.status === 'ready') {
          setDownloadStatus(t('renderer.remote.preparingPreview'))
          const previewRes = await props.downloadsApi.previewUse(current.id)
          setStagedTask({ taskId: current.id, token: previewRes.token })
          setPreview({
            token: previewRes.token,
            packages: previewRes.packages.map(p => ({
              packageId: p.packageId,
              displayName: p.displayName,
              version: p.version,
              installedBytes: p.installedBytes,
              replacing: p.replacing,
              source: p.source,
              commit: p.commit,
              description: p.description,
            })),
          } as Preview)
        }
        return
      }
      const sources: ExtensionDownloadSource[] = method === 'official'
        ? officialItems!.filter(item => selected.includes(item.id)).map(item => item.source)
        : [kind === 'git'
        ? { kind, url, ...(ref.trim() ? { ref: ref.trim() } : {}) }
        : { kind, url }]
      setPreview(await props.api.previewRemoteInstall(sources))
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false); setDownloadStatus('') }
  }
  async function refreshInstalled() {
    setRefreshError('')
    try { await props.onInstalled(); return true }
    catch (error) { setRefreshError(error instanceof Error ? error.message : String(error)); return false }
  }
  async function install() {
    if (!preview) return
    setBusy(true)
    setError('')
    setRefreshError('')
    try {
      if (stagedTask && props.downloadsApi) {
        const res = await props.downloadsApi.commitUse(stagedTask.taskId, stagedTask.token)
        setResult(undefined)
        setPreview(undefined)
        setStagedTask(undefined)
        const refreshed = await refreshInstalled()
        notify.success(res.message || t('renderer.installed'))
        if (refreshed) props.onClose()
        return
      }
      const committed = await props.api.commitRemoteInstall(preview.token)
      setResult(committed)
      setPreview(undefined)
      const refreshed = await refreshInstalled()
      if (committed.failed) {
        notify.failure(t('renderer.flow.installIncomplete'), committed.failed.message)
      } else {
        notify.success(t('renderer.installed'))
        if (refreshed) props.onClose()
      }
    } catch (error) {
      setPreview(undefined)
      setStagedTask(undefined)
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      notify.failure(t('renderer.flow.installIncomplete'), message)
    } finally { setBusy(false) }
  }
  return <Dialog open title={t('renderer.install')} dismissible={!busy} onClose={props.onClose}
    actions={<>
      <Button disabled={busy} onClick={props.onClose}>{t(props.firstSetup ? 'renderer.remote.skip' : 'renderer.remote.cancel')}</Button>
      {!props.preview && preview ? <Button disabled={busy} onClick={() => { setPreview(undefined); setError('') }}>{t('renderer.back')}</Button> : null}
      <Button disabled={busy || (!preview && (!canPrepare || (method === 'official' && officialLoading)))} onClick={() => void (preview ? install() : prepare())}>
        <Download size={16} aria-hidden="true" />{busy ? t('renderer.remote.busy') : preview ? t('renderer.remote.confirm') : t('renderer.remote.prepare')}
      </Button>
    </>}>
    <div className={styles.body}>
      {!preview && !props.onReprepare ? <PanelTabs<InstallMethod> activeId={method}
        ariaLabel={t('renderer.install')} size="compact"
        items={[
          { id: 'remote', label: t('renderer.remote.link'), disabled: busy },
          { id: 'local', label: t('renderer.remote.localZip'), disabled: busy },
          { id: 'official', label: t('renderer.remote.official'), disabled: busy },
        ]}
        onChange={next => { setMethod(next); setError('') }} /> : null}
      {!preview && !props.onReprepare && method === 'remote' ? <div role="tabpanel" aria-label={t('renderer.remote.link')} className={styles.fields}>
        <label>{t('renderer.remote.kind')}<select value={kind} disabled={busy || resolving} onChange={event => setKind(event.target.value as 'git' | 'zip')}>
          <option value="git">{t('renderer.remote.sourceGit')}</option><option value="zip">{t('renderer.remote.sourceZip')}</option>
        </select></label>
        <div className={styles.urlRow}>
          <label>{t('renderer.remote.url')}
            <input type="url" value={url} disabled={busy || resolving} placeholder={t('renderer.remote.urlPlaceholder')} onChange={event => setUrl(event.target.value)} />
          </label>
          {props.downloadsApi ? <Button variant="secondary" disabled={busy || resolving || !url.trim()} onClick={() => void handleResolveCandidates()}>
            {resolving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            <span>{resolving ? t('renderer.remote.resolving') : t('renderer.remote.detectVersions')}</span>
          </Button> : null}
        </div>
        {kind === 'git' ? <label>{t('renderer.remote.ref')}<input value={ref} disabled={busy || resolving} placeholder={t('renderer.remote.refPlaceholder')} onChange={event => setRef(event.target.value)} /></label> : null}
        {candidates.length > 0 && <div className={styles.candidatesList} role="radiogroup" aria-label={t('renderer.remote.candidatesAria')}>
          <p><strong>{t('renderer.remote.candidatesFound', { count: candidates.length })}</strong></p>
          {candidates.map(candidate => (
            <label key={candidate.id} className={styles.candidateCard} data-selected={selectedCandidateId === candidate.id ? 'true' : undefined}>
              <input type="radio" name="extension-candidate" checked={selectedCandidateId === candidate.id} onChange={() => setSelectedCandidateId(candidate.id)} disabled={busy} />
              <div className={styles.candidateContent}>
                <div className={styles.candidateHeader}>
                  <span className={styles.candidateTitle}>{candidate.name || candidate.packageId || t('renderer.remote.packageFallbackName')}</span>
                  {candidate.version && <span className={styles.candidateVersion}>v{candidate.version}</span>}
                  {candidate.recommended && <span className={`${styles.candidateBadge} ${styles.recommended}`}>{t('renderer.remote.recommended')}</span>}
                  {candidate.prerelease && <span className={`${styles.candidateBadge} ${styles.prerelease}`}>{t('renderer.remote.prerelease')}</span>}
                </div>
                {candidate.description && <p className={styles.candidateDesc}>{candidate.description}</p>}
              </div>
            </label>
          ))}
        </div>}
        {downloadStatus && <div className={styles.downloadStatus}><Loader2 size={16} className="animate-spin" aria-hidden="true" /><span>{downloadStatus}</span></div>}
      </div> : null}
      {!preview && !props.onReprepare && method === 'local' ? <div role="tabpanel" aria-label={t('renderer.remote.localZip')} className={styles.fields}>
        <label>{t('renderer.remote.localZip')}<input type="file" accept=".zip,application/zip" disabled={busy}
          onChange={event => setFile(event.target.files?.[0])} /></label>
      </div> : null}
      {!preview && !props.onReprepare && method === 'official' ? <div role="tabpanel" aria-label={t('renderer.remote.official')} className={styles.fields}>
        <p>{t('renderer.remote.officialNote')}</p>
        {officialLoading ? <p role="status">{t('renderer.remote.busy')}</p> : officialItems?.length === 0 ? <p>{t('renderer.remote.officialInstalled')}</p> : null}
        {officialItems?.map(item => <label className={styles.choice} key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || !!item.installedVersion}
            onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />
          <span><strong>{item.name}</strong><br />
            {item.description && <><span>{item.description}</span><br /></>}
            <small>{item.installedVersion ? t('renderer.remote.installedVersion', { version: item.installedVersion }) : t('renderer.remote.notInstalledGit')}</small>
            {item.metadataError && <small role="status"> · {item.metadataError}</small>}
          </span>
        </label>)}
      </div> : null}
      {preview && preview.packages.every(item => item.installedBytes !== undefined) && <p>{t('renderer.remote.totalPackageSize', { size: (preview.packages.reduce((sum, item) => sum + (item.installedBytes ?? 0), 0) / 1024 / 1024).toFixed(1) })}</p>}
      {preview ? <ul className={styles.list}>{preview.packages.map(item => <li key={item.packageId}>
        <strong>{item.displayName} · {item.version}</strong>
        <span>{item.packageId}</span>
        {item.description && <span>{item.description}</span>}
        {item.installedBytes !== undefined && <span>{t('renderer.remote.packageSize', { size: (item.installedBytes / 1024 / 1024).toFixed(1) })}</span>}
        {item.replacing ? <span>{t('renderer.remote.replace')}</span> : null}
        <span className={styles.source}>{item.source?.url ?? 'ZIP'}</span>
        {item.commit ? <code>{item.commit.slice(0, 12)}</code> : null}
      </li>)}</ul> : null}
      {result && <InstallResultDetails result={result} t={t} />}
      {refreshError && <div role="alert"><p>{t('renderer.flow.refreshFailed')}: {refreshError}</p>
        <Button disabled={busy} onClick={() => { setBusy(true); void refreshInstalled().finally(() => setBusy(false)) }}>{t('renderer.flow.refresh')}</Button>
      </div>}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </Dialog>
}

export function OfficialExtensionPicker(props: {
  api: StudioApi['extensions']; t: Translator; items: Official['items']
  onClose(): void; onInstalled(): Promise<unknown>
}) {
  return <RemoteExtensionInstall api={props.api} t={props.t} initialMethod="official" officialItems={props.items}
    firstSetup onClose={props.onClose} onInstalled={props.onInstalled} />
}

export function OfficialExtensionSetup(props: { api: StudioApi['extensions']; ready: boolean; t: Translator; onInstalled(): Promise<unknown> }) {
  const [state, setState] = useState<Official>()
  useEffect(() => {
    if (!props.ready) return
    let active = true
    setState(undefined)
    void props.api.officialSetup().then(result => { if (active) setState(result) })
      .catch(error => { if (active) notify.failure(props.t('renderer.remote.loadOfficialFailed'), error) })
    return () => { active = false }
  }, [props.api, props.ready, props.t])
  if (!state || state.completed || !state.items.some(item => !item.installedVersion)) return null
  async function close() {
    try { await props.api.finishOfficialSetup(); setState(undefined) }
    catch (error) { notify.failure(props.t('renderer.remote.loadOfficialFailed'), error) }
  }
  return <>
    <OfficialExtensionPicker api={props.api} t={props.t} items={state.items} onClose={() => void close()} onInstalled={props.onInstalled} />
  </>
}

export function ExtensionRemoteControls(props: { api: StudioApi['extensions']; t: Translator; selected?: ManagedExtensionPackage; onInstalled(): Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const [prepared, setPrepared] = useState<{ preview: Preview; input: Parameters<StudioApi['extensions']['previewRemoteChange']>[0] }>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [ref, setRef] = useState('')
  async function run(operation: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await operation() }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const selected = props.selected
  if (selected?.remote?.source.kind !== 'git') return null
  return <div className={styles.controls}>
      <Button disabled={busy} onClick={() => void run(async () => {
        const result = await props.api.checkRemoteUpdate(selected.packageId)
        setMessage(props.t(result.locked ? 'renderer.remote.locked' : result.changed ? 'renderer.remote.available' : 'renderer.remote.latest'))
      })}><RefreshCw size={16} aria-hidden="true" />{props.t('renderer.remote.check')}</Button>
      <label className={styles.branch}>{props.t('renderer.remote.ref')}<input value={ref} disabled={busy} placeholder={selected.remote.source.ref} onChange={event => setRef(event.target.value)} /></label>
      <Button disabled={busy} onClick={() => void run(async () => {
        const input = { packageId: selected.packageId, ...(ref.trim() ? { ref: ref.trim() } : {}) }
        setPrepared({ input, preview: await props.api.previewRemoteChange(input) }); setOpen(true)
      })}><GitBranch size={16} aria-hidden="true" />{props.t('renderer.remote.update')}</Button>
      <Button disabled={busy || !selected.remote.canRollback} onClick={() => void run(async () => {
        const input = { packageId: selected.packageId, rollback: true }
        setPrepared({ input, preview: await props.api.previewRemoteChange(input) }); setOpen(true)
      })}><Undo2 size={16} aria-hidden="true" />{props.t('renderer.remote.rollback')}</Button>
    {message ? <p role="status">{message}</p> : null}
    {open && prepared ? <RemoteExtensionInstall api={props.api} t={props.t} preview={prepared.preview} onReprepare={() => props.api.previewRemoteChange(prepared.input)} onClose={() => setOpen(false)} onInstalled={props.onInstalled} /> : null}
  </div>
}
