import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BookOpen, Braces, FileText, Folder, Image, Link2, Regex, ScrollText } from 'lucide-react'
import type { Card, ContextAssetNode, PromptResource } from '../../entities/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import { FileTree } from '../../shared/ui/file-tree/file-tree.js'
import { ContextAssetEditor } from '../../features/context-assets/ui/context-asset-workbench.js'
import { TokenSnapshotControl, TokenSnapshotSummary } from '../../features/context-assets/ui/resource-token-summary.js'
import { useResourceTokenSnapshot } from '../../features/context-assets/model/use-resource-token-snapshot.js'
import { RuleEditorFields } from '../../features/text-transforms/ui/rule-editor-fields.js'
import { LoomScriptSourceFields } from '../../features/text-transforms/ui/loom-script-source-fields.js'
import { MacroEntryDetail } from '../../features/state-variables/ui/macro-entry-detail.js'
import { objectToYaml, yamlToObject } from '../../features/state-variables/model/state-variable-editor.js'
import { ExtensionSettingsForm } from '../../features/extension-renderers/ui/extension-settings-form.js'
import type { LongTextEditorMode } from '../../shared/ui/long-text-editor/long-text-editor-model.js'
import { CardResourceOverview, type CardDirectoryApi } from './card-resource-overview.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import { useRestorableScroll } from '../../shared/hooks/use-restorable-scroll.js'
import styles from './card-resource-overview.module.scss'
import { buildCardResourceTree, classifyCardPromptResources, readCardSettingTarget, type CardResourceFolder, type CardResourceGroup, type CardResourceLocation } from './card-resource-directory-model.js'

type FolderKey = CardResourceFolder
type Location = CardResourceLocation

export function CardResourceDirectory(props: {
  cardId: string
  api: Pick<StudioApi, 'cards' | 'textTransforms' | 'loomScripts' | 'states' | 'extensions' | 'extensionRuntime' | 'portableExtensionPayloads'>
  directoryApi?: CardDirectoryApi
  endpoint: string
  resources: PromptResource[]
  onChangeNode(id: string, partial: Partial<ContextAssetNode>): void
  onCommitNode(id: string, partial: Partial<ContextAssetNode>): void
  onRefreshCards?(): Promise<unknown>
  onOpenSetting?(resource: PromptResource, nodeId: string): void
  selectedTreeId?: string
  expandedTreeIds?: string[]
  onTreeStateChange?(selectedId: string | undefined, expandedIds: string[]): void
  t: Translator
}) {
  const { cardId, api, endpoint, t } = props
  const queryClient = useQueryClient()
  const mediaRevision = useCardMediaRevision()
  const card = useQuery({ queryKey: ['card-resource-directory', endpoint, cardId, 'card'], queryFn: () => api.cards.get(cardId) })
  const rules = useQuery({ queryKey: ['card-resource-directory', endpoint, cardId, 'rules'], queryFn: () => api.textTransforms.listRules({ kind: 'card', cardId }) })
  const scripts = useQuery({ queryKey: ['card-resource-directory', endpoint, cardId, 'scripts'], queryFn: () => api.loomScripts.list({ kind: 'card', cardId }) })
  const definitionIds = card.data?.card.stateDefinitionIds ?? []
  const definitions = useQuery({
    queryKey: ['card-resource-directory', endpoint, cardId, 'state', definitionIds],
    queryFn: () => api.states.listDefinitions(undefined, definitionIds),
    enabled: Boolean(card.data),
  })
  const extensions = useQuery({ queryKey: ['card-resource-directory', endpoint, cardId, 'extensions'], queryFn: () => api.extensions.list({ kind: 'card', cardId }) })
  const catalog = useQuery({ queryKey: ['card-resource-directory', endpoint, cardId, 'catalog'], queryFn: () => props.directoryApi!.scan(), enabled: Boolean(props.directoryApi) })
  const [location, setLocation] = useState<Location>({})
  const [expandedIds, setExpandedIds] = useState<string[]>(() => props.expandedTreeIds ?? [])
  const scroll = useRestorableScroll<HTMLDivElement>(`card-resources:${endpoint}:${cardId}`)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<LongTextEditorMode>('source')
  const current = card.data?.card
  const boundIds = [...new Set([...(current?.promptResourceIds ?? []), ...(current?.externalPromptResourceIds ?? [])])]
  const boundSettings = props.resources.filter(resource => boundIds.includes(resource.id) && resource.resourceKind === 'setting')
  const tokens = useResourceTokenSnapshot([
    ...boundSettings.map(resource => resource.rootNode),
    ...(current?.settingLayer.entries ?? []).map((entry, index) => ({
      id: `inline:${cardId}:${index}`, kind: 'entry', label: entry.title ?? '', body: entry.content,
    })),
  ], `${endpoint}:${cardId}`)
  const payloadIds = current?.portableExtensionPayloadIds ?? []
  const payloads = useQuery({
    queryKey: ['card-resource-directory', endpoint, cardId, 'payloads', payloadIds],
    queryFn: async () => Promise.all(payloadIds.map(id => api.portableExtensionPayloads.get(id).then(result => result.payload))),
    enabled: payloadIds.length > 0,
  })
  const { ownedSettings, ownedPresets, references, extensionResources } = classifyCardPromptResources(current, props.resources)
  const ownRules = rules.data?.rules ?? []
  const ownScripts = scripts.data?.scripts ?? []
  const stateDefinitions = definitions.data?.definitions ?? []
  const installs = extensions.data?.items ?? []
  const groups: CardResourceGroup[] = [
    { key: 'settings', label: t('context.authoring.settings'), entries: [
      ...(current?.settingLayer.entries ?? []).map((entry, index) => ({ id: `card-setting:${index}`, label: entry.title || entry.path || String(index + 1) })),
      ...ownedSettings.map(resource => ({ id: resource.id, label: resource.rootNode.label })),
    ] },
    { key: 'agents', label: t('rail.agent'), entries: ownedPresets.map(resource => ({ id: resource.id, label: resource.rootNode.label })) },
    { key: 'rules', label: t('rail.textTransform'), entries: ownRules.map(rule => ({ id: rule.id, label: rule.name })) },
    { key: 'scripts', label: t('textTransform.ownerScripts'), entries: ownScripts.map(script => ({ id: script.id, label: script.name })) },
    { key: 'macros', label: t('rail.macro'), entries: Object.keys(current?.macros ?? {}).map(name => ({ id: name, label: name })) },
    { key: 'state', label: t('character.stateVariables'), entries: [
      ...(current?.stateTemplates ?? []).map(item => ({ id: `inline:${item.id}`, label: item.label ?? item.id })),
      ...stateDefinitions.map(item => ({ id: item.id, label: item.label ?? item.id })),
    ] },
    { key: 'extensions', label: t('rail.extensions'), entries: [
      ...(current?.extensionPackages ?? []).map(item => ({ id: `embedded:${item.packageId}`, label: item.packageId })),
      ...installs.map(item => ({ id: `installed:${item.packageId}`, label: item.displayName,
        children: [
          ...((item.resources?.settings?.length ?? 0) > 0
            ? [{ id: `config:${item.packageId}`, label: t('renderer.settings') }] : []),
          ...extensionResources.filter(resource => resource.origin?.kind === 'extension-package'
            && resource.origin.packageId === item.packageId)
            .map(resource => ({ id: `resource:${resource.id}`, label: resource.rootNode.label })),
        ] })),
      ...extensionResources.filter(resource => !installs.some(item =>
        resource.origin?.kind === 'extension-package' && item.packageId === resource.origin.packageId))
        .map(resource => ({ id: `resource:${resource.id}`, label: resource.rootNode.label })),
      ...(payloads.data?.length ? [{ id: 'bound-payloads', label: t('directory.boundPayloads'),
        children: payloads.data.map(item => ({ id: `payload:${item.id}`, label: item.fileName })) }] : []),
    ] },
    { key: 'references', label: t('context.cardBindings.title'), entries: references.map(resource => ({ id: resource.id, label: resource.rootNode.label })) },
    { key: 'attachments', label: t('directory.attachments'), entries: [
      ...(current?.media?.avatarAssetId ? [{ id: 'avatar', label: t('directory.avatar') }] : []),
      ...(current?.media?.coverAssetId ? [{ id: 'background', label: t('directory.background') }] : []),
      ...(catalog.data?.entries.some(entry => entry.registeredCardId === cardId) ? [{ id: 'media', label: 'README / files' }] : []),
    ] },
  ]
  const visible = groups.filter(group => group.entries.length)
  const folder = visible.find(group => group.key === location.folder)
  const resource = [...ownedSettings, ...ownedPresets, ...references, ...extensionResources]
    .find(item => item.id === (location.item?.startsWith('resource:') ? location.item.slice(9) : location.item))
  const node = resource && ['settings', 'agents', 'references', 'extensions'].includes(location.folder ?? '')
    ? findNode(resource.rootNode, location.nodeId ?? resource.rootNode.id) : undefined
  const promptRoots = new Map([
    ...[...ownedSettings, ...ownedPresets, ...references].map(resource => [resource.id, resource.rootNode] as const),
    ...extensionResources.map(resource => [`resource:${resource.id}`, resource.rootNode] as const),
  ])
  const { nodes, targets } = buildCardResourceTree(visible, promptRoots)
  function navigate(next: Location) {
    setLocation(next)
  }
  const error = [card, rules, scripts, definitions, extensions, catalog, payloads].find(query => query.isError)?.error
  return <section className={styles.directory} aria-label={t('directory.attachments')}>
    <nav className={styles.breadcrumbs} aria-label={t('directory.attachments')}>
      <button type="button" onClick={() => navigate({})} disabled={!location.item}><ArrowLeft size={16} aria-hidden="true" />{t('character.back')}</button>
      <button type="button" onClick={() => navigate({})}>{current?.name ?? t('character.title')}</button>
      {folder ? <button type="button" onClick={() => navigate({})}>{folder.label}</button> : null}
      {location.item ? <span>{folder?.entries.find(entry => entry.id === location.item)?.label}</span> : null}
      {node && node.id !== resource?.rootNode.id ? <span>{node.label}</span> : null}
    </nav>
    {current ? <TokenSnapshotControl snapshot={tokens} t={t}
      incomplete={boundIds.some(id => !props.resources.some(resource => resource.id === id))} /> : null}
    {current ? <div><TokenSnapshotSummary snapshot={tokens} t={t}
      incomplete={boundIds.some(id => !props.resources.some(resource => resource.id === id))} /></div> : null}
    {error ? <p role="alert" className={styles.error}>{error.message}</p> : null}
    {card.isPending ? <p role="status">{t('directory.loading')}</p> : null}
    {!location.item && !card.isPending ? <div ref={scroll.ref} onScroll={scroll.onScroll} className={styles.directoryList}>
      <FileTree ariaLabel={t('directory.attachments')} expandedIds={expandedIds} selectedId={props.selectedTreeId} nodes={nodes}
        getDisclosureLabel={item => item.label} getDragLabel={item => item.label}
        moreActionsLabel={t('context.actionMore')} onExpandedIdsChange={ids => {
          setExpandedIds(ids)
          props.onTreeStateChange?.(props.selectedTreeId, ids)
        }}
        onSelect={item => {
          const target = targets.get(item.id)
          const selectedSetting = readCardSettingTarget(item.id, targets, [...ownedSettings, ...references, ...extensionResources])
          if (selectedSetting && props.onOpenSetting) {
            props.onTreeStateChange?.(item.id, expandedIds)
            props.onOpenSetting(selectedSetting.resource, selectedSetting.nodeId)
            return
          }
          if (item.children?.length) {
            const next = expandedIds.includes(item.id) ? expandedIds.filter(id => id !== item.id) : [...expandedIds, item.id]
            setExpandedIds(next)
            props.onTreeStateChange?.(props.selectedTreeId, next)
            return
          }
          if (!target) return
          navigate(target)
        }}
        renderIcon={item => visible.some(group => group.key === item.id)
          ? icon(item.id as FolderKey) : item.kind === 'folder'
            ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />} />
    </div> : null}
    {location.item && resource && ['settings', 'agents', 'references', 'extensions'].includes(location.folder ?? '')
      ? <div className={styles.directoryDetail}>
      {location.folder === 'references' || location.folder === 'extensions'
        ? <p className={styles.readOnlyOrigin}>{resource.origin?.kind === 'extension-package'
          ? `${t('directory.extensionContribution')} · ${resource.origin.packageId}`
          : resource.origin?.kind === 'builtin' ? t('directory.builtinResource')
            : resource.sourceArtifactRef ? t('directory.cardResource')
              : t('directory.userResource')} · {resource.id}</p> : null}
      <ContextAssetEditor key={`${cardId}:${resource.id}:${node?.id}`}
        activationEditable={node?.category === 'setting'}
        editorMode={editorMode} metadataOpen={metadataOpen}
        node={node} t={t}
        onChangeNode={props.onChangeNode}
        onCommitNode={props.onCommitNode}
        onEditorModeChange={setEditorMode} onMetadataOpenChange={setMetadataOpen} />
    </div> : null}
    {location.item?.startsWith('card-setting:') && location.folder === 'settings' && current
      ? <CardSettingEntry key={`${cardId}:${location.item}`} card={current} index={Number(location.item.slice(13))}
          onSave={async (partial, expectedVersion) => {
            const entries = current.settingLayer.entries.map((entry, index) => index === Number(location.item!.slice(13))
              ? { ...entry, ...(partial.label !== undefined ? { title: partial.label } : {}), ...(partial.body !== undefined ? { content: partial.body } : {}) } : entry)
            await api.cards.update({ cardId, expectedVersion, settingLayer: { entries } })
            await queryClient.invalidateQueries({ queryKey: ['card-resource-directory', endpoint, cardId, 'card'] })
            await props.onRefreshCards?.()
          }} t={t} /> : null}
    {location.item && location.folder === 'rules' && ownRules.find(item => item.id === location.item)
      ? <CardRuleEditor key={`${cardId}:${location.item}`} rule={ownRules.find(item => item.id === location.item)!}
          onSave={async (rule, expectedVersion) => {
            await api.textTransforms.upsertRule({ ruleId: location.item!, expectedVersion, rule })
            await queryClient.invalidateQueries({ queryKey: ['card-resource-directory', endpoint, cardId, 'rules'] })
          }} t={t} /> : null}
    {location.item && location.folder === 'scripts' && ownScripts.find(item => item.id === location.item)
      ? <CardScriptEditor key={`${cardId}:${location.item}`} api={api.loomScripts} endpoint={endpoint}
          script={ownScripts.find(item => item.id === location.item)!} t={t}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['card-resource-directory', endpoint, cardId, 'scripts'] })} /> : null}
    {location.item && location.folder === 'macros' && current?.macros?.[location.item] !== undefined
      ? <CardMacroEditor key={`${cardId}:${location.item}`} card={current} name={location.item}
          onSave={async (name, value, expectedVersion) => {
            await api.cards.update({ cardId, expectedVersion, macros: { ...current.macros, [name]: value } })
            await queryClient.invalidateQueries({ queryKey: ['card-resource-directory', endpoint, cardId, 'card'] })
            await props.onRefreshCards?.()
          }} t={t} /> : null}
    {location.item && location.folder === 'state' && current && (
      location.item.startsWith('inline:') || stateDefinitions.some(item => item.id === location.item)
    ) ? <CardStateDefinitionEditor key={`${cardId}:${location.item}`}
      card={current} id={location.item} definition={stateDefinitions.find(item => item.id === location.item)}
      t={t} onSave={async (schema, initial, label, templateVersion, expectedVersion) => {
        if (location.item!.startsWith('inline:')) {
          const id = location.item!.slice(7)
          await api.cards.update({ cardId, expectedVersion, stateTemplates: (current.stateTemplates ?? []).map(item =>
            item.id === id ? { ...item, schema, initial, label, templateVersion } : item) })
          await queryClient.invalidateQueries({ queryKey: ['card-resource-directory', endpoint, cardId, 'card'] })
          await props.onRefreshCards?.()
        } else {
          await api.states.upsertDefinition({ definitionId: location.item!, expectedVersion,
            definition: { kind: 'timeline-template', schema, initial, label, templateVersion } })
          await queryClient.invalidateQueries({ queryKey: ['card-resource-directory', endpoint, cardId, 'state'] })
        }
      }} /> : null}
    {location.item?.startsWith('config:') && location.folder === 'extensions'
      && installs.find(item => item.packageId === location.item!.slice(7))
      ? <CardExtensionConfig api={api.extensionRuntime} cardId={cardId}
          installation={installs.find(item => item.packageId === location.item!.slice(7))!} t={t} /> : null}
    {location.item?.startsWith('payload:') && location.folder === 'extensions'
      && payloads.data?.find(item => item.id === location.item!.slice(8))
      ? <div className={styles.packageDetails}>
        <h3>{payloads.data.find(item => item.id === location.item!.slice(8))!.fileName}</h3>
        <p>{t('directory.boundPayloads')} · {payloads.data.find(item => item.id === location.item!.slice(8))!.packageId}</p>
        <pre>{payloads.data.find(item => item.id === location.item!.slice(8))!.content}</pre>
      </div> : null}
    {location.item && location.folder === 'attachments' && location.item !== 'media' && current
      ? <img className={styles.cardImage} alt={location.item === 'avatar' ? t('directory.avatar') : t('directory.background')}
          src={cardMediaUrl(cardId, location.item === 'avatar' ? 'avatar' : 'background',
            location.item === 'avatar' ? current.media?.avatarAssetId : current.media?.coverAssetId, mediaRevision)} /> : null}
    {location.item === 'media' && location.folder === 'attachments' && props.directoryApi
      ? <CardResourceOverview api={props.directoryApi} cardId={cardId} onRefresh={props.onRefreshCards} t={t} /> : null}
    {location.folder === 'extensions' && location.item
      && (location.item.startsWith('embedded:') || location.item.startsWith('installed:'))
      ? <div className={styles.packageDetails}>
        <h3>{location.item.slice(location.item.indexOf(':') + 1)}</h3>
        <p>{t('directory.packageVersion')}: {location.item.startsWith('embedded:')
          ? current?.extensionPackages?.find(item => item.packageId === location.item!.slice(9))?.version
          : installs.find(item => item.packageId === location.item!.slice(10))?.version}</p>
        <p>{location.item.startsWith('embedded:') ? t('directory.embeddedPackageReadOnly') : t('renderer.installed')}</p>
      </div> : null}
  </section>
}

function CardScriptEditor(props: {
  api: StudioApi['loomScripts']
  endpoint: string
  script: Awaited<ReturnType<StudioApi['loomScripts']['list']>>['scripts'][number]
  onSaved(): Promise<unknown>
  t: Translator
}) {
  const { script, api, endpoint, t } = props
  const exported = useQuery({ queryKey: ['card-script-source', endpoint, script.id, script.version], queryFn: () => api.export(script.id) })
  const [draft, setDraft] = useState<{ fileName: string; source: string }>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const value = draft ?? exported.data?.artifact
  return <div className={styles.directoryEditor}>
    <h3>{script.name}</h3>
    {exported.isPending ? <p role="status">{t('directory.loading')}</p> : null}
    {exported.isError ? <p role="alert" className={styles.error}>{exported.error.message}</p> : null}
    {value ? <LoomScriptSourceFields fileName={value.fileName} source={value.source} disabled={saving} t={t}
      onFileNameChange={fileName => setDraft({ ...value, fileName })}
      onSourceChange={source => setDraft({ ...value, source })} /> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <button type="button" disabled={!value || saving || !draft} onClick={() => {
      if (!value) return
      setSaving(true)
      setError('')
      void api.update({ scriptDocumentId: script.id, expectedVersion: script.version,
        fileName: value.fileName, source: value.source })
        .then(() => props.onSaved())
        .then(() => setDraft(undefined))
        .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setSaving(false))
    }}>{t('textTransform.save')}</button>
  </div>
}

function CardStateDefinitionEditor(props: {
  card: Card
  id: string
  definition?: Awaited<ReturnType<StudioApi['states']['listDefinitions']>>['definitions'][number]
  onSave(schema: Record<string, import('@loom-studio/client-bridge').ClientJsonValue>,
    initial: Record<string, import('@loom-studio/client-bridge').ClientJsonValue>,
    label: string | undefined, templateVersion: number, expectedVersion: number): Promise<void>
  t: Translator
}) {
  const inline = props.id.startsWith('inline:')
    ? props.card.stateTemplates?.find(item => item.id === props.id.slice(7)) : undefined
  const template = inline ?? (props.definition?.kind === 'timeline-template' ? props.definition : undefined)
  const [label, setLabel] = useState(template?.label ?? '')
  const [templateVersion, setTemplateVersion] = useState(template?.templateVersion ?? 1)
  const [schemaText, setSchemaText] = useState(() => objectToYaml(template?.schema))
  const [initialText, setInitialText] = useState(() => objectToYaml(template?.initial))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  if (!template) return <p className={styles.error} role="alert">{props.t('stateAuthoring.unassigned')}</p>
  return <div className={styles.stateDefinitionEditor}>
    <h3>{template.label || (inline?.id ?? props.definition?.id)}</h3>
    <label>{props.t('stateAuthoring.templateLabel')}<input value={label} onChange={event => setLabel(event.target.value)} /></label>
    <label>{props.t('stateAuthoring.templateVersion')}<input min={1} type="number" value={templateVersion}
      onChange={event => setTemplateVersion(Number(event.target.value))} /></label>
    <label>{props.t('stateAuthoring.schema')}<textarea value={schemaText} onChange={event => setSchemaText(event.target.value)} /></label>
    <label>{props.t('stateAuthoring.initial')}<textarea value={initialText} onChange={event => setInitialText(event.target.value)} /></label>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <button type="button" disabled={saving} onClick={() => {
      setError('')
      try {
        const schema = yamlToObject(schemaText, props.t('stateAuthoring.schema'))
        const initial = yamlToObject(initialText, props.t('stateAuthoring.initial'))
        if (!Number.isSafeInteger(templateVersion) || templateVersion < 1) throw new Error(props.t('stateAuthoring.templateVersion'))
        setSaving(true)
        void props.onSave(schema, initial, label || undefined, templateVersion, inline ? props.card.version : props.definition!.version)
          .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setSaving(false))
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    }}>{props.t('stateAuthoring.saveCard')}</button>
  </div>
}

function CardExtensionConfig(props: {
  api: StudioApi['extensionRuntime']
  cardId: string
  installation: Awaited<ReturnType<StudioApi['extensions']['list']>>['items'][number]
  t: Translator
}) {
  const settings = props.installation.resources?.settings ?? []
  return <div className={styles.directoryDetail}>
    <h3>{props.installation.displayName}</h3>
    {settings.length ? <ExtensionSettingsForm api={props.api} configRevision={0}
      packageId={props.installation.packageId} scopeContext={{ cardId: props.cardId }}
      settings={settings} t={props.t} /> : <p>{props.t('renderer.settings')}</p>}
  </div>
}

function CardRuleEditor(props: {
  rule: Awaited<ReturnType<StudioApi['textTransforms']['listRules']>>['rules'][number]
  onSave(rule: Parameters<StudioApi['textTransforms']['upsertRule']>[0]['rule'], version: number): Promise<void>
  t: Translator
}) {
  const [draft, setDraft] = useState<Parameters<typeof RuleEditorFields>[0]['value']>(() => ({
    name: props.rule.name, owner: props.rule.owner, enabled: props.rule.enabled,
    orderIndex: props.rule.orderIndex, matcher: props.rule.matcher, effect: props.rule.effect,
    targets: props.rule.targets, phases: props.rule.phases, range: props.rule.range,
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  return <div className={styles.directoryEditor}>
    <RuleEditorFields value={draft} disabled={saving} onChange={setDraft} t={props.t} />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <button type="button" disabled={saving} onClick={() => {
      setSaving(true)
      setError('')
      void props.onSave({ ...draft, orderIndex: draft.orderIndex ?? props.rule.orderIndex }, props.rule.version)
        .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setSaving(false))
    }}>{props.t('textTransform.save')}</button>
  </div>
}

function CardMacroEditor(props: { card: Card; name: string; onSave(name: string, value: string, version: number): Promise<void>; t: Translator }) {
  const [value, setValue] = useState(props.card.macros?.[props.name] ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <MacroEntryDetail title={props.t('macroAuthoring.title')} name={props.name} value={value} editable
    busy={busy} dirty={value !== props.card.macros?.[props.name]} error={error} t={props.t}
    onValueChange={setValue} onSave={() => {
      setBusy(true)
      setError('')
      void props.onSave(props.name, value, props.card.version)
        .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setBusy(false))
    }} />
}

function CardSettingEntry(props: { card: Card; index: number; onSave(partial: Partial<ContextAssetNode>, version: number): Promise<void>; t: Translator }) {
  const entry = props.card.settingLayer.entries[props.index]
  const [node, setNode] = useState<ContextAssetNode>(() => ({
    id: `card-setting:${props.index}`, kind: 'entry', category: 'setting',
    label: entry?.title || entry?.path || String(props.index + 1), body: entry?.content ?? '',
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<LongTextEditorMode>('source')
  if (!entry) return null
  return <div className={styles.directoryDetail}>
    <ContextAssetEditor node={node} activationEditable={false} editorMode={editorMode}
      metadataOpen={metadataOpen} t={props.t}
      onChangeNode={(_, partial) => setNode(current => ({ ...current, ...partial }))}
      onCommitNode={(_, partial) => {
        setNode(current => ({ ...current, ...partial }))
        setSaving(true)
        setError('')
        void props.onSave(partial, props.card.version)
          .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setSaving(false))
      }}
      onEditorModeChange={setEditorMode} onMetadataOpenChange={setMetadataOpen} />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <button type="button" disabled={saving || (node.body === entry.content && node.label === (entry.title || entry.path || String(props.index + 1)))} onClick={() => {
      setSaving(true)
      setError('')
      void props.onSave({ label: node.label, body: node.body }, props.card.version)
        .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setSaving(false))
    }}>{props.t('character.save')}</button>
  </div>
}

function findNode(root: ContextAssetNode, id: string): ContextAssetNode | undefined {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

function icon(folder: FolderKey) {
  const Icon = ({ settings: BookOpen, agents: BookOpen, references: Link2, rules: Regex, scripts: ScrollText,
    macros: Braces, state: Braces, extensions: Folder, attachments: Image })[folder]
  return <Icon size={16} aria-hidden="true" />
}
