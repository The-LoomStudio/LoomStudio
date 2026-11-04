import { useEffect, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './extension-resource-update-dialog.module.scss'

type Preview = Awaited<ReturnType<StudioApi['extensions']['previewPackageResources']>>
export function ExtensionResourceUpdateDialog(props: {
  api: StudioApi['extensions']; t: Translator; title: string; fromVersion: string
  input: Parameters<StudioApi['extensions']['previewPackageResources']>[0]
  onApply(fingerprint: string): Promise<unknown>; onClose(): void
}) {
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setPreview(undefined); setError('')
    void props.api.previewPackageResources(props.input).then(value => { if (active) setPreview(value) })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [props.api, props.input, revision])
  async function apply() {
    if (!preview) return
    setBusy(true); setError('')
    try { await props.onApply(preview.fingerprint); props.onClose() }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); setPreview(undefined) }
    finally { setBusy(false) }
  }
  return <Dialog open title={props.t('renderer.review.title', { name: props.title })} dismissible={!busy} onClose={props.onClose}
    actions={<>
      <Button disabled={busy} onClick={props.onClose}>{props.t('renderer.remote.cancel')}</Button>
      <Button disabled={busy} onClick={() => setRevision(value => value + 1)}>{props.t('renderer.review.reload')}</Button>
      <Button disabled={busy || !preview} onClick={() => void apply()}>{props.t('renderer.review.apply')}</Button>
    </>}>
    <p>{props.fromVersion} → {props.input.packageVersion}</p>
    <p>{props.t('renderer.review.overwrite')}</p>
    {error ? <p role="alert">{error}</p> : !preview ? <p role="status">{props.t('renderer.remote.busy')}</p> : null}
    {preview ? <>
      <p>{props.t('renderer.review.unknown')}</p>
      {preview.warnings.length ? <details><summary>{props.t('renderer.review.limits')}</summary><ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details> : null}
      <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th>{props.t('renderer.review.resource')}</th><th>{props.t('renderer.review.action')}</th><th>{props.t('renderer.review.references')}</th></tr></thead>
        <tbody>{preview.items.map(item => <tr key={`${item.kind}/${item.resourceId ?? item.contributionId}`}>
          <td>{item.name ?? item.contributionId}<small>{item.kind} · {item.contributionId}</small></td>
          <td>{props.t(`renderer.review.${item.action}`)}<small>{props.t(`renderer.review.local.${item.localChanges}`)}</small></td>
          <td>{item.references?.length ? <ul>{item.references.map(reference => <li key={`${reference.kind}/${reference.id}`}>{reference.name ?? reference.id} <small>{reference.kind}</small></li>)}</ul> : '—'}</td>
        </tr>)}</tbody>
      </table></div>
    </> : null}
  </Dialog>
}
