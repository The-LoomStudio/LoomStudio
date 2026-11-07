import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { notify } from '../../../shared/notifications/index.js'

export function ResourceUpdateNotifications(props: { api: StudioApi['resourceDownloads']; endpoint: string; ready: boolean; onOpen(): void }) {
  const shown = useRef(new Set<string>())
  const query = useQuery({ queryKey: ['resource-updates', props.endpoint], queryFn: () => props.api.listUpdates(), enabled: props.ready, refetchInterval: 60_000 })
  useEffect(() => { shown.current.clear() }, [props.endpoint])
  useEffect(() => {
    for (const record of query.data ?? []) {
      const candidate = record.candidate
      if (record.status !== 'available' || !candidate || record.ignoredCandidate === candidate.id || record.notifiedCandidate === candidate.id) continue
      const key = `${record.id}/${candidate.id}`
      if (shown.current.has(key)) continue
      shown.current.add(key)
      notify.info(`${record.name} 有新版本`, { id: key, description: `${record.installedVersion} → ${candidate.version ?? '新版本'}`, action: { label: '查看下载与更新', onClick: props.onOpen } })
      void props.api.acknowledge(record.id).catch(() => { /* In-memory dedupe remains; the source list still retains the candidate. */ })
    }
  }, [query.data, props.api, props.onOpen])
  return null
}
