import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@loom-studio/ui'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import { subscribeExtensionEvents } from '../../../shared/api/extension-events.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'

export function ExtensionModuleBatches(props: { api: StudioApi['extensions']; t: Translator; revision: number }) {
  const queryClient = useQueryClient()
  const batchesQuery = useQuery({
    queryKey: ['extensions', 'module-batches', props.revision],
    queryFn: () => props.api.listModuleBatches(),
    refetchInterval: query => (query.state.data?.batches.some(batch => batch.state !== 'completed') ? 500 : false),
    refetchIntervalInBackground: false,
  })

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['extensions', 'module-batches', props.revision] })
    }
    const unsubscribeExtensions = subscribeExtensionEvents({
      events: { 'extensions.changed': invalidate },
    })
    const unsubscribeCommits = subscribeDataCommits(operations => {
      if (operations.some(item => item.entityType.startsWith('extension'))) invalidate()
    }, () => {})
    return () => {
      unsubscribeExtensions()
      unsubscribeCommits()
    }
  }, [queryClient, props.revision])

  const batches = batchesQuery.data?.batches ?? []
  const error = batchesQuery.error instanceof Error
    ? batchesQuery.error.message
    : batchesQuery.error ? String(batchesQuery.error) : ''

  if (!batches.length && !error) return null
  return <details open={Boolean(error || batches.some(batch => batch.state !== 'completed'))}>
    <summary>{props.t('renderer.batch.title')} · {batches.length}</summary>
    <p>{props.t('renderer.batch.accepted')}</p>
    {error ? <p role="alert">{error}</p> : null}
    <Button onClick={() => { void batchesQuery.refetch() }}>{props.t('renderer.batch.refresh')}</Button>
    <ul>{[...batches].reverse().map(batch => <li key={batch.batchId}>
      {batch.packageId} · {batch.target.kind === 'card' ? batch.target.cardId : 'Global'} · {props.t(`renderer.batch.${batch.state}`)}
      <ul>{batch.results.map(result => <li key={result.moduleId}>
        {result.moduleId} · {props.t(result.status === 'completed' ? 'renderer.batch.success' : result.status === 'failed' ? 'renderer.batch.failed' : 'renderer.batch.unchanged')}
        {result.message ? ` · ${result.message}` : ''}
      </li>)}</ul>
    </li>)}</ul>
  </details>
}
