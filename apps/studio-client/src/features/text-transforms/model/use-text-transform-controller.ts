import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  HistorySource,
  RendererDefinition,
  TextExtractor,
  TextExtractorDraft,
  TextRuleOwner,
  TextTransformPhase,
  TextTransformRule,
  TextTransformRuleDraft,
} from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ClientRendererHost, ClientRendererRegistration } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { rendererContributionKey, rendererSurfacePolicies } from '../../../shared/extension-renderer-runtime/renderer-registry.js'
import { notify } from '../../../shared/notifications/index.js'
import { useTextTransformInspection } from './use-text-transform-inspection.js'

export type OwnerScope = TextRuleOwner | { kind: 'runtime' } | { kind: 'catalog' }
export type TextTransformRuntimeContext = {
  id: string
  label: string
  source: HistorySource
  consumerAgentSessionId?: string
}
export type TextTransformProps = {
  initialRuleId?: string
  initialExtractorId?: string
  temporaryTarget?: boolean
  api: StudioApi['textTransforms']
  onRuntimeChanged?: () => void
  rendererHost?: ClientRendererHost
  t: Translator
  source?: HistorySource
  consumerAgentSessionId?: string
  runtimeContexts?: TextTransformRuntimeContext[]
  owner?: OwnerScope
  ownerOptions?: { owner: OwnerScope; label: string; id: string }[]
  onOwnerChange?: (owner: OwnerScope) => void
  title?: string
  mobilePane?: 'master' | 'detail'
  onMobilePaneChange?: (pane: 'master' | 'detail') => void
  getOwnerName?: (owner: TextRuleOwner | OwnerScope) => string | undefined
  header?: ReactNode
  hideHeader?: boolean
}
type SelectedTarget = { kind: 'empty' } | { kind: 'rule'; id: string } | { kind: 'extractor'; id: string } | { kind: 'script'; id: string } | { kind: 'match'; id: string } | { kind: 'artifact'; id: string } | { kind: 'renderer'; id: string } | { kind: 'inspection' } | { kind: 'renderers' }
export type TextTransformController = ReturnType<typeof useTextTransformController>
export function useTextTransformController(props: TextTransformProps) {
  const owner = props.owner ?? { kind: 'workspace' as const }
  const ownerKey = ownerId(owner)
  const authoring = owner.kind !== 'runtime'
  const editingOwner: TextRuleOwner = owner.kind === 'runtime' || owner.kind === 'catalog' ? { kind: 'workspace' } : owner
  const [rules, setRules] = useState<TextTransformRule[]>([])
  const [extractors, setExtractors] = useState<TextExtractor[]>([])
  const [renderers, setRenderers] = useState<RendererDefinition[]>([])
  const [rendererRevision, setRendererRevision] = useState(0)
  const [searchValue, setSearchValue] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget>(authoring ? { kind: 'empty' } : { kind: 'inspection' })
  const runtimeContexts = props.runtimeContexts ?? (props.source ? [{
    id: sourceId(props.source),
    label: sourceLabel(props.source, props.t),
    source: props.source,
    consumerAgentSessionId: props.consumerAgentSessionId,
  }] : [])
  const runtimeContextsKey = JSON.stringify(runtimeContexts.map(context => [context.id, context.source, context.consumerAgentSessionId]))
  const [selectedRuntimeContextId, setSelectedRuntimeContextId] = useState(runtimeContexts[0]?.id ?? '')
  const selectedRuntimeContext = runtimeContexts.find(context => context.id === selectedRuntimeContextId) ?? runtimeContexts[0]
  const source = selectedRuntimeContext?.source ?? props.source
  const consumerAgentSessionId = selectedRuntimeContext?.consumerAgentSessionId ?? props.consumerAgentSessionId
  const [internalMobilePane, setInternalMobilePane] = useState<'master' | 'detail'>('master')
  const [selectedRuleId, setSelectedRuleId] = useState('')
  const [selectedExtractorId, setSelectedExtractorId] = useState('')
  const [ruleText, setRuleText] = useState(defaultRuleText)
  const [extractorText, setExtractorText] = useState(defaultExtractorText)
  const ruleDraftRef = useRef<{ version?: number } | undefined>(undefined)
  const extractorDraftRef = useRef<{ version?: number } | undefined>(undefined)
  const [phase, setPhase] = useState<TextTransformPhase>('display')
  const [busy, setBusy] = useState(false)
  const refreshRequest = useRef(0)
  const mountedRef = useRef(true)
  const sourceKey = JSON.stringify({ source, phase, consumerAgentSessionId })
  const catalogScope = useMemo(() => ({ api: props.api, ownerKey }), [props.api, ownerKey])
  const catalogScopeRef = useRef(catalogScope)
  catalogScopeRef.current = catalogScope
  const ruleWriteRef = useRef<{ scope: typeof catalogScope; id: string } | undefined>(undefined)
  const [ruleWrite, setRuleWrite] = useState<{ scope: typeof catalogScope; id: string }>()
  const [savedRule, setSavedRule] = useState<{ scope: typeof catalogScope; id: string; text: string }>()
  const inspectionScope = useMemo(() => ({ catalogScope, sourceKey }), [catalogScope, sourceKey])
  const inspectionScopeRef = useRef(inspectionScope)
  inspectionScopeRef.current = inspectionScope
  const [errorState, setErrorState] = useState<{ scope: typeof inspectionScope; message: string }>()
  const error = errorState?.scope === inspectionScope ? errorState.message : ''
  const { inspection, disabledRuleIds, orderedRuleIds, traceEntryId, inspect, saveOverride, selectTraceEntry, busy: inspectionBusy } = useTextTransformInspection({
    api: props.api, scope: inspectionScope, source, phase, consumerAgentSessionId,
    onRuntimeChanged: props.onRuntimeChanged, setError,
  })
  const mobilePane = props.mobilePane ?? internalMobilePane
  const setMobilePane = props.onMobilePaneChange ?? setInternalMobilePane
  const temporaryRule = rules.find(rule => rule.id === props.initialRuleId
    && (props.temporaryTarget || !ownerMatches(rule.owner, owner)))
  const temporaryExtractor = extractors.find(item => item.id === props.initialExtractorId
    && (props.temporaryTarget || !ownerMatches(item.owner, owner)))
  const visibleRules = useMemo(() => temporaryRule || temporaryExtractor
    ? temporaryRule ? [temporaryRule] : []
    : rules.filter(rule => ownerMatches(rule.owner, owner)), [owner, rules, temporaryRule, temporaryExtractor])
  const visibleExtractors = useMemo(() => temporaryRule || temporaryExtractor
    ? temporaryExtractor ? [temporaryExtractor] : []
    : extractors.filter(item => ownerMatches(item.owner, owner)), [extractors, owner, temporaryRule, temporaryExtractor])
  const finalOrder = useMemo(() => [...visibleRules].sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id)), [visibleRules])
  const runtimeRenderers = props.rendererHost ? listRuntimeRendererRegistrations(props.rendererHost) : []

  useEffect(() => props.rendererHost?.subscribe(() => setRendererRevision(props.rendererHost?.revision() ?? 0)), [props.rendererHost])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      refreshRequest.current++
    }
  }, [])

  function isCurrentCatalog() {
    return mountedRef.current && catalogScopeRef.current === catalogScope
  }

  function setError(message: string) {
    if (mountedRef.current && inspectionScopeRef.current === inspectionScope) {
      setErrorState({ scope: inspectionScope, message })
    }
  }

  async function refresh() {
    if (!isCurrentCatalog()) return
    const requestId = ++refreshRequest.current
    try {
      setBusy(true)
      const [ruleResult, extractorResult, rendererResult] = await Promise.all([
        props.api.listRules(), props.api.listExtractors(), authoring ? props.api.listRenderers() : Promise.resolve({ renderers: [] }),
      ])
      if (!isCurrentCatalog() || requestId !== refreshRequest.current) return
      setRules(ruleResult.rules)
      setExtractors(extractorResult.extractors)
      setRenderers(rendererResult.renderers)
      setError('')
    } catch (cause) {
      if (isCurrentCatalog() && requestId === refreshRequest.current) setError(readError(cause))
    } finally {
      if (isCurrentCatalog() && requestId === refreshRequest.current) setBusy(false)
    }
  }

  useEffect(() => {
    setSelectedTarget(authoring ? { kind: 'empty' } : { kind: 'inspection' })
    setSelectedRuleId('')
    setSelectedExtractorId('')
    setRuleText(defaultRuleText)
    setExtractorText(defaultExtractorText)
    ruleDraftRef.current = undefined
    extractorDraftRef.current = undefined
    void refresh()
  }, [catalogScope])
  useEffect(() => {
    setSelectedRuntimeContextId(current => runtimeContexts.some(context => context.id === current) ? current : (runtimeContexts[0]?.id ?? ''))
  }, [runtimeContextsKey])
  async function updateRule(rule: TextTransformRule, patch: Partial<Pick<TextTransformRuleDraft, 'enabled' | 'orderIndex'>>) {
    try {
      setBusy(true)
      await props.api.upsertRule({
        ruleId: rule.id,
        expectedVersion: rule.version,
        rule: { ...toRuleDraft(rule), ...patch },
      })
      await refresh()
      props.onRuntimeChanged?.()
    } catch (cause) { setError(readError(cause)) } finally { setBusy(false) }
  }

  async function moveAuthorRule(draggedNodeId: string, targetNodeId: string, position: 'before' | 'inside' | 'after') {
    if (position === 'inside' || !draggedNodeId.startsWith('rule:') || !targetNodeId.startsWith('rule:')) return
    const draggedId = draggedNodeId.slice(5)
    const targetId = targetNodeId.slice(5)
    const dragged = finalOrder.find(rule => rule.id === draggedId)
    const target = finalOrder.find(rule => rule.id === targetId)
    if (!dragged || !target || ownerId(dragged.owner) !== ownerId(target.owner)) return

    const ownerRules = finalOrder.filter(rule => ownerId(rule.owner) === ownerId(dragged.owner))
    const next = ownerRules.filter(rule => rule.id !== draggedId)
    const targetIndex = next.findIndex(rule => rule.id === targetId)
    next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, dragged)
    const changed = next.filter((rule, index) => rule.orderIndex !== index)
    if (changed.length === 0) return

    try {
      setBusy(true)
      await Promise.all(changed.map(rule => props.api.upsertRule({
        ruleId: rule.id,
        expectedVersion: rule.version,
        rule: { ...toRuleDraft(rule), orderIndex: next.indexOf(rule) },
      })))
      await refresh()
      props.onRuntimeChanged?.()
    } catch (cause) {
      const message = readError(cause)
      await refresh()
      setError(message)
    } finally { setBusy(false) }
  }

  function selectRule(id: string) {
    setSelectedRuleId(id)
    setSelectedTarget({ kind: 'rule', id })
    setMobilePane('detail')
    const item = rules.find(rule => rule.id === id)
    ruleDraftRef.current = { version: item?.version }
    setRuleText(item ? JSON.stringify(toRuleDraft(item), null, 2) : defaultRuleText)
  }

  const openedRuleRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!props.initialRuleId || openedRuleRef.current === props.initialRuleId) return
    if (!rules.some(rule => rule.id === props.initialRuleId)) return
    openedRuleRef.current = props.initialRuleId
    selectRule(props.initialRuleId)
  }, [props.initialRuleId, rules, owner])
  const openedExtractorRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!props.initialExtractorId || openedExtractorRef.current === props.initialExtractorId) return
    if (!extractors.some(item => item.id === props.initialExtractorId)) return
    openedExtractorRef.current = props.initialExtractorId
    selectExtractor(props.initialExtractorId)
  }, [props.initialExtractorId, extractors])

  function startNewRule() {
    ruleDraftRef.current = {}
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
    extractorDraftRef.current = { version: item?.version }
    setExtractorText(item ? JSON.stringify(toExtractorDraft(item), null, 2) : defaultExtractorText)
  }

  function startNewExtractor() {
    extractorDraftRef.current = {}
    const id = `extractor-${Date.now().toString(36)}`
    setSelectedExtractorId(id)
    setSelectedTarget({ kind: 'extractor', id })
    setMobilePane('detail')
    setExtractorText(JSON.stringify({ ...JSON.parse(defaultExtractorText), owner: editingOwner }, null, 2))
  }

  async function saveRule() {
    if (!isCurrentCatalog() || ruleWriteRef.current?.scope === catalogScope) return
    const baseline = ruleDraftRef.current
    if (!baseline) return
    const task = { scope: catalogScope, id: selectedRuleId }
    ruleWriteRef.current = task
    setRuleWrite(task)
    setSavedRule(undefined)
    setError('')
    try {
      const existing = rules.find(rule => rule.id === selectedRuleId)
      const draft = { ...(JSON.parse(ruleText) as TextTransformRuleDraft), owner: existing?.owner ?? editingOwner }
      const result = await props.api.upsertRule({ ruleId: selectedRuleId, expectedVersion: baseline.version, rule: draft })
      props.onRuntimeChanged?.()
      if (!isCurrentCatalog()) return
      if (ruleDraftRef.current === baseline) baseline.version = result.rule.version
      setRules(current => [...current.filter(rule => rule.id !== result.rule.id), result.rule])
      setSavedRule({ scope: catalogScope, id: selectedRuleId, text: ruleText })
      await refresh()
      notify.success(props.t('notify.success.saved'))
    } catch (cause) {
      const message = readError(cause)
      setError(message)
      notify.error(message)
    }
    finally {
      if (ruleWriteRef.current === task) ruleWriteRef.current = undefined
      if (isCurrentCatalog()) setRuleWrite(undefined)
    }
  }

  async function batchEditTextResources(nodeIds: string[], operation: 'enable' | 'disable' | 'delete') {
    const failedIds: string[] = []
    const errors: string[] = []
    setBusy(true)
    setError('')
    try {
      for (const nodeId of nodeIds) {
        const rule = rules.find(item => `rule:${item.id}` === nodeId)
        const extractor = extractors.find(item => `extractor:${item.id}` === nodeId)
        try {
          if (rule) {
            if (operation === 'delete') await props.api.deleteRule({ ruleId: rule.id, expectedVersion: rule.version })
            else await props.api.upsertRule({ ruleId: rule.id, expectedVersion: rule.version, rule: { ...toRuleDraft(rule), enabled: operation === 'enable' } })
          } else if (extractor) {
            if (operation === 'delete') await props.api.deleteExtractor({ extractorId: extractor.id, expectedVersion: extractor.version })
            else await props.api.upsertExtractor({ extractorId: extractor.id, expectedVersion: extractor.version, extractor: { ...toExtractorDraft(extractor), enabled: operation === 'enable' } })
          }
        } catch (cause) { failedIds.push(nodeId); errors.push(`${rule?.name ?? extractor?.name}: ${readError(cause)}`) }
      }
      props.onRuntimeChanged?.()
      await refresh()
      const error = errors.join('\n')
      setError(error)
      return { failedIds, error }
    } finally { setBusy(false) }
  }

  async function deleteRule() {
    try {
      const existing = rules.find(rule => rule.id === selectedRuleId)
      await props.api.deleteRule({ ruleId: selectedRuleId, expectedVersion: existing?.version })
      props.onRuntimeChanged?.()
      await refresh()
      notify.success(props.t('notify.success.deleted'))
    } catch (cause) {
      const message = readError(cause)
      setError(message)
      notify.error(message)
    }
  }

  async function saveExtractor() {
    const baseline = extractorDraftRef.current
    if (!isCurrentCatalog() || !baseline) return
    try {
      const existing = extractors.find(item => item.id === selectedExtractorId)
      const draft = { ...(JSON.parse(extractorText) as TextExtractorDraft), owner: existing?.owner ?? editingOwner }
      const result = await props.api.upsertExtractor({ extractorId: selectedExtractorId, expectedVersion: baseline.version, extractor: draft })
      if (!isCurrentCatalog()) return
      if (extractorDraftRef.current === baseline) baseline.version = result.extractor.version
      setExtractors(current => [...current.filter(item => item.id !== result.extractor.id), result.extractor])
      await refresh()
      notify.success(props.t('notify.success.saved'))
    } catch (cause) {
      const message = readError(cause)
      setError(message)
      notify.error(message)
    }
  }

  function formatJson(text: string, setter: (value: string) => void) {
    try {
      setter(JSON.stringify(JSON.parse(text), null, 2))
      setError('')
    } catch (cause) {
      const message = props.t('textTransform.invalidJson', { error: readError(cause) })
      setError(message)
      notify.error(message)
    }
  }

  function selectRuntimeContext(id: string) {
    setSelectedRuntimeContextId(id)
    setSelectedTarget({ kind: 'inspection' })
    setMobilePane('detail')
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
    deleteRule,
    batchEditTextResources,
    selectedExtractorId,
    ruleText,
    unsavedNewRule: selectedTarget.kind === 'rule' && Boolean(selectedRuleId) && !rules.some(rule => rule.id === selectedRuleId),
    ruleSaving: ruleWrite?.scope === catalogScope,
    ruleSaved: savedRule?.scope === catalogScope && savedRule.id === selectedRuleId && savedRule.text === ruleText,
    extractorText,
    phase,
    error,
    busy: busy || inspectionBusy,
    visibleRules,
    visibleExtractors,
    runtimeRenderers,
    rendererRevision,
    traceEntryId,
    finalOrder,
    refresh,
    inspect,
    selectRule,
    startNewRule,
    selectExtractor,
    updateRule,
    moveAuthorRule,
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
    disabledRuleIds,
    orderedRuleIds,
    searchValue,
    setSearchValue,
    setError,
    editingOwner,
  }
}

function ownerMatches(value: TextRuleOwner, scope: OwnerScope): boolean {
  if (scope.kind === 'catalog') return true
  if (scope.kind === 'runtime') return false
  if (scope.kind === 'workspace') return value.kind === 'workspace' || value.kind === 'user-override'
  if (scope.kind === 'card') return value.kind === 'card' && value.cardId === scope.cardId
  if (scope.kind === 'preset') return value.kind === 'preset' && value.presetId === scope.presetId
  if (scope.kind === 'extension') return value.kind === 'extension' && value.packageId === scope.packageId && value.moduleId === scope.moduleId
  return value.kind === 'user-override'
}
function ownerId(owner: OwnerScope): string { return owner.kind === 'runtime' ? 'runtime' : owner.kind === 'catalog' ? 'catalog' : JSON.stringify(owner) }
export function sourceLabel(source: HistorySource, t: Translator): string { return source.kind === 'narrative' ? t('textTransform.narrativeSource', { id: source.timelineId }) : t('textTransform.agentSessionSource', { id: source.sessionId }) }
function sourceId(source: HistorySource): string { return source.kind === 'narrative' ? `narrative:${source.timelineId}:${source.branchId}` : `agent-session:${source.sessionId}` }
function toRuleDraft(rule: TextTransformRule): TextTransformRuleDraft { const draft = { ...rule } as Record<string, unknown>; delete draft.id; delete draft.version; delete draft.createdAt; delete draft.updatedAt; return draft as TextTransformRuleDraft }
function toExtractorDraft(extractor: TextExtractor): TextExtractorDraft { const draft = { ...extractor } as Record<string, unknown>; delete draft.id; delete draft.version; delete draft.createdAt; delete draft.updatedAt; return draft as TextExtractorDraft }
function readError(value: unknown): string { return value instanceof Error ? value.message : String(value) }
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
const defaultRuleText = JSON.stringify({ name: 'Hide marker', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0, matcher: { kind: 'regex', pattern: '<marker>[\\s\\S]*?</marker>', flags: 'g' }, effect: { kind: 'replace', replacement: '' }, targets: ['narrative', 'agent-session'], phases: ['prompt', 'display'] }, null, 2)
const defaultExtractorText = JSON.stringify({ name: 'World State', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0, targets: ['narrative', 'agent-session'], matcher: { kind: 'regex', pattern: '<WorldState>([\\s\\S]*?)</WorldState>', flags: 'g', contentGroup: 1 }, strategy: 'latest-valid', parser: 'key-value-lines' }, null, 2)
