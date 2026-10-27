import { ExtensionIcon, useExtensionIdentities } from '../../../shared/ui/extension-icon/extension-icon.js'
import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Database, Folder, RefreshCw } from 'lucide-react'
import type { StateContribution } from '@loom-studio/shared'
import type { Card } from '../../../entities/card.js'
import type { ExtensionInstallationSource } from '../../../entities/extension.js'
import type { StateSourcesInspection, StateTarget } from '../../../entities/state.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { FileTree, type FileTreeNode } from '../../../shared/ui/file-tree/file-tree.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { objectToYaml } from '../model/state-variable-editor.js'
import styles from './state-sources-panel.module.scss'

type Props = {
  api: Pick<StudioApi['states'], 'inspectSources'>
  card?: Pick<Card, 'id' | 'version'>
  timelineTarget?: Extract<StateTarget, { scope: 'timeline' }>
  refreshToken?: string
  t: Translator
  header?: ReactNode
}
type ExtensionSource = StateSourcesInspection['extensions'][number]
type Outcome = { api: Props['api']; key: string } & ({ data: StateSourcesInspection } | { error: string })

export function StateSourcesPanel(props: Props) {
  const identities = useExtensionIdentities()
  const [outcome, setOutcome] = useState<Outcome>()
  const [refresh, setRefresh] = useState(0)
  const [selectedId, setSelectedId] = useState('timeline')
  const [expandedIds, setExpandedIds] = useState(['definitions', 'extensions'])
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const { api, t, timelineTarget: target } = props
  const key = JSON.stringify([props.card?.id, props.card?.version, target?.timelineId, target?.branchId, props.refreshToken, refresh])
  const current = outcome?.api === api && outcome.key === key ? outcome : undefined
  const data = current && 'data' in current ? current.data : undefined
  const error = current && 'error' in current ? current.error : undefined

  useEffect(() => {
    let active = true
    void api.inspectSources({ cardId: props.card?.id, target }).then(
      data => { if (active) setOutcome({ api, key, data }) },
      cause => { if (active) setOutcome({ api, key, error: cause instanceof Error ? cause.message : String(cause) }) },
    )
    return () => { active = false }
  }, [api, key])

  const nodes: FileTreeNode[] = data ? [
    ...(data.timeline ? [{ id: 'timeline', kind: 'entry' as const, label: t('stateSources.accepted'), meta: data.timeline.target.timelineId }] : []),
    { id: 'card', kind: 'entry', label: t('stateSources.card'), meta: data.card?.name ?? t('stateSources.noCard') },
    { id: 'definitions', kind: 'folder', label: t('stateSources.definitions'), meta: String(data.definitions.length),
      children: data.definitions.map(definition => ({
        id: `definition:${definition.id}`, kind: 'entry', label: definition.label || definition.id,
        meta: definition.kind === 'global' ? t('stateVariables.globalState') : t('stateSources.template'),
      })) },
    { id: 'extensions', kind: 'folder', label: t('stateSources.extensions'), meta: String(data.extensions.length),
      children: data.extensions.map(source => ({
        id: source.installationId, kind: 'entry', label: identities.find(item => item.packageId === source.packageId)?.displayName ?? source.packageId,
        meta: `${scopeLabel(source, t)} · ${participationLabel(source, Boolean(data.timeline), t)}`,
      })) },
  ] : []
  const selectedDefinition = data?.definitions.find(item => `definition:${item.id}` === selectedId)
  const selectedExtension = data?.extensions.find(item => item.installationId === selectedId)
  const selection = selectedDefinition || selectedExtension || selectedId === 'card'
    ? selectedId : data?.timeline ? 'timeline' : 'card'

  return <section className={styles.panel} aria-busy={!current} data-loom-component="state-sources-panel">
    <MasterDetailWorkbench
      dataComponent="state-sources-workbench" defaultMasterWidth={280} detailMinWidth={280}
      mobilePane={mobilePane} onMobilePaneChange={setMobilePane}
      backLabel={t('stateAuthoring.backToList')} resizeLabel={t('stateVariables.resizeSidebar')}
      master={<div className={styles.masterPane}>
        <header className={styles.masterHeader}>
          {props.header}
        </header>
        <div className={styles.masterToolbar}>
          <button type="button" className={styles.toolbarIconBtn} disabled={!current}
            aria-label={t('stateVariables.refresh')} title={t('stateVariables.refresh')} onClick={() => setRefresh(value => value + 1)}>
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.masterBody}><FileTree
          ariaLabel={t('stateSources.title')} nodes={nodes} selectedId={selection}
          expandedIds={expandedIds} onExpandedIdsChange={setExpandedIds}
          getDisclosureLabel={(node, expanded) => `${t(expanded ? 'stateVariables.collapse' : 'stateVariables.expand')}: ${node.label}`}
          getDragLabel={node => node.label} moreActionsLabel={t('stateVariables.actions')}
          renderIcon={node => node.kind === 'folder' ? <Folder size={16} /> : node.id === 'card' ? <BookOpen size={16} />
            : data?.extensions.some(item => item.installationId === node.id) ? <ExtensionIcon packageId={data.extensions.find(item => item.installationId === node.id)?.packageId} size={16} /> : <Database size={16} />}
          onSelect={node => {
            if (node.kind === 'folder') return
            setSelectedId(node.id)
            setMobilePane('detail')
          }}
        /></div>
      </div>}
    >
      {!current ? <p className={styles.message} role="status">{t('participation.loading')}</p>
        : error ? <p className={styles.error} role="alert">{error}</p>
          : !data ? null
          : <div className={styles.detail}>
            {selectedExtension ? <ExtensionDetail source={selectedExtension} timeline={data.timeline} t={t} />
              : selectedDefinition ? <>
                <h3>{selectedDefinition.label || selectedDefinition.id}</h3>
                <p>{t('stateSources.definitions')} · {selectedDefinition.kind === 'global' ? t('stateVariables.globalState') : t('stateSources.template')}</p>
                <SourceCode value={selectedDefinition} />
              </> : selection === 'timeline' && data.timeline ? <>
                <h3>{t('stateSources.accepted')}</h3>
                <dl className={styles.facts}>
                  <dt>Timeline</dt><dd>{data.timeline.target.timelineId}</dd>
                  <dt>Branch</dt><dd>{data.timeline.target.branchId}</dd>
                  <dt>{t('stateVariables.revision')}</dt><dd>{data.timeline.revisionId}</dd>
                  <dt>{t('stateSources.cardAtCreation')}</dt><dd>{data.timeline.context
                    ? `${data.timeline.context.cardName ?? data.timeline.context.sourceCardId} · v${data.timeline.context.sourceCardVersion}`
                    : t('stateSources.contextMissing')}</dd>
                </dl>
                <PathList paths={data.timeline.paths} t={t} />
                {data.timeline.context ? <details><summary>{t('stateSources.acceptedContext')}</summary><SourceCode value={data.timeline.context} /></details> : null}
              </> : data ? <CardDetail data={data} t={t} /> : null}
          </div>}
    </MasterDetailWorkbench>
  </section>
}

function CardDetail({ data, t }: { data: StateSourcesInspection; t: Translator }) {
  const card = data.card
  if (!card) return <p>{t('stateSources.noCard')}</p>
  return <>
    <h3>{card.name} · v{card.version}</h3>
    <h4>{t('stateSources.card')}</h4>
    <Declaration declaration={card.declaration} t={t} />
    <h4>{t('stateSources.definitionRefs')}</h4>
    <ul className={styles.references}>{card.definitionIds.map(id => {
      const definition = data.definitions.find(item => item.id === id)
      const status = card.declaration.templates.some(item => item.id === id) ? 'overridden'
        : definition?.kind === 'timeline-template' ? 'available' : definition ? 'wrongKind' : 'missing'
      return <li key={id}><code>{id}</code><span>{t(`stateSources.${status}`)}</span></li>
    })}</ul>
    {!card.definitionIds.length ? <p>{t('participation.none')}</p> : null}
    <h4>{t('stateSources.contributionRefs')}</h4>
    <ul className={styles.references}>{card.contributionIds.map(id => <li key={id}>
      <code>{id}</code><span>{t(data.extensions.some(source => source.registered.some(item => item.contributionId === id))
        ? 'stateSources.available' : 'stateSources.unregistered')}</span>
    </li>)}</ul>
    {!card.contributionIds.length ? <p>{t('participation.none')}</p> : null}
  </>
}

function ExtensionDetail({ source, timeline, t }: { source: ExtensionSource; timeline: StateSourcesInspection['timeline']; t: Translator }) {
  return <>
    <h3>{source.packageId}</h3>
    <dl className={styles.facts}>
      <dt>{t('stateSources.scope')}</dt><dd>{scopeLabel(source, t)}</dd>
      <dt>{t('participation.cardDefaults')}</dt><dd>{t(source.cardDefault ? 'stateSources.selected' : 'stateSources.notSelected')}</dd>
      <dt>{t('participation.timeline')}</dt><dd>{participationLabel(source, Boolean(timeline), t)}</dd>
      <dt>{t('stateSources.installedVersion')}</dt><dd>{source.installation?.packageVersion ?? t('stateSources.installationMissing')}</dd>
      <dt>{t('stateSources.acceptedVersion')}</dt><dd>{source.adoption?.packageVersion ?? t('participation.none')}</dd>
      <dt>{t('participation.source')}</dt><dd>{sourceLabel(source.installation?.source, t)}</dd>
      <dt>{t('participation.previousSource')}</dt><dd>{sourceLabel(source.adoption?.source, t)}</dd>
    </dl>
    {timeline ? <PathList paths={timeline.paths.filter(path => path.installationId === source.installationId)} t={t} /> : null}
    <h4>{t('stateSources.registered')} ({source.registered.length})</h4>
    <Contributions values={source.registered} t={t} />
    {!source.registered.length ? <p>{t('stateSources.unregistered')}</p> : null}
    <h4>{t('stateSources.accepted')} ({source.accepted.length})</h4>
    <Contributions values={source.accepted} t={t} />
    {!source.accepted.length ? <p>{t(timeline ? 'stateSources.notAccepted' : 'stateVariables.noTimeline')}</p> : null}
  </>
}

function Contributions({ values, t }: { values: ExtensionSource['registered']; t: Translator }) {
  return values.map(value => <section className={styles.contribution} key={value.contributionId}>
    <h5>{value.contributionId}</h5>
    <p>{value.moduleId} · v{value.packageVersion}</p>
    <Declaration declaration={value.declaration} t={t} />
  </section>)
}

function Declaration({ declaration, t }: { declaration: StateContribution; t: Translator }) {
  return <>
    <dl className={styles.facts}>
      <dt>{t('stateAuthoring.entityTypes')}</dt><dd>{declaration.entityTypes.map(type => type.label || type.id).join(', ') || t('participation.none')}</dd>
      <dt>{t('stateAuthoring.entities')}</dt><dd>{declaration.entities.map(entity => `${entity.typeId} / ${entity.entityId}`).join(', ') || t('participation.none')}</dd>
      <dt>{t('stateAuthoring.templates')}</dt><dd>{declaration.templates.map(template => `${template.label || template.componentKey || template.id} (v${template.templateVersion})`).join(', ') || t('participation.none')}</dd>
      <dt>{t('stateAuthoring.mounts')}</dt><dd>{declaration.componentMounts.length}</dd>
      <dt>{t('stateAuthoring.rawBindings')}</dt><dd>{declaration.bindings.length}</dd>
    </dl>
    <details><summary>{t('stateSources.declaration')}</summary><SourceCode value={declaration} /></details>
  </>
}

function PathList({ paths, t }: { paths: NonNullable<StateSourcesInspection['timeline']>['paths']; t: Translator }) {
  return <section>
    <h4>{t('stateSources.branchData')}</h4>
    {!paths.length ? <p>{t('stateSources.noPaths')}</p> : <ul className={styles.paths}>
      {paths.map(path => <li key={`${path.kind}:${path.path}`} data-state-presence={path.present ? 'present' : 'missing'}>
        <code>{path.path}</code>
        <span>{t(`stateSources.${path.kind}`)} · {t(path.present ? 'stateSources.present' : 'stateSources.missing')}</span>
      </li>)}
    </ul>}
  </section>
}

function SourceCode({ value }: { value: unknown }): ReactNode {
  return <pre className={styles.code}>{objectToYaml(value)}</pre>
}

function scopeLabel(source: ExtensionSource, t: Translator): string {
  return t(source.target?.kind === 'global' ? 'participation.globalSource'
    : source.target?.kind === 'card' ? 'participation.cardSource' : 'participation.unknownSource')
}

function participationLabel(source: ExtensionSource, hasTimeline: boolean, t: Translator): string {
  if (!hasTimeline) return t('stateVariables.noTimeline')
  if (!source.installation) return t('stateSources.installationMissing')
  if (!source.adoption) return t(source.installation.participation === 'timeline' ? 'participation.notAdopted' : 'stateSources.shared')
  if (!source.adoption.enabled) return t('participation.paused')
  return t(source.eligible ? 'stateSources.eligible' : 'participation.recoveryRequired')
}

function sourceLabel(source: ExtensionInstallationSource | undefined, t: Translator): string {
  if (!source) return t('participation.unknownSource')
  return source.kind === 'card' ? t('participation.cardSource') : source.kind === 'local' ? source.directory : source.url
}
