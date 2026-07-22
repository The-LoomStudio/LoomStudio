import type { LogGap, LogLevel, LogRecord, MemoryLogSink } from '@loom-studio/logging'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './log-viewer.module.scss'

type LogSource = 'server' | 'client'
type LevelFilter = LogLevel | 'all'

export function LogViewer(props: {
  api: StudioApi['logs']
  clientLogs: MemoryLogSink
  t: Translator
}) {
  const [source, setSource] = useState<LogSource>('server')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [namespacePrefix, setNamespacePrefix] = useState('')
  const [records, setRecords] = useState<LogRecord[]>([])
  const [gap, setGap] = useState<LogGap>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)

    try {
      if (source === 'client') {
        setRecords(props.clientLogs.list())
        setGap(undefined)
        setHasMore(false)
        return
      }

      const page = await props.api.list({ limit: 500 })
      setRecords(page.items)
      setGap(page.gap)
      setHasMore(page.hasMore)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [props.api, props.clientLogs, source])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visibleRecords = useMemo(() => records.filter(record => {
    if (level !== 'all' && record.level !== level) return false
    const prefix = namespacePrefix.trim()
    if (prefix && record.namespace !== prefix && !record.namespace.startsWith(`${prefix}.`)) return false
    return true
  }), [level, namespacePrefix, records])

  return (
    <section className={styles.viewer} aria-label={props.t('logs.title')}>
      <header className={styles.header}>
        <div>
          <h1>{props.t('logs.title')}</h1>
          <p>{props.t('logs.count', { count: visibleRecords.length })}</p>
        </div>
        <button disabled={loading} type="button" onClick={() => void refresh()}>
          {props.t('logs.refresh')}
        </button>
      </header>

      <div className={styles.toolbar}>
        <fieldset className={styles.sourceFieldset}>
          <legend>{props.t('logs.source')}</legend>
          <button
            className={source === 'server' ? styles.sourceActive : undefined}
            type="button"
            onClick={() => setSource('server')}
          >
            {props.t('logs.source.server')}
          </button>
          <button
            className={source === 'client' ? styles.sourceActive : undefined}
            type="button"
            onClick={() => setSource('client')}
          >
            {props.t('logs.source.client')}
          </button>
        </fieldset>

        <label>
          <span>{props.t('logs.level')}</span>
          <select value={level} onChange={event => setLevel(event.target.value as LevelFilter)}>
            <option value="all">{props.t('logs.level.all')}</option>
            <option value="debug">DEBUG</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
          </select>
        </label>

        <label className={styles.namespaceFilter}>
          <span>{props.t('logs.namespace')}</span>
          <input
            placeholder={props.t('logs.namespacePlaceholder')}
            value={namespacePrefix}
            onChange={event => setNamespacePrefix(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.status} aria-live="polite">
        {loading ? <p>{props.t('logs.loading')}</p> : null}
        {error ? <p className={styles.error}>{props.t('logs.error', { message: error })}</p> : null}
        {gap?.reason === 'evicted' ? <p className={styles.warning}>{props.t('logs.gap.evicted', { count: gap.dropped ?? 0 })}</p> : null}
        {gap?.reason === 'reset' ? <p className={styles.warning}>{props.t('logs.gap.reset')}</p> : null}
        {hasMore ? <p className={styles.warning}>{props.t('logs.more')}</p> : null}
      </div>

      <div className={styles.records}>
        {!loading && visibleRecords.length === 0 ? <p className={styles.empty}>{props.t('logs.empty')}</p> : null}
        {visibleRecords.map((record, index) => (
          <details className={`${styles.record} ${styles[record.level]}`} key={`${record.timestamp}-${record.namespace}-${index}`}>
            <summary>
              <time dateTime={record.timestamp}>{formatTime(record.timestamp)}</time>
              <span className={styles.level}>{record.level.toUpperCase()}</span>
              <span className={styles.namespace}>{record.namespace}</span>
              <span className={styles.message}>{record.message}</span>
            </summary>
            <pre>{JSON.stringify(record, null, 2)}</pre>
          </details>
        ))}
      </div>
    </section>
  )
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}
