import { Button, Dialog } from '@loom-studio/ui'
import { Download, GitBranch, RefreshCw, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { notify } from '../../../shared/notifications/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ManagedExtensionPackage } from '../../../entities/extension.js'
import type { ExtensionDownloadSource } from '@loom-studio/extension-sdk'
import { encodeBase64 } from '../../../shared/browser/download.js'
import { PanelTabs } from '../../../shared/ui/panel-tabs/panel-tabs.js'
import { InstallResultDetails } from './extension-recovery-panel.js'
import styles from './remote-extension-install.module.scss'

type Preview = Awaited<ReturnType<StudioApi['extensions']['previewRemoteInstall']>>
type Official = Awaited<ReturnType<StudioApi['extensions']['officialSetup']>>
type InstallMethod = 'remote' | 'local' | 'official'

export function RemoteExtensionInstall(props: {
  api: StudioApi['extensions']
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
  const canPrepare = props.onReprepare ? true : method === 'local' ? !!file
      : method === 'official' ? !!selected.length && !!officialItems
        : !!url.trim()
  async function prepare() {
    setResult(undefined)
    setRefreshError('')
    setBusy(true)
    setError('')
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
      const sources: ExtensionDownloadSource[] = method === 'official'
        ? officialItems!.filter(item => selected.includes(item.id)).map(item => item.source)
        : [kind === 'git'
        ? { kind, url, ...(ref.trim() ? { ref: ref.trim() } : {}) }
        : { kind, url }]
      setPreview(await props.api.previewRemoteInstall(sources))
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
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
        <label>{t('renderer.remote.kind')}<select value={kind} disabled={busy} onChange={event => setKind(event.target.value as 'git' | 'zip')}>
          <option value="git">Git</option><option value="zip">ZIP</option>
        </select></label>
        <label>{t('renderer.remote.url')}<input type="url" value={url} disabled={busy} placeholder="https://" onChange={event => setUrl(event.target.value)} /></label>
        {kind === 'git' ? <label>{t('renderer.remote.ref')}<input value={ref} disabled={busy} onChange={event => setRef(event.target.value)} /></label> : null}
      </div> : null}
      {!preview && !props.onReprepare && method === 'local' ? <div role="tabpanel" aria-label={t('renderer.remote.localZip')} className={styles.fields}>
        <label>{t('renderer.remote.localZip')}<input type="file" accept=".zip,application/zip" disabled={busy}
          onChange={event => setFile(event.target.files?.[0])} /></label>
      </div> : null}
      {!preview && !props.onReprepare && method === 'official' ? <div role="tabpanel" aria-label={t('renderer.remote.official')} className={styles.fields}>
        <p>获取安装清单会下载所选扩展及缺失依赖；Git 下载大小暂无法预知，下载后显示包内容大小。</p>
        {officialLoading ? <p role="status">{t('renderer.remote.busy')}</p> : officialItems?.length === 0 ? <p>{t('renderer.remote.officialInstalled')}</p> : null}
        {officialItems?.map(item => <label className={styles.choice} key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || !!item.installedVersion}
            onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />
          <span><strong>{item.name}</strong><br />
            {item.description && <><span>{item.description}</span><br /></>}
            <small>{item.installedVersion ? `已安装 · ${item.installedVersion}` : '未安装 · 下载大小未知（Git 传输）'}</small>
            {item.metadataError && <small role="status"> · {item.metadataError}</small>}
          </span>
        </label>)}
      </div> : null}
      {preview && preview.packages.every(item => item.installedBytes !== undefined) && <p>所选包及依赖合计：{(preview.packages.reduce((sum, item) => sum + (item.installedBytes ?? 0), 0) / 1024 / 1024).toFixed(1)} MiB（包内容）</p>}
      {preview ? <ul className={styles.list}>{preview.packages.map(item => <li key={item.packageId}>
        <strong>{item.displayName} · {item.version}</strong>
        <span>{item.packageId}</span>
        {item.description && <span>{item.description}</span>}
        {item.installedBytes !== undefined && <span>包内容大小：{(item.installedBytes / 1024 / 1024).toFixed(1)} MiB（不含 Git 历史）</span>}
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
      .catch(error => { if (active) notify.failure('读取扩展安装信息失败', error) })
    return () => { active = false }
  }, [props.api, props.ready])
  if (!state || state.completed || !state.items.some(item => !item.installedVersion)) return null
  async function close() {
    try { await props.api.finishOfficialSetup(); setState(undefined) }
    catch (error) { notify.failure('读取扩展安装信息失败', error) }
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
