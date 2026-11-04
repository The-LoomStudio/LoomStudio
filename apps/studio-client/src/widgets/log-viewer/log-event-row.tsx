import { ExtensionIcon } from '../../shared/ui/extension-icon/extension-icon.js'
import { LogOrigin } from './log-origin.js'
import { useId, useState, type ReactNode } from 'react'
import { readLogPresentation, type LogRecord } from '@loom-studio/logging'
import { Dialog, IconButton } from '@loom-studio/ui'
import { ArrowDownLeft, ArrowUpRight, Check, CircleAlert, Copy, Filter, Info, Link } from 'lucide-react'
import type { LogReferenceLabel } from '../../features/log-viewer/model/use-log-reference-labels.js'
import { readLogReferences, logReferenceLabelKey } from '../../features/log-viewer/model/log-references.js'
import { logSource } from '../../features/log-viewer/model/log-presentation.js'
import { formatNumber, formatTime, type Translator } from '../../shared/i18n/index.js'
import styles from './log-event-row.module.scss'

export function LogEventRow({ record, striped, t, onFilterRun, onInspect, referenceLabels, referenceError }: {
  striped?: boolean
  referenceLabels?: Map<string, LogReferenceLabel>
  referenceError?: boolean
  record: LogRecord
  t: Translator
  onFilterRun(runId: string): void
  onInspect?(): void
}) {
  const detailId = useId()
  function toggleDetail() { onInspect?.(); setExpanded(value => !value) }
  const [rawOpen, setRawOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const view = readLogPresentation(record)
  const source = logSource(record)
  const references = readLogReferences(record)
  const origin = references.find(reference => reference.type === 'extension') ?? references.find(reference => reference.type === 'provider')
  const originLabel = origin ? referenceLabels?.get(logReferenceLabelKey(origin.uri) ?? '') : undefined
  const originName = originLabel?.state === 'available' ? originLabel.title : record.extension?.packageId
  const originUnavailable = originLabel?.state === 'deleted' || originLabel?.state === 'unavailable'
  const outcome = record.data?.outcome
  const outcomeLabel = outcome === 'completed' ? t('observation.completed') : outcome === 'failed' ? t('observation.failed') : outcome === 'running' ? t('observation.running') : outcome === 'aborted' ? t('observation.aborted') : undefined
  const observationId = record.data?.observationRequestId ?? record.data?.measurementId ?? record.data?.runId
  const runId = typeof record.data?.runId === 'string' ? record.data.runId : undefined
  // References and complex payloads remain in the explicit raw view, not the default detail.
  const fields = Object.entries(record.data ?? {}).filter(([key, value]) =>
    !['detail', 'technical', ...(outcomeLabel ? ['outcome'] : [])].includes(key) && !/Ids?$/.test(key)
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

  return <><div className={styles.record} data-level={record.level} data-expanded={expanded} data-striped={striped}>
    <div className={styles.row} data-log-row="" onClick={toggleDetail}>
      <button type="button" className={styles.time} aria-label={record.message} aria-expanded={expanded} aria-controls={detailId} onClick={event => { event.stopPropagation(); toggleDetail() }}><time dateTime={record.timestamp}>{formatTime(record.timestamp, undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time></button>
      <span className={styles.level}>{record.level.toUpperCase()}</span>
      <span className={styles.source} data-source={source}>
        {origin && originName ? <button type="button" className={styles.sourceLink} disabled={originUnavailable} title={originName} onClick={event => { event.preventDefault(); event.stopPropagation(); onInspect?.(); window.dispatchEvent(new CustomEvent('loom:open-reference', { detail: { uri: origin.uri } })) }}>{record.extension && <ExtensionIcon packageId={record.extension.packageId} size={18} />}<span>{source} · {originName}</span></button> : <span className={styles.sourceName}>{source}</span>}
        <small title={`${record.service} / ${record.namespace}`}>{record.service} / {record.namespace}</small>
      </span>
      <span className={styles.event}>
        {runId && <LogOrigin compact source={referenceLabels?.get(`run:${runId}`)?.source} title={referenceLabels?.get(`run:${runId}`)?.title ?? source} />}
        <span className={styles.eventBody}>
          <span className={styles.message}>{(record.level === 'error' || record.level === 'warn') && <CircleAlert size={14} />}<span>{record.message}</span></span>

        </span>
      </span>      <span className={styles.metrics}>
        {outcomeLabel && <span className={styles.outcome} data-outcome={String(outcome)}>{outcomeLabel}</span>}
          {view.duration && <span className={styles.duration} aria-label={`${t('logs.duration')} ${view.duration}`}>{view.duration}</span>}
          {(view.inputTokens !== undefined || view.outputTokens !== undefined) && <span className={styles.tokens}>
            {view.inputTokens !== undefined && <><ArrowUpRight size={12} aria-label={t('logs.inputTokens')} />{formatNumber(view.inputTokens)}</>}
            {view.outputTokens !== undefined && <><ArrowDownLeft size={12} aria-label={t('logs.outputTokens')} />{formatNumber(view.outputTokens)}</>}
          </span>}
      </span>
      <span className={styles.rowActions}>
        <IconButton size="small" title={t('logs.raw')} aria-label={t('logs.raw')} aria-haspopup="dialog" onClick={event => { event.preventDefault(); event.stopPropagation(); onInspect?.(); setRawOpen(true) }}><Info size={16} /></IconButton>
        <IconButton size="small" title={copied ? t('logs.copied') : t('logs.copy')} aria-label={copied ? t('logs.copied') : t('logs.copy')} onClick={event => { event.preventDefault(); event.stopPropagation(); onInspect?.(); void copyRecord() }}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
      </span>
    </div>
    {expanded && <div id={detailId} className={styles.detail}>
      {view.detail && <p>{view.detail}</p>}
      <div className={styles.references}>{references.filter(reference => reference !== origin || !originName).map(reference => {
        const label = referenceLabels?.get(logReferenceLabelKey(reference.uri) ?? '')
        const unavailable = reference.type !== 'run' && (label?.state === 'deleted' || label?.state === 'unavailable')
        return <button type="button" key={reference.uri} disabled={unavailable} title={t('observation.currentName')} onClick={() => window.dispatchEvent(new CustomEvent('loom:open-reference', { detail: { uri: reference.uri } }))}>
          <Link size={12} />{t(`logs.ref.${reference.type}`)}{label ? ` · ${label.state === 'available' ? label.title || t('observation.unnamed') : t(label.state === 'deleted' ? 'observation.resourceDeleted' : 'observation.recordUnavailable')}` : reference.type !== 'source' && reference.type !== 'extension' ? ` · ${t(referenceError ? 'observation.readError' : 'observation.loading')}` : ''}
        </button>
      })}</div>
      <dl>
        {record.event && <div><dt>{t('logs.event')}</dt><dd>{record.event}</dd></div>}
        {fields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
      </dl>
      <div className={styles.detailActions}>
        {typeof observationId === 'string' && <button type="button" className={styles.command} onClick={() => window.dispatchEvent(new CustomEvent('loom:open-observation', { detail: { id: observationId } }))}><Link size={13} />{t('observation.title')}</button>}
        {runId && <button type="button" className={styles.command} onClick={() => onFilterRun(runId)}><Filter size={13} />{t('logs.filterRun')}</button>}
      </div>

    </div>}
  </div>
    {copyError && <p className={styles.copyNotice} role="alert">{t('logs.copyError')}</p>}
    {copied && <span className={styles.copyNotice} role="status">{t('logs.copied')}</span>}
  <Dialog open={rawOpen} onClose={() => setRawOpen(false)} title={t('logs.raw')} closeLabel={t('observation.close')} className={styles.rawDialog} closeOnBackdrop>
    {rawOpen && <pre className={styles.rawData}>{JSON.stringify(record, null, 2)}</pre>}
  </Dialog></>
}

export function LogEventHeader({ t, levelControl, sourceControl, messageControl }: { t: Translator; levelControl: ReactNode; sourceControl: ReactNode; messageControl: ReactNode }) {
  return <div className={`${styles.row} ${styles.tableHeader}`}>
    <span>{t('logs.columnTime')}</span><div className={styles.headerControl}>{levelControl}</div><div className={styles.headerControl}>{sourceControl}</div><div className={styles.headerMessage}>{messageControl}</div><span className={styles.headerMetrics}>{t('logs.columnMetrics')}</span><span className={styles.headerActions}>{t('logs.columnActions')}</span>
  </div>
}
