import { describe, expect, it } from 'vitest'
import { observationOrigin } from '../../../packages/application-runtime/src/observability/origin.js'
import { createObservationStore } from '../../../packages/application-runtime/src/observability/store.js'
import { createObservabilityRuntimeMethods } from '../../../packages/application-runtime/src/runtime/observability-runtime.js'
import type { ApplicationRuntimeContext } from '../../../packages/application-runtime/src/foundation/application-context.js'

function record(id: string) { return { id, kind: 'run' as const, title: id, status: 'running' as const } }

describe('temporary observation ownership', () => {
  it('expires from first capture, does not revive via patch, and disposes permanently', () => {
    let time = 0
    const store = createObservationStore({ now: () => time, ttlMs: 100 })
    store.write(record('run'))
    time = 50
    store.patch('run', { status: 'completed' })
    expect(store.get('run')?.expiresAt).toBe(new Date(100).toISOString())
    time = 100
    store.patch('run', { status: 'failed' })
    expect(store.get('run')).toBeNull()
    store.write(record('next'))
    store.dispose()
    store.write(record('closed'))
    expect(store.list().records).toEqual([])
    const fresh = createObservationStore()
    expect(fresh.list().records).toEqual([])
    fresh.dispose()
  })
  it('keeps immutable snapshots and pages summaries without prompt bodies', () => {
    const store = createObservationStore({ now: () => 0 })
    const messages = [{ role: 'user' as const, content: 'before' }]
    store.write({ ...record('a'), kind: 'api', request: { messages } })
    messages[0]!.content = 'after'
    const snapshot = store.get('a')!
    expect(snapshot.request?.messages?.[0]?.content).toBe('before')
    snapshot.request!.messages![0]!.content = 'edited copy'
    expect(store.get('a')?.request?.messages?.[0]?.content).toBe('before')
    store.write(record('b'))
    const page = store.list({ limit: 1 })
    expect(page.records.map(x => x.id)).toEqual(['b'])
    expect(store.list({ cursor: page.nextCursor }).records[0]).not.toHaveProperty('request')
    store.dispose()
  })
  it('drops oversized evidence without dropping identity or throwing; bounds families', () => {
    const store = createObservationStore({ limits: { records: 2, entryBytes: 2000, totalBytes: 5000 } })
    store.write({ ...record('run'), request: { messages: [{ role: 'user', content: 'x'.repeat(10000) }] } })
    expect(store.get('run')).toMatchObject({ availability: 'partial' })
    expect(store.get('run')?.request).toBeUndefined()
    store.write({ ...record('request'), kind: 'request', parentId: 'run' })
    store.write(record('new'))
    expect(store.get('run')).toBeNull()
    expect(store.get('request')).toBeNull()
    expect(store.list().records.map(x => x.id)).toEqual(['new'])
    expect(() => store.capture(() => { throw new Error('capture failed') })).not.toThrow()
    expect(store.list().dropped).toBeGreaterThan(0)
    store.dispose()
  })
  it('filters deleted Session/Timeline/installation evidence from every query', async () => {
    const observations = createObservationStore()
    observations.write({ ...record('run'), agentSessionId: 'session' })
    observations.write({ ...record('request'), kind: 'request', parentId: 'run' })
    observations.write({ ...record('build'), kind: 'build', timelineId: 'deleted-timeline' })
    observations.write({ ...record('extension'), kind: 'api', origin: { installationId: 'removed' } })
    const methods = createObservabilityRuntimeMethods({
      observations, agents: { getSession: async () => null },
      narratives: { getTimeline: async () => null }, documents: { get: async () => null },
    } as unknown as ApplicationRuntimeContext)
    expect((await methods.listObservations({ limit: 1 })).records).toEqual([])
    expect(await methods.getObservation({ id: 'run' })).toBeNull()
    expect(await methods.getObservationRequest({ id: 'request' })).toBeNull()
    expect(await methods.getObservationBuild({ id: 'build' })).toBeNull()
    expect(await methods.getObservationRequest({ id: 'extension' })).toBeNull()
    observations.dispose()
  })
})


describe('observation current reference summaries', () => {
  it('resolves labels without rewriting historical evidence and distinguishes missing records from deleted entities', async () => {
    const observations = createObservationStore()
    observations.write({ ...record('run'), title: 'Recorded title' })
    const methods = createObservabilityRuntimeMethods({
      observations,
      agents: { getSession: async (id: string) => id === 'session' ? { title: 'Current session' } : null },
      narratives: { getTimeline: async () => ({ title: undefined }) },
      documents: { get: async () => ({ type: 'airp.providerProfile', content: { displayName: 'Current provider', secretRef: 'never return' } }) },
      promptResources: { getResource: async () => null },
    } as unknown as ApplicationRuntimeContext)
    expect(await methods.getObservationReferences({ references: [
      { type: 'session', id: 'session' }, { type: 'session', id: 'gone' },
      { type: 'provider', id: 'provider' }, { type: 'timeline', id: 'timeline' }, { type: 'run', id: 'expired' },
    ] })).toEqual([
      { type: 'session', id: 'session', title: 'Current session', state: 'available' },
      { type: 'session', id: 'gone', title: undefined, state: 'deleted' },
      { type: 'provider', id: 'provider', title: 'Current provider', state: 'available' },
      { type: 'timeline', id: 'timeline', title: '', state: 'available' },
      { type: 'run', id: 'expired', title: undefined, state: 'unavailable' },
    ])
    expect(observations.get('run')?.title).toBe('Recorded title')
    observations.dispose()
  })
  it('projects the recorded preset identity without borrowing the current session preset', async () => {
    const observations = createObservationStore()
    observations.write({ ...record('new'), agentPresetId: 'recorded-preset', agentSessionId: 'session' })
    observations.write({ ...record('old'), agentSessionId: 'session' })
    const methods = createObservabilityRuntimeMethods({ observations,
      agents: { getSession: async () => ({ id: 'session', agentPresetId: 'changed-preset' }) },
      promptResources: { getResource: async (id: string) => ({ label: id, metadata: { description: 'not an avatar' } }) },
    } as unknown as ApplicationRuntimeContext)
    const result = await methods.getObservationReferences({ references: [{ type: 'run', id: 'new' }, { type: 'run', id: 'old' }] })
    expect(result[0]?.source?.presetName).toBe('recorded-preset')
    expect(result[1]?.source?.presetName).toBeUndefined()
    expect(observations.get('new')?.agentPresetId).toBe('recorded-preset')
    observations.dispose()
  })
  it('does not turn read failures into deleted-resource labels', async () => {
    const methods = createObservabilityRuntimeMethods({ documents: { get: async () => { throw new Error('IO failure') } } } as unknown as ApplicationRuntimeContext)
    await expect(methods.getObservationReferences({ references: [{ type: 'provider', id: 'p' }] })).rejects.toThrow('IO failure')
  })
})


it('records authenticated client provenance without replacing explicit actors or inventing missing provenance', () => {
  expect(observationOrigin({ clientId: 'session:authenticated', callId: 'call' })).toEqual({ actor: 'client:session:authenticated', callId: 'call' })
  expect(observationOrigin({ clientId: 'client', actor: { kind: 'extension', id: 'extension' } }).actor).toBe('extension:extension')
  expect(observationOrigin()).toEqual({})
})
