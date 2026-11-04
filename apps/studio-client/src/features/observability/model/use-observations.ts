import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { ObservationListInput } from '../../../entities/observation.js'

export function useObservations(api: StudioApi, endpoint: string, initialRecordId?: string, active = true) {
  const [recordId, setRecordId] = useState<string | undefined>(initialRecordId)
  const [stepId, setStepId] = useState<string>()
  const [kind, setKind] = useState<ObservationListInput['kind']>()
  const baseKey = [endpoint, 'observations']
  const queryClient = useQueryClient()
  const persistenceKey = [...baseKey, 'persistence']
  const persistence = useQuery({ queryKey: persistenceKey, queryFn: () => api.observations.persistence(), enabled: active, refetchInterval: 5000, refetchIntervalInBackground: false })
  const setPersistence = useMutation({ onMutate: () => queryClient.cancelQueries({ queryKey: persistenceKey }), mutationFn: (enabled: boolean) => api.observations.setPersistence(enabled), onSuccess: state => queryClient.setQueryData(persistenceKey, state) })
  const list = useInfiniteQuery({
    queryKey: [...baseKey, 'list', kind],
    enabled: active,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.observations.list({ kind, cursor: pageParam, limit: 30 }),
    getNextPageParam: page => page.nextCursor,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const records = list.data?.pages.flatMap(page => page.records).filter((record, index, items) => items.findIndex(item => item.id === record.id) === index) ?? []
  const detail = useQuery({ queryKey: [...baseKey, 'detail', recordId], queryFn: () => api.observations.get(recordId!), enabled: active && !!recordId, refetchInterval: 5000, refetchIntervalInBackground: false })
  const selected = detail.data?.record.id === recordId ? detail.data : undefined
  const steps = selected ? selected.record.kind === 'run' ? selected.children : [selected.record] : []
  const step = steps.find(item => item.id === stepId)
  const requestSteps = steps.filter(item => item.kind === 'request' || item.kind === 'api')
  const previous = step ? requestSteps[requestSteps.findIndex(item => item.id === step.id) - 1] : undefined
  const entry = useQuery({ queryKey: [...baseKey, 'entry', step?.kind, step?.id], queryFn: () => step!.kind === 'build' ? api.observations.getBuild(step!.id) : api.observations.getRequest(step!.id), enabled: active && !!step, refetchInterval: step?.status === 'running' ? 2000 : 5000, refetchIntervalInBackground: false })
  const buildId = entry.data?.id === step?.id ? entry.data?.buildId : undefined
  const build = useQuery({ queryKey: [...baseKey, 'build', buildId], queryFn: () => api.observations.getBuild(buildId!), enabled: active && !!buildId && step?.kind !== 'build', refetchInterval: 5000, refetchIntervalInBackground: false })
  const previousEntry = useQuery({ queryKey: [...baseKey, 'entry', previous?.kind, previous?.id], queryFn: () => api.observations.getRequest(previous!.id), enabled: active && !!previous, refetchInterval: 5000, refetchIntervalInBackground: false })
  return { persistence, setPersistence, list, records, detail, selected, steps, step, entry, build, buildId, previousEntry, previous, recordId, setRecordId, setStepId, setKind }
}
