import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { GlobalSearchKind, SearchScopeOption } from '@loom-studio/shared'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import {
  findGlobalSearchNavigation, findGlobalSearchTypes, INITIAL_GLOBAL_SEARCH_STATE, type GlobalSearchAction,
} from './global-search-model.js'
import { globalSearchResultsOptions, globalSearchScopesOptions } from './global-search-queries.js'
import { useGlobalSearchStore } from './global-search-store.js'

function useDebouncedQuery(value: string): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 150)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

export type GlobalSearchInput = { api: StudioApi; endpoint: string; open: boolean; t: Translator; currentCardId?: string; currentPresetId?: string }

export function useGlobalSearch(input: GlobalSearchInput) {
  const state = useGlobalSearchStore(store => store.byEndpoint[input.endpoint] ?? INITIAL_GLOBAL_SEARCH_STATE)
  const dispatch = useCallback((action: GlobalSearchAction) => {
    useGlobalSearchStore.getState().dispatch(input.endpoint, action)
  }, [input.endpoint])
  const query = state.query.trim()
  const candidateQuery = state.candidateQuery.trim()
  const hasResourceSearch = Boolean(query || state.scope || state.kind)
  const debouncedQuery = useDebouncedQuery(query)
  const debouncedCandidateQuery = useDebouncedQuery(candidateQuery)
  const resultsQuery = useInfiniteQuery({
    ...globalSearchResultsOptions({
      api: input.api, endpoint: input.endpoint, query,
      scope: state.scope ? { kind: state.scope.kind, id: state.scope.id } : undefined,
      kind: state.kind, currentCardId: input.currentCardId, currentPresetId: input.currentPresetId,
    }),
    enabled: input.open && state.mode === 'results' && hasResourceSearch && query === debouncedQuery,
  })
  const scopesQuery = useInfiniteQuery({
    ...globalSearchScopesOptions({ api: input.api, endpoint: input.endpoint, query: candidateQuery, currentCardId: input.currentCardId, currentPresetId: input.currentPresetId }),
    enabled: input.open && state.mode === 'scopes' && candidateQuery === debouncedCandidateQuery,
  })
  const navigation = useMemo(() => state.mode === 'results'
    ? findGlobalSearchNavigation({ query, scope: state.scope, kind: state.kind, t: input.t }) : [],
  [state.mode, query, state.scope, state.kind, input.t])
  const results = useMemo(() => hasResourceSearch ? resultsQuery.data?.pages.flatMap(page => page.items) ?? [] : [], [hasResourceSearch, resultsQuery.data])
  const scopes = useMemo(() => scopesQuery.data?.pages.flatMap(page => page.items) ?? [], [scopesQuery.data])
  const types = useMemo(() => findGlobalSearchTypes(candidateQuery, input.t), [candidateQuery, input.t])
  const activeQuery = state.mode === 'results' && hasResourceSearch ? resultsQuery : state.mode === 'scopes' ? scopesQuery : undefined
  const debouncing = state.mode === 'results' ? query !== debouncedQuery
    : state.mode === 'scopes' && candidateQuery !== debouncedCandidateQuery

  const setInputValue = useCallback((value: string) => dispatch({ type: 'input', value }), [dispatch])
  const showScopes = useCallback(() => dispatch({ type: 'mode', mode: 'scopes' }), [dispatch])
  const showTypes = useCallback(() => dispatch({ type: 'mode', mode: 'types' }), [dispatch])
  const showResults = useCallback(() => dispatch({ type: 'mode', mode: 'results' }), [dispatch])
  const selectScope = useCallback((scope: SearchScopeOption) => dispatch({ type: 'scope', scope }), [dispatch])
  const selectKind = useCallback((kind: GlobalSearchKind) => dispatch({ type: 'kind', kind }), [dispatch])
  const removeScope = useCallback(() => dispatch({ type: 'scope' }), [dispatch])
  const removeKind = useCallback(() => dispatch({ type: 'kind' }), [dispatch])
  const clearFilters = useCallback(() => dispatch({ type: 'clear-filters' }), [dispatch])

  return {
    mode: state.mode,
    query: state.query,
    inputValue: state.mode === 'results' ? state.query : state.candidateQuery,
    scope: state.scope,
    kind: state.kind,
    navigation,
    results,
    scopes,
    types,
    loading: input.open && Boolean(activeQuery && (debouncing || activeQuery.isPending)),
    loadingMore: activeQuery?.isFetchingNextPage ?? false,
    error: activeQuery?.error ?? null,
    diagnostics: activeQuery?.data?.pages[0]?.diagnostics ?? [],
    hasMore: activeQuery?.hasNextPage ?? false,
    setInputValue, showScopes, showTypes, showResults, selectScope, selectKind, removeScope, removeKind, clearFilters,
    loadMore: () => {
      if (activeQuery?.hasNextPage && !activeQuery.isFetching && !debouncing) void activeQuery.fetchNextPage()
    },
    retry: () => {
      if (!activeQuery || debouncing) return
      if (activeQuery.isFetchNextPageError) void activeQuery.fetchNextPage()
      else void activeQuery.refetch()
    },
  }
}
