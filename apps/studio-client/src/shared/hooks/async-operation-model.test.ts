import { describe, expect, it } from 'vitest'
import { createAsyncOperationState, readLatestOperationError, reduceAsyncOperationState } from './async-operation-model.js'

describe('async operation state', () => {
  it('tracks concurrent pending counts independently by scope', () => {
    let state = createAsyncOperationState()
    state = reduceAsyncOperationState(state, { scope: 'session', type: 'start' })
    state = reduceAsyncOperationState(state, { scope: 'session', type: 'start' })
    state = reduceAsyncOperationState(state, { scope: 'cards', type: 'start' })
    state = reduceAsyncOperationState(state, { scope: 'session', sequence: 1, type: 'finish', recordError: true })

    expect(state.session.pendingCount).toBe(1)
    expect(state.cards.pendingCount).toBe(1)
    expect(state.resources.pendingCount).toBe(0)
  })

  it('keeps stale completions from replacing the latest scoped error', () => {
    let state = createAsyncOperationState()
    state = reduceAsyncOperationState(state, { scope: 'session', type: 'start' })
    state = reduceAsyncOperationState(state, { scope: 'session', sequence: 2, type: 'finish', recordError: true, error: 'latest' })
    state = reduceAsyncOperationState(state, { scope: 'session', sequence: 1, type: 'finish', recordError: false, error: 'stale' })

    expect(state.session.error?.message).toBe('latest')
    expect(readLatestOperationError(state)).toEqual({ message: 'latest', scope: 'session', sequence: 2 })
  })

  it('does not let an older success clear a newer error', () => {
    let state = createAsyncOperationState()
    state = reduceAsyncOperationState(state, { scope: 'resources', type: 'start' })
    state = reduceAsyncOperationState(state, { scope: 'resources', type: 'start' })
    state = reduceAsyncOperationState(state, { scope: 'resources', sequence: 2, type: 'finish', recordError: true, error: 'latest' })
    state = reduceAsyncOperationState(state, { scope: 'resources', sequence: 1, type: 'finish', recordError: true })

    expect(state.resources.pendingCount).toBe(0)
    expect(state.resources.error?.message).toBe('latest')
  })
})
