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
import styles from './remote-extension-install.module.scss'

type Preview = Awaited<ReturnType<StudioApi['extensions']['previewRemoteInstall']>>
type Official = Awaited<ReturnType<StudioApi['extensions']['officialSetup']>>
type InstallMethod = 'remote' | 'local' | 'official'

export function RemoteExtensionInstall(props: {
  api: StudioApi['extensions']
  t: Translator
  preview?: Preview
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
  const canPrepare = method === 'local' ? !!file
      : method === 'official' ? !!selected.length && !!officialItems
        : !!url.trim()
  async function prepare() {
    setBusy(true)
    setError('')
    try {
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
  async function install() {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const result = await props.api.commitRemoteInstall(preview.token)
      setPreview(undefined)
      await props.onInstalled()
      if (result.failed) {
        const message = `${result.installed.length} ${t('renderer.remote.completed')} · ${result.failed.packageId}: ${result.failed.message}`
        setError(message)
        notify.failure('扩展安装未完成', message)
      } else {
        notify.success(t('renderer.installed'))
        props.onClose()
      }
    } catch (error) {
      setPreview(undefined)
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      notify.failure('扩展安装未完成', message)
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
      {!preview ? <PanelTabs<InstallMethod> activeId={method}
        ariaLabel={t('renderer.install')} size="compact"
        items={[
          { id: 'remote', label: t('renderer.remote.link'), disabled: busy },
          { id: 'local', label: t('renderer.remote.localZip'), disabled: busy },
          { id: 'official', label: t('renderer.remote.official'), disabled: busy },
        ]}
        onChange={next => { setMethod(next); setError('') }} /> : null}
      {!preview && method === 'remote' ? <div role="tabpanel" aria-label={t('renderer.remote.link')} className={styles.fields}>
        <label>{t('renderer.remote.kind')}<select value={kind} disabled={busy} onChange={event => setKind(event.target.value as 'git' | 'zip')}>
          <option value="git">Git</option><option value="zip">ZIP</option>
        </select></label>
        <label>{t('renderer.remote.url')}<input type="url" value={url} disabled={busy} placeholder="https://" onChange={event => setUrl(event.target.value)} /></label>
        {kind === 'git' ? <label>{t('renderer.remote.ref')}<input value={ref} disabled={busy} onChange={event => setRef(event.target.value)} /></label> : null}
      </div> : null}
      {!preview && method === 'local' ? <div role="tabpanel" aria-label={t('renderer.remote.localZip')} className={styles.fields}>
        <label>{t('renderer.remote.localZip')}<input type="file" accept=".zip,application/zip" disabled={busy}
          onChange={event => setFile(event.target.files?.[0])} /></label>
      </div> : null}
      {!preview && method === 'official' ? <div role="tabpanel" aria-label={t('renderer.remote.official')} className={styles.fields}>
        {officialLoading ? <p role="status">{t('renderer.remote.busy')}</p> : officialItems?.length === 0 ? <p>{t('renderer.remote.officialInstalled')}</p> : null}
        {officialItems?.map(item => <label className={styles.choice} key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} disabled={busy}
            onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />
          <span>{item.name}</span>
        </label>)}
      </div> : null}
      {preview ? <ul className={styles.list}>{preview.packages.map(item => <li key={item.packageId}>
        <strong>{item.displayName} · {item.version}</strong>
        <span>{item.packageId}</span>
        {item.replacing ? <span>{t('renderer.remote.replace')}</span> : null}
        <span className={styles.source}>{item.source?.url ?? 'ZIP'}</span>
        {item.commit ? <code>{item.commit.slice(0, 12)}</code> : null}
      </li>)}</ul> : null}
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
  if (!state || state.completed || !state.items.length) return null
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
  const [preview, setPreview] = useState<Preview>()
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
        setPreview(await props.api.previewRemoteChange({ packageId: selected.packageId, ...(ref.trim() ? { ref: ref.trim() } : {}) })); setOpen(true)
      })}><GitBranch size={16} aria-hidden="true" />{props.t('renderer.remote.update')}</Button>
      <Button disabled={busy || !selected.remote.canRollback} onClick={() => void run(async () => {
        setPreview(await props.api.previewRemoteChange({ packageId: selected.packageId, rollback: true })); setOpen(true)
      })}><Undo2 size={16} aria-hidden="true" />{props.t('renderer.remote.rollback')}</Button>
    {message ? <p role="status">{message}</p> : null}
    {open ? <RemoteExtensionInstall api={props.api} t={props.t} preview={preview} onClose={() => setOpen(false)} onInstalled={props.onInstalled} /> : null}
  </div>
}
