import { ObservationSourceIcon } from './observation-source-icon.js'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, ChevronLeft, ChevronRight, ArrowLeft, ArrowUpRight, CheckCircle2, CircleDashed, Search, TriangleAlert, Wrench } from 'lucide-react'
import { Button, SearchField, Tabs } from '@loom-studio/ui'
import { WindowColumnLayout } from '../../shared/ui/window-column-layout/window-column-layout.js'
import type { ObservationRecord, ObservationStep, ObservationReference } from '../../features/observability/model/observation-view.js'
import { t as defaultTranslator, type Translator } from '../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import type { ObservationMessage } from '../../features/observability/model/observation-view.js'
import styles from '../../features/observability/ui/observability-workbench.module.scss'
import { ObservationRawData } from '../../features/observability/ui/observation-dialog.js'
import { groupMacroReads } from '../../features/observability/model/observation-variables.js'

import { ObservationSources } from '../../features/observability/ui/observation-sources.js'
import { ToolArguments, ToolResult } from '../../features/observability/ui/observation-content.js'

const ObservationTranslation = createContext<Translator>(defaultTranslator)

type View = 'messages' | 'build' | 'variables' | 'tools' | 'usage'

type WorkbenchProps = {
  t?: Translator
  records: ObservationRecord[]
  toolbar?: ReactNode
  selectedRecordId?: string
  selectedRecord?: ObservationRecord
  listNotice?: ReactNode
  listFooter?: ReactNode
  detailNotice?: ReactNode
  stepNotice?: ReactNode
  onSelectRecord?(id: string): void
  onSelectStep?(id: string): void
  onKindChange?(kind: ObservationRecord['kind'] | undefined): void
}

export function ObservabilityWorkbench(props: WorkbenchProps) {
  return <ObservationTranslation.Provider value={props.t ?? defaultTranslator}><WorkbenchContent {...props} /></ObservationTranslation.Provider>
}

function WorkbenchContent({ records, toolbar, selectedRecordId, selectedRecord, listNotice, listFooter, detailNotice, stepNotice, onSelectRecord, onSelectStep, onKindChange }: WorkbenchProps) {
  const t = useContext(ObservationTranslation)
  const kindNames = { run: t('observation.run'), build: t('observation.standaloneBuild'), api: t('observation.api') }
  const container = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [detailOpen, setDetailOpen] = useState(!!selectedRecordId)
  useEffect(() => { if (selectedRecordId) setDetailOpen(true) }, [selectedRecordId])
  const [width, setWidth] = useState(320)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | ObservationRecord['kind']>('all')
  const [selectedId, setSelectedId] = useState(records[0]?.id)
  const visible = records.filter(record => (filter === 'all' || record.kind === filter) && `${record.title} ${record.id} ${record.origin}`.toLowerCase().includes(query.toLowerCase()))
  const selected = selectedRecordId ? records.find(record => record.id === selectedRecordId) ?? selectedRecord : visible.find(record => record.id === selectedId) ?? visible[0]
  useEffect(() => { if (selected && !selectedRecordId) { setSelectedId(selected.id); onSelectRecord?.(selected.id) } }, [selected?.id, selectedRecordId, onSelectRecord])
  useEffect(() => {
    const node = container.current
    if (!node) return
    const observer = new ResizeObserver(() => setNarrow(node.clientWidth < 760))
    setNarrow(node.clientWidth < 760)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const master = <aside className={styles.master} aria-label={t('observation.records')}>
    <div className={styles.listHeader}><span>{t('observation.recentRecords')}</span><small>{visible.length}</small></div>
    <SearchField aria-label={t('observation.search')} placeholder={t('observation.searchLoaded')} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={t('observation.clearSearch')} />
    <Tabs ariaLabel={t('observation.recordKind')} size="compact" activeId={filter} onChange={value => { setFilter(value); onKindChange?.(value === 'all' ? undefined : value) }} items={[
      { id: 'all', label: t('observation.all') }, { id: 'run', label: kindNames.run }, { id: 'build', label: kindNames.build }, { id: 'api', label: kindNames.api },
    ]} />
    {listNotice}
    <div className={styles.records}>
      {visible.map(record => <button type="button" key={record.id} className={styles.record} aria-current={selected?.id === record.id ? 'true' : undefined} onClick={() => { setSelectedId(record.id); onSelectRecord?.(record.id); setDetailOpen(true) }}>
        <span className={styles.recordMeta}><span>{kindNames[record.kind]}</span><time>{record.time}</time></span>
        <strong>{record.title}</strong>
        <span className={styles.recordMeta}><span>{record.stepCount === undefined ? (onSelectRecord ? '' : t('observation.stepCount', { count: record.steps.length })) : t('observation.stepCount', { count: record.stepCount })}</span><Status status={record.status} /></span>
      </button>)}
      {!visible.length && !listNotice && <Empty title={records.length ? t('observation.noMatches') : t('observation.empty')} description={records.length ? t('observation.trySearch') : t('observation.emptyHint')} />}
    </div>
    {listFooter}
  </aside>
  const detail = selected ? detailNotice ?? <RecordView key={selected.id} record={selectedRecord?.id === selected.id ? selectedRecord : selected} onSelectStep={onSelectStep} stepNotice={selectedRecord?.id === selected.id ? stepNotice : undefined} /> : detailNotice ?? <Empty title={t('observation.selectRecord')} description={t('observation.selectHint')} />
  return <div ref={container} className={styles.workbench} data-loom-component="observability-workbench">
    <header className={styles.header}>{toolbar}</header>
    <div className={styles.body}>
      {narrow ? detailOpen && selected ? <div className={styles.narrowDetail}><Button onClick={() => setDetailOpen(false)}><ArrowLeft size={14} />{t('observation.returnRecords')}</Button>{detail}</div> : master
        : <WindowColumnLayout columns={[
          { id: 'records', size: width, minSize: 210, resizeLabel: t('observation.resize'), content: master },
          { id: 'detail', fill: true, minSize: 420, content: detail },
        ]} onColumnSizeChange={(_, size) => setWidth(size)} />}
    </div>
  </div>
}

function RecordView({ record, onSelectStep, stepNotice }: { record: ObservationRecord; onSelectStep?: (id: string) => void; stepNotice?: ReactNode }) {
  const t = useContext(ObservationTranslation)
  const kindNames = { run: t('observation.run'), build: t('observation.standaloneBuild'), api: t('observation.api') }
  const tabs = [
  { id: 'messages', label: t('observation.messages') }, { id: 'build', label: t('observation.build') },
  { id: 'variables', label: t('observation.variables') }, { id: 'tools', label: t('observation.tools') }, { id: 'usage', label: t('observation.usage') },
] as const
  const scroller = useRef<HTMLElement>(null)
  const [stepId, setStepId] = useState(record.steps.find(item => item.kind === 'request')?.id ?? record.steps[0]?.id)
  const [view, setView] = useState<View>('messages')
  const [sourceId, setSourceId] = useState<string>()
  const [changesOnly, setChangesOnly] = useState(true)
  const step = record.steps.find(item => item.id === stepId) ?? record.steps.find(item => item.kind === 'request') ?? record.steps[0]
  const stepIndex = record.steps.findIndex(item => item.id === step?.id)
  function selectStep(id: string) { setStepId(id); setSourceId(undefined) }
  useEffect(() => { if (step) onSelectStep?.(step.id) }, [step?.id, onSelectStep])
  useEffect(() => { if (step && !stepId) setStepId(step.id) }, [step?.id, stepId])
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [step?.id, view])
  return <section ref={scroller} className={styles.detail} aria-label={record.title}>
    <div className={styles.recordHeading}>
      <div className={styles.eyebrow}>{kindNames[record.kind]} · {record.time}</div>
      <h2>{record.title}<Status status={record.status} /></h2>
      <References items={record.references} /><div className={styles.recordSubline}><span>{record.origin}</span><Identity values={record.identity ?? { ID: record.id, context: record.context }} /></div>
    </div>
    <nav className={styles.steps} aria-label={t('observation.steps')}>
      {record.steps.map(item => <button type="button" key={item.id} aria-current={step?.id === item.id ? 'step' : undefined} onClick={() => selectStep(item.id)}>
        <Status status={item.status} iconOnly /><strong title={item.title}>{item.title}</strong><small>{item.duration}</small>
      </button>)}
    </nav>
    {step ? <>
      <References items={step.references} />
      {(step.diagnostic || record.diagnostic) && <details className={styles.diagnostic}><summary><TriangleAlert size={15} /><span><strong>{t(step.status === 'failed' ? 'observation.requestFailed' : 'observation.diagnosticDetails')}</strong><span className={styles.diagnosticPreview}>{step.diagnostic ?? record.diagnostic}</span></span></summary><p>{step.diagnostic ?? record.diagnostic}</p></details>}
      <div className={styles.detailNavigation}>
        <nav className={styles.stepContext} aria-label={t('observation.currentStep')}>
          <Button size="small" aria-label={t('observation.previousStep')} title={t('observation.previousStep')} disabled={stepIndex <= 0} onClick={() => selectStep(record.steps[stepIndex - 1]!.id)}><ChevronLeft size={16} /></Button>
          <span className={styles.stepContextTitle}><Status status={step.status} iconOnly /><strong title={step.title}>{step.title}</strong><small>{step.duration}</small></span>
          <span className={styles.stepContextModel} title={step.model}>{step.model}</span>
          <Button size="small" aria-label={t('observation.nextStep')} title={t('observation.nextStep')} disabled={stepIndex >= record.steps.length - 1} onClick={() => selectStep(record.steps[stepIndex + 1]!.id)}><ChevronRight size={16} /></Button>
        </nav>
        <Tabs ariaLabel={t('observation.stepDetails')} items={tabs} activeId={view} onChange={setView} bordered />
      </div>
      <div className={styles.content} role="tabpanel" aria-label={tabs.find(tab => tab.id === view)?.label}>
        {stepNotice ?? <>
        {view === 'messages' && (step.capability ? <><h3>{t('observation.capabilityInput')}</h3><p className={styles.hint}>{[step.capability.providerId, step.capability.capabilityId].filter(Boolean).join(' / ')}</p><ObservationRawData title={t('observation.capabilityInput')} text={step.capabilityInput} t={t} /></> : <>
          <div className={styles.sectionHeading}><h3>{t(step.kind === 'build' ? 'observation.inputMessages' : 'observation.stepMessages')}</h3>{step.kind !== 'build' && <Button size="small" aria-pressed={changesOnly} onClick={() => setChangesOnly(!changesOnly)}>{t(changesOnly ? 'observation.allMessages' : 'observation.changedMessages')}</Button>}</div>
          {step.kind !== 'build' && <>
            {step.response && <div className={styles.stepOutput}><h4>{t('observation.assistantContent')}</h4><MessageReader message={step.response} onSource={() => {}} /></div>}
            {!!step.tools.length && <div className={styles.stepOutput}><h4>{t('observation.toolCalls')}</h4>{step.tools.map(tool => <ToolReader key={tool.id} tool={tool} />)}</div>}
            {!step.response && !step.tools.length && <p className={styles.hint}>{t(step.outputRecorded ? 'observation.noAssistantOutput' : 'observation.outputMissing')}</p>}
          </>}
          {step.kind === 'build' ? <InputMessages step={step} changesOnly={false} onSource={id => { setSourceId(id); setView('build') }} /> : <details key={`${step.id}:${changesOnly}`} className={styles.requestInput} open={!changesOnly}>
            <summary>{t('observation.inputMessages')} · {step.messages.length}<small>{t('observation.inputContextHint')}</small></summary>
            <InputMessages step={step} changesOnly={changesOnly} onSource={id => { setSourceId(id); setView('build') }} />
          </details>}
        </>)}
        {view === 'build' && <>
          <ObservationSources renderSourceIcon={props => <ObservationSourceIcon {...props} />} key={step.id} sources={step.sources} selectedId={sourceId} onSelect={setSourceId} scroller={scroller} t={t} />
          {!step.sources.length && <Empty title={step.evidence && !step.evidence.sources ? t('observation.sourcesMissing') : t('observation.sourcesEmpty')} description={t('observation.sourcesHint')} />}
        </>}
        {view === 'variables' && <>
          <h3>{t('observation.buildVariables')}</h3><p className={styles.hint}>{t('observation.variablesHint')}</p>
          {groupMacroReads(step.variables).map(macro => <details className={styles.variable} key={`${step.id}:${macro.id}`}>
            <summary><code>{macro.name}</code><span className={styles.variableValue}>{macro.values.length === 1 ? macro.values[0] : t('observation.variableValues', { count: macro.values.length })}</span><small>{t('observation.variableReads', { count: macro.count })}</small></summary>
            <div className={styles.variableConsumers}>
              <h4>{t('observation.variableConsumers')}</h4>
              {macro.consumers.map(consumer => {
                const source = step.sources.find(item => item.id === consumer.hostId)
                return <div className={styles.variableConsumer} key={consumer.id}>
                  <div className={styles.sectionHeading}>
                    {source ? <Button size="small" onClick={() => { setSourceId(source.id); setView('build') }}><ArrowUpRight size={13} />{source.title === source.id ? t('observation.variableUnnamedSource') : source.title}</Button> : <span>{t('observation.variableSourceMissing')}</span>}
                    <small>{t('observation.variableReads', { count: consumer.count })}</small>
                  </div>
                  <small>{consumer.stage === 'source' ? t('observation.variableSourceStage') : consumer.stage === 'render' ? t('observation.variableRenderStage') : consumer.stage ?? t('observation.missing')}</small>
                  {macro.values.length > 1 && <div className={styles.variableConsumerValue}>{consumer.value}</div>}
                  <Identity values={{ host: consumer.hostId }} />
                </div>
              })}
              <Identity values={{ path: macro.path, source: macro.source }} />
            </div>
          </details>)}
          {!step.variables.length && <Empty title={step.evidence && !step.evidence.variables ? t('observation.variablesMissing') : t('observation.variablesEmpty')} description={t('observation.variablesEvidence')} />}
        </>}
        {view === 'tools' && <>
          <ObservationRawData title={`${t('observation.toolDefinitions')} · ${step.toolDefinitions?.length ?? '—'}`} value={step.toolDefinitions} text={step.toolDefinitions === undefined ? t('observation.toolDefinitionsMissing') : undefined} t={t} />
          <h3>{t('observation.toolCalls')}</h3>
          {step.tools.map(tool => <ToolReader key={tool.id} tool={tool} />)}
          {!step.tools.length && <Empty title={step.evidence && !step.evidence.tools ? t('observation.toolsMissing') : t('observation.toolsEmpty')} description={t('observation.toolsHint')} />}
        </>}
        {view === 'usage' && <Usage step={step} />}
        <Identity values={step.identity ?? { ID: step.id }} />
        <ObservationRawData key={step.id} title={t('observation.raw')} value={step.raw ?? step} t={t} />
        </>}
      </div>
    </> : <Empty title={t('observation.stepsEmpty')} description={t('observation.stepsWaiting')} />}
  </section>
}

function InputMessages({ step, changesOnly, onSource }: { step: ObservationStep; changesOnly: boolean; onSource(id?: string): void }) {
  const t = useContext(ObservationTranslation)
  const [showUnchanged, setShowUnchanged] = useState(false)
  const filtered = changesOnly && step.canCompare && !showUnchanged
  return <div className={styles.inputMessageList}>
    <p className={styles.hint}>{t(step.kind === 'build' ? 'observation.buildHint' : 'observation.requestHint')}</p>
    {step.comparison && <p className={styles.hint}>{step.comparison}</p>}
    {!step.canCompare && step.kind !== 'build' && <p className={styles.hint}>{t(step.initialInput ? 'observation.initialInput' : 'observation.comparisonMissing')}</p>}
    {filtered && step.messages.some(message => !message.change) && <button type="button" className={styles.unchangedMessages} onClick={() => setShowUnchanged(true)}>{t('observation.unchangedCount', { count: step.messages.filter(message => !message.change).length })}<ChevronRight size={14} /></button>}
    {step.evidence && !step.evidence.messages && <Empty title={t('observation.messagesMissing')} description={t('observation.messagesMissingHint')} />}
    {step.messages.filter(message => !filtered || message.change).map(message => <MessageReader key={message.id} message={message} index={step.messages.indexOf(message)} onSource={() => onSource(message.sourceId)} />)}
    {!!step.removedMessages?.length && <details className={styles.removedMessages}><summary>{t('observation.removedCount', { count: step.removedMessages.length })}</summary>{step.removedMessages.map(message => <MessageReader key={message.id} message={message} onSource={() => {}} />)}</details>}
  </div>
}

function ToolReader({ tool }: { tool: ObservationStep['tools'][number] }) {
  const t = useContext(ObservationTranslation)
  return <article className={styles.source}>
    <div className={styles.sectionHeading}><h4><Wrench size={14} />{tool.name}</h4><Status status={tool.status} /></div>
    <h4>{t('observation.input')}</h4><ToolArguments value={tool.input} t={t} />
    <h4>{t('observation.result')}</h4><div data-failed={tool.status === 'failed'} className={styles.toolOutcome}><ToolResult value={tool.result} t={t} /></div>
    <ObservationRawData title={t('observation.rawTool')} value={tool} t={t} />
  </article>
}

function Identity({ values }: { values: Record<string, string | undefined> }) {
  const t = useContext(ObservationTranslation)
  const [copyState, setCopyState] = useState<string>()
  return <details className={styles.identity}><summary>{t('observation.identifiers')}</summary><dl>
    {Object.entries(values).filter(([, value]) => value).map(([name, value]) => <div key={name}><dt>{name}</dt><dd><code>{value}</code><Button size="small" aria-label={`${t('observation.copy')} ${name}`} onClick={async () => setCopyState(await tryWriteClipboardText(value!) ? name : 'error')}><Copy size={12} />{copyState === name ? t('observation.copied') : t('observation.copy')}</Button></dd></div>)}
  </dl>{copyState === 'error' && <p role="status">{t('observation.copyFailed')}</p>}</details>
}

function MessageReader({ message, index, onSource }: { message: ObservationMessage; index?: number; onSource(): void }) {
  const t = useContext(ObservationTranslation)
  const [expanded, setExpanded] = useState(false)
  const long = message.content.length > 900 || message.content.split('\n').length > 12
  return <article className={styles.message}>
    <header className={styles.messageHeading}><span className={styles.role}>{message.role}</span>{(message.position !== undefined || index !== undefined) && <small>#{message.position ?? (index! + 1)}</small>}{message.change && <span className={styles.change}>{message.change}</span>}<small className={styles.push}>{message.estimatedTokens === undefined ? '' : t('observation.estimatedTokens', { count: message.estimatedTokens })}</small></header>
    {message.content && <div className={`${styles.messageText} ${long && !expanded ? styles.clamped : ''}`}>{message.content}</div>}
    {long && <Button size="small" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? 'observation.collapseText' : 'observation.expandText')}</Button>}
    {message.toolCalls?.map((call, callIndex) => <details className={styles.raw} key={callIndex}><summary><Wrench size={14} />{call.name}</summary><ToolArguments value={call.arguments} t={t} /></details>)}
    <div className={styles.messageActions}>{message.sourceId && <Button size="small" onClick={onSource}><ArrowUpRight size={13} />{t('observation.locateSource')}</Button>}
      {message.raw !== undefined && <ObservationRawData title={t('observation.rawMessage')} value={message.raw} t={t} />}
    </div>
  </article>
}

function Usage({ step }: { step: ObservationStep }) {
  const t = useContext(ObservationTranslation)
  const value = step.measurement
  return <><h3>{t('observation.stepUsage')}</h3><div className={styles.metrics}>
    {[[t('observation.requestEstimate'), value?.estimatedTokens], [t('observation.inputUsage'), value?.inputTokens], [t('observation.outputUsage'), value?.outputTokens], [t('observation.duration'), step.duration], [t('observation.firstOutput'), step.firstOutputMs === undefined ? undefined : `${(step.firstOutputMs >= 1000 ? step.firstOutputMs / 1000 : step.firstOutputMs).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${step.firstOutputMs >= 1000 ? 's' : 'ms'}`]].map(([label, number]) => <div key={label}><small>{label}</small><strong>{typeof number === 'number' ? number.toLocaleString() : number ?? t('observation.notReturned')}</strong></div>)}
  </div><p className={styles.hint}>{value?.note ?? t('observation.measurementMissing')}</p>
    {value && <><h4>{t('observation.breakdown')}</h4><dl className={styles.breakdown}>{step.messages.map(message => <div key={message.id}><dt>{message.role} · #{step.messages.indexOf(message) + 1}</dt><dd>{message.estimatedTokens ?? t('observation.missing')}</dd></div>)}<div><dt>{t('observation.toolSchema')}</dt><dd>{value.toolTokens ?? t('observation.missing')}</dd></div></dl></>}
    <ObservationRawData title={t('observation.configuration')} value={step.configuration} t={t} />
    <p className={styles.hint}>{t('observation.finish', { reason: step.finishReason ?? t('observation.pendingResult') })}</p></>
}
function Status({ status, iconOnly }: { status: string; iconOnly?: boolean }) {
  const t = useContext(ObservationTranslation)
  const statusNames = { queued: t('observation.pendingResult'), proposed: t('observation.notReturned'), completed: t('observation.completed'), running: t('observation.running'), failed: t('observation.failed'), aborted: t('observation.aborted'), suspended: t('observation.suspended') }
  const label = status in statusNames ? statusNames[status as keyof typeof statusNames] : status
  const Icon = status === 'completed' ? CheckCircle2 : status === 'failed' ? TriangleAlert : CircleDashed
  return <span className={styles.status} data-status={status} aria-label={iconOnly ? label : undefined}><Icon size={13} aria-hidden="true" />{!iconOnly && label}</span>
}
function Empty({ title, description }: { title: string; description: string }) {
  return <div className={styles.empty}><Search size={22} aria-hidden="true" /><strong>{title}</strong><p>{description}</p></div>
}

function References({ items }: { items?: ObservationReference[] }) {
  return items?.length ? <div className={styles.recordSubline}>{items.map((item, index) => <span key={index}>
    {item.open ? <Button size="small" onClick={item.open}>{item.label}<ArrowUpRight size={12} /></Button> : <span>{item.label}</span>}
    {item.note && <small> · {item.note}</small>}
  </span>)}</div> : null
}
