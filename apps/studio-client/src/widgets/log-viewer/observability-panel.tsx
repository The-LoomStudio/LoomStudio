import { Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Checkbox, Dialog, IconButton } from '@loom-studio/ui'
import { formatEntityReference, type EntityReference } from '@loom-studio/shared'
import { useLogReferenceLabels } from '../../features/log-viewer/model/use-log-reference-labels.js'
import type { ObservationReference } from '../../features/observability/model/observation-view.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { ObservabilityWorkbench } from './observability-workbench.js'
import { mapObservationStep, mapObservationSummary } from '../../features/observability/model/observation-mapping.js'
import { useObservations } from '../../features/observability/model/use-observations.js'
import styles from '../../features/observability/ui/observability-workbench.module.scss'

type Props = { directoryHeader?: ReactNode; active: boolean; api: StudioApi; endpoint: string; t: Translator; searchParams: URLSearchParams; onSearchParamsChange(params: URLSearchParams): void }

export function ObservabilityPanel({ directoryHeader, active, api, endpoint, t, searchParams, onSearchParamsChange }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const targetRecord = searchParams.get('observationId') ?? undefined
  const state = useObservations(api, endpoint, targetRecord, active)
  useEffect(() => { if (targetRecord) state.setRecordId(targetRecord) }, [targetRecord])
  const summary = state.selected?.record
  const providerId = state.entry.data?.id === state.step?.id ? state.entry.data?.request?.model?.providerProfileId : undefined
  const entityRefs: EntityReference[] = [
    ...(summary?.timelineId ? [{ kind: 'entity' as const, type: 'timeline' as const, id: summary.timelineId, branchId: summary.branchId }] : []),
    ...(summary?.agentSessionId ? [{ kind: 'entity' as const, type: 'session' as const, id: summary.agentSessionId }] : []),
    ...(providerId ? [{ kind: 'entity' as const, type: 'provider' as const, id: providerId }] : []),
  ]
  const names = useLogReferenceLabels(active ? api : undefined, endpoint, [...entityRefs.map(formatEntityReference), ...state.records.map(record => formatEntityReference({ kind: 'entity', type: 'run', id: record.id })), ...(summary ? [formatEntityReference({ kind: 'entity', type: 'run', id: summary.id })] : [])])
  function entityLink(ref: EntityReference): ObservationReference {
    const value = names.labels.get(`${ref.type}:${ref.id}`)
    return { label: `${t(`logs.ref.${ref.type}`)} · ${value ? value.state === 'available' ? value.title || t('observation.unnamed') : t(value.state === 'deleted' ? 'observation.resourceDeleted' : 'observation.recordUnavailable') : t(names.isError ? 'observation.readError' : 'observation.loading')}`,
      note: value?.state === 'available' ? t('observation.currentName') : undefined,
      open: value?.state === 'available' ? () => window.dispatchEvent(new CustomEvent('loom:open-reference', { detail: { uri: formatEntityReference(ref) } })) : undefined }
  }
  function selectRecord(id: string) {
    state.setRecordId(id)
    const params = new URLSearchParams(searchParams)
    params.set('observationId', id)
    onSearchParamsChange(params)
  }
  function notice(text: string, retry?: () => unknown): ReactNode {
    return <div className={styles.readNotice} role="status"><p>{text}</p>{retry && <Button size="small" onClick={() => { void retry() }}>{t('observation.retry')}</Button>}</div>
  }
  const selectedRecord = state.selected ? {
    ...mapObservationSummary(state.selected.record, t),
    source: names.labels.get(`run:${state.selected.record.id}`)?.source,
    references: [...entityRefs.filter(ref => ref.type !== 'provider').map(entityLink),
      ...(summary?.kind === 'run' ? [{ label: t('observation.applicationLogs'), open: () => {
        const params = new URLSearchParams(searchParams)
        params.delete('logView'); params.set('logRun', summary.id); params.set('logSource', 'all')
        onSearchParamsChange(params)
      } }] : []),
    ],
    stepCount: state.steps.length,
    steps: state.steps.map(step => ({ ...mapObservationStep(step, state.entry.data, state.build.data, step.id === state.step?.id && state.previousEntry.data?.id === state.previous?.id ? state.previousEntry.data : undefined, t), references: step.id === state.step?.id ? [
      ...entityRefs.filter(ref => ref.type === 'provider').map(entityLink),
      ...(step.buildId ? [{ label: t('observation.buildStage'), note: state.build.data === null ? t('observation.recordUnavailable') : undefined, open: state.build.data ? () => selectRecord(step.buildId!) : undefined }] : []),
    ] : [] })),
  } : undefined
  const detailNotice = !state.recordId ? undefined
    : state.detail.isError ? notice(t('observation.readError'), state.detail.refetch)
      : state.detail.isPending ? notice(t('observation.loading'))
        : state.detail.data === null ? notice(t('observation.unavailable'), state.detail.refetch) : undefined
  const stepNotice = !state.step ? undefined
    : state.entry.isError ? notice(t('observation.readError'), state.entry.refetch)
      : state.entry.isPending ? notice(t('observation.loading'))
        : state.entry.data === null ? notice(t('observation.unavailable'), state.entry.refetch) : undefined
  return <><ObservabilityWorkbench
    directoryHeader={<div className={styles.directoryHeading}>{directoryHeader}<IconButton aria-label={t('observation.settings')} title={t('observation.settings')} onClick={() => setSettingsOpen(true)}><Settings size={16} /></IconButton></div>}
    t={t}
    records={state.records.map(record => ({ ...mapObservationSummary(record, t), source: names.labels.get(`run:${record.id}`)?.source }))}
    selectedRecordId={state.recordId}
    selectedRecord={selectedRecord}
    onSelectRecord={selectRecord} onSelectStep={state.setStepId} onKindChange={state.setKind}
    listNotice={state.list.isError ? notice(t('observation.readError'), state.list.refetch) : state.list.isPending ? notice(t('observation.loading')) : undefined}
    listFooter={<>{!!state.list.data?.pages[0]?.dropped && notice(t('observation.dropped', { count: state.list.data.pages[0].dropped }))}{state.list.hasNextPage && <Button disabled={state.list.isFetchingNextPage} onClick={() => { void state.list.fetchNextPage() }}>{t('observation.loadMore')}</Button>}</>}
    detailNotice={detailNotice}
    stepNotice={stepNotice}
    toolbar={<>
      {state.buildId && state.build.isError ? notice(t('observation.buildError'), state.build.refetch) : null}
      {state.buildId && state.build.isPending ? notice(t('observation.buildLoading')) : null}
      {state.previousEntry.isError ? notice(t('observation.comparisonError'), state.previousEntry.refetch) : null}
    </>}
  /><Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t('observation.settings')} closeLabel={t('observation.close')} closeOnBackdrop>
    <div className={styles.logSettings}>      <label className={styles.persistenceToggle}><Checkbox checked={state.persistence.data?.enabled ?? false} disabled={!state.persistence.data?.available || state.setPersistence.isPending} onChange={event => state.setPersistence.mutate(event.target.checked)} />{t('observation.persistAcrossRestart')}</label><small>{t(state.persistence.data?.enabled ? 'observation.retentionPersisted' : 'observation.retention')}</small>
      {state.persistence.isError ? notice(t('observation.persistenceReadFailed'), state.persistence.refetch) : null}
      {state.setPersistence.isError ? notice(t('observation.persistenceSaveFailed'), () => state.setPersistence.mutate(state.setPersistence.variables!)) : null}
      {state.persistence.data?.error ? <div className={styles.persistenceError} role="status">{t('observation.persistenceError')} {state.persistence.data.error}</div> : null}
      {state.persistence.data && !state.persistence.data.available ? notice(t('observation.persistenceUnavailable')) : null}
</div>
  </Dialog></>
}
