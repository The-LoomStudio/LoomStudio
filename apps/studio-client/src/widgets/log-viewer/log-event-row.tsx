import { useState } from 'react'
import { readLogPresentation, type LogRecord } from '@loom-studio/logging'
import { IconButton } from '@loom-studio/ui'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, CircleAlert, Copy, Filter, Link } from 'lucide-react'
import { readLogReferences } from '../../features/log-viewer/model/log-references.js'
import { logSource } from '../../features/log-viewer/model/log-presentation.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './log-event-row.module.scss'

export function LogEventRow({ record, t, onFilterRun, onInspect }: {
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
      <span className={styles.time}><ChevronRight className={styles.chevron} size={12} /><time dateTime={record.timestamp}>{new Date(record.timestamp).toLocaleTimeString([], { hour12: false })}</time></span>
      <span className={styles.source} data-source={source} title={record.namespace}>{source}</span>
      <span className={styles.event}>
        <span className={styles.message}>{(record.level === 'error' || record.level === 'warn') && <CircleAlert size={14} />}{record.message}</span>
        {view.duration && <span className={styles.duration} aria-label={`${t('logs.duration')} ${view.duration}`}>{view.duration}</span>}
        {(view.inputTokens !== undefined || view.outputTokens !== undefined) && <span className={styles.tokens}>
          {view.inputTokens !== undefined && <><ArrowUpRight size={12} aria-label={t('logs.inputTokens')} />{view.inputTokens.toLocaleString()}</>}
          {view.outputTokens !== undefined && <><ArrowDownLeft size={12} aria-label={t('logs.outputTokens')} />{view.outputTokens.toLocaleString()}</>}
        </span>}
      </span>
    </summary>
    {expanded && <div className={styles.detail}>
      {view.detail && <p>{view.detail}</p>}
      <div className={styles.references}>{readLogReferences(record).map(reference => <button type="button" key={reference.uri} title={reference.uri} onClick={() => window.dispatchEvent(new CustomEvent('loom:open-reference', { detail: { uri: reference.uri } }))}>
        <Link size={12} />{t(`logs.ref.${reference.type}`)}
      </button>)}</div>
      <dl>
        <div><dt>{t('logs.level')}</dt><dd>{record.level.toUpperCase()}</dd></div>
        <div><dt>{t('logs.source')}</dt><dd>{record.service} / {record.namespace}</dd></div>
        {record.event && <div><dt>{t('logs.event')}</dt><dd>{record.event}</dd></div>}
        {fields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
      </dl>
      <div className={styles.detailActions}>
        {runId && <button type="button" className={styles.command} onClick={() => onFilterRun(runId)}><Filter size={13} />{t('logs.filterRun')}</button>}
        <IconButton size="small" aria-label={copied ? t('logs.copied') : t('logs.copy')} onClick={() => void copyRecord()}>{copied ? <Check size={13} /> : <Copy size={13} />}</IconButton>
        {copied && <span role="status">{t('logs.copied')}</span>}
      </div>
      {copyError && <p role="alert">{t('logs.copyError')}</p>}
      <details className={styles.rawDetails}>
        <summary><ChevronRight size={12} />{t('logs.raw')}</summary>
        <pre className={styles.raw} tabIndex={0} aria-label={t('logs.raw')}>{JSON.stringify(record, null, 2)}</pre>
      </details>
    </div>}
  </details>
}
