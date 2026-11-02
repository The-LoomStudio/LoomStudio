import { InfoDialog } from '../../shared/ui/info-dialog/info-dialog.js'
import { LogOrigin } from './log-origin.js'
import { useState } from 'react'
import { readLogPresentation, type LogRecord } from '@loom-studio/logging'
import { IconButton } from '@loom-studio/ui'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, CircleAlert, Copy, Filter, Link } from 'lucide-react'
import type { LogReferenceLabel } from '../../features/log-viewer/model/use-log-reference-labels.js'
import { readLogReferences, logReferenceLabelKey } from '../../features/log-viewer/model/log-references.js'
import { logSource } from '../../features/log-viewer/model/log-presentation.js'
import { formatNumber, formatTime, type Translator } from '../../shared/i18n/index.js'
import styles from './log-event-row.module.scss'

export function LogEventRow({ record, t, onFilterRun, onInspect, referenceLabels, referenceError }: {
  referenceLabels?: Map<string, LogReferenceLabel>
  referenceError?: boolean
  record: LogRecord
  t: Translator
  onFilterRun(runId: string): void
  onInspect?(): void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const view = readLogPresentation(record)
  const source = logSource(record)
  const observationId = record.data?.observationRequestId ?? record.data?.measurementId ?? record.data?.runId
  const runId = typeof record.data?.runId === 'string' ? record.data.runId : undefined
  // References and complex payloads remain in the explicit raw view, not the default detail.
  const fields = Object.entries(record.data ?? {}).filter(([key, value]) =>
    !['detail', 'technical'].includes(key) && !/Ids?$/.test(key)
    && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
  )

  async function copyRecord() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(record, null, 2))
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  return <details className={styles.record} data-level={record.level} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className={styles.row} onClick={onInspect}>
      <span className={styles.time}><ChevronRight className={styles.chevron} size={12} /><time dateTime={record.timestamp}>{formatTime(record.timestamp, undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time></span>
      <span className={styles.source} data-source={source} title={record.namespace}>{source}</span>
      <span className={styles.event}>
        {runId && <LogOrigin compact source={referenceLabels?.get(`run:${runId}`)?.source} title={referenceLabels?.get(`run:${runId}`)?.title ?? source} />}
        <span className={styles.eventBody}>
          <span className={styles.message}>{(record.level === 'error' || record.level === 'warn') && <CircleAlert size={14} />}<span>{record.message}</span></span>
          {view.duration && <span className={styles.duration} aria-label={`${t('logs.duration')} ${view.duration}`}>{view.duration}</span>}
          {(view.inputTokens !== undefined || view.outputTokens !== undefined) && <span className={styles.tokens}>
            {view.inputTokens !== undefined && <><ArrowUpRight size={12} aria-label={t('logs.inputTokens')} />{formatNumber(view.inputTokens)}</>}
            {view.outputTokens !== undefined && <><ArrowDownLeft size={12} aria-label={t('logs.outputTokens')} />{formatNumber(view.outputTokens)}</>}
          </span>}
        </span>
      </span>
    </summary>
    {expanded && <div className={styles.detail}>
      {view.detail && <p>{view.detail}</p>}
      <div className={styles.references}><InfoDialog title={t('logs.raw')}><pre>{JSON.stringify(record, null, 2)}</pre></InfoDialog>{readLogReferences(record).map(reference => {
        const label = referenceLabels?.get(logReferenceLabelKey(reference.uri) ?? '')
        const unavailable = reference.type !== 'run' && (label?.state === 'deleted' || label?.state === 'unavailable')
        return <button type="button" key={reference.uri} disabled={unavailable} title={t('observation.currentName')} onClick={() => window.dispatchEvent(new CustomEvent('loom:open-reference', { detail: { uri: reference.uri } }))}>
          <Link size={12} />{t(`logs.ref.${reference.type}`)}{label ? ` · ${label.state === 'available' ? label.title || t('observation.unnamed') : t(label.state === 'deleted' ? 'observation.resourceDeleted' : 'observation.recordUnavailable')}` : reference.type !== 'source' && reference.type !== 'extension' ? ` · ${t(referenceError ? 'observation.readError' : 'observation.loading')}` : ''}
        </button>
      })}</div>
      <dl>
        <div><dt>{t('logs.level')}</dt><dd>{record.level.toUpperCase()}</dd></div>
        <div><dt>{t('logs.source')}</dt><dd>{record.service} / {record.namespace}</dd></div>
        {record.event && <div><dt>{t('logs.event')}</dt><dd>{record.event}</dd></div>}
        {fields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
      </dl>
      <div className={styles.detailActions}>
        {typeof observationId === 'string' && <button type="button" className={styles.command} onClick={() => window.dispatchEvent(new CustomEvent('loom:open-observation', { detail: { id: observationId } }))}><Link size={13} />{t('observation.title')}</button>}
        {runId && <button type="button" className={styles.command} onClick={() => onFilterRun(runId)}><Filter size={13} />{t('logs.filterRun')}</button>}
        <IconButton size="small" aria-label={copied ? t('logs.copied') : t('logs.copy')} onClick={() => void copyRecord()}>{copied ? <Check size={13} /> : <Copy size={13} />}</IconButton>
        {copied && <span role="status">{t('logs.copied')}</span>}
      </div>
      {copyError && <p role="alert">{t('logs.copyError')}</p>}

    </div>}
  </details>
}
