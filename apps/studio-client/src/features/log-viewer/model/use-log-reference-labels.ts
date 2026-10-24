import { useQuery } from '@tanstack/react-query'
import { parseEntityReference } from '@loom-studio/shared'
import type { StudioApi } from '../../../shared/api/studio-api.js'

export type LogReferenceLabel = { title?: string; state: 'available' | 'deleted' | 'unavailable' }

/** One batched current-name projection shared by application and model logs. */
export function useLogReferenceLabels(api: StudioApi | undefined, endpoint: string, uris: string[]) {
  const references = [...new Set(uris)].sort().flatMap(uri => {
    const ref = parseEntityReference(uri)
    return ref && ref.type !== 'extension' ? [{ type: ref.type, id: ref.id }] : []
  }).filter((ref, index, all) => all.findIndex(other => other.type === ref.type && other.id === ref.id) === index)
  const query = useQuery({
    queryKey: [endpoint, 'log-reference-labels', references],
    enabled: !!api && references.length > 0,
    queryFn: async () => {
      const pages = []
      for (let index = 0; index < references.length; index += 100) pages.push(await api!.observations.references({ references: references.slice(index, index + 100) }))
      return pages.flat()
    },
    staleTime: 5000,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const labels = new Map<string, LogReferenceLabel>()
  for (const item of query.data ?? []) labels.set(`${item.type}:${item.id}`, item)
  return { labels, isError: query.isError }
}
