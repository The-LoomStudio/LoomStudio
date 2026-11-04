import { Button } from '@loom-studio/ui'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './extension-recovery-panel.module.scss'

type Recovery = Awaited<ReturnType<StudioApi['extensions']['listRecoveryRecords']>>['records'][number]
type InstallResult = Awaited<ReturnType<StudioApi['extensions']['commitRemoteInstall']>>

const stageKeys = {
  'prepare': 'renderer.flow.stage.prepare',
  'save-recovery': 'renderer.flow.stage.save-recovery',
  'disable-old-modules': 'renderer.flow.stage.disable-old-modules',
  'dispose-old-modules': 'renderer.flow.stage.dispose-old-modules',
  'backup-old-code': 'renderer.flow.stage.backup-old-code',
  'replace-code': 'renderer.flow.stage.replace-code',
  'save-history': 'renderer.flow.stage.save-history',
  'forget-removed-modules': 'renderer.flow.stage.forget-removed-modules',
  'restore-module-state': 'renderer.flow.stage.restore-module-state',
  'activate-modules': 'renderer.flow.stage.activate-modules',
  'remove-recovery-record': 'renderer.flow.stage.remove-recovery-record',
  'import-resources': 'renderer.flow.stage.resource-import',
} as const

function stageLabel(stage: string | undefined, t: Translator) {
  if (!stage) return t('renderer.flow.unknown')
  return Object.hasOwn(stageKeys, stage) ? t(stageKeys[stage as keyof typeof stageKeys]) : stage
}

function RecoveryPaths({ record, t }: { record: Pick<Recovery, 'recordPath' | 'backupDirectory' | 'historyDirectory' | 'destination'>; t: Translator }) {
  return <dl className={styles.paths}>
    <dt>{t('renderer.flow.recordPath')}</dt><dd>{record.recordPath}</dd>
    {record.backupDirectory && <><dt>{t('renderer.flow.backupPath')}</dt><dd>{record.backupDirectory}</dd></>}
    {record.historyDirectory && <><dt>{t('renderer.flow.historyPath')}</dt><dd>{record.historyDirectory}</dd></>}
    {record.destination && <><dt>{t('renderer.flow.destination')}</dt><dd>{record.destination}</dd></>}
  </dl>
}

export function InstallResultDetails({ result, t }: { result: InstallResult; t: Translator }) {
  return <section className={styles.panel} aria-label={t('renderer.flow.installResult')}>
    <strong>{t('renderer.flow.installResult')}</strong>
    {result.installed.length > 0 && <ul>{result.installed.map(item => <li key={item.packageId}>{item.packageId} · {item.version}</li>)}</ul>}
    {result.failed && <div role="alert" className={styles.record}>
      <strong>{result.failed.packageId}</strong><p>{result.failed.message}</p>
      <p>{t('renderer.flow.stage')}: {stageLabel(result.failed.stage, t)}</p>
      <p>{t(result.failed.codeCommitted === true ? 'renderer.flow.codeCommitted' : result.failed.codeCommitted === false ? 'renderer.flow.codeNotCommitted' : 'renderer.flow.commitUnknown')}</p>
      {result.failed.recovery && <><RecoveryPaths record={result.failed.recovery} t={t} /><p>{t('renderer.flow.manualGuide')}</p></>}
    </div>}
  </section>
}

export function RecoveryPanel({ api, t, revision }: { api: StudioApi['extensions']; t: Translator; revision?: unknown }) {
  const [records, setRecords] = useState<Recovery[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void api.listRecoveryRecords().then(result => { if (active) setRecords(result.records) })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, revision, refresh])
  if (!loading && !error && !records.length) return null
  return <section className={styles.panel} aria-label={t('renderer.flow.recoveryTitle')} aria-busy={loading}>
    <div className={styles.heading}><strong>{t('renderer.flow.recoveryTitle')}</strong>
      <Button disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />{t('renderer.flow.refresh')}</Button>
    </div>
    {loading && <p role="status">{t('renderer.flow.loading')}</p>}
    {error && <p role="alert">{t('renderer.flow.loadFailed')}: {error}</p>}
    {records.length > 0 && <><p>{t('renderer.flow.manualGuide')}</p><ul className={styles.records}>{records.map(record => <li key={record.id} className={styles.record}>
      <strong>{record.packageId ?? t('renderer.flow.unknownPackage')}</strong>
      {!record.valid && <p role="alert">{t('renderer.flow.invalidRecord')}</p>}
      <p>{t('renderer.flow.versions')}: {record.fromVersion ?? t('renderer.flow.unknown')} → {record.toVersion ?? t('renderer.flow.unknown')}</p>
      <p>{t('renderer.flow.stage')}: {stageLabel(record.stage, t)}</p>
      {record.message && <p>{record.message}</p>}
      <RecoveryPaths record={record} t={t} />
    </li>)}</ul></>}
  </section>
}
