import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Code2, Filter, Layers, Play, Plus, RefreshCw, Scissors, Sparkles, Trash2, Wand2 } from 'lucide-react'
import type {
  HistorySource,
  RendererDefinition,
  TextExtractor,
  TextExtractorDraft,
  TextPipelineInspection,
  TextRuleOwner,
  TextTransformPhase,
  TextTransformRule,
  TextTransformRuleDraft,
  LoomScript,
  LoomScriptMount,
  LoomScriptOwner,
  ResolvedLoomScriptRendererMount,
} from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ClientRendererHost, ClientRendererRegistration } from '../../extension-renderers/model/client-renderer-host.js'
import { rendererContributionKey, rendererSurfacePolicies } from '../../extension-renderers/model/renderer-registry.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { PipelineWorkbenchView, type PipelineWorkbenchGroup } from './pipeline-workbench-view.js'
import styles from './text-transform-panel.module.scss'

export type OwnerScope = TextRuleOwner | { kind: 'runtime' }
export type TextTransformRuntimeContext = {
  id: string
  label: string
  source: HistorySource
  consumerAgentSessionId?: string
}
export type TextTransformProps = {
  api: StudioApi['textTransforms']
  loomScriptsApi?: StudioApi['loomScripts']
  onRuntimeChanged?: () => void
  rendererHost?: ClientRendererHost
  runtimeScriptContext?: { workspaceId?: string; timelineId?: string; presetId?: string }
  t: Translator
  source?: HistorySource
  consumerAgentSessionId?: string
  runtimeContexts?: TextTransformRuntimeContext[]
  owner?: OwnerScope
  title?: string
  mobilePane?: 'master' | 'detail'
  onMobilePaneChange?: (pane: 'master' | 'detail') => void
}
type SelectedTarget = { kind: 'empty' } | { kind: 'rule'; id: string } | { kind: 'extractor'; id: string } | { kind: 'script'; id: string } | { kind: 'match'; id: string } | { kind: 'artifact'; id: string } | { kind: 'renderer'; id: string } | { kind: 'inspection' } | { kind: 'renderers' }
export type TextTransformController = ReturnType<typeof useTextTransformController>
const phases: TextTransformPhase[] = ['classify', 'prompt', 'display']

export function useTextTransformController(props: TextTransformProps) {
  const owner = props.owner ?? { kind: 'workspace' as const }
  const ownerKey = ownerId(owner)
  const authoring = owner.kind !== 'runtime'
  const editingOwner: TextRuleOwner = owner.kind === 'runtime' ? { kind: 'workspace' } : owner
  const [rules, setRules] = useState<TextTransformRule[]>([])
  const [extractors, setExtractors] = useState<TextExtractor[]>([])
  const [renderers, setRenderers] = useState<RendererDefinition[]>([])
  const [inspection, setInspection] = useState<TextPipelineInspection>()
  const [scripts, setScripts] = useState<LoomScript[]>([])
  const [mounts, setMounts] = useState<LoomScriptMount[]>([])
  const [resolvedMounts, setResolvedMounts] = useState<ResolvedLoomScriptRendererMount[]>([])
  const [rendererRevision, setRendererRevision] = useState(0)
  const [scriptSource, setScriptSource] = useState('')
  const [scriptFileName, setScriptFileName] = useState('script.loom.js')
  const [overrideVersion, setOverrideVersion] = useState<number>()
  const [disabledRuleIds, setDisabledRuleIds] = useState<string[]>([])
  const [orderedRuleIds, setOrderedRuleIds] = useState<string[]>([])
  const [traceEntryId, setTraceEntryId] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget>(authoring ? { kind: 'empty' } : { kind: 'inspection' })
  const runtimeContexts = props.runtimeContexts ?? (props.source ? [{
    id: sourceId(props.source),
    label: sourceLabel(props.source, props.t),
    source: props.source,
    consumerAgentSessionId: props.consumerAgentSessionId,
  }] : [])
  const runtimeContextsKey = JSON.stringify(runtimeContexts.map(context => [context.id, context.source, context.consumerAgentSessionId]))
  const runtimeScriptContextKey = authoring ? '' : JSON.stringify(props.runtimeScriptContext ?? {})
  const [selectedRuntimeContextId, setSelectedRuntimeContextId] = useState(runtimeContexts[0]?.id ?? '')
  const selectedRuntimeContext = runtimeContexts.find(context => context.id === selectedRuntimeContextId) ?? runtimeContexts[0]
  const source = selectedRuntimeContext?.source ?? props.source
  const consumerAgentSessionId = selectedRuntimeContext?.consumerAgentSessionId ?? props.consumerAgentSessionId
  const [internalMobilePane, setInternalMobilePane] = useState<'master' | 'detail'>('master')
  const [selectedRuleId, setSelectedRuleId] = useState('')
  const [selectedExtractorId, setSelectedExtractorId] = useState('')
  const [ruleText, setRuleText] = useState(defaultRuleText)
  const [extractorText, setExtractorText] = useState(defaultExtractorText)
  const [phase, setPhase] = useState<TextTransformPhase>('display')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inspectionRequest = useRef(0)
  const sourceKey = JSON.stringify({ source, phase, consumerAgentSessionId })
  const mobilePane = props.mobilePane ?? internalMobilePane
  const setMobilePane = props.onMobilePaneChange ?? setInternalMobilePane
  const visibleRules = useMemo(() => rules.filter(rule => ownerMatches(rule.owner, owner)), [owner, rules])
  const visibleExtractors = useMemo(() => extractors.filter(item => ownerMatches(item.owner, owner)), [extractors, owner])
  const finalOrder = useMemo(() => [...visibleRules].sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id)), [visibleRules])
  const scriptOwner = toScriptOwner(owner)
  const visibleMounts = scriptOwner ? mounts.filter(mount => scriptOwnerMatches(mount.target, scriptOwner)) : mounts
  const visibleScripts = visibleMounts.map(mount => ({ mount, script: scripts.find(script => script.id === mount.scriptDocumentId) })).filter((item): item is { mount: LoomScriptMount; script: LoomScript } => Boolean(item.script))
  const runtimeRenderers = props.rendererHost ? listRuntimeRendererRegistrations(props.rendererHost) : []

  useEffect(() => props.rendererHost?.subscribe(() => setRendererRevision(props.rendererHost?.revision() ?? 0)), [props.rendererHost])

  async function refresh() {
    try {
      setBusy(true)
      const [ruleResult, extractorResult, rendererResult, scriptResult, mountResult, resolvedResult] = await Promise.all([
        props.api.listRules(), props.api.listExtractors(), authoring ? props.api.listRenderers() : Promise.resolve({ renderers: [] }),
        authoring ? (props.loomScriptsApi?.list(scriptOwner) ?? Promise.resolve({ scripts: [] })) : Promise.resolve({ scripts: [] }),
        authoring ? (props.loomScriptsApi?.listMounts(scriptOwner) ?? Promise.resolve({ mounts: [] })) : Promise.resolve({ mounts: [] }),
        !authoring && props.loomScriptsApi ? props.loomScriptsApi.resolveRendererMounts(props.runtimeScriptContext) : Promise.resolve({ mounts: [] }),
      ])
      setRules(ruleResult.rules)
      setExtractors(extractorResult.extractors)
      setRenderers(rendererResult.renderers)
      setScripts(scriptResult.scripts)
      setMounts(mountResult.mounts)
      setResolvedMounts(resolvedResult.mounts)
      setError('')
    } catch (cause) {
      setError(readError(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setSelectedTarget(authoring ? { kind: 'empty' } : { kind: 'inspection' })
    setSelectedRuleId('')
    setSelectedExtractorId('')
    setRuleText(defaultRuleText)
    setExtractorText(defaultExtractorText)
    setInspection(undefined)
    setTraceEntryId('')
    inspectionRequest.current += 1
    void refresh()
  }, [ownerKey, runtimeScriptContextKey])
  useEffect(() => {
    setSelectedRuntimeContextId(current => runtimeContexts.some(context => context.id === current) ? current : (runtimeContexts[0]?.id ?? ''))
  }, [runtimeContextsKey])
  useEffect(() => { setInspection(undefined); setTraceEntryId(''); inspectionRequest.current += 1 }, [sourceKey])

  async function inspect(requestedTraceEntryId = traceEntryId) {
    if (!source) return
    const requestId = inspectionRequest.current + 1
    const requestedKey = sourceKey
    inspectionRequest.current = requestId
    setInspection(undefined)
    try {
      setBusy(true)
      let result = await props.api.inspectTextPipeline({ source, phase, ...(consumerAgentSessionId ? { consumerAgentSessionId } : {}), ...(requestedTraceEntryId ? { traceEntryId: requestedTraceEntryId } : {}) })
      if (!requestedTraceEntryId) {
        const defaultTraceEntryId = result.snapshot.entries.at(-1)?.id
        if (defaultTraceEntryId) {
          result = await props.api.inspectTextPipeline({ source, phase, ...(consumerAgentSessionId ? { consumerAgentSessionId } : {}), traceEntryId: defaultTraceEntryId })
          requestedTraceEntryId = defaultTraceEntryId
        }
      }
      if (inspectionRequest.current === requestId && requestedKey === sourceKey) {
        setInspection(result)
        setTraceEntryId(requestedTraceEntryId)
        const overrideResult = await props.api.getOverride({ source, phase, ...(consumerAgentSessionId ? { consumerAgentSessionId } : {}) })
        setOverrideVersion(overrideResult.override?.version)
        setDisabledRuleIds(overrideResult.override?.disabledRuleIds ?? [])
        setOrderedRuleIds(overrideResult.override?.orderedRuleIds ?? result.rules.map(rule => rule.id))
        setError('')
      }
    } catch (cause) {
      if (inspectionRequest.current === requestId && requestedKey === sourceKey) setError(readError(cause))
    } finally {
      if (inspectionRequest.current === requestId) setBusy(false)
    }
  }

  async function selectScript(id: string) {
    setSelectedTarget({ kind: 'script', id })
    setMobilePane('detail')
    const resolved = resolvedMounts.find(item => item.script.id === id)
    if (resolved) {
      setScriptSource(resolved.source)
      setScriptFileName(`${resolved.script.metadataId}.loom.js`)
      return
    }
    const script = scripts.find(item => item.id === id)
    if (!script || !props.loomScriptsApi) return
    try {
      setBusy(true)
      const result = await props.loomScriptsApi.export(id)
      setScriptSource(result.artifact.source)
      setScriptFileName(result.artifact.fileName)
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  async function importScript(file: File) {
    if (!scriptOwner || !props.loomScriptsApi) return
    try {
      setBusy(true)
      const source = await file.text()
      const result = await props.loomScriptsApi.import({ owner: scriptOwner, fileName: file.name, source })
      await props.loomScriptsApi.createMount({ target: scriptOwner, scriptDocumentId: result.script.id, orderIndex: visibleMounts.length })
      await refresh()
      props.onRuntimeChanged?.()
      await selectScript(result.script.id)
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  async function saveScript() {
    if (selectedTarget.kind !== 'script' || !props.loomScriptsApi) return
    const script = scripts.find(item => item.id === selectedTarget.id)
    if (!script) return
    try {
      setBusy(true)
      await props.loomScriptsApi.update({ scriptDocumentId: script.id, expectedVersion: script.version, fileName: scriptFileName, source: scriptSource })
      await refresh()
      props.onRuntimeChanged?.()
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  async function updateScriptMount(mount: LoomScriptMount, patch: Partial<Pick<LoomScriptMount, 'enabled' | 'orderIndex' | 'grantedCapabilities'>>) {
    if (!props.loomScriptsApi) return
    try {
      setBusy(true)
      await props.loomScriptsApi.updateMount({ mountId: mount.id, expectedVersion: mount.version, enabled: patch.enabled ?? mount.enabled, orderIndex: patch.orderIndex ?? mount.orderIndex, ...(mount.pinnedDocumentVersion !== undefined ? { pinnedDocumentVersion: mount.pinnedDocumentVersion } : {}), grantedCapabilities: patch.grantedCapabilities ?? mount.grantedCapabilities })
      await refresh()
      props.onRuntimeChanged?.()
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  async function saveOverride(nextDisabled = disabledRuleIds, nextOrder = orderedRuleIds) {
    if (!source) return
    try {
      setBusy(true)
      const result = await props.api.upsertOverride({ source, phase, ...(consumerAgentSessionId ? { consumerAgentSessionId } : {}), ...(overrideVersion !== undefined ? { expectedVersion: overrideVersion } : {}), disabledRuleIds: nextDisabled, orderedRuleIds: nextOrder })
      setOverrideVersion(result.override.version)
      setDisabledRuleIds(result.override.disabledRuleIds)
      setOrderedRuleIds(result.override.orderedRuleIds)
      await inspect()
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  function selectRule(id: string) {
    setSelectedRuleId(id)
    setSelectedTarget({ kind: 'rule', id })
    setMobilePane('detail')
    const item = rules.find(rule => rule.id === id)
    setRuleText(item ? JSON.stringify(toRuleDraft(item), null, 2) : defaultRuleText)
  }

  function startNewRule() {
    const id = `rule-${Date.now().toString(36)}`
    setSelectedRuleId(id)
    setSelectedTarget({ kind: 'rule', id })
    setMobilePane('detail')
    setRuleText(JSON.stringify({ ...JSON.parse(defaultRuleText), owner: editingOwner }, null, 2))
  }

  function selectExtractor(id: string) {
    setSelectedExtractorId(id)
    setSelectedTarget({ kind: 'extractor', id })
    setMobilePane('detail')
    const item = extractors.find(extractor => extractor.id === id)
    setExtractorText(item ? JSON.stringify(toExtractorDraft(item), null, 2) : defaultExtractorText)
  }

  function startNewExtractor() {
    const id = `extractor-${Date.now().toString(36)}`
    setSelectedExtractorId(id)
    setSelectedTarget({ kind: 'extractor', id })
    setMobilePane('detail')
    setExtractorText(JSON.stringify({ ...JSON.parse(defaultExtractorText), owner: editingOwner }, null, 2))
  }

  async function saveRule() {
    try {
      const existing = rules.find(rule => rule.id === selectedRuleId)
      const draft = { ...(JSON.parse(ruleText) as TextTransformRuleDraft), owner: existing?.owner ?? editingOwner }
      await props.api.upsertRule({ ruleId: selectedRuleId, ...(existing ? { expectedVersion: existing.version } : {}), rule: draft })
      await refresh()
    } catch (cause) { setError(readError(cause)) }
  }

  async function saveExtractor() {
    try {
      const existing = extractors.find(item => item.id === selectedExtractorId)
      const draft = { ...(JSON.parse(extractorText) as TextExtractorDraft), owner: existing?.owner ?? editingOwner }
      await props.api.upsertExtractor({ extractorId: selectedExtractorId, ...(existing ? { expectedVersion: existing.version } : {}), extractor: draft })
      await refresh()
    } catch (cause) { setError(readError(cause)) }
  }

  function formatJson(text: string, setter: (value: string) => void) {
    try {
      setter(JSON.stringify(JSON.parse(text), null, 2))
      setError('')
    } catch (cause) {
      setError(props.t('textTransform.invalidJson', { error: readError(cause) }))
    }
  }

  function selectRuntimeContext(id: string) {
    setSelectedRuntimeContextId(id)
    setSelectedTarget({ kind: 'inspection' })
    setMobilePane('detail')
  }

  function selectTraceEntry(id: string) {
    setTraceEntryId(id)
    void inspect(id)
  }

  return {
    ...props,
    owner,
    authoring,
    runtimeContexts,
    selectedRuntimeContextId,
    source,
    consumerAgentSessionId,
    rules,
    extractors,
    renderers,
    inspection,
    selectedTarget,
    mobilePane,
    selectedRuleId,
    selectedExtractorId,
    ruleText,
    extractorText,
    phase,
    error,
    busy,
    visibleRules,
    visibleExtractors,
    visibleScripts,
    resolvedMounts,
    runtimeRenderers,
    rendererRevision,
    traceEntryId,
    finalOrder,
    refresh,
    inspect,
    selectRule,
    startNewRule,
    selectExtractor,
    selectScript,
    importScript,
    saveScript,
    updateScriptMount,
    saveOverride,
    startNewExtractor,
    saveRule,
    saveExtractor,
    formatJson,
    selectRuntimeContext,
    selectTraceEntry,
    setSelectedTarget,
    setMobilePane,
    setRuleText,
    setExtractorText,
    setPhase,
    scriptSource,
    scriptFileName,
    disabledRuleIds,
    orderedRuleIds,
    searchValue,
    setScriptSource,
    setScriptFileName,
    setSearchValue,
    setError,
  }
}

export function TextTransformPanel(props: TextTransformProps) {
  const controller = useTextTransformController(props)
  const heading = props.title ?? (controller.owner.kind === 'runtime' ? props.t('textTransform.inspectorTitle') : props.t('textTransform.title'))
  if (!controller.authoring) return <RuntimePipelinePanel controller={controller} heading={heading} />
  return <section className={styles.panel} data-loom-component="text-transform-panel">
    <header className={styles.intro}>
      <div><h2>{heading}</h2><p>{controller.owner.kind === 'runtime' ? props.t('textTransform.runtimeDescription') : props.t('textTransform.ownerDescription', { owner: ownerLabel(controller.owner, props.t) })}</p></div>
      <button className={styles.refreshButton} disabled={controller.busy} type="button" onClick={() => void controller.refresh()}><RefreshCw aria-hidden="true" size={14} /><span>{props.t('textTransform.refresh')}</span></button>
    </header>
    {controller.error ? <div className={styles.errorBanner}>{controller.error}</div> : null}
    <MasterDetailWorkbench
      dataComponent="text-transform-workbench"
      masterWidth="minmax(240px, 300px)"
      mobilePane={controller.mobilePane}
      onMobilePaneChange={controller.setMobilePane}
      master={<TextTransformExplorer controller={controller} />}
    >
      <TextTransformDetail controller={controller} />
    </MasterDetailWorkbench>
  </section>
}

export function TextTransformExplorer({ controller }: { controller: TextTransformController }) {
  const { t } = controller
  return <nav aria-label={t('textTransform.navigation')} className={styles.masterNav}>
    {controller.authoring ? <>
      <div className={styles.navGroup}>
        <header><span>{t('textTransform.ownerRules')}</span><button className={styles.navAddBtn} title={t('textTransform.newRule')} type="button" onClick={controller.startNewRule}><Plus aria-hidden="true" size={14} /></button></header>
        {controller.finalOrder.map(rule => <button key={rule.id} aria-current={controller.selectedTarget.kind === 'rule' && controller.selectedTarget.id === rule.id ? 'page' : undefined} className={styles.navItem} type="button" onClick={() => controller.selectRule(rule.id)}><Scissors aria-hidden="true" /><span className={styles.navItemBody}><strong>{rule.name}</strong><small>{ownerLabel(rule.owner, t)} · {rule.enabled ? t('textTransform.enabled') : t('textTransform.disabled')}</small></span><span className={styles.orderBadge}>{rule.orderIndex}</span></button>)}
        {controller.finalOrder.length === 0 ? <button className={styles.navItem} type="button" onClick={controller.startNewRule}><Plus aria-hidden="true" /><span className={styles.navItemBody}><strong>{t('textTransform.newRule')}</strong><small>{t('textTransform.ownerRulesEmpty')}</small></span></button> : null}
      </div>
      <div className={styles.navGroup}>
        <header><span>{t('textTransform.ownerExtractors')}</span><button className={styles.navAddBtn} title={t('textTransform.newExtractor')} type="button" onClick={controller.startNewExtractor}><Plus aria-hidden="true" size={14} /></button></header>
        {controller.visibleExtractors.map(item => <button key={item.id} aria-current={controller.selectedTarget.kind === 'extractor' && controller.selectedTarget.id === item.id ? 'page' : undefined} className={styles.navItem} type="button" onClick={() => controller.selectExtractor(item.id)}><Filter aria-hidden="true" /><span className={styles.navItemBody}><strong>{item.name}</strong><small>{ownerLabel(item.owner, t)} · {item.strategy}</small></span></button>)}
        {controller.visibleExtractors.length === 0 ? <button className={styles.navItem} type="button" onClick={controller.startNewExtractor}><Plus aria-hidden="true" /><span className={styles.navItemBody}><strong>{t('textTransform.newExtractor')}</strong><small>{t('textTransform.ownerExtractorsEmpty')}</small></span></button> : null}
      </div>
      {controller.loomScriptsApi ? <div className={styles.navGroup}>
        <header><span>{t('textTransform.ownerScripts')}</span><label className={styles.navAddBtn} title={t('textTransform.importScript')}><Plus aria-hidden="true" size={14} /><input accept=".loom.js,text/javascript" hidden type="file" onChange={event => { const file = event.target.files?.[0]; if (file) void controller.importScript(file); event.currentTarget.value = '' }} /></label></header>
        {controller.visibleScripts.sort((a, b) => a.mount.orderIndex - b.mount.orderIndex).map(({ script, mount }) => <button key={mount.id} aria-current={controller.selectedTarget.kind === 'script' && controller.selectedTarget.id === script.id ? 'page' : undefined} className={styles.navItem} type="button" onClick={() => void controller.selectScript(script.id)}><Code2 aria-hidden="true" /><span className={styles.navItemBody}><strong>{script.name}</strong><small>{script.metadataId} · {mount.enabled ? t('textTransform.enabled') : t('textTransform.disabled')}</small></span><span className={styles.orderBadge}>{mount.orderIndex}</span></button>)}
        {controller.visibleScripts.length === 0 ? <p className={styles.emptyState}>{t('textTransform.ownerScriptsEmpty')}</p> : null}
      </div> : null}
    </> : <>
      <div className={styles.navGroup}>
        <header><span>{t('textTransform.currentContext')}</span></header>
        {controller.runtimeContexts.map(context => <button key={context.id} aria-current={controller.selectedRuntimeContextId === context.id && controller.selectedTarget.kind === 'inspection' ? 'page' : undefined} className={styles.navItem} type="button" onClick={() => controller.selectRuntimeContext(context.id)}>
          <Sparkles aria-hidden="true" /><span className={styles.navItemBody}><strong>{context.label}</strong><small>{sourceLabel(context.source, t)}</small></span>
        </button>)}
        {controller.runtimeContexts.length === 0 ? <p className={styles.emptyState}>{t('textTransform.noHistory')}</p> : null}
      </div>
      <div className={styles.navGroup}><header><span>{t('textTransform.extensionCapabilities')}</span></header><button aria-current={controller.selectedTarget.kind === 'renderers' ? 'page' : undefined} className={styles.navItem} type="button" onClick={() => { controller.setSelectedTarget({ kind: 'renderers' }); controller.setMobilePane('detail') }}><Layers aria-hidden="true" /><span className={styles.navItemBody}><strong>{t('textTransform.renderers')}</strong><small>{controller.renderers.length} {t('textTransform.rendererCount')}</small></span></button></div>
    </>}
  </nav>
}

export function TextTransformDetail({ controller }: { controller: TextTransformController }) {
  const { t } = controller
  if (controller.selectedTarget.kind === 'rule') {
    const selectedRule = controller.rules.find(item => item.id === controller.selectedRuleId)
    const readOnly = !controller.authoring && selectedRule?.owner.kind !== 'workspace' && selectedRule?.owner.kind !== 'preset'
    return <>{!controller.authoring ? <OverrideControls controller={controller} ruleId={controller.selectedRuleId} /> : null}<EditorDetail controller={controller} icon={<Scissors aria-hidden="true" size={16} />} title={t('textTransform.ruleTitle')} id={controller.selectedRuleId} text={controller.ruleText} setText={controller.setRuleText} onFormat={() => controller.formatJson(controller.ruleText, controller.setRuleText)} onSave={() => void controller.saveRule()} readOnly={readOnly} onDelete={controller.authoring && controller.visibleRules.some(item => item.id === controller.selectedRuleId) ? () => void controller.api.deleteRule({ ruleId: controller.selectedRuleId, expectedVersion: controller.visibleRules.find(item => item.id === controller.selectedRuleId)?.version }).then(controller.refresh).catch(cause => controller.setError(readError(cause))) : undefined} /></>
  }
  if (controller.selectedTarget.kind === 'extractor') {
    const selectedExtractor = controller.extractors.find(item => item.id === controller.selectedExtractorId)
    const readOnly = !controller.authoring && selectedExtractor?.owner.kind !== 'workspace' && selectedExtractor?.owner.kind !== 'preset'
    return <EditorDetail controller={controller} icon={<Filter aria-hidden="true" size={16} />} title={t('textTransform.extractorTitle')} id={controller.selectedExtractorId} text={controller.extractorText} setText={controller.setExtractorText} onFormat={() => controller.formatJson(controller.extractorText, controller.setExtractorText)} onSave={() => void controller.saveExtractor()} readOnly={readOnly} onDelete={controller.authoring && controller.visibleExtractors.some(item => item.id === controller.selectedExtractorId) ? () => void controller.api.deleteExtractor({ extractorId: controller.selectedExtractorId, expectedVersion: controller.visibleExtractors.find(item => item.id === controller.selectedExtractorId)?.version }).then(controller.refresh).catch(cause => controller.setError(readError(cause))) : undefined} />
  }
  if (controller.selectedTarget.kind === 'script') return <ScriptDetail controller={controller} />
  if (controller.selectedTarget.kind === 'match' || controller.selectedTarget.kind === 'artifact') return <RuntimeItemDetail controller={controller} />
  if (controller.selectedTarget.kind === 'renderer') return <RuntimeRendererDetail controller={controller} rendererKey={controller.selectedTarget.id} />
  if (controller.selectedTarget.kind === 'renderers') return <RendererDetail controller={controller} />
  if (controller.selectedTarget.kind === 'empty') return <div className={styles.editorContainer}><p className={styles.emptyState}>{t('textTransform.selectAuthoringItem')}</p></div>
  return <InspectionDetail controller={controller} />
}

function EditorDetail(props: { controller: TextTransformController; icon: ReactNode; title: string; id: string; text: string; setText(value: string): void; onFormat(): void; onSave(): void; onDelete?: () => void; readOnly?: boolean }) {
  const { t } = props.controller
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}>{props.icon}<h3>{props.title}</h3><input className={styles.inlineInput} aria-label={t('textTransform.documentId')} value={props.id} readOnly /></div>{!props.readOnly ? <div className={styles.headerActions}><button className={styles.secondaryButton} type="button" onClick={props.onFormat}><Wand2 aria-hidden="true" size={13} /><span>{t('textTransform.format')}</span></button>{props.onDelete ? <button className={styles.dangerButton} type="button" onClick={props.onDelete}><Trash2 aria-hidden="true" size={13} /><span>{t('textTransform.delete')}</span></button> : null}<button className={styles.primaryButton} disabled={!props.id.trim()} type="button" onClick={props.onSave}>{t('textTransform.save')}</button></div> : null}</header><div className={styles.editorContainer}><textarea className={styles.rawJsonTextarea} readOnly={props.readOnly} spellCheck={false} value={props.text} onChange={event => props.setText(event.target.value)} /></div></>
}

function RuntimePipelinePanel({ controller, heading }: { controller: TextTransformController; heading: string }) {
  const { t } = controller
  const [ownerFilter, setOwnerFilter] = useState('')
  const [effectFilter, setEffectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const allGroups = useMemo<PipelineWorkbenchGroup[]>(() => {
    const inspection = controller.inspection
    if (!inspection) return []
    return [
      { id: 'rules', label: t('textTransform.effectiveRules'), items: inspection.rules.map((rule, index) => ({ id: `rule:${rule.id}`, kind: 'rule', label: rule.name, description: `${rule.matcher.pattern} · v${rule.version}`, owner: ownerLabel(rule.owner, t), effect: rule.effect.kind, order: index + 1, status: controller.disabledRuleIds.includes(rule.id) ? 'disabled' : 'active' })) },
      { id: 'extractors', label: t('textTransform.extractors'), items: inspection.extractors.map(item => ({ id: `extractor:${item.id}`, kind: 'extractor', label: item.name, description: `${item.strategy} · v${item.version}`, owner: ownerLabel(item.owner, t), effect: 'extractor', status: item.enabled ? 'active' : 'disabled' })) },
      { id: 'matches', label: t('textTransform.matchesDiagnostics'), items: inspection.snapshot.matches.map(item => ({ id: `match:${item.matchId}`, kind: 'renderer', label: item.match || item.matchId, description: `${item.entryId} · ${item.inputRange.start}-${item.inputRange.end}`, owner: `${item.ruleId}@${item.ruleVersion}`, effect: 'match', status: item.displayRange ? 'active' : 'degraded' })) },
      { id: 'artifacts', label: t('textTransform.artifacts'), items: inspection.artifacts.map(item => ({ id: `artifact:${item.artifactId}`, kind: 'renderer', label: item.artifactType, description: `${item.values.length} · v${item.extractorVersion}`, owner: item.extractorId, effect: 'artifact', status: item.stale ? 'degraded' : 'active' })) },
      { id: 'renderers', label: t('textTransform.renderers'), items: controller.runtimeRenderers.map(item => ({ id: `renderer:${item.key}`, kind: 'renderer', label: item.registration.definition.name, description: `${item.registration.definition.surface} · ${item.registration.definition.instanceScope}${item.claims.length ? ` · claim:${item.claims.map(claim => claim.scopeKey).join(',')}` : ''}${item.diagnostics.length ? ` · ${item.diagnostics.map(diagnostic => diagnostic.code).join(',')}` : ''}`, owner: item.registration.owner.kind === 'extension' ? `extension:${item.registration.owner.packageId}/${item.registration.owner.moduleId}` : `script:${item.registration.owner.scriptDocumentId}@${item.registration.owner.documentVersion}`, effect: 'renderer', status: item.diagnostics.length ? 'degraded' : 'active' })) },
      { id: 'scripts', label: t('textTransform.ownerScripts'), items: listRuntimeScriptItems(controller.resolvedMounts).map(item => ({ ...item, effect: 'script' })) },
    ]
  }, [controller.disabledRuleIds, controller.inspection, controller.rendererRevision, controller.resolvedMounts, controller.runtimeRenderers, t])
  const ownerOptions = useMemo(() => [...new Set(allGroups.flatMap(group => group.items.map(item => item.owner)))].sort(), [allGroups])
  const effectOptions = useMemo(() => [...new Set(allGroups.flatMap(group => group.items.map(item => item.effect).filter((value): value is string => Boolean(value))))].sort(), [allGroups])
  const groups = useMemo(() => allGroups.map(group => ({
    ...group,
    items: group.items.filter(item => (!ownerFilter || item.owner === ownerFilter) && (!effectFilter || item.effect === effectFilter) && (!statusFilter || item.status === statusFilter)),
  })).filter(group => group.items.length > 0), [allGroups, effectFilter, ownerFilter, statusFilter])
  const selectedId = controller.selectedTarget.kind === 'empty' || controller.selectedTarget.kind === 'inspection' || controller.selectedTarget.kind === 'renderers' ? undefined : `${controller.selectedTarget.kind}:${controller.selectedTarget.id}`
  return <section className={styles.panel} data-loom-component="text-transform-panel">
    <header className={styles.intro}><div><h2>{heading}</h2><p>{t('textTransform.runtimeDescription')}</p></div><div className={styles.headerActions}>
      <select className={styles.inlineInput} value={controller.selectedRuntimeContextId} onChange={event => controller.selectRuntimeContext(event.target.value)}>{controller.runtimeContexts.map(context => <option key={context.id} value={context.id}>{context.label}</option>)}</select>
      <select className={styles.inlineInput} value={controller.phase} onChange={event => controller.setPhase(event.target.value as TextTransformPhase)}>{phases.map(value => <option key={value} value={value}>{t(`textTransform.phase.${value}`)}</option>)}</select>
    </div></header>
    {controller.error ? <div className={styles.errorBanner}>{controller.error}</div> : null}
    <PipelineWorkbenchView
      ariaLabel={t('textTransform.navigation')}
      backLabel={t('textTransform.backToSettings')}
      detail={<TextTransformDetail controller={controller} />}
      emptyLabel={controller.source ? t('textTransform.inspectionPending') : t('textTransform.noHistory')}
      filters={<>
        <select aria-label={t('textTransform.filterOwner')} value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}><option value="">{t('textTransform.filterAllOwners')}</option>{ownerOptions.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label={t('textTransform.filterEffect')} value={effectFilter} onChange={event => setEffectFilter(event.target.value)}><option value="">{t('textTransform.filterAllEffects')}</option>{effectOptions.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label={t('textTransform.filterStatus')} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">{t('textTransform.filterAllStatuses')}</option>{['active', 'disabled', 'degraded', 'conflict'].map(value => <option key={value} value={value}>{value}</option>)}</select>
      </>}
      groups={groups}
      mobilePane={controller.mobilePane}
      preview={<PipelineRuntimePreview controller={controller} />}
      searchPlaceholder={t('textTransform.search')}
      searchValue={controller.searchValue}
      selectedId={selectedId}
      onMobilePaneChange={controller.setMobilePane}
      onSearchChange={controller.setSearchValue}
      onSelect={id => {
        const [kind, ...parts] = id.split(':')
        const targetId = parts.join(':')
        if (kind === 'rule') controller.selectRule(targetId)
        else if (kind === 'extractor') controller.selectExtractor(targetId)
        else if (kind === 'script') void controller.selectScript(targetId)
        else if (kind === 'match' || kind === 'artifact' || kind === 'renderer') controller.setSelectedTarget({ kind, id: targetId })
      }}
    />
  </section>
}

function ScriptDetail({ controller }: { controller: TextTransformController }) {
  const { t } = controller
  const selectedScriptId = controller.selectedTarget.kind === 'script' ? controller.selectedTarget.id : undefined
  const resolved = selectedScriptId ? controller.resolvedMounts.find(item => item.script.id === selectedScriptId) : undefined
  const selected = selectedScriptId ? controller.visibleScripts.find(item => item.script.id === selectedScriptId) : undefined
  if (resolved) return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Code2 aria-hidden="true" size={16} /><h3>{resolved.script.name}</h3><small>{resolved.script.metadataId} · v{resolved.script.version}</small></div></header><div className={styles.inspectionContainer}><section className={styles.inspectionSection}><h4>{t('textTransform.metadata')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify({ mountId: resolved.mountId, enabled: resolved.enabled, orderIndex: resolved.orderIndex, grantedCapabilities: resolved.grantedCapabilities, scriptVersion: resolved.script.scriptVersion, requestedCapabilities: resolved.script.requestedCapabilities, contributions: resolved.script.contributions }, null, 2)}</pre></section><section className={styles.inspectionSection}><h4>{t('textTransform.source')}</h4><textarea className={styles.rawJsonTextarea} readOnly spellCheck={false} value={resolved.source} /></section></div></>
  if (!selected) return <div className={styles.editorContainer}><p className={styles.emptyState}>{t('textTransform.ownerScriptsEmpty')}</p></div>
  const { script, mount } = selected
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Code2 aria-hidden="true" size={16} /><h3>{script.name}</h3><small>{script.metadataId} · v{script.version}</small></div><div className={styles.headerActions}><label><input checked={mount.enabled} type="checkbox" onChange={event => void controller.updateScriptMount(mount, { enabled: event.target.checked })} /> {t('textTransform.enabled')}</label><input aria-label={t('textTransform.order')} className={styles.inlineInput} type="number" value={mount.orderIndex} onChange={event => void controller.updateScriptMount(mount, { orderIndex: Number(event.target.value) })} /><button className={styles.primaryButton} disabled={controller.busy} type="button" onClick={() => void controller.saveScript()}>{t('textTransform.save')}</button></div></header><div className={styles.inspectionContainer}>
    <section className={styles.inspectionSection}><h4>{t('textTransform.metadata')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify({ owner: script.owner, scriptVersion: script.scriptVersion, runtime: script.runtime, requestedCapabilities: script.requestedCapabilities, contributions: script.contributions }, null, 2)}</pre></section>
    <section className={styles.inspectionSection}><h4>{t('textTransform.grants')}</h4>{script.requestedCapabilities.length === 0 ? <p className={styles.emptyState}>{t('textTransform.noGrants')}</p> : script.requestedCapabilities.map(capability => <label key={capability}><input checked={mount.grantedCapabilities.includes(capability)} type="checkbox" onChange={event => void controller.updateScriptMount(mount, { grantedCapabilities: event.target.checked ? [...mount.grantedCapabilities, capability] : mount.grantedCapabilities.filter(value => value !== capability) })} /> {capability}</label>)}</section>
    <section className={styles.inspectionSection}><h4>{t('textTransform.source')}</h4><input className={styles.inlineInput} value={controller.scriptFileName} onChange={event => controller.setScriptFileName(event.target.value)} /><textarea className={styles.rawJsonTextarea} spellCheck={false} value={controller.scriptSource} onChange={event => controller.setScriptSource(event.target.value)} /></section>
  </div></>
}

function RuntimeItemDetail({ controller }: { controller: TextTransformController }) {
  const target = controller.selectedTarget
  const value = target.kind === 'match' ? controller.inspection?.snapshot.matches.find(item => item.matchId === target.id) : target.kind === 'artifact' ? controller.inspection?.artifacts.find(item => item.artifactId === target.id) : undefined
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Layers aria-hidden="true" size={16} /><h3>{target.kind}</h3></div></header><div className={styles.editorContainer}><pre className={styles.dryRunOutput}>{JSON.stringify(value, null, 2)}</pre></div></>
}

function OverrideControls({ controller, ruleId }: { controller: TextTransformController; ruleId: string }) {
  const disabled = controller.disabledRuleIds.includes(ruleId)
  const order = controller.orderedRuleIds.includes(ruleId) ? controller.orderedRuleIds : [...controller.orderedRuleIds, ruleId]
  const index = order.indexOf(ruleId)
  const move = (offset: number) => {
    const nextIndex = index + offset
    if (nextIndex < 0 || nextIndex >= order.length) return
    const next = [...order]
    ;[next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!]
    void controller.saveOverride(controller.disabledRuleIds, next)
  }
  return <div className={styles.detailHeader}><div className={styles.headerTitle}><Layers aria-hidden="true" size={15} /><strong>{controller.t('textTransform.override')}</strong></div><div className={styles.headerActions}><label><input checked={!disabled} type="checkbox" onChange={event => void controller.saveOverride(event.target.checked ? controller.disabledRuleIds.filter(id => id !== ruleId) : [...controller.disabledRuleIds, ruleId], order)} /> {controller.t('textTransform.enabled')}</label><button className={styles.secondaryButton} disabled={index <= 0} type="button" onClick={() => move(-1)}>{controller.t('textTransform.moveUp')}</button><button className={styles.secondaryButton} disabled={index < 0 || index >= order.length - 1} type="button" onClick={() => move(1)}>{controller.t('textTransform.moveDown')}</button></div></div>
}

function InspectionDetail({ controller }: { controller: TextTransformController }) {
  const { t } = controller
  const snapshot = controller.inspection?.snapshot
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Sparkles aria-hidden="true" size={16} /><h3>{t('textTransform.inspector')}</h3><select className={styles.inlineInput} value={controller.phase} onChange={event => controller.setPhase(event.target.value as TextTransformPhase)}>{phases.map(value => <option key={value} value={value}>{t(`textTransform.phase.${value}`)}</option>)}</select></div><div className={styles.headerActions}><button className={styles.primaryButton} disabled={!controller.source || controller.busy} type="button" onClick={() => void controller.inspect()}><Play aria-hidden="true" size={13} /><span>{t('textTransform.inspect')}</span></button></div></header><div className={styles.inspectionContainer}>{!controller.inspection ? <p className={styles.emptyState}>{controller.source ? t('textTransform.inspectionPending') : t('textTransform.noHistory')}</p> : <><section className={styles.inspectionSection}><h4>{t('textTransform.effectiveRules')}</h4>{controller.inspection.rules.map((rule, index) => <article className={styles.ruleCard} key={rule.id}><strong>{index + 1}. {rule.name}</strong><small>{ownerLabel(rule.owner, t)} · {rule.matcher.kind}: {rule.matcher.pattern}</small><small>{t('textTransform.effect')}: {rule.effect.kind}</small></article>)}{controller.inspection.rules.length === 0 ? <p className={styles.emptyState}>{t('textTransform.noEffectiveRules')}</p> : null}</section><section className={styles.inspectionSection}><h4>{t('textTransform.extractors')}</h4><p className={styles.metaLine}>{controller.inspection.extractors.map(item => `${item.name} · ${ownerLabel(item.owner, t)}`).join('；') || t('textTransform.noEffectiveExtractors')}</p></section><section className={styles.inspectionSection}><h4>{t('textTransform.matchesDiagnostics')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify({ matches: snapshot?.matches ?? [], diagnostics: snapshot?.diagnostics ?? [] }, null, 2)}</pre></section><section className={styles.inspectionSection}><h4>{t('textTransform.dryRun')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify(snapshot, null, 2)}</pre></section></>}</div></>
}

function PipelineRuntimePreview({ controller }: { controller: TextTransformController }) {
  const { inspection, t } = controller
  const snapshot = inspection?.snapshot
  const trace = snapshot?.trace
  const selectedRuleId = controller.selectedTarget.kind === 'rule' ? controller.selectedTarget.id : undefined
  const selectedMatchId = controller.selectedTarget.kind === 'match' ? controller.selectedTarget.id : undefined
  const selectedArtifactId = controller.selectedTarget.kind === 'artifact' ? controller.selectedTarget.id : undefined
  const entries = snapshot?.entries ?? []

  return <section className={styles.pipelinePreview}>
    <header className={styles.previewHeader}>
      <div><small>{t('textTransform.preview')}</small><h3>{t('textTransform.assemblyPreview')}</h3></div>
      {entries.length > 0 ? <select aria-label={t('textTransform.previewEntry')} value={controller.traceEntryId || entries.at(-1)?.id} onChange={event => controller.selectTraceEntry(event.target.value)}>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.id}</option>)}</select> : null}
    </header>
    {!inspection ? <p className={styles.emptyState}>{controller.source ? t('textTransform.inspectionPending') : t('textTransform.noHistory')}</p> : <div className={styles.previewContent}>
      <PreviewText label={t('textTransform.canonical')} value={trace?.canonicalText ?? entries.find(entry => entry.id === controller.traceEntryId)?.originalText ?? ''} />
      <div className={styles.traceSteps}>
        {(trace?.steps ?? []).map(step => <section data-selected={step.ruleId === selectedRuleId || step.matchIds.includes(selectedMatchId ?? '') ? 'true' : undefined} key={`${step.ruleId}-${step.stepIndex}`}>
          <header><strong>{step.stepIndex + 1}. {inspection.rules.find(rule => rule.id === step.ruleId)?.name ?? step.ruleId}</strong><small>{step.effect} · {step.matched ? t('textTransform.matched') : t('textTransform.notMatched')}</small></header>
          <PreviewText label={t('textTransform.input')} value={step.inputText} />
          <PreviewText label={t('textTransform.output')} value={step.outputText} />
          {step.matchIds.length > 0 ? <code>{step.matchIds.join(' · ')}</code> : null}
        </section>)}
        {trace && trace.steps.length === 0 ? <p className={styles.emptyState}>{t('textTransform.noTraceSteps')}</p> : null}
      </div>
      <PreviewText label={t('textTransform.finalDisplay')} value={trace?.finalText ?? entries.find(entry => entry.id === controller.traceEntryId)?.text ?? ''} />
      <section className={styles.previewFacts}>
        <strong>{t('textTransform.matchesDiagnostics')}</strong>
        <pre>{JSON.stringify({
          matches: (snapshot?.matches ?? []).filter(match => !selectedMatchId || match.matchId === selectedMatchId),
          artifacts: (inspection.artifacts ?? []).filter(artifact => !selectedArtifactId || artifact.artifactId === selectedArtifactId),
          diagnostics: snapshot?.diagnostics ?? [],
        }, null, 2)}</pre>
      </section>
    </div>}
  </section>
}

function PreviewText(props: { label: string; value: string }) {
  return <section className={styles.previewText}><strong>{props.label}</strong><pre>{props.value || '—'}</pre></section>
}

function RuntimeRendererDetail({ controller, rendererKey }: { controller: TextTransformController; rendererKey: string }) {
  const item = controller.runtimeRenderers.find(candidate => candidate.key === rendererKey)
  if (!item) return <div className={styles.editorContainer}><p className={styles.emptyState}>{controller.t('textTransform.noRenderers')}</p></div>
  const owner = item.registration.owner.kind === 'extension'
    ? `extension:${item.registration.owner.packageId}/${item.registration.owner.moduleId}`
    : `script:${item.registration.owner.scriptDocumentId}@${item.registration.owner.documentVersion}`
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Layers aria-hidden="true" size={16} /><h3>{item.registration.definition.name}</h3><small>{owner}</small></div></header><div className={styles.inspectionContainer}>
    <section className={styles.inspectionSection}><h4>{controller.t('textTransform.metadata')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify({ contributionKey: item.key, owner: item.registration.owner, definition: item.registration.definition }, null, 2)}</pre></section>
    <section className={styles.inspectionSection}><h4>{controller.t('textTransform.runtimeState')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify({ claims: item.claims, instances: item.instances, diagnostics: item.diagnostics }, null, 2)}</pre></section>
  </div></>
}

function RendererDetail({ controller }: { controller: TextTransformController }) {
  const { t } = controller
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Layers aria-hidden="true" size={16} /><h3>{t('textTransform.renderers')}</h3></div></header><div className={styles.editorContainer}>{controller.renderers.length === 0 ? <p className={styles.emptyState}>{t('textTransform.noRenderers')}</p> : <div className={styles.rendererGrid}>{controller.renderers.map(renderer => <div key={renderer.id} className={styles.rendererCard}><strong>{renderer.name}</strong><small>{renderer.surface}</small><small>{renderer.instanceScope}</small></div>)}</div>}</div></>
}

function ownerMatches(value: TextRuleOwner, scope: OwnerScope): boolean {
  if (scope.kind === 'runtime') return false
  if (scope.kind === 'workspace') return value.kind === 'workspace' || value.kind === 'user-override'
  if (scope.kind === 'card') return value.kind === 'card' && value.cardId === scope.cardId
  if (scope.kind === 'preset') return value.kind === 'preset' && value.presetId === scope.presetId
  if (scope.kind === 'extension') return value.kind === 'extension' && value.packageId === scope.packageId && value.moduleId === scope.moduleId
  return value.kind === 'user-override'
}

function ownerId(owner: OwnerScope): string { return owner.kind === 'runtime' ? 'runtime' : JSON.stringify(owner) }
function toScriptOwner(owner: OwnerScope): LoomScriptOwner | undefined { if (owner.kind === 'card') return { kind: 'card', cardId: owner.cardId }; if (owner.kind === 'preset') return { kind: 'preset', presetId: owner.presetId }; if (owner.kind === 'workspace') return { kind: 'workspace', workspaceId: 'workspace' }; if (owner.kind === 'user-override') return { kind: 'user' }; return undefined }
function scriptOwnerMatches(left: LoomScriptOwner, right: LoomScriptOwner): boolean { return JSON.stringify(left) === JSON.stringify(right) }
export function listRuntimeRendererRegistrations(host: ClientRendererHost): Array<{
  key: string
  registration: ClientRendererRegistration
  claims: ReturnType<ClientRendererHost['activeClaims']>
  instances: ReturnType<ClientRendererHost['instances']>
  diagnostics: ReturnType<ClientRendererHost['diagnostics']>
}> {
  const claims = host.activeClaims()
  const instances = host.instances()
  const diagnostics = host.diagnostics()
  return (Object.keys(rendererSurfacePolicies) as Array<keyof typeof rendererSurfacePolicies>).flatMap(surface => host.list(surface)).map(registration => {
    const key = rendererContributionKey(registration)
    return {
      key,
      registration,
      claims: claims.filter(claim => claim.contributionKey === key),
      instances: instances.filter(instance => instance.contributionKey === key),
      diagnostics: diagnostics.filter(diagnostic => diagnostic.contributionKey === key),
    }
  })
}
export function listRuntimeScriptItems(mounts: readonly ResolvedLoomScriptRendererMount[]): PipelineWorkbenchGroup['items'] {
  return mounts.filter(mount => mount.enabled).map(mount => ({
    id: `script:${mount.script.id}`,
    kind: 'script',
    label: mount.script.name,
    description: `${mount.script.metadataId} · ${mount.script.contributions.flatMap(item => item.inputs.map(input => input.kind === 'match' ? `match:${input.ruleId}` : `artifact:${input.artifactType}`)).join(', ')}`,
    owner: `resolved@${mount.script.version}`,
    order: mount.orderIndex,
    status: 'active',
  }))
}
function ownerLabel(owner: TextRuleOwner | OwnerScope, t: Translator): string { if (owner.kind === 'workspace') return t('textTransform.ownerWorkspace'); if (owner.kind === 'user-override') return t('textTransform.ownerUserOverride'); if (owner.kind === 'card') return t('textTransform.ownerCard', { id: owner.cardId }); if (owner.kind === 'preset') return t('textTransform.ownerPreset', { id: owner.presetId }); if (owner.kind === 'extension') return t('textTransform.ownerExtension', { id: owner.packageId }); return t('textTransform.ownerRuntime') }
function sourceLabel(source: HistorySource, t: Translator): string { return source.kind === 'narrative' ? t('textTransform.narrativeSource', { id: source.timelineId }) : t('textTransform.agentSessionSource', { id: source.sessionId }) }
function sourceId(source: HistorySource): string { return source.kind === 'narrative' ? `narrative:${source.timelineId}:${source.branchId}` : `agent-session:${source.sessionId}` }
function toRuleDraft(rule: TextTransformRule): TextTransformRuleDraft { const draft = { ...rule } as Record<string, unknown>; delete draft.id; delete draft.version; delete draft.createdAt; delete draft.updatedAt; return draft as TextTransformRuleDraft }
function toExtractorDraft(extractor: TextExtractor): TextExtractorDraft { const draft = { ...extractor } as Record<string, unknown>; delete draft.id; delete draft.version; delete draft.createdAt; delete draft.updatedAt; return draft as TextExtractorDraft }
function readError(value: unknown): string { return value instanceof Error ? value.message : String(value) }
const defaultRuleText = JSON.stringify({ name: 'Hide marker', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0, matcher: { kind: 'regex', pattern: '<marker>[\\s\\S]*?</marker>', flags: 'g' }, effect: { kind: 'replace', replacement: '' }, targets: ['narrative', 'agent-session'], phases: ['prompt', 'display'] }, null, 2)
const defaultExtractorText = JSON.stringify({ name: 'World State', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0, targets: ['narrative', 'agent-session'], matcher: { kind: 'regex', pattern: '<WorldState>([\\s\\S]*?)</WorldState>', flags: 'g', contentGroup: 1 }, strategy: 'latest-valid', parser: 'key-value-lines' }, null, 2)
