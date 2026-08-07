import { useCallback, useReducer, useRef } from 'react'
import {
  createAsyncOperationState,
  readLatestOperationError,
  reduceAsyncOperationState,
  type AsyncOperationScope,
} from './async-operation-model.js'

export type LatestOperationContext = {
  isCurrent(): boolean
}

export function useAsyncOperations() {
  const [pending, dispatch] = useReducer(reduceAsyncOperationState, undefined, createAsyncOperationState)
  const sequenceRef = useRef(0)
  const latestByScopeRef = useRef(new Map<AsyncOperationScope, number>())

  const run = useCallback(async <T,>(scope: AsyncOperationScope, action: () => Promise<T>): Promise<T | undefined> => {
    const sequence = ++sequenceRef.current
    dispatch({ scope, type: 'start' })
    try {
      const result = await action()
      dispatch({ scope, sequence, type: 'finish', recordError: true })
      return result
    } catch (caught) {
      dispatch({ scope, sequence, type: 'finish', recordError: true, error: readErrorMessage(caught) })
      return undefined
    }
  }, [])

  const runLatest = useCallback(async <T,>(scope: AsyncOperationScope, action: (context: LatestOperationContext) => Promise<T>): Promise<T | undefined> => {
    const sequence = ++sequenceRef.current
    latestByScopeRef.current.set(scope, sequence)
    const context = { isCurrent: () => latestByScopeRef.current.get(scope) === sequence }
    dispatch({ scope, type: 'start' })
    try {
      const result = await action(context)
      dispatch({ scope, sequence, type: 'finish', recordError: context.isCurrent() })
      return context.isCurrent() ? result : undefined
    } catch (caught) {
      dispatch({ scope, sequence, type: 'finish', recordError: context.isCurrent(), error: readErrorMessage(caught) })
      return undefined
    }
  }, [])

  return {
    error: readLatestOperationError(pending),
    isPending: (...scopes: AsyncOperationScope[]) => scopes.some(scope => pending[scope].pendingCount > 0),
    pending,
    run,
    runLatest,
  }
}

function readErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}
