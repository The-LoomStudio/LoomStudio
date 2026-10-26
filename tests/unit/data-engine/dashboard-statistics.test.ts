import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createStatisticsStore, recordUserInteraction, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createAssetStore, createBlobStore } from '@loom-studio/asset-store'
import { describe, expect, it } from 'vitest'

const now = () => '2026-10-25T04:00:00.000Z'
const range = { to: '2026-10-26T00:00:00.000Z', timeZone: 'Asia/Taipei' }
const identity = (id: string) => ({ id, providerProfileId: 'profile', providerId: 'provider', providerName: 'Provider', purpose: 'chat', simulated: false })
let sequence = 0
const open = (filename = ':memory:') => createSqliteDataEngine({ filename, now, createId: prefix => `${prefix}-${++sequence}` })

describe('durable dashboard facts', () => {
  it('retains reported usage across restart and deletion, without counting historical observations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-statistics-'))
    const filename = join(directory, 'stats.sqlite')
    let engine = open(filename)
    try {
      engine.database.exec("CREATE TABLE observations (usage_json TEXT); INSERT INTO observations VALUES ('{\"totalTokens\":99999}')")
      let store = createStatisticsStore(engine, now)
      expect((await store.usage(range)).totals.requests).toBe(0)
      await store.track(identity('one'), async report => {
        report({ inputTokens: 20, outputTokens: 10, totalTokens: 30, cacheReadTokens: 5, reasoningTokens: 4 })
        report({ inputTokens: 20, outputTokens: 10, totalTokens: 30 })
      })
      engine.database.exec('DROP TABLE observations')
      await engine.close()
      engine = open(filename)
      store = createStatisticsStore(engine, now)
      expect((await store.usage(range)).totals).toMatchObject({ requests: 1, total: 30, input: 20, output: 10, cacheRead: 5, reasoning: 4, unreported: 0 })
    } finally { await engine.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('keeps partial and failed-call usage, excludes simulation and never estimates missing totals', async () => {
    const engine = open()
    try {
      const store = createStatisticsStore(engine, now)
      await expect(store.track(identity('failed'), async report => { report({ totalTokens: 8 }); throw new Error('invalid body') })).rejects.toThrow('invalid body')
      await store.track(identity('partial'), async report => { report({ inputTokens: 3 }) })
      await store.track(identity('missing'), async () => {})
      await store.track({ ...identity('fake'), simulated: true }, async report => { report({ totalTokens: 100 }) })
      expect((await store.usage(range)).totals).toMatchObject({ requests: 3, reported: 2, unreported: 1, total: 8, input: 3, totalReported: 1 })
      expect((await store.usage({ ...range, includeSimulated: true })).totals.total).toBe(108)
      const first = await store.usageRequests({ ...range, providerProfileId: 'profile', limit: 2 })
      const second = await store.usageRequests({ ...range, providerProfileId: 'profile', limit: 2, cursor: first.nextCursor })
      expect([...first.items, ...second.items].map(row => row.id)).toEqual(['partial', 'missing', 'failed'])
      expect(second.nextCursor).toBeUndefined()
    } finally { await engine.close() }
  })

  it('recovers interrupted calls as unknown and keeps accepted sends transactional and idempotent', async () => {
    const engine = open()
    try {
      let store = createStatisticsStore(engine, now)
      await store.track(identity('interrupted'), async () => {})
      engine.database.exec("UPDATE usage_requests SET status = 'running'")
      store = createStatisticsStore(engine, now)
      expect((await store.usage(range)).totals.unknown).toBe(1)
      const write = (fail = false) => engine.transact({ actor: { kind: 'client', id: 'client' } }, async tx => {
        recordUserInteraction(tx, { id: fail ? 'rollback' : 'accepted', kind: 'agent' })
        if (fail) throw new Error('rollback')
      })
      await write(); await expect(write()).rejects.toMatchObject({ code: 'data.transaction_empty' })
      await expect(write(true)).rejects.toThrow('rollback')
      expect(engine.database.prepare('SELECT id FROM play_interactions').all().map(row => row.id)).toEqual(['accepted'])
    } finally { await engine.close() }
  })
})

it('reads inventory from real schemas and counts accepted narrative input exactly once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-inventory-'))
  const engine = open()
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  try {
    createSqliteDocumentStore({ engine })
    createPromptResourceStore({ engine })
    const narrative = createNarrativeStore({ engine, now, createId })
    const blobs = createBlobStore({ engine, now, createId, rootDirectory: directory })
    createAssetStore({ engine, now, createId, blobs })
    const stats = createStatisticsStore(engine, now)
    const actor = { kind: 'client' as const, id: 'test' }
    const story = await narrative.createTimeline({ actor, stateRevisionId: 'initial' })
    const input = { actor, timelineId: story.timeline.id, branchId: story.branch.id,
      nodeId: 'accepted', expectedHeadNodeId: null, body: { format: 'loom-markdown.v1' as const, raw: 'Hello' } }
    await narrative.appendInput(input)
    await narrative.appendInput(input)
    expect((await stats.play(range)).rows).toMatchObject([{ sends: 1, days: 1, stories: [{ id: story.timeline.id, sends: 1 }] }])
    expect((await stats.resources()).items.find(item => item.id === 'timelines')?.count).toBe(1)
    // Ordinary writes/imports are deliberately not a user-send collection point.
    await narrative.appendNode({ actor, timelineId: story.timeline.id, branchId: story.branch.id,
      expectedHeadNodeId: 'accepted', stateRevisionId: 'initial', body: { format: 'loom-markdown.v1', raw: 'Imported' } })
    expect((await stats.play(range)).rows[0]?.sends).toBe(1)
  } finally { await engine.close(); await rm(directory, { recursive: true, force: true }) }
})
