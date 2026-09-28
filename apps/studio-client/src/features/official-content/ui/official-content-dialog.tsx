import { Dialog } from '@loom-studio/ui'
import { Download, PackagePlus, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { OfficialContentPackage } from '../../../entities/official-content.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { downloadBase64 } from '../../../shared/browser/download.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './official-content-dialog.module.scss'

export function OfficialContentDialog(props: {
  api: StudioApi['officialContent']
  onInstalled(): Promise<void>
  onClose(): void
  t: Translator
}) {
  const [packages, setPackages] = useState<OfficialContentPackage[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const active = useRef(false)
  const pending = useRef(true)

  useEffect(() => {
    active.current = true
    let current = true
    void props.api.list().then(result => {
      if (current) setPackages(result.packages)
    }, caught => {
      if (current) setError(caught instanceof Error ? caught.message : String(caught))
    }).finally(() => {
      if (current) { pending.current = false; setBusy(false) }
    })
    return () => { current = false; active.current = false }
  }, [props.api])

  async function run(operation: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(undefined)
    try {
      await operation()
    } catch (caught) {
      if (active.current) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      pending.current = false
      if (active.current) setBusy(false)
    }
  }

  async function reload() {
    const result = await props.api.list()
    if (active.current) setPackages(result.packages)
  }

  function install(content: OfficialContentPackage) {
    if (pending.current || !window.confirm(props.t('official.installConfirm'))) return
    void run(async () => {
      const result = await props.api.install({ packageId: content.id, digest: content.digest })
      if (!active.current) return
      await reload()
      if (!active.current) return
      await props.onInstalled()
      if (active.current) toast.success(props.t(result.resources.some(resource => resource.created) ? 'official.installed' : 'official.unchanged'))
    })
  }

  function exportContent(content: OfficialContentPackage) {
    void run(async () => {
      const result = await props.api.export({ packageId: content.id, digest: content.digest })
      if (active.current) downloadBase64(result.base64, result.fileName, 'application/zip')
    })
  }

  return (
    <Dialog open title={props.t('official.builtin')} onClose={props.onClose}>
      <div className={styles.content} aria-busy={busy}>
        <div className={styles.toolbar}>
          <button aria-label={props.t('official.refresh')} title={props.t('official.refresh')} disabled={busy} type="button" onClick={() => void run(reload)}>
            <RefreshCw aria-hidden="true" size={16} />
          </button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
        {packages.length === 0 ? <p role="status">{props.t(busy ? 'official.loading' : 'official.empty')}</p> : null}
        {packages.map(content => {
          const complete = content.resources.every(resource => resource.available)
          return (
            <article key={content.id} className={styles.package}>
              <header>
                <div><h3>{content.name}</h3><small>{content.id}</small></div>
                <div className={styles.actions}>
                  <button aria-label={props.t('official.export')} title={props.t('official.export')} disabled={busy} type="button" onClick={() => exportContent(content)}>
                    <Download aria-hidden="true" size={16} />
                  </button>
                  <button disabled={busy || complete} type="button" onClick={() => install(content)}>
                    <PackagePlus aria-hidden="true" size={16} /><span>{props.t(complete ? 'official.available' : 'official.install')}</span>
                  </button>
                </div>
              </header>
              <dl>
                {content.resources.map(resource => (
                  <div key={resource.id}>
                    <dt>{resource.name}</dt>
                    <dd>{resource.resourceKind} · {props.t(resource.available ? 'official.available' : 'official.notInstalled')}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )
        })}
      </div>
    </Dialog>
  )
}
