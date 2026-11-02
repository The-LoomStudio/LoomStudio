import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { StateTarget } from '../../../entities/index.js'
import { notify } from '../../../shared/notifications/index.js'

export function usePlayerProfileQuery(
  api: StudioApi['states'], endpoint: string,
  target: Extract<StateTarget, { scope: 'timeline' }> | undefined,
  revisionId?: string,
) {
  const query = useQuery({
    queryKey: ['player-profile', endpoint, target?.timelineId, target?.branchId, revisionId],
    enabled: Boolean(target),
    queryFn: () => api.get(target!),
    retry: false, staleTime: 0, gcTime: 0,
    refetchOnWindowFocus: 'always',
  })
  useEffect(() => {
    if (query.error) notify.failure('读取用户资料失败', query.error)
  }, [query.error])
  return query
}
