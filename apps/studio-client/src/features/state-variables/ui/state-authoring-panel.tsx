import { Box, Boxes, Braces, Component, FileCode2, Link2, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Card, CardStateTemplate } from '../../../entities/card.js'
import type { JsonObject } from '../../../entities/common.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { FileTree } from '../../../shared/ui/file-tree/file-tree.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { objectToYaml, parseCardStateConfig, stateSnapshotToTreeNodes, yamlToObject } from '../model/state-variable-editor.js'
import styles from './state-variables-panel.module.scss'

export type StateAuthoringPanelProps = {
  card?: Card
  t: Translator
  onSaveCard(input: {
    cardId: string
    expectedVersion: number
    stateTemplates?: Card['stateTemplates']
    stateDefinitionIds: string[]
    stateEntityTypes: NonNullable<Card['stateEntityTypes']>
    timelineStateEntities: NonNullable<Card['timelineStateEntities']>
    timelineComponentMounts: NonNullable<Card['timelineComponentMounts']>
    stateContributionIds: NonNullable<Card['stateContributionIds']>
    timelineStateBindings: NonNullable<Card['timelineStateBindings']>
  }): Promise<Card>
}

type DraftConfig = ReturnType<typeof cardToConfig>
type Selection =
  | { kind: 'entity-type' | 'entity' | 'component' | 'mount' | 'contribution' | 'binding'; index: number }
  | { kind: 'source' }

export function StateAuthoringPanel(props: StateAuthoringPanelProps) {
  const initial = cardToConfig(props.card)
  const [config, setConfig] = useState(initial)
  const [sourceText, setSourceText] = useState(() => configToYaml(initial))
  const [sourceError, setSourceError] = useState('')
  const [selection, setSelection] = useState<Selection>(() => defaultSelection(initial))
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [expandedIds, setExpandedIds] = useState<string[]>(['/entities'])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const cardIdRef = useRef(props.card?.id)
  const versionRef = useRef(props.card?.version)
  const baselineRef = useRef(configToYaml(initial))

  useEffect(() => {
    if (cardIdRef.current === props.card?.id) return
    const next = cardToConfig(props.card)
    const yaml = configToYaml(next)
    cardIdRef.current = props.card?.id
    versionRef.current = props.card?.version
    baselineRef.current = yaml
    setConfig(next)
    setSourceText(yaml)
    setSourceError('')
    setError('')
    setSelection(defaultSelection(next))
    setMobilePane('master')
  }, [props.card])

  const preview = useMemo(() => buildAssemblyPreview(config), [config])
  const previewNodes = useMemo(() => stateSnapshotToTreeNodes(preview.snapshot), [preview.snapshot])
  const dirty = sourceText !== baselineRef.current

  if (!props.card) return <section className={styles.panel}><div className={styles.emptyState}>{props.t('stateAuthoring.noCard')}</div></section>

  function commit(next: DraftConfig) {
    setConfig(next)
    setSourceText(configToYaml(next))
    setSourceError('')
    setError('')
  }

  function select(next: Selection) {
    setSelection(next)
    setMobilePane('detail')
  }

  function updateSource(text: string) {
    setSourceText(text)
    try {
      const parsed = parseCardStateConfig(text)
      setConfig({ ...parsed, stateTemplates: parsed.stateTemplates ?? [] })
      setSourceError('')
    } catch (cause) {
      setSourceError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function save() {
    if (saving || sourceError) return
    setSaving(true)
    setError('')
    try {
      const parsed = parseCardStateConfig(sourceText)
      const saved = await props.onSaveCard({
        cardId: props.card!.id,
        expectedVersion: versionRef.current ?? props.card!.version,
        stateTemplates: parsed.stateTemplates,
        stateDefinitionIds: parsed.stateDefinitionIds,
        stateEntityTypes: parsed.stateEntityTypes,
        timelineStateEntities: parsed.timelineStateEntities,
        timelineComponentMounts: parsed.timelineComponentMounts,
        stateContributionIds: parsed.stateContributionIds,
        timelineStateBindings: parsed.timelineStateBindings,
      })
      const next = cardToConfig(saved)
      const yaml = configToYaml(next)
      versionRef.current = saved.version
      baselineRef.current = yaml
      setConfig(next)
      setSourceText(yaml)
      toast.success(props.t('stateAuthoring.savedCard'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.panel} data-loom-component="state-authoring-panel">
      <header className={styles.intro}>
        <div><h2>{props.t('stateAuthoring.title')}</h2><p>{props.card.name} · v{versionRef.current ?? props.card.version}</p></div>
        <button className={styles.primaryActionBtn} type="button" disabled={!dirty || saving || Boolean(sourceError)} onClick={() => void save()}>
          <Save aria-hidden="true" size={14} /><span>{props.t('stateAuthoring.saveCard')}</span>
        </button>
      </header>
      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      <div className={styles.stateAuthoringBody}>
        <MasterDetailWorkbench
          backLabel={props.t('stateAuthoring.backToList')}
          dataComponent="state-authoring-workbench"
          defaultMasterWidth={250}
          detailMinWidth={320}
          mobilePane={mobilePane}
          onBack={() => setMobilePane('master')}
          onMobilePaneChange={setMobilePane}
          master={<AuthoringMaster config={config} selection={selection} select={select} commit={commit} t={props.t} />}
        >
          <div className={styles.stateAuthoringDetailLayout}>
            <div className={styles.stateAuthoringEditorScroll}>
              <AuthoringDetail config={config} selection={selection} commit={commit} sourceText={sourceText} sourceError={sourceError} updateSource={updateSource} t={props.t} />
            </div>
            <section className={styles.assemblyPreview} aria-label={props.t('stateAuthoring.preview')}>
              <header><h3>{props.t('stateAuthoring.preview')}</h3><span>{preview.rules.length} {props.t('stateAuthoring.previewRules')}</span></header>
              {preview.rules.length ? <div className={styles.assemblyRuleList}>{preview.rules.map(rule => <span key={rule}>{rule}</span>)}</div> : null}
              {preview.issues.length ? <div className={styles.fieldError}>{preview.issues.join(' · ')}</div> : null}
              {previewNodes.length ? <FileTree
                ariaLabel={props.t('stateAuthoring.preview')}
                expandedIds={expandedIds}
                getDisclosureLabel={node => node.label}
                getDragLabel={node => node.label}
                moreActionsLabel={props.t('stateVariables.actions')}
                nodes={previewNodes}
                onExpandedIdsChange={setExpandedIds}
                onSelect={() => undefined}
              /> : <div className={styles.emptyState}>{props.t('stateAuthoring.previewEmpty')}</div>}
            </section>
          </div>
        </MasterDetailWorkbench>
      </div>
    </section>
  )
}

function AuthoringMaster(props: { config: DraftConfig; selection: Selection; select(selection: Selection): void; commit(config: DraftConfig): void; t: Translator }) {
  const { config, selection, select, commit, t } = props
  const group = (title: string, count: number, addLabel: string, onAdd: () => void, children: ReactNode) => (
    <section className={styles.navGroup}>
      <header><span>{title}</span><small>{count}</small><button aria-label={addLabel} className={styles.navAddBtn} type="button" onClick={onAdd}><Plus aria-hidden="true" size={14} /></button></header>
      {children}
    </section>
  )
  return <nav className={styles.masterNav} aria-label={t('stateAuthoring.title')}>
    {group(t('stateAuthoring.entityTypes'), config.stateEntityTypes.length, t('stateAuthoring.addEntityType'), () => {
      const index = config.stateEntityTypes.length
      commit({ ...config, stateEntityTypes: [...config.stateEntityTypes, { id: `entity-type-${index + 1}`, collectionPath: `entities.type_${index + 1}` }] })
      select({ kind: 'entity-type', index })
    }, config.stateEntityTypes.map((item, index) => <NavItem key={`${item.id}:${index}`} active={selection.kind === 'entity-type' && selection.index === index} icon={<Boxes size={15} />} label={item.label || item.id} meta={item.collectionPath} onClick={() => select({ kind: 'entity-type', index })} />))}
    {group(t('stateAuthoring.entities'), config.timelineStateEntities.length, t('stateAuthoring.addEntity'), () => {
      if (!config.stateEntityTypes.length) return
      const index = config.timelineStateEntities.length
      commit({ ...config, timelineStateEntities: [...config.timelineStateEntities, { typeId: config.stateEntityTypes[0]!.id, entityId: `entity-${index + 1}` }] })
      select({ kind: 'entity', index })
    }, config.timelineStateEntities.map((item, index) => <NavItem key={`${item.typeId}:${item.entityId}:${index}`} active={selection.kind === 'entity' && selection.index === index} icon={<Box size={15} />} label={item.entityId} meta={item.typeId} onClick={() => select({ kind: 'entity', index })} />))}
    {group(t('stateAuthoring.templates'), config.stateTemplates.length, t('stateAuthoring.addTemplate'), () => {
      const index = config.stateTemplates.length
      const id = uniqueTemplateId(config.stateTemplates, index + 1)
      commit({ ...config, stateTemplates: [...config.stateTemplates, { id, templateVersion: 1, schema: { type: 'object' }, initial: {}, componentKey: `component_${index + 1}`, targetEntityTypeIds: [] }], stateDefinitionIds: [...config.stateDefinitionIds, id] })
      select({ kind: 'component', index })
    }, config.stateTemplates.map((item, index) => <NavItem key={`${item.id}:${index}`} active={selection.kind === 'component' && selection.index === index} icon={<Component size={15} />} label={item.label || item.componentKey || item.id} meta={`${item.id} · v${item.templateVersion}`} onClick={() => select({ kind: 'component', index })} />))}
    {group(t('stateAuthoring.mounts'), config.timelineComponentMounts.length, t('stateAuthoring.addMount'), () => {
      const template = config.stateTemplates[0]
      if (!template || !config.stateEntityTypes.length) return
      const index = config.timelineComponentMounts.length
      commit({ ...config, timelineComponentMounts: [...config.timelineComponentMounts, { templateId: template.id, templateVersion: template.templateVersion, componentKey: template.componentKey || template.id, target: { kind: 'entity-type', typeId: config.stateEntityTypes[0]!.id }, initial: {} }] })
      select({ kind: 'mount', index })
    }, config.timelineComponentMounts.map((item, index) => <NavItem key={`${item.templateId}:${index}`} active={selection.kind === 'mount' && selection.index === index} icon={<Link2 size={15} />} label={item.componentKey} meta={formatMountTarget(item)} onClick={() => select({ kind: 'mount', index })} />))}
    {group(t('stateAuthoring.contributions'), config.stateContributionIds.length, t('stateAuthoring.addContribution'), () => {
      const index = config.stateContributionIds.length
      commit({ ...config, stateContributionIds: [...config.stateContributionIds, `extension.package.contribution-${index + 1}`] })
      select({ kind: 'contribution', index })
    }, config.stateContributionIds.map((id, index) => <NavItem key={`${id}:${index}`} active={selection.kind === 'contribution' && selection.index === index} icon={<Link2 size={15} />} label={id} meta={t('stateAuthoring.extensionSource')} onClick={() => select({ kind: 'contribution', index })} />))}
    {group(t('stateAuthoring.rawBindings'), config.timelineStateBindings.length, t('stateAuthoring.addRawBinding'), () => {
      const template = config.stateTemplates[0]
      if (!template) return
      const index = config.timelineStateBindings.length
      commit({ ...config, timelineStateBindings: [...config.timelineStateBindings, { path: 'state.path', templateId: template.id, templateVersion: template.templateVersion, initial: {} }] })
      select({ kind: 'binding', index })
    }, config.timelineStateBindings.map((item, index) => <NavItem key={`${item.path}:${index}`} active={selection.kind === 'binding' && selection.index === index} icon={<Braces size={15} />} label={item.path} meta={`${item.templateId} · v${item.templateVersion}`} onClick={() => select({ kind: 'binding', index })} />))}
    <section className={styles.navGroup}><header><span>{t('stateAuthoring.source')}</span></header><NavItem active={selection.kind === 'source'} icon={<FileCode2 size={15} />} label={t('stateAuthoring.cardConfig')} meta="YAML" onClick={() => select({ kind: 'source' })} /></section>
  </nav>
}

function NavItem(props: { active: boolean; icon: ReactNode; label: string; meta: string; onClick(): void }) {
  return <button aria-current={props.active ? 'page' : undefined} className={styles.navItem} type="button" onClick={props.onClick}>{props.icon}<span className={styles.navItemBody}><strong>{props.label}</strong><small>{props.meta}</small></span></button>
}

function AuthoringDetail(props: { config: DraftConfig; selection: Selection; commit(config: DraftConfig): void; sourceText: string; sourceError: string; updateSource(text: string): void; t: Translator }) {
  const { config, selection, commit, t } = props
  if (selection.kind === 'source') return <div className={styles.stateAuthoringSource}><h3>{t('stateAuthoring.source')}</h3><textarea className={styles.yamlTextarea} value={props.sourceText} onChange={event => props.updateSource(event.target.value)} />{props.sourceError ? <div className={styles.fieldError}>{props.sourceError}</div> : null}</div>
  const list = selection.kind === 'entity-type' ? config.stateEntityTypes : selection.kind === 'entity' ? config.timelineStateEntities : selection.kind === 'component' ? config.stateTemplates : selection.kind === 'mount' ? config.timelineComponentMounts : selection.kind === 'contribution' ? config.stateContributionIds : config.timelineStateBindings
  if (!list[selection.index]) return <div className={styles.emptyState}>{t('stateAuthoring.unassigned')}</div>
  const remove = () => {
    if (selection.kind === 'entity-type') commit({ ...config, stateEntityTypes: config.stateEntityTypes.filter((_, index) => index !== selection.index) })
    if (selection.kind === 'entity') commit({ ...config, timelineStateEntities: config.timelineStateEntities.filter((_, index) => index !== selection.index) })
    if (selection.kind === 'component') {
      const removed = config.stateTemplates[selection.index]!
      commit({ ...config, stateTemplates: config.stateTemplates.filter((_, index) => index !== selection.index), stateDefinitionIds: config.stateDefinitionIds.filter(id => id !== removed.id), timelineComponentMounts: config.timelineComponentMounts.filter(mount => mount.templateId !== removed.id), timelineStateBindings: config.timelineStateBindings.filter(binding => binding.templateId !== removed.id) })
    }
    if (selection.kind === 'mount') commit({ ...config, timelineComponentMounts: config.timelineComponentMounts.filter((_, index) => index !== selection.index) })
    if (selection.kind === 'contribution') commit({ ...config, stateContributionIds: config.stateContributionIds.filter((_, index) => index !== selection.index) })
    if (selection.kind === 'binding') commit({ ...config, timelineStateBindings: config.timelineStateBindings.filter((_, index) => index !== selection.index) })
  }
  return <div className={styles.stateAuthoringEditor}><header className={styles.detailHeader}><div className={styles.headerTitle}><DetailIcon kind={selection.kind} /><h3>{detailTitle(selection.kind, t)}</h3></div><button className={styles.dangerActionBtn} type="button" onClick={remove}><Trash2 aria-hidden="true" size={14} /><span>{t('stateAuthoring.delete')}</span></button></header><div className={styles.stateAuthoringFields}>{renderFields(config, selection, commit, t)}</div></div>
}

function renderFields(config: DraftConfig, selection: Exclude<Selection, { kind: 'source' }>, commit: (config: DraftConfig) => void, t: Translator) {
  const index = selection.index
  if (selection.kind === 'entity-type') {
    const item = config.stateEntityTypes[index]!
    const update = (patch: Partial<typeof item>) => commit({ ...config, stateEntityTypes: config.stateEntityTypes.map((value, i) => i === index ? { ...value, ...patch } : value) })
    return <><TextField label={t('stateAuthoring.typeId')} value={item.id} onChange={id => update({ id })} /><TextField label={t('stateAuthoring.templateLabel')} value={item.label ?? ''} onChange={label => update({ label: label || undefined })} /><TextField label={t('stateAuthoring.collectionPath')} value={item.collectionPath} onChange={collectionPath => update({ collectionPath })} /></>
  }
  if (selection.kind === 'entity') {
    const item = config.timelineStateEntities[index]!
    const update = (patch: Partial<typeof item>) => commit({ ...config, timelineStateEntities: config.timelineStateEntities.map((value, i) => i === index ? { ...value, ...patch } : value) })
    return <><SelectField label={t('stateAuthoring.entityType')} value={item.typeId} options={config.stateEntityTypes.map(type => ({ value: type.id, label: type.label || type.id }))} onChange={typeId => update({ typeId })} /><TextField label={t('stateAuthoring.entityId')} value={item.entityId} onChange={entityId => update({ entityId })} /></>
  }
  if (selection.kind === 'component') {
    const item = config.stateTemplates[index]!
    const update = (patch: Partial<CardStateTemplate>) => commit(updateComponentTemplate(config, index, patch))
    return <><TextField label={t('stateAuthoring.templateId')} value={item.id} onChange={id => update({ id })} /><TextField label={t('stateAuthoring.templateLabel')} value={item.label ?? ''} onChange={label => update({ label: label || undefined })} /><NumberField label={t('stateAuthoring.templateVersion')} value={item.templateVersion} onChange={templateVersion => update({ templateVersion })} /><TextField label={t('stateAuthoring.componentKey')} value={item.componentKey ?? ''} onChange={componentKey => update({ componentKey })} /><CheckboxField label={t('stateAuthoring.targetEntityTypes')} options={config.stateEntityTypes} selected={item.targetEntityTypeIds ?? []} onChange={targetEntityTypeIds => update({ targetEntityTypeIds })} /><YamlField label={t('stateAuthoring.schema')} value={item.schema} onChange={schema => update({ schema })} /><YamlField label={t('stateAuthoring.initial')} value={item.initial} onChange={initial => update({ initial })} /></>
  }
  if (selection.kind === 'mount') {
    const item = config.timelineComponentMounts[index]!
    const update = (patch: Partial<typeof item>) => commit({ ...config, timelineComponentMounts: config.timelineComponentMounts.map((value, i) => i === index ? { ...value, ...patch } : value) })
    const template = config.stateTemplates.find(value => value.id === item.templateId)
    const entityOptions = config.timelineStateEntities.map(entity => ({ value: `${entity.typeId}:${entity.entityId}`, label: `${entity.entityId} · ${entity.typeId}` }))
    return <><SelectField label={t('stateAuthoring.bindingTemplate')} value={item.templateId} options={config.stateTemplates.map(value => ({ value: value.id, label: value.label || value.id }))} onChange={templateId => { const next = config.stateTemplates.find(value => value.id === templateId); update({ templateId, templateVersion: next?.templateVersion ?? 1, componentKey: next?.componentKey || templateId }) }} /><TextField label={t('stateAuthoring.componentKey')} value={item.componentKey} onChange={componentKey => update({ componentKey })} /><SelectField label={t('stateAuthoring.mountTargetKind')} value={item.target.kind} options={[{ value: 'entity', label: t('stateAuthoring.exactEntity') }, { value: 'entity-type', label: t('stateAuthoring.entityTypeBatch') }]} onChange={kind => update({ target: kind === 'entity' && config.timelineStateEntities[0] ? { kind: 'entity', entity: config.timelineStateEntities[0] } : { kind: 'entity-type', typeId: config.stateEntityTypes[0]?.id ?? '' } })} />{item.target.kind === 'entity' ? <SelectField label={t('stateAuthoring.mountTarget')} value={`${item.target.entity.typeId}:${item.target.entity.entityId}`} options={entityOptions} onChange={value => { const [typeId, entityId] = splitEntityKey(value); update({ target: { kind: 'entity', entity: { typeId, entityId } } }) }} /> : <SelectField label={t('stateAuthoring.mountTarget')} value={item.target.typeId} options={config.stateEntityTypes.map(type => ({ value: type.id, label: type.label || type.id }))} onChange={typeId => update({ target: { kind: 'entity-type', typeId } })} />}<YamlField label={t('stateAuthoring.bindingInitial')} value={item.initial ?? {}} onChange={initial => update({ initial })} /><small>{template?.targetEntityTypeIds?.length ? `${t('stateAuthoring.targetEntityTypes')}: ${template.targetEntityTypeIds.join(', ')}` : ''}</small></>
  }
  if (selection.kind === 'contribution') {
    const id = config.stateContributionIds[index]!
    return <><div className={styles.scopeBanner}>{t('stateAuthoring.contributionHint')}</div><TextField label={t('stateAuthoring.contributionId')} value={id} onChange={value => commit({ ...config, stateContributionIds: config.stateContributionIds.map((item, i) => i === index ? value : item) })} /></>
  }
  const item = config.timelineStateBindings[index]!
  const update = (patch: Partial<typeof item>) => commit({ ...config, timelineStateBindings: config.timelineStateBindings.map((value, i) => i === index ? { ...value, ...patch } : value) })
  return <><div className={styles.scopeBanner}>{t('stateAuthoring.rawBindingHint')}</div><TextField label={t('stateAuthoring.bindingPath')} value={item.path} onChange={path => update({ path })} /><SelectField label={t('stateAuthoring.bindingTemplate')} value={item.templateId} options={config.stateTemplates.map(value => ({ value: value.id, label: value.label || value.id }))} onChange={templateId => { const template = config.stateTemplates.find(value => value.id === templateId); update({ templateId, templateVersion: template?.templateVersion ?? 1 }) }} /><NumberField label={t('stateAuthoring.bindingVersion')} value={item.templateVersion} onChange={templateVersion => update({ templateVersion })} /><YamlField label={t('stateAuthoring.bindingInitial')} value={item.initial ?? {}} onChange={initial => update({ initial })} /></>
}

function TextField(props: { label: string; value: string; onChange(value: string): void }) { return <label><span>{props.label}</span><input value={props.value} onChange={event => props.onChange(event.target.value)} /></label> }
function NumberField(props: { label: string; value: number; onChange(value: number): void }) { return <label><span>{props.label}</span><input min={1} type="number" value={props.value} onChange={event => props.onChange(Number(event.target.value))} /></label> }
function SelectField(props: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange(value: string): void }) { return <label><span>{props.label}</span><select value={props.value} onChange={event => props.onChange(event.target.value)}>{props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
function CheckboxField(props: { label: string; options: NonNullable<Card['stateEntityTypes']>; selected: string[]; onChange(value: string[]): void }) { return <fieldset className={styles.checkboxField}><legend>{props.label}</legend>{props.options.map(option => <label key={option.id}><input type="checkbox" checked={props.selected.includes(option.id)} onChange={event => props.onChange(event.target.checked ? [...props.selected, option.id] : props.selected.filter(id => id !== option.id))} /><span>{option.label || option.id}</span></label>)}</fieldset> }
function YamlField(props: { label: string; value: JsonObject; onChange(value: JsonObject): void }) { const [error, setError] = useState(''); return <label><span>{props.label}</span><textarea key={objectToYaml(props.value)} defaultValue={objectToYaml(props.value)} onBlur={event => { try { props.onChange(yamlToObject(event.target.value)); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }} />{error ? <small className={styles.fieldError}>{error}</small> : null}</label> }

function DetailIcon(props: { kind: Exclude<Selection['kind'], 'source'> }) { return props.kind === 'entity-type' ? <Boxes size={16} /> : props.kind === 'entity' ? <Box size={16} /> : props.kind === 'component' ? <Component size={16} /> : props.kind === 'mount' || props.kind === 'contribution' ? <Link2 size={16} /> : <Braces size={16} /> }
function detailTitle(kind: Exclude<Selection['kind'], 'source'>, t: Translator) { return kind === 'entity-type' ? t('stateAuthoring.entityTypeDetails') : kind === 'entity' ? t('stateAuthoring.entityDetails') : kind === 'component' ? t('stateAuthoring.templateDetails') : kind === 'mount' ? t('stateAuthoring.mountDetails') : kind === 'contribution' ? t('stateAuthoring.contributionDetails') : t('stateAuthoring.rawBindingDetails') }

function cardToConfig(card?: Card) {
  return {
    stateTemplates: structuredClone(card?.stateTemplates ?? []),
    stateDefinitionIds: [...(card?.stateDefinitionIds ?? card?.stateTemplates?.map(template => template.id) ?? [])],
    stateEntityTypes: structuredClone(card?.stateEntityTypes ?? []),
    timelineStateEntities: structuredClone(card?.timelineStateEntities ?? []),
    timelineComponentMounts: structuredClone(card?.timelineComponentMounts ?? []),
    stateContributionIds: [...(card?.stateContributionIds ?? [])],
    timelineStateBindings: structuredClone(card?.timelineStateBindings ?? []),
  }
}

function configToYaml(config: DraftConfig) { return objectToYaml(config) }
function defaultSelection(config: DraftConfig): Selection { return config.stateEntityTypes.length ? { kind: 'entity-type', index: 0 } : config.timelineStateEntities.length ? { kind: 'entity', index: 0 } : config.stateTemplates.length ? { kind: 'component', index: 0 } : { kind: 'source' } }
function uniqueTemplateId(templates: CardStateTemplate[], seed: number) { const ids = new Set(templates.map(item => item.id)); let index = seed; while (ids.has(`component-${index}`)) index += 1; return `component-${index}` }
function updateComponentTemplate(config: DraftConfig, index: number, patch: Partial<CardStateTemplate>): DraftConfig {
  const current = config.stateTemplates[index]!
  const next = { ...current, ...patch }
  return {
    ...config,
    stateTemplates: config.stateTemplates.map((template, templateIndex) => templateIndex === index ? next : template),
    stateDefinitionIds: config.stateDefinitionIds.map(id => id === current.id ? next.id : id),
    timelineComponentMounts: config.timelineComponentMounts.map(mount => mount.templateId === current.id ? {
      ...mount,
      templateId: next.id,
      templateVersion: next.templateVersion,
      ...(mount.componentKey === current.componentKey && next.componentKey ? { componentKey: next.componentKey } : {}),
    } : mount),
    timelineStateBindings: config.timelineStateBindings.map(binding => binding.templateId === current.id ? {
      ...binding,
      templateId: next.id,
      templateVersion: next.templateVersion,
    } : binding),
  }
}
function splitEntityKey(value: string): [string, string] { const index = value.indexOf(':'); return index < 0 ? ['', value] : [value.slice(0, index), value.slice(index + 1)] }
function formatMountTarget(mount: NonNullable<Card['timelineComponentMounts']>[number]) { return mount.target.kind === 'entity' ? `${mount.target.entity.typeId}:${mount.target.entity.entityId}` : `${mount.target.typeId}:*` }

function buildAssemblyPreview(config: DraftConfig) {
  const snapshot: JsonObject = {}
  const issues: string[] = []
  const rules: string[] = []
  const types = new Map(config.stateEntityTypes.map(type => [type.id, type]))
  const templates = new Map(config.stateTemplates.map(template => [template.id, template]))
  for (const entity of config.timelineStateEntities) {
    const type = types.get(entity.typeId)
    if (!type) { issues.push(`Entity ${entity.entityId}: unknown type ${entity.typeId}`); continue }
    setPreviewPath(snapshot, [...type.collectionPath.split('.'), entity.entityId], { components: {} }, issues)
  }
  for (const mount of config.timelineComponentMounts) {
    const template = templates.get(mount.templateId)
    if (!template) { issues.push(`Mount ${mount.componentKey}: unknown component ${mount.templateId}`); continue }
    const targetTypeId = mount.target.kind === 'entity-type' ? mount.target.typeId : undefined
    const targets = mount.target.kind === 'entity' ? [mount.target.entity] : config.timelineStateEntities.filter(entity => entity.typeId === targetTypeId)
    rules.push(`${mount.componentKey} → ${formatMountTarget(mount)} (${targets.length})`)
    for (const target of targets) {
      const type = types.get(target.typeId)
      if (!type) continue
      setPreviewPath(snapshot, [...type.collectionPath.split('.'), target.entityId, 'components', mount.componentKey], deepMerge(template.initial, mount.initial ?? {}), issues)
    }
  }
  for (const binding of config.timelineStateBindings) {
    if (binding.path.includes('*')) { rules.push(`${binding.templateId} → ${binding.path}`); continue }
    const template = templates.get(binding.templateId)
    if (!template) { issues.push(`Path ${binding.path}: unknown component ${binding.templateId}`); continue }
    setPreviewPath(snapshot, binding.path.split('.'), deepMerge(template.initial, binding.initial ?? {}), issues)
    rules.push(`${binding.templateId} → ${binding.path}`)
  }
  return { snapshot, issues, rules }
}

function setPreviewPath(root: JsonObject, path: string[], value: JsonObject, issues: string[]) {
  let current = root
  for (const segment of path.slice(0, -1)) {
    const existing = current[segment]
    if (existing === undefined) { const child = {}; Object.defineProperty(current, segment, { value: child, enumerable: true, configurable: true, writable: true }); current = child; continue }
    if (!isObject(existing)) { issues.push(`Path conflict: ${path.join('.')}`); return }
    current = existing
  }
  const key = path.at(-1)
  if (!key) return
  if (Object.hasOwn(current, key)) { issues.push(`Duplicate path: ${path.join('.')}`); return }
  Object.defineProperty(current, key, { value, enumerable: true, configurable: true, writable: true })
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(override)) result[key] = isObject(result[key]) && isObject(value) ? deepMerge(result[key], value) : structuredClone(value)
  return result
}
function isObject(value: unknown): value is JsonObject { return typeof value === 'object' && value !== null && !Array.isArray(value) }
