import { StoryHero } from '../../../shared/ui/story-hero/story-hero.js'
import type { CardSummary } from '../../../entities/index.js'
import { ExtensionIcon } from '../../../shared/ui/extension-icon/extension-icon.js'
import workspaceStyles from './extension-workspace.module.scss'
import { useEffect, useRef, useState } from 'react'
import { Database, Library, Plus, RefreshCw, RotateCcw, Info, ToggleLeft, ToggleRight } from 'lucide-react'
import { Button, Checkbox, Dialog, IconButton } from '@loom-studio/ui'
import type { ListExtensionInstallationsResult, ManagedExtensionPackage } from '../../../entities/index.js'
import type { ExtensionInstallationSource, TimelineExtensionAdoptionPreview, TimelineExtensionParticipation, TimelineExtensionRecoveryPreview, TimelineExtensionResourceInspection } from '../../../entities/extension.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './timeline-extension-panel.module.scss'

export type TimelineExtensionPanelProps = {
  api: StudioApi['timelineExtensions']
  installations: ListExtensionInstallationsResult['installations']
  packages: readonly ManagedExtensionPackage[]
  timeline?: { id: string; branchId: string; title?: string; cardId?: string }
  character?: CardSummary
  refreshToken?: number
  t: Translator
  onChanged(): void | Promise<unknown>
}

type Preview = { kind: 'adopt'; value: TimelineExtensionAdoptionPreview }
  | { kind: 'initialize'; value: TimelineExtensionAdoptionPreview }
  | { kind: 'recover'; value: TimelineExtensionRecoveryPreview }

export function TimelineExtensionPanel(props: TimelineExtensionPanelProps) {
  const [config, setConfig] = useState<TimelineExtensionParticipation>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview>()
  const [resources, setResources] = useState<TimelineExtensionResourceInspection>()
  const [sourceInfo, setSourceInfo] = useState<{ packageId: string; source?: ExtensionInstallationSource }>()
  const [acceptSource, setAcceptSource] = useState(false)
  const mounted = useRef(false)
  const pending = useRef(false)
  const request = useRef(0)
  const installationRevision = JSON.stringify(props.installations.map(item => [item.id, item.version]))

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current += 1 }
  }, [])

  async function refresh() {
    const id = ++request.current
    if (!props.timeline) { setConfig(undefined); return }
    setLoading(true)
    try {
      const result = await props.api.get({ timelineId: props.timeline.id })
      if (mounted.current && id === request.current) { setConfig(result); setError('') }
    } catch (cause) {
      if (mounted.current && id === request.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && id === request.current) setLoading(false)
    }
  }

  useEffect(() => {
    setConfig(undefined)
    setPreview(undefined)
    setResources(undefined)
    setSourceInfo(undefined)
    void refresh()
    return () => { request.current += 1 }
  }, [props.api, props.timeline?.id, props.timeline?.branchId, props.refreshToken, installationRevision])

  async function run(action: () => Promise<unknown>, mutation = false) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      if (!mounted.current) return
      if (mutation) {
        setPreview(undefined)
        await refresh()
        if (mounted.current) await props.onChanged()
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const cardId = props.timeline?.cardId
  const rows = new Map<string, {
    id: string; packageId: string; target: 'global' | 'card'
    installation?: ListExtensionInstallationsResult['installations'][number]
  }>(props.installations.filter(item => item.participation === 'timeline'
    && (item.target.kind === 'global' || item.target.cardId === cardId))
    .map(item => [item.id, { id: item.id, packageId: item.packageId, target: item.target.kind, installation: item }]))
  for (const entry of config?.entries ?? []) {
    if (!rows.has(entry.installationId)) rows.set(entry.installationId, {
      id: entry.installationId, packageId: entry.packageId, target: entry.source?.kind === 'card' ? 'card' : 'global',
    })
  }
  const hasContext = Boolean(props.timeline)
  const isSourceChange = preview?.kind === 'recover' && preview.value.sourceChanged

  return <section className={styles.panel} aria-busy={busy || loading}>
    <StoryHero character={props.character} label={props.t('participation.timeline')}
      title={props.timeline?.title || props.t('participation.timeline')}
      description="管理当前故事中运行的扩展。新故事会在开始时单独选择。"
      actions={<IconButton size="small" title={props.t('participation.refresh')} aria-label={props.t('participation.refresh')} disabled={busy || loading} onClick={() => void refresh()}>
        <RefreshCw size={16} aria-hidden="true" />
      </IconButton>} />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {!hasContext ? <p>{props.t('participation.noTimeline')}</p>
      : loading ? <p role="status">{props.t('participation.loading')}</p>
        : <ul className={styles.list}>
          {[...rows.values()].map(row => {
            const entry = config?.entries.find(item => item.installationId === row.id)
            const changed = Boolean(entry && row.installation && entry.installationVersion !== row.installation.version)
            const checked = entry?.enabled === true
            const status = !row.installation ? 'missing' : changed ? 'recoveryRequired' : checked ? 'adopted' : entry ? 'paused' : 'notAdopted'
            const pkg = props.packages.find(item => item.packageId === row.packageId
              && (item.target?.kind ?? 'global') === row.target
              && (item.target?.kind !== 'card' || item.target.cardId === cardId))
            return <li key={row.id} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.packageHeading}><ExtensionIcon packageId={row.packageId} iconUrl={pkg?.iconUrl} size={32} /><strong>{pkg?.displayName ?? row.packageId}</strong>
                  <IconButton size="small" aria-label={props.t('participation.source')} title={props.t('participation.source')} onClick={() => setSourceInfo({ packageId: row.packageId, source: row.installation?.source ?? entry?.source })}><Info size={16} /></IconButton></span>
                <small>{props.t(row.target === 'card'
                  ? 'participation.cardSource' : 'participation.globalSource')} · {row.installation?.packageVersion ?? entry?.packageVersion}</small>
              </div>
              <span className={styles.status}>{status === 'missing' || status === 'recoveryRequired' || status === 'notAdopted' ? props.t(`participation.${status}`) : null}</span>
              <div className={styles.actions}>
              <IconButton size="small" disabled={busy}
                title={props.t('participation.resources')} aria-label={`${props.t('participation.resources')}: ${row.packageId}`}
                onClick={() => void run(async () => {
                  const revision = request.current
                  const result = await props.api.inspectResources({ timelineId: props.timeline!.id, installationId: row.id })
                  if (mounted.current && revision === request.current) setResources(result)
                })}><Library size={16} aria-hidden="true" /></IconButton>
              {checked && row.installation && !changed ? <Button size="small" variant="ghost" disabled={busy}
                title={props.t('participation.initializeState')} aria-label={`${props.t('participation.initializeState')}: ${row.packageId}`}
                onClick={() => void run(async () => {
                  const value = await props.api.previewStateInitialization({
                    timelineId: props.timeline!.id, branchId: props.timeline!.branchId, installationId: row.id,
                  })
                  if (mounted.current) setPreview({ kind: 'initialize', value })
                })}><Database size={16} aria-hidden="true" />{props.t('participation.initializeState')}</Button> : null}
              {!entry ? <Button size="small" disabled={busy || !config || !row.installation} onClick={() => void run(async () => {
                  const value = await props.api.previewAdoption({
                    timelineId: props.timeline!.id, branchId: props.timeline!.branchId, installationId: row.id,
                  })
                  if (mounted.current) { setAcceptSource(false); setPreview({ kind: 'adopt', value }) }
                })}><Plus size={15} aria-hidden="true" />{props.t('participation.add')}</Button>
                  : changed ? <Button size="small" disabled={busy} onClick={() => void run(async () => {
                    const value = await props.api.previewRecovery({ timelineId: props.timeline!.id, installationId: row.id })
                    if (mounted.current) { setAcceptSource(false); setPreview({ kind: 'recover', value }) }
                  })}><RotateCcw size={15} aria-hidden="true" />{props.t('participation.recover')}</Button>
                    : <button type="button" className={workspaceStyles.packageToggle} aria-pressed={checked} disabled={busy || !row.installation}
                      title={props.t(checked ? 'renderer.disablePackage' : 'renderer.enablePackage')}
                      aria-label={`${props.t(checked ? 'renderer.disablePackage' : 'renderer.enablePackage')} · ${props.t('participation.timeline')}: ${pkg?.displayName ?? row.packageId}`}
                      onClick={() => { void run(() => props.api.update({
                        timelineId: props.timeline!.id, installationId: row.id, expectedVersion: config!.version, enabled: !checked,
                      }), true) }}>{checked ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}</button>}
              </div>
            </li>
          })}
          {rows.size === 0 ? <li>{props.t('participation.empty')}</li> : null}
        </ul>}
    {sourceInfo ? <Dialog open onClose={() => setSourceInfo(undefined)} title={props.t('participation.source')} closeOnBackdrop>
      <dl className={styles.sourceFacts}><dt>Package</dt><dd>{sourceInfo.packageId}</dd><dt>{props.t('participation.source')}</dt><dd>{sourceLabel(sourceInfo.source, props.t)}</dd></dl>
    </Dialog> : null}
    {resources ? <Dialog open onClose={() => setResources(undefined)} title={props.t('participation.resources')}>
      <ul className={styles.resourceList}>{resources.resources.map(resource => <li key={`${resource.kind}:${resource.id}`}>
        <strong>{resource.label}</strong>
        <span>{resource.kind} · {props.t(resource.eligible ? 'participation.resourceEligible' : 'participation.resourceUnavailable')}</span>
        <code>{resource.contributionId}</code>
      </li>)}</ul>
      {!resources.resources.length ? <p>{props.t('participation.none')}</p> : null}
    </Dialog> : null}
    {preview ? <Dialog open dismissible={!busy} onClose={() => setPreview(undefined)}
      title={props.t(preview.kind === 'adopt' ? 'participation.confirmAdd'
        : preview.kind === 'initialize' ? 'participation.initializeState' : 'participation.confirmRecovery')}
      actions={<>
        <Button disabled={busy} onClick={() => setPreview(undefined)}>{props.t('participation.cancel')}</Button>
        <Button disabled={busy || Boolean(isSourceChange && !acceptSource) || (preview.kind === 'initialize' && !preview.value.paths.length)} onClick={() => void run(
          () => preview.kind === 'adopt' ? props.api.adopt(preview.value)
            : preview.kind === 'initialize' ? props.api.initializeState(preview.value)
              : props.api.recover({ ...preview.value, acceptSourceChange: acceptSource }), true,
        )}>{props.t('participation.confirm')}</Button>
      </>}>
      <p>{preview.value.packageId} · {preview.value.packageVersion}</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <dl className={styles.preview}>
        {preview.kind === 'recover' ? <><dt>{props.t('participation.previousSource')}</dt><dd>{sourceLabel(preview.value.previousSource, props.t)}</dd></> : null}
        <dt>{props.t('participation.source')}</dt><dd>{sourceLabel(preview.value.source, props.t)}</dd>
        {preview.kind !== 'recover' ? <><dt>{props.t('participation.statePaths')}</dt><dd>{preview.value.paths.length
          ? preview.value.paths.join('\n') : props.t(preview.kind === 'initialize' ? 'participation.stateComplete' : 'participation.none')}</dd></> : null}
      </dl>
      {isSourceChange ? <label><Checkbox checked={acceptSource} disabled={busy} onChange={event => setAcceptSource(event.target.checked)} />{props.t('participation.acceptSource')}</label> : null}
    </Dialog> : null}
  </section>
}

function sourceLabel(source: ExtensionInstallationSource | undefined, t: Translator): string {
  if (!source) return t('participation.unknownSource')
  if (source.kind === 'card') return t('participation.cardSource')
  return source.kind === 'local' ? source.directory : source.url
}
