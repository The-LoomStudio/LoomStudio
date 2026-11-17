import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type Status = Awaited<ReturnType<StudioApi['agentSessions']['summaryStatus']>>

const IDLE_STATUS: Status = { state: 'idle' }
const apiScopeIds = new WeakMap<StudioApi, number>()
let nextApiScopeId = 1

function getApiScopeId(api: StudioApi): number {
  let id = apiScopeIds.get(api)
  if (id === undefined) {
    id = nextApiScopeId++
    apiScopeIds.set(api, id)
  }
  return id
}

/** Poll only the small coordinator status, never rebuild the Session history on a timer. */
export function useSessionSummaryStatus(api: StudioApi, sessionId: string) {
  const queryClient = useQueryClient()
  const apiScope = getApiScopeId(api)
  const queryKey = useMemo(() => ['agent-sessions', apiScope, 'summary-status', sessionId] as const, [apiScope, sessionId])
  const statusQuery = useQuery({
    queryKey,
    queryFn: () => api.agentSessions.summaryStatus(sessionId),
    refetchInterval: query => {
      const state = query.state.data?.state
      return state === 'preparing' || state === 'ready' ? 1500 : 5000
    },
    refetchIntervalInBackground: false,
  })

  useEffect(() => {
    return subscribeDataCommits(
      operations => {
        const hasSummaryChange = operations.some(op =>
          op.entityType === 'agent.summary-task'
          || (op.entityType === 'agent.session' && op.entityId === sessionId),
        )
        if (!hasSummaryChange) return
        void queryClient.invalidateQueries({ exact: true, queryKey })
      },
      () => {
        void queryClient.invalidateQueries({ exact: true, queryKey })
      },
    )
  }, [queryClient, queryKey, sessionId])

  return {
    status: statusQuery.data ?? IDLE_STATUS,
    error: statusQuery.error ? (statusQuery.error instanceof Error ? statusQuery.error.message : String(statusQuery.error)) : undefined,
  }
}

