import type { LogLevel, LogRecord, MemoryLogSink } from '@loom-studio/logging'
import { Checkbox, IconButton, SearchField } from '@loom-studio/ui'
import { ArrowDown, Copy, Download, Filter, RefreshCw, Search, Square, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLogFeed, type LogSource } from '../../features/log-viewer/model/use-log-feed.js'
import { useLogHistory } from '../../features/log-viewer/model/use-log-history.js'
import { formatLogReport, selectDiagnosticContext } from '../../features/log-viewer/model/log-report.js'
import { filterLogRecords } from '../../features/log-viewer/model/log-presentation.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { downloadBlob } from '../../shared/browser/download.js'
import type { Translator } from '../../shared/i18n/index.js'
import { highestLogLevel, moreSevereLogLevel } from './log-viewer-model.js'
import { LogEventRow } from './log-event-row.js'
import styles from './log-viewer.module.scss'

declare const __LOOM_STUDIO_VERSION__: string

export function LogViewer(props: {
  active: boolean
  api: StudioApi['logs']
  clientLogs: MemoryLogSink
  t: Translator
  extensions?: readonly { packageId: string; displayName: string }[]
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const sourceParam = searchParams.get('logSource')
  const source: LogSource | 'history' = sourceParam === 'server' || sourceParam === 'client' || sourceParam === 'history' ? sourceParam : 'all'
  const packageId = searchParams.get('logPackage') || undefined
  const runId = searchParams.get('logRun') || undefined
  const setRunId = (value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('logRun', value)
    else next.delete('logRun')
    setSearchParams(next)
  }
  const historyMode = source === 'history'
  const [since, setSince] = useState(() => localDateTime(new Date(Date.now() - 86_400_000)))
  const [until, setUntil] = useState(() => localDateTime(new Date()))
  const [eventFilter, setEventFilter] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [report, setReport] = useState<{ context: string; filtered: string }>()
  const [reportMode, setReportMode] = useState<'context' | 'filtered'>('context')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const dialog = useRef<HTMLDialogElement>(null)
  const history = useLogHistory(props.api, props.active && historyMode)
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [query, setQuery] = useState('')
  const [technical, setTechnical] = useState(false)
  const [followingLatest, setFollowingLatest] = useState(true)
  const [unread, setUnread] = useState<{ count: number; level?: LogLevel }>({ count: 0 })
  const recordsRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef<HTMLDivElement>(null)
  const followingLatestRef = useRef(true)
  const initialScrollPendingRef = useRef(true)
  const inspectingRef = useRef(false)
  const recordKeys = useRef(new WeakMap<LogRecord, number>())
  const nextKey = useRef(0)

  const resetFollowingLatest = useCallback(() => {
    followingLatestRef.current = true
    initialScrollPendingRef.current = true
    inspectingRef.current = false
    setFollowingLatest(true)
    setUnread({ count: 0 })
  }, [])

  const handleUnreadRecords = useCallback((items: LogRecord[]) => {
    const matching = filterLogRecords(items, { query, level, technical, runId })
    setUnread(current => ({
      count: current.count + matching.length,
      level: moreSevereLogLevel(current.level, highestLogLevel(matching)),
    }))
  }, [query, level, technical, runId])

  const current = useLogFeed({
    active: props.active && !historyMode, source: historyMode ? 'all' : source, api: props.api, clientLogs: props.clientLogs, packageId,
    followingLatestRef, onUnreadRecords: handleUnreadRecords,
  })
  const historyMatchesScope = history.query?.packageId === packageId && history.query?.runId === runId
  const historyDirty = Boolean(history.query && (
    !historyMatchesScope || (history.query.text ?? '') !== query
    || (history.query.event ?? '') !== eventFilter || (history.query.moduleId ?? '') !== moduleId
    || (history.query.levels?.[0] ?? 'all') !== level
    || localDateTime(new Date(history.query.since)) !== since || localDateTime(new Date(history.query.until)) !== until
  ))
  const records = useMemo(() => historyMode
    ? historyMatchesScope ? [...(history.page?.items ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp)) : []
    : current.records, [historyMode, historyMatchesScope, history.page, current.records])
  const loading = historyMode ? history.loading : current.loading
  const error = historyMode ? history.error : current.error
  const sourceReady = historyMode ? Boolean(history.page && historyMatchesScope) : current.sourceReady
  const truncated = historyMode ? history.page?.hasMore : current.truncated

  useEffect(() => {
    if (props.active) resetFollowingLatest()
  }, [props.active, source, resetFollowingLatest])

  const visibleRecords = useMemo(
    () => filterLogRecords(records, { query: historyMode ? '' : query, level: historyMode ? 'all' : level, technical, runId })
      .filter(record => (!packageId || record.extension?.packageId === packageId) && (historyMode || !moduleId || record.extension?.moduleId === moduleId) && (historyMode || !eventFilter || record.event === eventFilter)),
    [records, query, level, technical, runId, packageId, moduleId, eventFilter, historyMode],
  )
  useEffect(() => {
    if (report) dialog.current?.showModal()
  }, [report])
  // Identity survives polling and filtering; eviction cannot transfer an open row to another event.
  const keyedRecords = useMemo(() => visibleRecords.map(record => {
    let key = recordKeys.current.get(record)
    if (key === undefined) {
      key = nextKey.current++
      recordKeys.current.set(record, key)
    }
    return { key, record }
  }), [visibleRecords])

  useLayoutEffect(() => {
    if (!props.active || historyMode || (!initialScrollPendingRef.current && !followingLatestRef.current)) return
    latestRef.current?.scrollIntoView({ block: 'end' })
    initialScrollPendingRef.current = false
    setUnread({ count: 0 })
  }, [props.active, visibleRecords, historyMode])

  function pauseForInspection() {
    inspectingRef.current = true
    followingLatestRef.current = false
    initialScrollPendingRef.current = false
    setFollowingLatest(false)
  }

  function scrollToLatest() {
    inspectingRef.current = false
    followingLatestRef.current = true
    setFollowingLatest(true)
    setUnread({ count: 0 })
    latestRef.current?.scrollIntoView({ block: 'end' })
  }

  function handleScroll() {
    const container = recordsRef.current
    if (!container || inspectingRef.current) return
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 32
    followingLatestRef.current = atBottom
    setFollowingLatest(atBottom)
    if (atBottom) setUnread({ count: 0 })
  }

  function changeSource(value: LogSource | 'history') {
    const next = new URLSearchParams(searchParams)
    next.set('logSource', value)
    setSearchParams(next)
  }

  function searchHistory() {
    pauseForInspection()
    void history.search({
      limit: 200, since: new Date(since).toISOString(), until: new Date(until).toISOString(),
      ...(query ? { text: query } : {}), ...(level !== 'all' ? { levels: [level] } : {}),
      ...(packageId ? { packageId } : {}), ...(runId ? { runId } : {}),
      ...(eventFilter ? { event: eventFilter } : {}), ...(moduleId ? { moduleId } : {}),
    })
  }

  function previewReport() {
    pauseForInspection()
    setCopyState('idle')
    const notices = [
      ...(error ? [error] : []),
      ...(!historyMode ? current.sourceIssues : []),
      ...(truncated ? ['Search or buffer is incomplete; more records may exist.'] : []),
      ...(packageId ? ['Extension filtering requires host-owned identity; older records without it are not matched.'] : []),
      ...(historyMode ? (history.page?.issues ?? []).map(issue => `${issue.reason}: ${issue.count}`) : []),
      ...(historyMode ? [`History query: ${JSON.stringify(history.query)}`] : [`View filters: ${JSON.stringify({ query, level, moduleId, eventFilter, technical })}`]),
    ]
    const common = { version: __LOOM_STUDIO_VERSION__, capturedAt: new Date().toISOString(), scope: `${source}; package=${packageId ?? 'all'}; run=${runId ?? 'all'}`, notices }
    const contextRecords = records.filter(record => (!runId || record.data?.runId === runId) && (historyMode || !moduleId || record.extension?.moduleId === moduleId))
    setReport({
      context: formatLogReport({ ...common, scope: `${common.scope}; selection=failure context`, notices: [...notices, historyMode ? 'Context is limited to the loaded history matches.' : 'Context ignores text, level and event display filters; package, run and module scope are retained.'], records: selectDiagnosticContext(contextRecords) }),
      filtered: formatLogReport({ ...common, scope: `${common.scope}; selection=visible results`, records: visibleRecords }),
    })
  }

  async function copyReport() {
    try { await navigator.clipboard.writeText(report![reportMode]); setCopyState('copied') }
    catch { setCopyState('failed') }
  }

  function closeReport() {
    dialog.current?.close()
    setReport(undefined)
  }

  return <section className={styles.viewer} aria-label={props.t('logs.title')}>
    <div className={styles.toolbar}>
      <div className={styles.sources} role="group" aria-label={props.t('logs.source')}>
        {(['all', 'server', 'client', 'history'] as const).map(value => <button key={value} type="button" aria-pressed={source === value} onClick={() => changeSource(value)}>{props.t(`logs.source.${value}`)}</button>)}
      </div>
      <SearchField containerClassName={styles.search} aria-label={props.t('logs.search')} placeholder={props.t('logs.searchPlaceholder')} clearLabel={props.t('logs.search')} value={query} onClear={() => setQuery('')} onChange={event => setQuery(event.target.value)} />
      <select aria-label={props.t('logs.level')} value={level} onChange={event => setLevel(event.target.value as LogLevel | 'all')}>
        <option value="all">{props.t('logs.level.all')}</option>
        {(['debug', 'info', 'warn', 'error'] as const).map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}
      </select>
      <label className={styles.technical}><Checkbox checked={technical} onChange={event => setTechnical(event.target.checked)} />{props.t('logs.technical')}</label>
      <div className={styles.actions}>
        {!historyMode && <IconButton aria-label={props.t('logs.refresh')} disabled={loading} onClick={() => { resetFollowingLatest(); void current.refresh() }}><RefreshCw size={15} /></IconButton>}
        <IconButton aria-label={props.t('logs.report')} disabled={!sourceReady || !records.length} onClick={previewReport}><Copy size={15} /></IconButton>
        <IconButton aria-label={props.t('logs.download')} disabled={!sourceReady || !visibleRecords.length} onClick={() => downloadBlob(new Blob([JSON.stringify(visibleRecords, null, 2)], { type: 'application/json' }), `loom-logs-${new Date().toISOString().replaceAll(':', '-')}.json`)}><Download size={15} /></IconButton>
      </div>
    </div>
    <div className={styles.filters}>
      <select aria-label={props.t('logs.extension')} value={packageId ?? ''} onChange={event => {
        const next = new URLSearchParams(searchParams)
        if (event.target.value) next.set('logPackage', event.target.value)
        else next.delete('logPackage')
        setSearchParams(next)
      }}>
        <option value="">{props.t('logs.allExtensions')}</option>
        {packageId && !props.extensions?.some(item => item.packageId === packageId) && <option value={packageId}>{packageId}</option>}
        {props.extensions?.map(item => <option key={item.packageId} value={item.packageId}>{item.displayName}</option>)}
      </select>
      <input aria-label={props.t('logs.module')} placeholder={props.t('logs.module')} value={moduleId} onChange={event => setModuleId(event.target.value)} />
      <input aria-label={props.t('logs.event')} placeholder={props.t('logs.event')} value={eventFilter} onChange={event => setEventFilter(event.target.value)} />
    </div>
    {historyMode && <form className={styles.filters} onSubmit={event => { event.preventDefault(); searchHistory() }}>
      <label>{props.t('logs.since')}<input type="datetime-local" required value={since} onChange={event => setSince(event.target.value)} /></label>
      <label>{props.t('logs.until')}<input type="datetime-local" required min={since} value={until} onChange={event => setUntil(event.target.value)} /></label>
      <button type="submit" disabled={loading}><Search size={14} />{props.t('logs.search')}</button>
      {loading && <IconButton aria-label={props.t('logs.cancel')} onClick={history.cancel}><Square size={13} /></IconButton>}
    </form>}
    {runId && <div className={styles.scope}><Filter size={13} /><span title={runId}>{props.t('logs.runScope')}</span><IconButton aria-label={props.t('logs.clearRun')} onClick={() => setRunId(undefined)}><X size={14} /></IconButton></div>}
    <div className={styles.status} aria-live="polite">
      {loading && <p>{props.t('logs.loading')}</p>}
      {error && <p className={styles.error}>{props.t('logs.error', { message: error })}</p>}
      {!historyMode && current.sourceIssues.map((issue, index) => <p key={index}>{props.t('logs.sourceGap', { detail: issue })}</p>)}
      {historyMode && history.query && <p>{props.t('logs.searchedRange', { since: history.query.since, until: history.query.until, count: history.page?.scannedRecords ?? 0 })}</p>}
      {historyMode && historyDirty && <p>{props.t('logs.historyDirty')}</p>}
      {historyMode && packageId && <p>{props.t('logs.legacyOwnership')}</p>}
      {historyMode && history.page?.issues.map((issue, index) => <p key={index}>{props.t('logs.historyIssue', { reason: issue.reason, count: issue.count })}</p>)}
      {truncated && <p>{props.t('logs.more')}</p>}
      {history.capped && <p>{props.t('logs.historyCap')}</p>}
    </div>
    <div className={styles.recordsShell}>
      <div className={styles.records} ref={recordsRef} onScroll={handleScroll}>
        {!loading && !visibleRecords.length && <p className={styles.empty}>{props.t('logs.empty')}</p>}
        {keyedRecords.map(({ key, record }) => <LogEventRow key={key} record={record} t={props.t} onInspect={pauseForInspection} onFilterRun={value => { pauseForInspection(); setRunId(value) }} />)}
        {historyMode && sourceReady && history.page?.hasMore && !history.capped && <button className={styles.loadMore} type="button" disabled={loading} onClick={history.loadMore}>{props.t('logs.loadMore')}</button>}
        <div ref={latestRef} />
      </div>
      {!historyMode && !followingLatest && <button className={styles.latest} data-level={unread.level} type="button" onClick={scrollToLatest}><ArrowDown size={14} />{unread.count ? props.t('logs.newRecords', { count: unread.count }) : props.t('logs.returnLatest')}</button>}
    </div>
    <footer className={styles.footer}>{props.t('logs.count', { count: visibleRecords.length })} · {props.t(historyMode ? 'logs.historyAvailability' : 'logs.currentAvailability')}</footer>
    {report && <dialog ref={dialog} className={styles.report} aria-label={props.t('logs.report')} onCancel={event => { event.preventDefault(); closeReport() }}>
      <header><strong>{props.t('logs.report')}</strong><IconButton aria-label={props.t('logs.close')} onClick={closeReport}><X size={16} /></IconButton></header>
      <p>{props.t('logs.reportPrivacy')}</p>
      <select aria-label={props.t('logs.reportScope')} value={reportMode} onChange={event => { setReportMode(event.target.value as 'context' | 'filtered'); setCopyState('idle') }}>
        <option value="context">{props.t('logs.context')}</option><option value="filtered">{props.t('logs.filtered')}</option>
      </select>
      <textarea readOnly value={report[reportMode]} aria-label={props.t('logs.reportPreview')} />
      {copyState === 'failed' && <p role="alert">{props.t('logs.copyError')}</p>}
      <footer><button type="button" onClick={() => void copyReport()}><Copy size={14} />{props.t(copyState === 'copied' ? 'logs.copied' : 'logs.reportCopy')}</button><IconButton aria-label={props.t('logs.download')} onClick={() => downloadBlob(new Blob([report[reportMode]], { type: 'text/plain;charset=utf-8' }), 'loom-diagnostic.txt')}><Download size={15} /></IconButton></footer>
    </dialog>}
  </section>
}

function localDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
