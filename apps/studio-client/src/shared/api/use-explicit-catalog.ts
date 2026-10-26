import { isCancelledError, useQuery, useQueryClient } from '@tanstack/react-query'

/** Explicitly refreshed server catalogs; drafts and credentials stay with their owners. */
export function useExplicitCatalog<T>(queryKey: readonly string[], read: () => Promise<T[]>) {
  const client = useQueryClient()
  const options = { queryKey, queryFn: read }
  const query = useQuery({ ...options, enabled: false })

  async function refresh() {
    void client.cancelQueries({ queryKey, exact: true })
    try { await client.fetchQuery({ ...options, retry: false, staleTime: 0 }) }
    catch (error) { if (!isCancelledError(error)) throw error }
  }

  function publish(update: (items: T[]) => T[]) {
    void client.cancelQueries({ queryKey, exact: true })
    client.setQueryData<T[]>(queryKey, current => update(current ?? []))
  }

  return { items: query.data ?? [], loaded: query.data !== undefined, refresh, publish,
    isReading: () => client.getQueryState(queryKey)?.fetchStatus === 'fetching' }
}
