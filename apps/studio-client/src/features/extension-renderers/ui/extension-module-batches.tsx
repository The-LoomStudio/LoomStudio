import { useEffect, useState } from 'react'
import { Button } from '@loom-studio/ui'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'

type Batches = Awaited<ReturnType<StudioApi['extensions']['listModuleBatches']>>['batches']
export function ExtensionModuleBatches(props: { api: StudioApi['extensions']; t: Translator; revision: number }) {
  const [batches, setBatches] = useState<Batches>([])
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function read() {
      try {
        const result = await props.api.listModuleBatches()
        if (!active) return
        setBatches(result.batches); setError('')
        if (result.batches.some(batch => batch.state !== 'completed')) timer = setTimeout(() => void read(), 500)
      } catch (error) { if (active) setError(error instanceof Error ? error.message : String(error)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [props.api, props.revision, refresh])
  if (!batches.length && !error) return null
  return <details open={Boolean(error || batches.some(batch => batch.state !== 'completed'))}>
    <summary>{props.t('renderer.batch.title')} · {batches.length}</summary>
    <p>{props.t('renderer.batch.accepted')}</p>
    {error ? <p role="alert">{error}</p> : null}
    <Button onClick={() => setRefresh(value => value + 1)}>{props.t('renderer.batch.refresh')}</Button>
    <ul>{[...batches].reverse().map(batch => <li key={batch.batchId}>
      {batch.packageId} · {batch.target.kind === 'card' ? batch.target.cardId : 'Global'} · {props.t(`renderer.batch.${batch.state}`)}
      <ul>{batch.results.map(result => <li key={result.moduleId}>
        {result.moduleId} · {props.t(result.status === 'completed' ? 'renderer.batch.success' : result.status === 'failed' ? 'renderer.batch.failed' : 'renderer.batch.unchanged')}
        {result.message ? ` · ${result.message}` : ''}
      </li>)}</ul>
    </li>)}</ul>
  </details>
}
