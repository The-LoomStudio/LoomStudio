import { InfoDialog } from '../../shared/ui/info-dialog/info-dialog.js'
import { useWorkbenchView } from '../../shared/studio-shell/use-workbench-view.js'
import { LogOrigin } from './log-origin.js'
import { ObservationSourceIcon } from './observation-source-icon.js'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, Check, Copy, ChevronLeft, ChevronRight, ArrowLeft, ArrowUpRight, CheckCircle2, CircleDashed, Search, TriangleAlert, Wrench } from 'lucide-react'
import { Button, Dialog, IconButton, SearchField, Tabs } from '@loom-studio/ui'
import { WindowColumnLayout } from '../../shared/ui/window-column-layout/window-column-layout.js'
import type { ObservationRecord, ObservationStep, ObservationReference } from '../../features/observability/model/observation-view.js'
import { t as defaultTranslator, type Translator } from '../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import type { ObservationMessage } from '../../features/observability/model/observation-view.js'
import styles from '../../features/observability/ui/observability-workbench.module.scss'
import { ObservationRawData } from '../../features/observability/ui/observation-dialog.js'
import { ObservationMessages, ObservationMessageCard } from '../../features/observability/ui/observation-messages.js'
import { useTokenCounts } from '../../shared/tokenizer/use-token-counts.js'
import { messageTokenParts, sumTokenParts } from '../../features/observability/model/observation-token-view.js'
import { groupMacroReads } from '../../features/observability/model/observation-variables.js'

import { ObservationSources } from '../../features/observability/ui/observation-sources.js'
import { ToolArguments, ToolResult } from '../../features/observability/ui/observation-content.js'

const ObservationTranslation = createContext<Translator>(defaultTranslator)

type View = 'messages' | 'build' | 'variables' | 'tools' | 'usage'

type WorkbenchProps = {
  t?: Translator
  records: ObservationRecord[]
  directoryHeader?: ReactNode
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

function WorkbenchContent({ records, directoryHeader, toolbar, selectedRecordId, selectedRecord, listNotice, listFooter, detailNotice, stepNotice, onSelectRecord, onSelectStep, onKindChange }: WorkbenchProps) {
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

  const master = <aside data-loom-mobile-tab-scope="" className={styles.master} aria-label={t('observation.records')}>
    {directoryHeader}
    <div className={styles.directoryNotices}>{toolbar}</div>
    <div className={styles.listHeader}><span>{t('observation.recentRecords')}</span><small>{visible.length}</small></div>
    <SearchField aria-label={t('observation.search')} placeholder={t('observation.searchLoaded')} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={t('observation.clearSearch')} />
    <Tabs ariaLabel={t('observation.recordKind')} size="compact" activeId={filter} onChange={value => { setFilter(value); onKindChange?.(value === 'all' ? undefined : value) }} items={[
      { id: 'all', label: t('observation.all') }, { id: 'run', label: kindNames.run }, { id: 'build', label: kindNames.build }, { id: 'api', label: kindNames.api },
    ]} />
    {listNotice}
    <div className={styles.records}>
      {visible.map(record => <button type="button" key={record.id} className={styles.record} aria-current={selected?.id === record.id ? 'true' : undefined} onClick={() => { setSelectedId(record.id); onSelectRecord?.(record.id); setDetailOpen(true) }}>
        <span className={styles.recordMeta}><span>{kindNames[record.kind]}</span><time>{record.time}</time></span>
        <LogOrigin source={record.source} title={record.title} />
        <span className={styles.recordMeta}><span>{record.stepCount === undefined ? (onSelectRecord ? '' : t('observation.stepCount', { count: record.steps.length })) : t('observation.stepCount', { count: record.stepCount })}</span><Status status={record.status} /></span>
      </button>)}
      {!visible.length && !listNotice && <Empty title={records.length ? t('observation.noMatches') : t('observation.empty')} description={records.length ? t('observation.trySearch') : t('observation.emptyHint')} />}
    </div>
    {listFooter}
  </aside>
  const detail = selected ? detailNotice ?? <RecordView key={selected.id} record={selectedRecord?.id === selected.id ? selectedRecord : selected} onSelectStep={onSelectStep} stepNotice={selectedRecord?.id === selected.id ? stepNotice : undefined} /> : detailNotice ?? <Empty title={t('observation.selectRecord')} description={t('observation.selectHint')} />
  return <div ref={container} className={styles.workbench} data-loom-component="observability-workbench">

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
  const [view, setView] = useWorkbenchView<View>('model-log.detail', 'messages', ['messages', 'build', 'variables', 'tools', 'usage'])
  const [infoOpen, setInfoOpen] = useState(false)
  const [sourceId, setSourceId] = useState<string>()
  const [changesOnly, setChangesOnly] = useState(true)
  const step = record.steps.find(item => item.id === stepId) ?? record.steps.find(item => item.kind === 'request') ?? record.steps[0]
  const stepIndex = record.steps.findIndex(item => item.id === step?.id)
  function selectStep(id: string) { setStepId(id); setSourceId(undefined) }
  useEffect(() => { if (step) onSelectStep?.(step.id) }, [step?.id, onSelectStep])
  useEffect(() => { if (step && !stepId) setStepId(step.id) }, [step?.id, stepId])
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [step?.id, view])
  return <section data-loom-mobile-tab-scope="" ref={scroller} className={styles.detail} aria-label={record.title}>
    <div className={styles.recordHeading}>
      <h2><LogOrigin source={record.source} title={record.title} metadata={<span className={styles.eyebrow}>{kindNames[record.kind]} · <time>{record.time}</time></span>} /><Status status={record.status} /><IconButton aria-label={t('observation.identifiers')} onClick={() => setInfoOpen(true)}><Info size={16} /></IconButton></h2>
      <Dialog className={styles.identityDialog} open={infoOpen} title={t('observation.identifiers')} onClose={() => setInfoOpen(false)} closeOnBackdrop>
        <div className={styles.identitySections}>
          <section className={styles.identitySection}><h3>{t('observation.runInfo')}</h3><p>{kindNames[record.kind]} · {record.time} · {record.origin}</p></section>
          <section className={styles.identitySection}><h3>{t('observation.relatedResources')}</h3><References items={[...(record.references ?? []), ...(step?.references ?? [])]} /></section>
          <section className={styles.identitySection}><h3>{t('observation.identifiers')}</h3><Identity inline values={record.identity ?? { ID: record.id, context: record.context }} /></section>
        </div>
      </Dialog>
    </div>
    <Tabs className={styles.steps} ariaLabel={t('observation.steps')} activeId={step?.id ?? ''} onChange={selectStep} size="compact"
      items={record.steps.map(item => ({ id: item.id, label: <span className={styles.stepLabel}>
        <Status status={item.status} iconOnly /><span title={item.title}>{item.title}</span><small>{item.duration}</small>
      </span> }))} />
    {step ? <div data-loom-mobile-tab-scope="" style={{ display: 'contents' }}>
      {(step.diagnostic || record.diagnostic) && <div className={styles.diagnostic}><TriangleAlert size={15} /><span><strong>{t(step.status === 'failed' ? 'observation.requestFailed' : 'observation.diagnosticDetails')}</strong><span className={styles.diagnosticPreview}>{step.diagnostic ?? record.diagnostic}</span></span><InfoDialog title={t('observation.diagnosticDetails')}><p>{step.diagnostic ?? record.diagnostic}</p></InfoDialog></div>}
      <div className={styles.detailNavigation}>
        <nav className={styles.stepContext} aria-label={t('observation.currentStep')}>
          <Button size="small" aria-label={t('observation.previousStep')} title={t('observation.previousStep')} disabled={stepIndex <= 0} onClick={() => selectStep(record.steps[stepIndex - 1]!.id)}><ChevronLeft size={16} /></Button>
          <span className={styles.stepContextModel} title={step.model}>{step.model}</span>
          <ObservationRawData icon key={step.id} title={t('observation.raw')} value={step.raw ?? step} t={t}><Identity inline values={step.identity ?? { ID: step.id }} /></ObservationRawData>
          <Button size="small" aria-label={t('observation.nextStep')} title={t('observation.nextStep')} disabled={stepIndex >= record.steps.length - 1} onClick={() => selectStep(record.steps[stepIndex + 1]!.id)}><ChevronRight size={16} /></Button>
        </nav>
        <Tabs ariaLabel={t('observation.stepDetails')} items={tabs} activeId={view} onChange={setView} bordered />
      </div>
      <div className={styles.content} role="tabpanel" aria-label={tabs.find(tab => tab.id === view)?.label}>
        {stepNotice ?? <>
        {view === 'messages' && (step.capability ? <><h3>{t('observation.capabilityInput')}</h3><p className={styles.hint}>{[step.capability.providerId, step.capability.capabilityId].filter(Boolean).join(' / ')}</p><ObservationRawData title={t('observation.capabilityInput')} text={step.capabilityInput} t={t} /></> : <>
          <div className={styles.sectionHeading}><h3>{t(step.kind === 'build' ? 'observation.inputMessages' : 'observation.stepMessages')}</h3>{step.kind !== 'build' && <Button size="small" aria-pressed={changesOnly} onClick={() => setChangesOnly(!changesOnly)}>{t(changesOnly ? 'observation.allMessages' : 'observation.changedMessages')}</Button>}</div>
          <InputMessages step={step} changesOnly={step.kind !== 'build' && changesOnly} onSource={id => { setSourceId(id); setView('build') }} />
          {step.kind !== 'build' && <>
            {step.reasoning && <div className={styles.stepOutput}><h4>{t('agent.reasoning')}</h4><MessageReader message={step.reasoning} onSource={() => {}} /></div>}
            {step.response && <div className={styles.stepOutput}><h4>{t('observation.assistantContent')}</h4><MessageReader message={step.response} onSource={() => {}} /></div>}
            {!!step.tools.length && <div className={styles.stepOutput}><h4>{t('observation.toolCalls')}</h4>{step.tools.map(tool => <ToolReader key={tool.id} tool={tool} />)}</div>}
            {!step.response && !step.reasoning && !step.tools.length && <p className={styles.hint}>{t(step.outputRecorded ? 'observation.noAssistantOutput' : 'observation.outputMissing')}</p>}
          </>}
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
              <div className={styles.sectionHeading}><h4>{t('observation.variableConsumers')}</h4><Identity values={{ path: macro.path, source: macro.source }} /></div>
              {macro.consumers.map(consumer => {
                const source = step.sources.find(item => item.id === consumer.hostId)
                return <div className={styles.variableConsumer} key={consumer.id}>
                  <div className={styles.sectionHeading}>
                    {source ? <Button size="small" onClick={() => { setSourceId(source.id); setView('build') }}><ArrowUpRight size={13} />{source.title === source.id ? t('observation.variableUnnamedSource') : source.title}</Button> : <span>{t('observation.variableSourceMissing')}</span>}
                    <span>{t('observation.variableReads', { count: consumer.count })} <Identity values={{ host: consumer.hostId }} /></span>
                  </div>
                  <small>{consumer.stage === 'source' ? t('observation.variableSourceStage') : consumer.stage === 'render' ? t('observation.variableRenderStage') : consumer.stage ?? t('observation.missing')}</small>
                  {macro.values.length > 1 && <div className={styles.variableConsumerValue}>{consumer.value}</div>}
                </div>
              })}
            </div>
          </details>)}
          {!step.variables.length && <Empty title={step.evidence && !step.evidence.variables ? t('observation.variablesMissing') : t('observation.variablesEmpty')} description={t('observation.variablesEvidence')} />}
        </>}
        {view === 'tools' && <>
          <ToolDefinitions definitions={step.toolDefinitions} />
          <h3>{t('observation.toolCalls')}</h3>
          {step.tools.map(tool => <ToolReader key={tool.id} tool={tool} />)}
          {!step.tools.length && <Empty title={step.evidence && !step.evidence.tools ? t('observation.toolsMissing') : t('observation.toolsEmpty')} description={t('observation.toolsHint')} />}
        </>}
        {view === 'usage' && <Usage step={step} />}
        </>}
      </div>
    </div> : <Empty title={t('observation.stepsEmpty')} description={t('observation.stepsWaiting')} />}
  </section>
}

function InputMessages({ step, changesOnly, onSource }: { step: ObservationStep; changesOnly: boolean; onSource(id?: string): void }) {
  const t = useContext(ObservationTranslation)
  return <ObservationMessages key={step.id} step={step} changesOnly={changesOnly} onSource={onSource} t={t} />
}

function ToolDefinitions({ definitions }: { definitions: ObservationStep['toolDefinitions'] }) {
  const t = useContext(ObservationTranslation)
  return <section className={styles.toolDefinitions}>
    <div className={styles.sectionHeading}><h3>{t('observation.toolDefinitions')} · {definitions?.length ?? '—'}</h3><ObservationRawData icon title={`${t('observation.toolDefinitions')} · JSON`} value={definitions} t={t} /></div>
    {definitions === undefined && <p className={styles.hint}>{t('observation.toolDefinitionsMissing')}</p>}
    {definitions?.map((value, index) => {
      const raw = toolObject(value)
      const definition = toolObject(raw.function ?? raw)
      const schema = toolObject(definition.inputSchema ?? definition.parameters)
      const required = Array.isArray(schema.required) ? schema.required : []
      return <fieldset key={index} className={`${styles.source} ${styles.messageFrame}`}>
        <legend className={styles.frameLegend}><span className={styles.frameHeading}><span className={styles.frameTitle}><Wrench size={14} />{typeof definition.name === 'string' ? definition.name : `#${index + 1}`}</span><span className={styles.frameLine} /><ObservationRawData icon title={`${typeof definition.name === 'string' ? definition.name : t('observation.toolDefinitions')} · JSON`} value={value} t={t} /></span></legend>
        {typeof definition.description === 'string' && <p className={styles.toolDescription}>{definition.description}</p>}
        {Object.keys(toolObject(schema.properties)).length > 0 && <dl className={styles.toolParameters}>{Object.entries(toolObject(schema.properties)).map(([name, parameter]) => {
          const field = toolObject(parameter)
          return <div key={name}><dt><code>{name}</code>{typeof field.type === 'string' && <small>{field.type}</small>}{required.includes(name) && <span aria-label={t('observation.requiredParameter')}>*</span>}</dt><dd>{typeof field.description === 'string' ? field.description : '—'}</dd></div>
        })}</dl>}
      </fieldset>
    })}
  </section>
}

// Recorded provider definitions are untyped and may use either the normalized or function envelope.
function toolObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function ToolReader({ tool }: { tool: ObservationStep['tools'][number] }) {
  const t = useContext(ObservationTranslation)
  return <fieldset className={`${styles.source} ${styles.messageFrame}`}>
    <legend className={styles.frameLegend}><span className={styles.frameHeading}><span className={styles.frameTitle}><Wrench size={14} />{tool.name}</span><span className={styles.frameLine} /><span className={styles.headingActions}><Status status={tool.status} /><ObservationRawData icon title={t('observation.rawTool')} value={tool} t={t} /></span></span></legend>
    <h4>{t('observation.input')}</h4><ToolArguments value={tool.input} t={t} />
    <h4>{t('observation.result')}</h4><div data-failed={tool.status === 'failed'} className={styles.toolOutcome}><ToolResult value={tool.result} t={t} /></div>
  </fieldset>
}

function Identity({ values, inline = false }: { values: Record<string, string | undefined>; inline?: boolean }) {
  const t = useContext(ObservationTranslation)
  const [copyState, setCopyState] = useState<string>()
  const content = <><dl>
    {Object.entries(values).filter(([, value]) => value).map(([name, value]) => <div key={name}><dt>{name}</dt><dd><code>{value}</code><IconButton size="small" title={copyState === name ? t('observation.copied') : t('observation.copy')} aria-label={`${t('observation.copy')} ${name}`} onClick={async () => setCopyState(await tryWriteClipboardText(value!) ? name : 'error')}>{copyState === name ? <Check size={12} /> : <Copy size={12} />}</IconButton></dd></div>)}
  </dl>{copyState === 'error' && <p role="status">{t('observation.copyFailed')}</p>}</>
  return inline ? <div className={styles.identity}>{content}</div> : <InfoDialog title={t('observation.identifiers')}><div className={styles.identity}>{content}</div></InfoDialog>
}

function MessageReader({ message, index, onSource }: { message: ObservationMessage; index?: number; onSource(): void }) {
  const t = useContext(ObservationTranslation)
  const parts = messageTokenParts([message])
  const counted = useTokenCounts(parts.map(part => part.text), message.id)
  const tokens = sumTokenParts(parts, new Map(parts.map((part, position) => [part.text, counted.currentCounts[position]])))
  return <ObservationMessageCard message={message} index={index} tokens={tokens} onSource={onSource} t={t} />
}

function Usage({ step }: { step: ObservationStep }) {
  const t = useContext(ObservationTranslation)
  const value = step.measurement
  return <><h3>{t('observation.stepUsage')}</h3><div className={styles.metrics}>
    {[[t('observation.requestEstimate'), value?.estimatedTokens], [t('observation.inputUsage'), value?.inputTokens], [t('observation.outputUsage'), value?.outputTokens], [t('observation.duration'), step.duration], [t('observation.firstOutput'), step.firstOutputMs === undefined ? undefined : `${(step.firstOutputMs >= 1000 ? step.firstOutputMs / 1000 : step.firstOutputMs).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${step.firstOutputMs >= 1000 ? 's' : 'ms'}`]].map(([label, number]) => <div key={label}><small>{label}</small><strong>{typeof number === 'number' ? number.toLocaleString() : number ?? t('observation.notReturned')}</strong></div>)}
  </div><p className={styles.hint}>{value?.note ?? t('observation.measurementMissing')}</p>
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
  return items?.length ? <div className={styles.referenceLinks}>{items.map((item, index) => <span key={index}>
    {item.open ? <button className={styles.referenceLink} type="button" title={item.note} onClick={item.open}>{item.label}</button> : <span>{item.label}</span>}
    {!item.open && item.note && <small> · {item.note}</small>}
  </span>)}</div> : null
}
