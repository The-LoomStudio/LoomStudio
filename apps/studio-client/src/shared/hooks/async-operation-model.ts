export const ASYNC_OPERATION_SCOPES = [
  'bootstrap',
  'cards',
  'resources',
  'provider-settings',
  'session',
  'mutation',
] as const

export type AsyncOperationScope = (typeof ASYNC_OPERATION_SCOPES)[number]

export type AsyncOperationError = {
  message: string
  scope: AsyncOperationScope
  sequence: number
}

type AsyncOperationStatus = {
  error?: AsyncOperationError
  pendingCount: number
}

export type AsyncOperationState = Record<AsyncOperationScope, AsyncOperationStatus>

type AsyncOperationEvent =
  | { scope: AsyncOperationScope; type: 'start' }
  | { error?: string; recordError: boolean; scope: AsyncOperationScope; sequence: number; type: 'finish' }

export function createAsyncOperationState(): AsyncOperationState {
  return Object.fromEntries(ASYNC_OPERATION_SCOPES.map(scope => [scope, { pendingCount: 0 }])) as AsyncOperationState
}

export function reduceAsyncOperationState(state: AsyncOperationState, event: AsyncOperationEvent): AsyncOperationState {
  const current = state[event.scope]
  if (event.type === 'start') {
    return { ...state, [event.scope]: { ...current, pendingCount: current.pendingCount + 1 } }
  }

  const shouldUpdateError = event.recordError
    && (!current.error || event.sequence >= current.error.sequence)
  const error = shouldUpdateError
    ? event.error ? { message: event.error, scope: event.scope, sequence: event.sequence } : undefined
    : current.error

  return {
    ...state,
    [event.scope]: {
      pendingCount: Math.max(0, current.pendingCount - 1),
      ...(error ? { error } : {}),
    },
  }
}

export function readLatestOperationError(state: AsyncOperationState): AsyncOperationError | undefined {
  return Object.values(state)
    .flatMap(status => status.error ? [status.error] : [])
    .sort((left, right) => right.sequence - left.sequence)[0]
}
