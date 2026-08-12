import type { LogLevel, LogRecord, MemoryLogSink } from '@loom-studio/logging'
import { ArrowDown, ChevronRight, Download, Layers3, RefreshCw, Search } from 'lucide-react'
import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLogFeed, type LogSource } from '../../features/log-viewer/model/use-log-feed.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import { buildLogStream, highestLogLevel, matchesLogSearch, moreSevereLogLevel } from './log-viewer-model.js'
import styles from './log-viewer.module.scss'

type LevelFilter = LogLevel | 'all'
type UnreadLogs = { count: number; level?: LogLevel }

export function LogViewer(props: {
  active: boolean
  api: StudioApi['logs']
  clientLogs: MemoryLogSink
  t: Translator
}) {
  const [source, setSource] = useState<LogSource>('server')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [query, setQuery] = useState('')
  const [followingLatest, setFollowingLatest] = useState(true)
  const [unread, setUnread] = useState<UnreadLogs>({ count: 0 })
  const recordsRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef<HTMLDivElement>(null)
  const followingLatestRef = useRef(true)
  const initialScrollPendingRef = useRef(true)

  const resetFollowingLatest = useCallback(() => {
    followingLatestRef.current = true
    initialScrollPendingRef.current = true
    setFollowingLatest(true)
    setUnread({ count: 0 })
  }, [])

  const handleUnreadRecords = useCallback((items: LogRecord[]) => {
    const nextLevel = highestLogLevel(items)
    setUnread(current => ({
      count: current.count + items.length,
      level: moreSevereLogLevel(current.level, nextLevel),
    }))
  }, [])

  const { records, gap, truncated, loading, error, refresh } = useLogFeed({
    active: props.active,
    source,
    api: props.api,
    clientLogs: props.clientLogs,
    followingLatestRef,
    onUnreadRecords: handleUnreadRecords,
  })

  const handleRefresh = () => {
    resetFollowingLatest()
    void refresh()
  }

  useEffect(() => {
    if (!props.active) return
    resetFollowingLatest()
  }, [props.active, resetFollowingLatest, source])

  const visibleRecords = useMemo(() => records.filter(record => {
    if (level !== 'all' && record.level !== level) return false
    return matchesLogSearch(record, query)
  }), [level, query, records])
  const stream = useMemo(() => buildLogStream(visibleRecords), [visibleRecords])

  useLayoutEffect(() => {
    if (!props.active) return
    const container = recordsRef.current
    if (!container || (!initialScrollPendingRef.current && !followingLatestRef.current)) return
    latestRef.current?.scrollIntoView({ block: 'end' })
    initialScrollPendingRef.current = false
    setUnread({ count: 0 })
  }, [props.active, stream])

  const handleRecordsScroll = () => {
    const container = recordsRef.current
    if (!container) return
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 32
    followingLatestRef.current = atBottom
    setFollowingLatest(atBottom)
    if (atBottom) setUnread({ count: 0 })
  }

  const scrollToLatest = () => {
    followingLatestRef.current = true
    setFollowingLatest(true)
    setUnread({ count: 0 })
    latestRef.current?.scrollIntoView({ block: 'end' })
  }

  const downloadVisibleLogs = () => {
    const blob = new Blob([JSON.stringify(visibleRecords, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `loom-logs-${new Date().toISOString().replaceAll(':', '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className={styles.viewer} aria-label={props.t('logs.title')}>
      <div className={styles.toolbar}>
        <div aria-label={props.t('logs.source')} className={styles.sourceControl} role="group">
          <button
            aria-pressed={source === 'server'}
            className={source === 'server' ? styles.sourceActive : undefined}
            type="button"
            onClick={() => setSource('server')}
          >
            {props.t('logs.source.server')}
          </button>
          <button
            aria-pressed={source === 'client'}
            className={source === 'client' ? styles.sourceActive : undefined}
            type="button"
            onClick={() => setSource('client')}
          >
            {props.t('logs.source.client')}
          </button>
        </div>

        <select aria-label={props.t('logs.level')} value={level} onChange={event => setLevel(event.target.value as LevelFilter)}>
          <option value="all">{props.t('logs.level.all')}</option>
          <option value="debug">DEBUG</option>
          <option value="info">INFO</option>
          <option value="warn">WARN</option>
          <option value="error">ERROR</option>
        </select>

        <label className={styles.searchField}>
          <Search aria-hidden="true" />
          <span className={styles.srOnly}>{props.t('logs.search')}</span>
          <input
            placeholder={props.t('logs.searchPlaceholder')}
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>

        <span className={styles.count}>{props.t('logs.count', { count: visibleRecords.length })}</span>
        <div className={styles.actions}>
          <button aria-label={props.t('logs.refresh')} disabled={loading} title={props.t('logs.refresh')} type="button" onClick={handleRefresh}>
            <RefreshCw aria-hidden="true" />
          </button>
          <button aria-label={props.t('logs.download')} disabled={visibleRecords.length === 0} title={props.t('logs.download')} type="button" onClick={downloadVisibleLogs}>
            <Download aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.status} aria-live="polite">
        {loading ? <p>{props.t('logs.loading')}</p> : null}
        {error ? <p className={styles.error}>{props.t('logs.error', { message: error })}</p> : null}
        {gap?.reason === 'evicted' ? <p className={styles.warning}>{props.t('logs.gap.evicted', { count: gap.dropped ?? 0 })}</p> : null}
        {gap?.reason === 'reset' ? <p className={styles.warning}>{props.t('logs.gap.reset')}</p> : null}
        {truncated ? <p className={styles.warning}>{props.t('logs.more')}</p> : null}
      </div>

      <div className={styles.recordsShell}>
        <div className={styles.records} ref={recordsRef} onScroll={handleRecordsScroll}>
          {!loading && stream.length === 0 ? <p className={styles.empty}>{props.t('logs.empty')}</p> : null}
          {stream.map((item, streamIndex) => item.kind === 'record'
            ? <LogRecordRow key={`${item.record.timestamp}-${item.record.callId ?? streamIndex}`} record={item.record} />
            : (
                <details className={styles.group} key={`${item.firstTimestamp}-${item.namespace}-${streamIndex}`} open>
                  <summary className={styles.groupSummary}>
                    <ChevronRight aria-hidden="true" className={styles.chevron} />
                    <Layers3 aria-hidden="true" className={styles.groupIcon} />
                    <span className={styles.groupName}>{item.namespace}</span>
                    <span className={styles.groupCount}>{props.t('logs.count', { count: item.records.length })}</span>
                    <span className={styles.timeRange}>{formatTime(item.firstTimestamp)} – {formatTime(item.lastTimestamp)}</span>
                  </summary>
                  <div className={styles.groupRecords}>
                    {item.records.map((record, index) => (
                      <LogRecordRow key={`${record.timestamp}-${record.callId ?? index}`} record={record} />
                    ))}
                  </div>
                </details>
              ))}
          <div aria-hidden="true" className={styles.latestAnchor} ref={latestRef} />
        </div>
        {!followingLatest ? (
          <button aria-live="polite" className={`${styles.latestIndicator} ${unread.level ? styles[`latest${capitalize(unread.level)}`] : ''}`} type="button" onClick={scrollToLatest}>
            <ArrowDown aria-hidden="true" />
            <span>{unread.count > 0 ? props.t('logs.newRecords', { count: unread.count }) : props.t('logs.returnLatest')}</span>
          </button>
        ) : null}
      </div>
    </section>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function LogRecordRow({ record }: { record: LogRecord }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <details className={`${styles.record} ${styles[record.level]}`} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
        <time dateTime={record.timestamp}>{formatTime(record.timestamp)}</time>
        <span className={styles.level}>{record.level.toUpperCase()}</span>
        <span className={styles.namespace}>{record.namespace}</span>
        <span className={styles.message}>{highlightMessage(record.message)}</span>
      </summary>
      {expanded ? <pre className={styles.json}>{renderJson(record)}</pre> : null}
    </details>
  )
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function highlightMessage(message: string): ReactNode {
  const tokens = message.split(/(https?:\/\/\S+|#[\w-]+|\b[A-Z][A-Z0-9_]{2,}\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g)
  return tokens.map((token, index) => {
    let className: string | undefined
    if (/^https?:\/\//.test(token)) className = styles.messageLink
    else if (/^#/.test(token)) className = styles.messageProperty
    else if (/^[A-Z][A-Z0-9_]{2,}$/.test(token)) className = styles.messageEvent
    else if (/^(?:true|false|null|undefined)$/.test(token)) className = styles.messageConstant
    else if (/^\d+(?:\.\d+)?$/.test(token)) className = styles.messageNumber
    return className ? <span className={className} key={index}>{token}</span> : token
  })
}

function renderJson(value: unknown, depth = 0): ReactNode {
  if (value === null) return <span className={styles.jsonConstant}>null</span>
  if (typeof value === 'string') return <span className={styles.jsonString}>{JSON.stringify(value)}</span>
  if (typeof value === 'number') return <span className={styles.jsonNumber}>{value}</span>
  if (typeof value === 'boolean') return <span className={styles.jsonConstant}>{String(value)}</span>
  if (Array.isArray(value)) return renderJsonEntries('[', ']', value.map((item, index) => [String(index), item]), depth, false)
  if (typeof value === 'object') return renderJsonEntries('{', '}', Object.entries(value), depth, true)
  return <span className={styles.jsonInvalid}>{String(value)}</span>
}

function renderJsonEntries(
  opening: string,
  closing: string,
  entries: Array<[string, unknown]>,
  depth: number,
  showKeys: boolean,
): ReactNode {
  if (entries.length === 0) return <span className={styles.jsonPunctuation}>{opening}{closing}</span>
  const indent = '  '.repeat(depth + 1)
  const closingIndent = '  '.repeat(depth)

  return (
    <>
      <span className={styles.jsonPunctuation}>{opening}</span>{'\n'}
      {entries.map(([key, value], index) => (
        <Fragment key={key}>
          {indent}
          {showKeys ? <><span className={styles.jsonProperty}>{JSON.stringify(key)}</span><span className={styles.jsonPunctuation}>: </span></> : null}
          {renderJson(value, depth + 1)}
          {index < entries.length - 1 ? <span className={styles.jsonPunctuation}>,</span> : null}
          {'\n'}
        </Fragment>
      ))}
      {closingIndent}<span className={styles.jsonPunctuation}>{closing}</span>
    </>
  )
}
