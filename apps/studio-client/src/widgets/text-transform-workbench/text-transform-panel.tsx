
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { LoomScriptMountTarget } from '@loom-studio/shared/loom-scripts'
import { useScopedScriptEditor } from '../../features/loom-scripts/model/use-scoped-script-editor.js'
export type TextTransformProps = RuleProps & {
  loomScriptsApi?: StudioApi['loomScripts']
  runtimeScriptContext?: { workspaceId?: string; timelineId?: string; presetId?: string }
}
export type TextTransformController = ReturnType<typeof useTextTransformController>
export function useTextTransformController(props: TextTransformProps) {
  const rules = useRuleController(props)
  const owner = rules.owner
  const scriptOwner: LoomScriptMountTarget | undefined = owner.kind === 'card' ? { kind: 'card', cardId: owner.cardId }
    : owner.kind === 'preset' ? { kind: 'preset', presetId: owner.presetId }
    : owner.kind === 'workspace' ? { kind: 'user' }
    : owner.kind === 'user-override' ? { kind: 'user' } : undefined
  const scripts = useScopedScriptEditor({ ...props, authoring: rules.authoring, ownerKey: JSON.stringify(owner), scriptOwner })
  function selectScriptTarget(id: string) { rules.setSelectedTarget({ kind: 'script', id }); rules.setMobilePane('detail') }
  return { ...rules, ...scripts, loomScriptsApi: props.loomScriptsApi,
    busy: rules.busy || scripts.busy, error: rules.error || scripts.error,
    refresh: async () => { await Promise.all([rules.refresh(), scripts.refresh()]) },
    selectScript: async (id: string) => { selectScriptTarget(id); await scripts.selectScript(id) },
    createScript: async () => { const id = await scripts.createScript(); if (id) selectScriptTarget(id) },
    importScript: async (file: File) => { const id = await scripts.importScript(file); if (id) selectScriptTarget(id) },
  }
}
import { useMemo, useState, type ReactNode } from 'react'
import { Code2, FileSearch, Filter, Folder, FolderOpen, Layers, Play, RefreshCw, Scissors, Sparkles, ToggleLeft, ToggleRight, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@loom-studio/ui'
import type { TextRuleOwner, TextTransformPhase, ResolvedLoomScriptRendererMount, UnavailableLoomScriptMount } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import { MasterDetailWorkbench } from '../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import { FileTree, type FileTreeNode } from '../../shared/ui/file-tree/file-tree.js'
import { PipelineWorkbenchView, type PipelineWorkbenchGroup } from '../../features/text-transforms/ui/pipeline-workbench-view.js'
import { scriptCapabilityLabel } from '../../features/loom-scripts/model/script-capabilities.js'
import { LoomScriptSourceFields } from '../../features/loom-scripts/ui/loom-script-source-fields.js'
import { sourceLabel, useTextTransformController as useRuleController, type OwnerScope, type TextTransformProps as RuleProps } from '../../features/text-transforms/model/use-text-transform-controller.js'
import styles from '../../features/text-transforms/ui/text-transform-panel.module.scss'

export { listRuntimeRendererRegistrations } from '../../features/text-transforms/model/use-text-transform-controller.js'
export type { OwnerScope, TextTransformRuntimeContext } from '../../features/text-transforms/model/use-text-transform-controller.js'

const phases: TextTransformPhase[] = ['classify', 'prompt', 'display']

export function TextTransformPanel(props: TextTransformProps) {
  const controller = useTextTransformController(props)
  const heading = props.title ?? (controller.owner.kind === 'runtime' ? props.t('textTransform.inspectorTitle') : props.t('textTransform.title'))
  if (!controller.authoring) return <RuntimePipelinePanel header={props.header} controller={controller} heading={heading} hideHeader={props.hideHeader} />
  return <section className={styles.panel} data-loom-component="text-transform-panel">
    {!props.hideHeader && !props.header ? (
      <header className={styles.intro}>
        <div><h2>{heading}</h2><p>{controller.owner.kind === 'runtime' ? props.t('textTransform.runtimeDescription') : props.t('textTransform.ownerDescription', { owner: ownerLabel(controller.owner, props.t, props.getOwnerName) })}</p></div>
        <div className={styles.headerActions}>
          {props.ownerOptions && props.ownerOptions.length > 1 && props.onOwnerChange ? (
            <PanelTabs
              activeId={props.ownerOptions.find(opt =>
                (opt.owner.kind === controller.owner.kind) &&
                (opt.owner.kind === 'card' ? controller.owner.kind === 'card' && opt.owner.cardId === controller.owner.cardId : true)
              )?.id ?? props.ownerOptions[0]!.id}
              ariaLabel={props.t('textTransform.ownerDescription', { owner: '' })}
              items={props.ownerOptions.map(opt => ({ id: opt.id, label: opt.label }))}
              onChange={id => {
                const match = props.ownerOptions?.find(opt => opt.id === id)
                if (match && props.onOwnerChange) props.onOwnerChange(match.owner)
              }}
            />
          ) : null}
          <Button size="small" variant="secondary" disabled={controller.busy} type="button" onClick={() => void controller.refresh()}><RefreshCw aria-hidden="true" size={14} /><span>{props.t('textTransform.refresh')}</span></Button>
        </div>
      </header>
    ) : null}
    <MasterDetailWorkbench
      backLabel={props.t('textTransform.backToSettings')}
      resizeLabel={props.t('stateVariables.resizeSidebar')}
      dataComponent="text-transform-workbench"
      masterWidth="minmax(240px, 300px)"
      mobilePane={controller.mobilePane}
      onMobilePaneChange={controller.setMobilePane}
      master={(
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {props.header ? (
            <header className={styles.masterHeader}>
              {props.header}
            </header>
          ) : null}
          <div className={styles.masterToolbar}>
            <button
              className={styles.toolbarIconBtn}
              type="button"
              onClick={() => void controller.refresh()}
              disabled={controller.busy}
              title={props.t('textTransform.refresh')}
              aria-label={props.t('textTransform.refresh')}
            >
              <RefreshCw aria-hidden="true" size={14} />
            </button>
          </div>
          <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}>
            <TextTransformExplorer controller={controller} />
          </div>
        </div>
      )}
    >
      <TextTransformDetail controller={controller} />
    </MasterDetailWorkbench>
  </section>
}

export function TextTransformExplorer({ controller }: { controller: TextTransformController }) {
  const { t } = controller
  const [expandedIds, setExpandedIds] = useState<string[]>(() => ['group:rules', 'group:extractors', 'group:scripts', 'group:contexts', 'group:extensions'])

  const selectedId = useMemo(() => {
    const target = controller.selectedTarget
    if (target.kind === 'rule') return `rule:${target.id}`
    if (target.kind === 'extractor') return `extractor:${target.id}`
    if (target.kind === 'script') return `script:${target.id}`
    if (target.kind === 'renderers') return 'renderers'
    if (target.kind === 'inspection') return `context:${controller.selectedRuntimeContextId}`
    return undefined
  }, [controller.selectedTarget, controller.selectedRuntimeContextId])

  const nodes: FileTreeNode[] = useMemo(() => {
    if (controller.authoring) {
      const itemsByOwner = new Map<string, FileTreeNode[]>()
      const addNode = (ownerStr: string, node: FileTreeNode) => {
        if (!itemsByOwner.has(ownerStr)) itemsByOwner.set(ownerStr, [])
        itemsByOwner.get(ownerStr)!.push(node)
      }

      for (const rule of controller.finalOrder) {
        addNode(ownerLabel(rule.owner, t, controller.getOwnerName), {
          id: `rule:${rule.id}`,
          label: rule.name,
          kind: 'entry' as const,
          meta: rule.enabled ? String(rule.orderIndex) : t('textTransform.disabled'),
        })
      }

      for (const item of controller.visibleExtractors) {
        addNode(ownerLabel(item.owner, t, controller.getOwnerName), {
          id: `extractor:${item.id}`,
          label: item.name,
          kind: 'entry' as const,
          meta: item.strategy,
        })
      }

      const editingOwnerLabel = ownerLabel(controller.editingOwner, t, controller.getOwnerName)
      if (!itemsByOwner.has(editingOwnerLabel)) itemsByOwner.set(editingOwnerLabel, [])

      return Array.from(itemsByOwner.entries())
        .sort(([ownerA], [ownerB]) => ownerA.localeCompare(ownerB))
        .map(([ownerStr, children]) => ({
          id: `owner:${ownerStr}`,
          label: ownerStr,
          kind: 'folder' as const,
          meta: String(children.length),
          children,
        }))
    }
    // runtime mode
    return [
      { id: 'group:contexts', label: t('textTransform.currentContext'), kind: 'folder', children: controller.runtimeContexts.map(context => ({
        id: `context:${context.id}`,
        label: context.label,
        kind: 'entry' as const,
        meta: sourceLabel(context.source, t),
      })) },
      { id: 'group:extensions', label: t('textTransform.extensionCapabilities'), kind: 'folder', children: [
        { id: 'renderers', label: t('textTransform.renderers'), kind: 'entry', meta: `${controller.renderers.length}` },
      ] },
    ]
  }, [controller.authoring, controller.finalOrder, controller.unsavedNewRule, controller.selectedRuleId, controller.visibleExtractors, controller.visibleScripts, controller.runtimeContexts, controller.renderers.length, controller.loomScriptsApi, t])

  return <nav aria-label={t('textTransform.navigation')} className={styles.masterNav}>
    {controller.authoring && controller.ownerOptions && controller.ownerOptions.length > 1 && controller.onOwnerChange ? (
      <div className={styles.scopeTabsContainer}>
        <PanelTabs
          activeId={controller.ownerOptions.find(opt =>
            (opt.owner.kind === controller.owner.kind) &&
            (opt.owner.kind === 'card' ? controller.owner.kind === 'card' && opt.owner.cardId === controller.owner.cardId : true)
          )?.id ?? controller.ownerOptions[0]!.id}
          ariaLabel={t('textTransform.ownerDescription', { owner: '' })}
          items={controller.ownerOptions.map(opt => ({ id: opt.id, label: opt.label }))}
          size="compact"
          onChange={id => {
            const match = controller.ownerOptions?.find(opt => opt.id === id)
            if (match && controller.onOwnerChange) controller.onOwnerChange(match.owner)
          }}
        />
      </div>
    ) : null}
    <FileTree
      key={JSON.stringify(controller.owner)}
      ariaLabel={t('textTransform.navigation')}
      nodes={nodes}
      batchDisabled={controller.busy}
      canBatchSelect={node => controller.visibleExtractors.some(item => `extractor:${item.id}` === node.id)}
      getBatchActions={() => [
        { id: 'enable', label: t('common.batchEnable'), icon: <ToggleRight size={14} />, run: nodes => controller.batchEditTextResources(nodes.map(node => node.id), 'enable') },
        { id: 'disable', label: t('common.batchDisable'), icon: <ToggleLeft size={14} />, run: nodes => controller.batchEditTextResources(nodes.map(node => node.id), 'disable') },
        { id: 'delete', label: t('common.batchDelete'), icon: <Trash2 size={14} />, tone: 'danger', confirm: true, run: nodes => controller.batchEditTextResources(nodes.map(node => node.id), 'delete') },
      ]}
      selectedId={selectedId}
      expandedIds={expandedIds}
      onExpandedIdsChange={setExpandedIds}
      onSelect={node => {
        if (node.kind === 'folder') {
          setExpandedIds(prev => prev.includes(node.id) ? prev.filter(id => id !== node.id) : [...prev, node.id])
          return
        }
        const id = node.id
        if (id.startsWith('rule:')) controller.selectRule(id.slice(5))
        else if (id.startsWith('extractor:')) controller.selectExtractor(id.slice(10))
        else if (id.startsWith('script:')) void controller.selectScript(id.slice(7))
        else if (id.startsWith('context:')) controller.selectRuntimeContext(id.slice(8))
        else if (id === 'renderers') { controller.setSelectedTarget({ kind: 'renderers' }); controller.setMobilePane('detail') }
      }}
      renderIcon={(node, expanded) => {
        if (node.kind === 'folder') return expanded ? <FolderOpen size={15} /> : <Folder size={15} />
        const id = node.id
        if (id.startsWith('rule:')) return <Scissors size={15} />
        if (id.startsWith('extractor:')) return <Filter size={15} />
        if (id.startsWith('script:')) return <Code2 size={15} />
        if (id.startsWith('context:')) return <Sparkles size={15} />
        return <Layers size={15} />
      }}
      renderTrailing={node => {
        if (node.kind === 'folder' && node.id === `owner:${ownerLabel(controller.editingOwner, t, controller.getOwnerName)}` && controller.authoring) {
          return (
            <div style={{ display: 'flex', gap: 2 }}>
              <button className={styles.navAddBtn} title={t('textTransform.newExtractor')} type="button" onClick={event => { event.stopPropagation(); controller.startNewExtractor() }}><FileSearch aria-hidden="true" size={14} /></button>
            </div>
          )
        }
        return null
      }}
      getDisclosureLabel={(node, expanded) => `${expanded ? t('textTransform.collapse') : t('textTransform.expand')} ${node.label}`}
      getDragLabel={node => node.label}
      moreActionsLabel={t('textTransform.moreActions')}
      isMuted={node => {
        if (node.id.startsWith('rule:')) {
          const ruleId = node.id.slice(5)
          const rule = controller.finalOrder.find(item => item.id === ruleId)
          return rule ? !rule.enabled : false
        }
        if (node.id.startsWith('extractor:')) {
          const extId = node.id.slice(10)
          const ext = controller.visibleExtractors.find(item => item.id === extId)
          return ext ? !ext.enabled : false
        }
        return false
      }}
      variant="flat"
    />
    {controller.authoring && controller.finalOrder.length === 0 && !controller.unsavedNewRule ? (
      <p className={styles.emptyState}>{t('textTransform.ownerRulesEmpty')}</p>
    ) : null}
    {!controller.authoring && controller.runtimeContexts.length === 0 ? (
      <p className={styles.emptyState}>{t('textTransform.noHistory')}</p>
    ) : null}
  </nav>
}

export function TextTransformDetail({ controller }: { controller: TextTransformController }) {
  return <>{controller.error ? <div className={styles.errorBanner} role="alert">{controller.error}</div> : null}<TextTransformDetailContent controller={controller} /></>
}

function TextTransformDetailContent({ controller }: { controller: TextTransformController }) {
  const { t } = controller
  if (controller.selectedTarget.kind === 'rule') {
    return <>{!controller.authoring ? <OverrideControls controller={controller} ruleId={controller.selectedRuleId} /> : null}<RuleSummaryDetail key={controller.selectedRuleId} controller={controller} /></>
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

function RuleSummaryDetail({ controller }: { controller: TextTransformController }) {
  const rule = controller.rules.find(item => item.id === controller.selectedRuleId)
    ?? controller.inspection?.rules.find(item => item.id === controller.selectedRuleId)
  const [sample, setSample] = useState('')
  const [result, setResult] = useState('')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  if (!rule) return <p className={styles.emptyState}>{controller.t('textTransform.ruleUnavailable')}</p>
  const scriptId = rule.scriptDocumentId
  const canOpen = scriptId && controller.visibleScripts.some(item => item.script.id === scriptId)
  async function testRule() {
    if (!scriptId || !controller.loomScriptsApi) return
    setTesting(true); setError('')
    try {
      const { artifact } = await controller.loomScriptsApi.export(scriptId)
      const preview = await controller.loomScriptsApi.preview({ source: artifact.source, text: sample })
      setResult(JSON.stringify(preview, null, 2))
    } catch (cause) { setError(readError(cause)) } finally { setTesting(false) }
  }
  return <>
    <header className={styles.detailHeader}><div className={styles.headerTitle}><Scissors aria-hidden="true" size={16} /><h3>{rule.name}</h3><small>{controller.t('textTransform.ruleSummaryVersion', { version: rule.version })}</small></div>
      {canOpen ? <Button size="small" variant="secondary" disabled={controller.busy} onClick={() => void controller.selectScript(scriptId)}>{controller.t('textTransform.editFullScript')}</Button> : null}
    </header>
    <div className={styles.inspectionContainer}>
      <p className={styles.metaLine}>{controller.t('textTransform.ruleSummaryHint')}</p>
      <section className={styles.inspectionSection}><h4>{controller.t('textTransform.ruleMatch')}</h4><pre className={styles.dryRunOutput}>{`/${rule.matcher.pattern}/${rule.matcher.flags}`}</pre></section>
      <section className={styles.inspectionSection}><h4>{controller.t(rule.effect.kind === 'replace' ? 'textTransform.ruleReplacement' : 'textTransform.ruleProcessing')}</h4><pre className={styles.dryRunOutput}>{rule.effect.kind === 'replace' ? rule.effect.replacement : JSON.stringify(rule.effect, null, 2)}</pre></section>
      <p className={styles.metaLine}>{rule.phases.join(' · ')} · {rule.targets.join(' · ')}{rule.range ? ` · ${controller.t('textTransform.ruleDepth', { min: rule.range.minDepth ?? 0, max: rule.range.maxDepth ?? controller.t('textTransform.ruleUnlimited') })}` : ''}</p>
      {scriptId && controller.loomScriptsApi ? <section className={styles.inspectionSection}>
        <h4>{controller.t('textTransform.ruleTest')}</h4><p className={styles.metaLine}>{controller.t('textTransform.ruleTestHint')}</p>
        <textarea aria-label={controller.t('textTransform.ruleTestText')} className={styles.rawJsonTextarea} value={sample} onChange={event => setSample(event.target.value)} />
        <Button size="small" disabled={testing} onClick={() => void testRule()}>{controller.t('textTransform.test')}</Button>
        {error ? <p role="alert">{error}</p> : null}{result ? <pre className={styles.dryRunOutput}>{result}</pre> : null}
      </section> : null}
    </div>
  </>
}

function EditorDetail(props: { controller: TextTransformController; icon: ReactNode; title: string; id: string; text: string; setText(value: string): void; onFormat(): void; onSave(): void; onDelete?: () => void; readOnly?: boolean }) {
  const { t } = props.controller
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}>{props.icon}<h3>{props.title}</h3><input className={styles.inlineInput} aria-label={t('textTransform.documentId')} value={props.id} readOnly /></div>{!props.readOnly ? <div className={styles.headerActions}><Button size="small" variant="secondary" onClick={props.onFormat}><Wand2 aria-hidden="true" size={13} /><span>{t('textTransform.format')}</span></Button>{props.onDelete ? <Button size="small" variant="danger" onClick={props.onDelete}><Trash2 aria-hidden="true" size={13} /><span>{t('textTransform.delete')}</span></Button> : null}<Button size="small" variant="ghost" disabled={!props.id.trim()} onClick={props.onSave}>{t('textTransform.save')}</Button></div> : null}</header><div className={styles.editorContainer}><textarea aria-label={t('textTransform.jsonEditor', { title: props.title })} className={styles.rawJsonTextarea} readOnly={props.readOnly} spellCheck={false} value={props.text} onChange={event => props.setText(event.target.value)} /></div></>
}

function RuntimePipelinePanel({ controller, heading, hideHeader, header }: { controller: TextTransformController; heading: string; hideHeader?: boolean; header?: ReactNode }) {
  const { t } = controller
  const [ownerFilter, setOwnerFilter] = useState('')
  const [effectFilter, setEffectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const allGroups = useMemo<PipelineWorkbenchGroup[]>(() => {
    const inspection = controller.inspection
    if (!inspection) return []
    return [
      { id: 'rules', label: t('textTransform.effectiveRules'), items: inspection.rules.map((rule, index) => ({ id: `rule:${rule.id}`, kind: 'rule', label: rule.name, description: `${rule.matcher.pattern} · v${rule.version}`, owner: ownerLabel(rule.owner, t, controller.getOwnerName), effect: rule.effect.kind, order: index + 1, status: controller.disabledRuleIds.includes(rule.id) ? 'disabled' : 'active' })) },
      { id: 'extractors', label: t('textTransform.extractors'), items: inspection.extractors.map(item => ({ id: `extractor:${item.id}`, kind: 'extractor', label: item.name, description: `${item.strategy} · v${item.version}`, owner: ownerLabel(item.owner, t, controller.getOwnerName), effect: 'extractor', status: item.enabled ? 'active' : 'disabled' })) },
      { id: 'matches', label: t('textTransform.matchesDiagnostics'), items: inspection.snapshot.matches.map(item => ({ id: `match:${item.matchId}`, kind: 'renderer', label: item.match || item.matchId, description: `${item.entryId} · ${item.inputRange.start}-${item.inputRange.end}`, owner: `${item.ruleId}@${item.ruleVersion}`, effect: 'match', status: item.displayRange ? 'active' : 'degraded' })) },
      { id: 'artifacts', label: t('textTransform.artifacts'), items: inspection.artifacts.map(item => ({ id: `artifact:${item.artifactId}`, kind: 'renderer', label: item.artifactType, description: `${item.values.length} · v${item.extractorVersion}`, owner: item.extractorId, effect: 'artifact', status: item.stale ? 'degraded' : 'active' })) },
      { id: 'renderers', label: t('textTransform.renderers'), items: controller.runtimeRenderers.map(item => ({ id: `renderer:${item.key}`, kind: 'renderer', label: item.registration.definition.name, description: `${item.registration.definition.surface} · ${item.registration.definition.instanceScope}${item.claims.length ? ` · claim:${item.claims.map(claim => claim.scopeKey).join(',')}` : ''}${item.diagnostics.length ? ` · ${item.diagnostics.map(diagnostic => diagnostic.code).join(',')}` : ''}`, owner: item.registration.owner.kind === 'extension' ? `extension:${item.registration.owner.packageId}/${item.registration.owner.moduleId}` : `script:${item.registration.owner.scriptDocumentId}@${item.registration.owner.documentVersion}`, effect: 'renderer', status: item.diagnostics.length ? 'degraded' : 'active' })) },
      { id: 'scripts', label: t('textTransform.ownerScripts'), items: listRuntimeScriptItems(controller.resolvedMounts, controller.unavailableMounts).map(item => ({ ...item, effect: 'script' })) },
    ]
  }, [controller.disabledRuleIds, controller.inspection, controller.rendererRevision, controller.resolvedMounts, controller.unavailableMounts, controller.runtimeRenderers, t])
  const ownerOptions = useMemo(() => [...new Set(allGroups.flatMap(group => group.items.map(item => item.owner)))].sort(), [allGroups])
  const effectOptions = useMemo(() => [...new Set(allGroups.flatMap(group => group.items.map(item => item.effect).filter((value): value is string => Boolean(value))))].sort(), [allGroups])
  const groups = useMemo(() => {
    const filteredItems = allGroups.flatMap(group => group.items).filter(item => (!ownerFilter || item.owner === ownerFilter) && (!effectFilter || item.effect === effectFilter) && (!statusFilter || item.status === statusFilter))
    const ownerGroups = new Map<string, PipelineWorkbenchGroup['items']>()
    for (const item of filteredItems) {
      if (!ownerGroups.has(item.owner)) ownerGroups.set(item.owner, [])
      ownerGroups.get(item.owner)!.push(item)
    }
    return Array.from(ownerGroups.entries()).map(([owner, items]) => ({
      id: `owner:${owner}`,
      label: owner,
      items,
    })).sort((a, b) => a.label.localeCompare(b.label))
  }, [allGroups, effectFilter, ownerFilter, statusFilter])
  const selectedId = controller.selectedTarget.kind === 'empty' || controller.selectedTarget.kind === 'inspection' || controller.selectedTarget.kind === 'renderers' ? undefined : `${controller.selectedTarget.kind}:${controller.selectedTarget.id}`
  return <section className={styles.panel} data-loom-component="text-transform-panel">
    {!hideHeader && !header ? (
      <header className={styles.intro}>
        <div><h2>{heading}</h2><p>{t('textTransform.runtimeDescription')}</p></div>
        <div className={styles.headerActions}>
          {controller.runtimeContexts.length > 1 ? (
            <select aria-label={t('textTransform.currentContext')} className={styles.inlineInput} value={controller.selectedRuntimeContextId} onChange={event => controller.selectRuntimeContext(event.target.value)}>
              {controller.runtimeContexts.map(context => <option key={context.id} value={context.id}>{context.label}</option>)}
            </select>
          ) : null}
          <PanelTabs<TextTransformPhase>
            activeId={controller.phase}
            ariaLabel={t('textTransform.navigation')}
            items={phases.map(value => ({
              id: value,
              label: t(`textTransform.phase.${value}`),
            }))}
            onChange={controller.setPhase}
          />
        </div>
      </header>
    ) : null}
    <PipelineWorkbenchView
      header={header}
      t={t}
      ariaLabel={t('textTransform.navigation')}
      backLabel={t('textTransform.backToSettings')}
      detail={<TextTransformDetail controller={controller} />}
      emptyLabel={controller.source ? t('textTransform.inspectionPending') : t('textTransform.noHistory')}
      filters={<>
        <select aria-label={t('textTransform.filterOwner')} value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}><option value="">{t('textTransform.filterAllOwners')}</option>{ownerOptions.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label={t('textTransform.filterEffect')} value={effectFilter} onChange={event => setEffectFilter(event.target.value)}><option value="">{t('textTransform.filterAllEffects')}</option>{effectOptions.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label={t('textTransform.filterStatus')} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">{t('textTransform.filterAllStatuses')}</option>{(['active', 'disabled', 'degraded', 'conflict'] as const).map(value => <option key={value} value={value}>{t(`textTransform.status.${value}`)}</option>)}</select>
      </>}
      groups={groups}
      mobilePane={controller.mobilePane}
      preview={<PipelineRuntimePreview controller={controller} />}
      searchPlaceholder={t('textTransform.search')}
      searchClearLabel={t('textTransform.clearSearch')}
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
  if (resolved) return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Code2 aria-hidden="true" size={16} /><h3>{resolved.script.name}</h3><small>{resolved.script.metadataId} · v{resolved.script.version}</small></div></header><div className={styles.inspectionContainer}><section className={styles.inspectionSection}><h4>{t('textTransform.metadata')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify({ mountId: resolved.mountId, enabled: resolved.enabled, orderIndex: resolved.orderIndex, grantedCapabilities: resolved.grantedCapabilities, scriptVersion: resolved.script.scriptVersion, requestedCapabilities: resolved.script.requestedCapabilities, contributions: resolved.script.contributions }, null, 2)}</pre></section><section className={styles.inspectionSection}><h4>{t('textTransform.source')}</h4><textarea aria-label={t('textTransform.source')} className={styles.rawJsonTextarea} readOnly spellCheck={false} value={resolved.source} /></section></div></>
  if (!selected) return <div className={styles.editorContainer}><p className={styles.emptyState}>{t('textTransform.ownerScriptsEmpty')}</p></div>
  const { script, mount } = selected
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Code2 aria-hidden="true" size={16} /><h3>{script.name}</h3><small>{script.metadataId} · v{script.version}</small></div><div className={styles.headerActions}><label><input checked={mount.enabled} disabled={controller.busy || (!mount.enabled && script.requestedCapabilities.some(capability => !mount.grantedCapabilities.includes(capability)))} type="checkbox" onChange={event => void controller.updateScriptMount(mount, { enabled: event.target.checked })} /> {mount.target.kind === 'user' ? '在全局启用' : mount.target.kind === 'card' ? '在当前角色启用' : t('textTransform.enabled')}</label><input aria-label={t('textTransform.order')} className={styles.inlineInput} type="number" value={mount.orderIndex} onChange={event => void controller.updateScriptMount(mount, { orderIndex: Number(event.target.value) })} /><Button size="small" variant="ghost" disabled={controller.busy || !mount.enabled} onClick={() => void controller.refreshScriptMount(mount)}><RefreshCw aria-hidden="true" size={14} />刷新此实例</Button><Button size="small" variant="ghost" disabled={controller.busy} onClick={() => void controller.saveScript()}>{t('textTransform.save')}</Button></div></header><div className={styles.inspectionContainer}>
    <section className={styles.inspectionSection}><h4>{t('textTransform.metadata')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify({ owner: script.owner, scriptVersion: script.scriptVersion, runtime: script.runtime, requestedCapabilities: script.requestedCapabilities, contributions: script.contributions }, null, 2)}</pre></section>
    <section className={styles.inspectionSection}><h4>{t('textTransform.grants')}</h4>{script.requestedCapabilities.length === 0 ? <p className={styles.emptyState}>{t('textTransform.noGrants')}</p> : script.requestedCapabilities.map(capability => <label key={capability}><input checked={mount.grantedCapabilities.includes(capability)} disabled={controller.busy || mount.enabled} type="checkbox" onChange={event => void controller.updateScriptMount(mount, { grantedCapabilities: event.target.checked ? [...mount.grantedCapabilities, capability] : mount.grantedCapabilities.filter(value => value !== capability) })} /> {scriptCapabilityLabel(capability)}</label>)}</section>
    <LoomScriptSourceFields fileName={controller.scriptFileName} source={controller.scriptSource} disabled={controller.busy}
      onFileNameChange={controller.setScriptFileName} onSourceChange={controller.setScriptSource} t={t} />
  </div></>
}

function RuntimeItemDetail({ controller }: { controller: TextTransformController }) {
  const target = controller.selectedTarget
  const value = target.kind === 'match' ? controller.inspection?.snapshot.matches.find(item => item.matchId === target.id) : target.kind === 'artifact' ? controller.inspection?.artifacts.find(item => item.artifactId === target.id) : undefined
  return <><header className={styles.detailHeader}><div className={styles.headerTitle}><Layers aria-hidden="true" size={16} /><h3>{controller.t(target.kind === 'match' ? 'textTransform.matchTitle' : 'textTransform.artifactTitle')}</h3></div></header><div className={styles.editorContainer}><pre className={styles.dryRunOutput}>{JSON.stringify(value, null, 2)}</pre></div></>
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
  return <div className={styles.detailHeader}><div className={styles.headerTitle}><Layers aria-hidden="true" size={15} /><strong>{controller.t('textTransform.override')}</strong></div><div className={styles.headerActions}><label><input checked={!disabled} type="checkbox" onChange={event => void controller.saveOverride(event.target.checked ? controller.disabledRuleIds.filter(id => id !== ruleId) : [...controller.disabledRuleIds, ruleId], order)} /> {controller.t('textTransform.enabled')}</label><Button size="small" variant="secondary" disabled={index <= 0} onClick={() => move(-1)}>{controller.t('textTransform.moveUp')}</Button><Button size="small" variant="secondary" disabled={index < 0 || index >= order.length - 1} onClick={() => move(1)}>{controller.t('textTransform.moveDown')}</Button></div></div>
}

function InspectionDetail({ controller }: { controller: TextTransformController }) {
  const { t } = controller
  const snapshot = controller.inspection?.snapshot
  return <>
    <header className={styles.detailHeader}>
      <div className={styles.headerTitle}>
        <Sparkles aria-hidden="true" size={16} />
        <h3>{t('textTransform.inspector')}</h3>
        <PanelTabs<TextTransformPhase>
          activeId={controller.phase}
          ariaLabel={t('textTransform.inspector')}
          items={phases.map(value => ({
            id: value,
            label: t(`textTransform.phase.${value}`),
          }))}
          size="compact"
          onChange={controller.setPhase}
        />
      </div>
      <div className={styles.headerActions}>
        <Button size="small" variant="ghost" disabled={!controller.source || controller.busy} onClick={() => void controller.inspect()}>
          <Play aria-hidden="true" size={13} />
          <span>{t('textTransform.inspect')}</span>
        </Button>
      </div>
    </header><div className={styles.inspectionContainer}>{!controller.inspection ? <p className={styles.emptyState}>{controller.source ? t('textTransform.inspectionPending') : t('textTransform.noHistory')}</p> : <><section className={styles.inspectionSection}><h4>{t('textTransform.effectiveRules')}</h4>{controller.inspection.rules.map((rule, index) => <article className={styles.ruleCard} key={rule.id}><strong>{index + 1}. {rule.name}</strong><small>{ownerLabel(rule.owner, t)} · {rule.matcher.kind}: {rule.matcher.pattern}</small><small>{t('textTransform.effect')}: {rule.effect.kind}</small></article>)}{controller.inspection.rules.length === 0 ? <p className={styles.emptyState}>{t('textTransform.noEffectiveRules')}</p> : null}</section><section className={styles.inspectionSection}><h4>{t('textTransform.extractors')}</h4><p className={styles.metaLine}>{controller.inspection.extractors.map(item => `${item.name} · ${ownerLabel(item.owner, t)}`).join('；') || t('textTransform.noEffectiveExtractors')}</p></section><section className={styles.inspectionSection}><h4>{t('textTransform.matchesDiagnostics')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify({ matches: snapshot?.matches ?? [], diagnostics: snapshot?.diagnostics ?? [] }, null, 2)}</pre></section><section className={styles.inspectionSection}><h4>{t('textTransform.dryRun')}</h4><pre className={styles.dryRunOutput}>{JSON.stringify(snapshot, null, 2)}</pre></section></>}</div></>
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

export function listRuntimeScriptItems(mounts: readonly ResolvedLoomScriptRendererMount[], unavailableMounts: readonly UnavailableLoomScriptMount[] = []): PipelineWorkbenchGroup['items'] {
  return [...mounts.filter(mount => mount.enabled).map(mount => ({
    id: `script:${mount.script.id}`,
    kind: 'script' as const,
    label: mount.script.name,
    description: `${mount.script.metadataId} · ${mount.script.contributions.flatMap(item => item.kind === 'renderer' ? item.inputs.map(input => input.kind === 'match' ? `match:${input.ruleId}` : `artifact:${input.artifactType}`) : [`${item.kind}:${item.id}`]).join(', ')}`,
    owner: `resolved@${mount.script.version}`,
    order: mount.orderIndex,
    status: 'active' as const,
  })), ...unavailableMounts.filter(mount => mount.enabled).map(mount => ({
    id: `unavailable-script:${mount.mountId}`,
    kind: 'script' as const,
    label: mount.scriptDocumentId,
    description: mount.message,
    owner: mount.mountId,
    status: 'degraded' as const,
  }))]
}
function ownerLabel(owner: TextRuleOwner | OwnerScope, t: Translator, getName?: (owner: TextRuleOwner | OwnerScope) => string | undefined): string {
  const name = getName?.(owner);
  if (owner.kind === 'workspace' || owner.kind === 'catalog') return t('textTransform.ownerWorkspace');
  if (owner.kind === 'user-override') return t('textTransform.ownerUserOverride');
  if (owner.kind === 'card') return name ? t('textTransform.ownerCardNamed', { name }) : t('textTransform.ownerCard', { id: owner.cardId });
  if (owner.kind === 'preset') return name ? t('textTransform.ownerPresetNamed', { name }) : t('textTransform.ownerPreset', { id: owner.presetId });
  if (owner.kind === 'extension') return name ? t('textTransform.ownerExtensionNamed', { name }) : t('textTransform.ownerExtension', { id: owner.packageId });
  return t('textTransform.ownerRuntime')
}
function readError(value: unknown): string { return value instanceof Error ? value.message : String(value) }
