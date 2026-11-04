import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { applicationDocumentTypes, createApplicationRuntime, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { extensionInstallationId, type ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import type { GlobalSearchHit, SearchResourcesInput } from '@loom-studio/shared'
import { describe, expect, it, vi } from 'vitest'

const actor = { kind: 'system' as const, id: 'global-search-test' }

function fixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-10-13T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const agents = createAgentStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, narratives, agents })
  const lore = async (id: string, label: string, body: string) => (await promptResources.createResource({
    id, actor, resourceKind: 'lore', rootNode: { id: `${id}-root`, kind: 'module', label,
      children: [{ id: `${id}-entry`, kind: 'entry', label: '地理', body }] },
  })).resource
  return { engine, documents, promptResources, narratives, agents, runtime, lore, now }
}

it('keeps Card searches and healthy Lore searchable when one resource metadata is corrupt', async () => {
  const f = fixture()
  try {
    await f.runtime.createCard({ name: 'Healthy Card' })
    await f.lore('good', 'Healthy Lore', 'needle')
    await f.lore('bad', 'Broken Lore', 'needle')
    f.engine.database.prepare('UPDATE prompt_resources SET metadata_json = ? WHERE id = ?').run('{broken', 'bad')
    const cards = await f.runtime.searchResources({ query: 'Healthy', kind: 'card' })
    expect(cards.items.map(item => item.title)).toContain('Healthy Card')
    expect(cards.diagnostics).toEqual([expect.objectContaining({ resourceId: 'bad' })])
    const lore = await f.runtime.searchResources({ query: 'needle', kind: 'lore' })
    expect(lore.items.map(item => item.target.type === 'resource' && item.target.resourceId)).toEqual(['good'])
    const scopes = await f.runtime.listGlobalSearchScopes({ query: '' })
    expect(scopes.items.some(item => item.id === 'good')).toBe(true)
    expect(scopes.items.some(item => item.id === 'bad')).toBe(false)
    expect(scopes.diagnostics).toEqual(cards.diagnostics)
    await expect(f.promptResources.getResource('bad')).rejects.toThrow('JSON')
  } finally { await f.engine.close() }
})

async function collectResults(runtime: ReturnType<typeof fixture>['runtime'], input: SearchResourcesInput) {
  const items: GlobalSearchHit[] = []
  let cursor: string | undefined
  do {
    const page = await runtime.searchResources({ ...input, cursor })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

describe('global resource search', () => {
  it('browses filtered resource roots and worldbook entries without requiring keywords', async () => {
    const f = fixture()
    try {
      const card = (await f.runtime.createCard({ name: '角色' })).card
      await f.lore('z-active', 'Z adopted', '只在搜索时返回的正文')
      await f.lore('b-other', 'B resource', '另一份正文')
      await f.lore('a-other', 'A resource', '另一份正文')
      await f.runtime.updateCardPromptResources({ expectedVersion: (await f.runtime.getCard({ cardId: card.id })).card.version, cardId: card.id, promptResourceIds: ['z-active'] })
      expect((await f.runtime.searchResources({ query: '' })).items).toEqual([])
      const roots = await collectResults(f.runtime, { query: '', kind: 'lore', currentCardId: card.id, limit: 1 })
      expect(roots.map(hit => hit.title)).toEqual(['Z adopted', 'A resource', 'B resource'])
      expect(roots.every(hit => !hit.snippet && hit.target.type === 'resource' && hit.target.nodeId.endsWith('-root'))).toBe(true)
      const scoped = await f.runtime.searchResources({ query: '', scope: { kind: 'card', id: card.id } })
      expect(scoped.items.map(hit => hit.title)).toEqual(['Z adopted'])
      const entries = await f.runtime.searchResources({ query: '', scope: { kind: 'resource', id: 'z-active' } })
      expect(entries.items).toEqual([expect.objectContaining({ title: '地理', path: ['Z adopted', '地理'] })])
      expect(entries.items[0]!.snippet).toBeUndefined()
      expect((await f.runtime.searchResources({ query: '', scope: { kind: 'resource', id: 'z-active' }, kind: 'preset' })).items).toEqual([])
      expect((await f.runtime.searchResources({ query: '', kind: 'card' })).items.map(hit => hit.title)).toEqual(['角色'])
      await expect(f.runtime.searchResources({ query: '', scope: { kind: 'resource', id: 'deleted' } })).rejects.toThrow('scope')
    } finally { await f.engine.close() }
  })

  it('prioritizes the current Card and enabled Lore before pagination without hiding other scopes', async () => {
    const f = fixture()
    try {
      const other = (await f.runtime.createCard({ name: '同名角色' })).card
      const current = (await f.runtime.createCard({ name: '同名角色' })).card
      await f.lore('a-inactive', '世界书', '未采用')
      await f.lore('z-active', '世界书', '已采用')
      await f.runtime.updateCardPromptResources({ expectedVersion: (await f.runtime.getCard({ cardId: current.id })).card.version, cardId: current.id, promptResourceIds: ['z-active'] })
      const first = await f.runtime.listGlobalSearchScopes({ query: '', currentCardId: current.id, limit: 1 })
      expect(first.items.map(item => item.id)).toEqual([current.id])
      const second = await f.runtime.listGlobalSearchScopes({ query: '', currentCardId: current.id, limit: 1, cursor: first.nextCursor })
      expect(second.items.map(item => item.id)).toEqual(['z-active'])
      const all = await f.runtime.listGlobalSearchScopes({ query: '', currentCardId: current.id })
      expect(all.items.map(item => item.id)).toEqual([current.id, 'z-active', other.id, 'a-inactive'])
      await expect(f.runtime.listGlobalSearchScopes({ query: '', currentCardId: other.id, cursor: first.nextCursor })).rejects.toThrow('cursor')
      const preset = (await f.promptResources.createResource({ id: 'preset-no-card', actor, resourceKind: 'preset', metadata: { useCardLore: false }, rootNode: { id: 'preset-no-card-root', kind: 'module', label: '预设' } })).resource
      const disabled = await f.runtime.listGlobalSearchScopes({ query: '世界书', currentCardId: current.id, currentPresetId: preset.id })
      expect(disabled.items.map(item => item.id)).toEqual(['a-inactive', 'z-active'])
      await f.runtime.replaceLoreMounts({ expectedMountIds: (await f.runtime.listLoreMounts({ source: { kind: 'preset', id: preset.id } })).mounts.map(mount => mount.id), source: { kind: 'preset', id: preset.id }, loreResourceIds: ['z-active'] })
      const adopted = await f.runtime.listGlobalSearchScopes({ query: '世界书', currentCardId: current.id, currentPresetId: preset.id, limit: 1 })
      expect(adopted.items.map(item => item.id)).toEqual(['z-active'])
    } finally { await f.engine.close() }
  })

  it('expands only carried Presets, keeps direct Lore references and maps Chinese definition hits without loading trees', async () => {
    const f = fixture()
    try {
      const artifact: CardBundleArtifact = {
        schemaVersion: 4, artifactId: 'bundle-search', displayName: '霜月', card: { name: '霜月' },
        contextAssets: [{ id: 'preset-root', kind: 'module', category: 'preset', label: '旅行助手' }],
      }
      const imported = await f.runtime.importCardBundle({ artifact })
      const carriedPreset = imported.card.promptResourceIds![0]!
      const lore = await f.lore('lore-north', '北境设定', '遥远的王都坐落于两条河流的交汇处。')
      await f.lore('lore-other', '王都', '不属于该角色的定义。')
      await f.runtime.replaceLoreMounts({ expectedMountIds: (await f.runtime.listLoreMounts({ source: { kind: 'preset', id: carriedPreset } })).mounts.map(mount => mount.id), source: { kind: 'preset', id: carriedPreset }, loreResourceIds: [lore.id] })
      const external = (await f.runtime.createCard({ name: '关联卡' })).card
      await f.runtime.updateCardPromptResources({ expectedVersion: (await f.runtime.getCard({ cardId: external.id })).card.version, cardId: external.id,
        promptResourceIds: [carriedPreset], externalPromptResourceIds: [carriedPreset] })

      const forbidden = [
        vi.spyOn(f.promptResources, 'getResource').mockRejectedValue(new Error('Full tree reads are forbidden')),
        vi.spyOn(f.promptResources, 'listResources').mockRejectedValue(new Error('Full tree lists are forbidden')),
      ]
      const page = await f.runtime.searchResources({ query: '王都', scope: { kind: 'card', id: imported.card.id }, kind: 'lore', limit: 1 })
      expect(page.items).toEqual([expect.objectContaining({
        title: '地理', kind: 'lore', snippet: expect.stringContaining('王都'),
        target: { type: 'resource', resourceId: lore.id, nodeId: 'lore-north-entry', resourceKind: 'lore' },
      })])
      expect(page.items[0]!.path).toContain('北境设定')
      expect((await f.runtime.searchResources({ query: '王都', scope: { kind: 'card', id: external.id } })).items).toEqual([])
      expect((await f.runtime.searchResources({ query: '旅行助手', scope: { kind: 'card', id: external.id }, kind: 'preset' })).items).toHaveLength(1)
      expect((await collectResults(f.runtime, { query: '', scope: { kind: 'card', id: imported.card.id }, limit: 1 })).map(hit => hit.kind).sort()).toEqual(['lore', 'preset'])
      expect((await collectResults(f.runtime, { query: '', scope: { kind: 'card', id: external.id }, limit: 1 })).map(hit => hit.kind)).toEqual(['preset'])
      for (const spy of forbidden) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore() }

      await f.runtime.updateCardPromptResources({ expectedVersion: (await f.runtime.getCard({ cardId: external.id })).card.version, cardId: external.id,
        promptResourceIds: [carriedPreset, lore.id], externalPromptResourceIds: [carriedPreset, lore.id] })
      expect((await f.runtime.searchResources({ query: '王都', scope: { kind: 'card', id: external.id }, kind: 'lore' })).items)
        .toHaveLength(1)
      expect((await f.runtime.searchResources({ query: '王都', scope: { kind: 'resource', id: lore.id }, kind: 'preset' })).items).toEqual([])
    } finally { await f.engine.close() }
  })

  it('aggregates every live installation while retaining identities and Card ownership without Timeline leases', async () => {
    const f = fixture()
    try {
      const cardA = (await f.runtime.createCard({ name: '同名角色' })).card
      const cardB = (await f.runtime.createCard({ name: '同名角色' })).card
      const packageId = 'example.world'
      const installations: string[] = []
      const targets: ExtensionInstallationTarget[] = [
        { kind: 'global' }, { kind: 'card', cardId: cardA.id }, { kind: 'card', cardId: cardB.id },
      ]
      for (const [index, target] of targets.entries()) {
        const installationId = extensionInstallationId(packageId, target)
        installations.push(installationId)
        await f.documents.write({ id: installationId, type: applicationDocumentTypes.extensionInstallation,
          content: { packageId, packageVersion: '1.0.0', target, participation: 'timeline', createdAt: f.now(), updatedAt: f.now() }, actor })
        await f.promptResources.createResource({ id: `world-${index}`, resourceKind: 'lore', actor,
          metadata: { origin: { kind: 'extension-package', packageId, packageVersion: '1.0.0', installationId, contributionId: 'world' } },
          rootNode: { id: `world-root-${index}`, kind: 'module', label: '同名世界书', body: '王都地理' } })
      }
      const scoped = await collectResults(f.runtime, { query: '王都', scope: { kind: 'extension', id: packageId }, limit: 1 })
      expect(scoped).toHaveLength(3)
      expect(new Set(scoped.map(hit => hit.id)).size).toBe(3)
      expect(scoped.map(hit => hit.source!.installationId).sort()).toEqual(installations.sort())
      expect(scoped.map(hit => hit.source!.cardId).filter(Boolean).sort()).toEqual([cardA.id, cardB.id].sort())
      expect((await f.runtime.searchResources({ query: '王都' })).items).toHaveLength(3)
      expect((await f.runtime.searchResources({ query: '王都', scope: { kind: 'card', id: cardA.id } })).items)
        .toEqual([expect.objectContaining({ source: expect.objectContaining({ cardId: cardA.id }) })])
      const browsed = await collectResults(f.runtime, { query: '', scope: { kind: 'extension', id: packageId }, limit: 1 })
      expect(browsed.map(hit => hit.source!.installationId).sort()).toEqual(installations.sort())
      expect(browsed.every(hit => !hit.snippet)).toBe(true)
      const scopes = await f.runtime.listGlobalSearchScopes({ query: packageId })
      expect(scopes.items.filter(scope => scope.kind === 'extension')).toEqual([expect.objectContaining({ id: packageId })])
      await f.documents.delete({ id: extensionInstallationId(packageId, { kind: 'card', cardId: cardB.id }), actor })
      expect((await f.runtime.searchResources({ query: '王都', scope: { kind: 'extension', id: packageId } })).items).toHaveLength(2)
    } finally { await f.engine.close() }
  })

  it('merges complete pages by stable identity, only searches runtime entry titles and binds cursors to conditions', async () => {
    const f = fixture()
    try {
      const card = (await f.runtime.createCard({ name: '王都', description: '旅行角色' })).card
      await f.runtime.createCard({ name: '王都的居民' })
      await f.lore('definition-exact', '王都', '连续定义内容')
      await f.lore('definition-body', '北境', '王都在北方。')
      const timeline = await f.narratives.createTimeline({ actor, title: '王都', stateRevisionId: 'revision-test',
        createdFrom: { cardId: card.id, cardVersion: card.version },
        openingNode: { body: { format: 'loom-markdown.v1', raw: '剧情秘密正文' } } })
      const session = await f.agents.createSession({ actor, agentPresetId: 'preset-test', title: '王都会话' })
      await f.agents.appendEntries({ actor, agentSessionId: session.session.id, expectedEntryCount: 0,
        entries: [{ entry: { kind: 'message', role: 'user', content: '会话秘密正文' } }] })
      const queries = vi.spyOn(f.engine.database, 'prepare')
      const all = (await f.runtime.searchResources({ query: '王都', limit: 100 })).items
      const paged = await collectResults(f.runtime, { query: '王都', limit: 2 })
      expect(paged).toEqual(all)
      expect(new Set(paged.map(hit => hit.id)).size).toBe(paged.length)
      expect(paged).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'timeline', target: { type: 'timeline', timelineId: timeline.timeline.id } }),
        expect.objectContaining({ kind: 'session', target: { type: 'session', sessionId: session.session.id } }),
      ]))
      expect((await f.runtime.searchResources({ query: '秘密正文' })).items).toEqual([])
      expect(queries.mock.calls.some(([sql]) => /narrative_nodes|agent_transcript_entries|state_revisions/i.test(sql))).toBe(false)
      queries.mockRestore()
      const first = await f.runtime.searchResources({ query: '王都', limit: 1 })
      await expect(f.runtime.searchResources({ query: '王都', kind: 'lore', cursor: first.nextCursor })).rejects.toThrow('cursor')
      expect((await f.runtime.searchResources({ query: '王都', scope: { kind: 'card', id: card.id }, kind: 'timeline' })).items).toEqual([])
    } finally { await f.engine.close() }
  })

  it('paginates same-name scope candidates and rejects deleted scopes instead of widening the query', async () => {
    const f = fixture()
    try {
      const cards = [await f.runtime.createCard({ name: '同名' }), await f.runtime.createCard({ name: '同名' })]
      const lore = await f.lore('same-name-lore', '同名', '王都')
      const ids: string[] = []
      let cursor: string | undefined
      do {
        const page = await f.runtime.listGlobalSearchScopes({ query: '同名', limit: 1, cursor })
        ids.push(...page.items.map(item => item.id))
        cursor = page.nextCursor
      } while (cursor)
      expect(new Set(ids)).toEqual(new Set([cards[0]!.card.id, cards[1]!.card.id, lore.id]))
      const page = await f.runtime.listGlobalSearchScopes({ query: '同名', limit: 1 })
      await expect(f.runtime.listGlobalSearchScopes({ query: '其他', cursor: page.nextCursor })).rejects.toThrow('cursor')
      await f.promptResources.deleteResource({ resourceId: lore.id, actor })
      await expect(f.runtime.searchResources({ query: '王都', scope: { kind: 'resource', id: lore.id } }))
        .rejects.toMatchObject({ code: 'search.scope_unavailable' })
      await f.documents.delete({ id: cards[0]!.card.id, actor })
      await expect(f.runtime.searchResources({ query: '同名', scope: { kind: 'card', id: cards[0]!.card.id } }))
        .rejects.toMatchObject({ code: 'search.scope_unavailable' })
      await expect(f.runtime.searchResources({ query: '王都', scope: { kind: 'extension', id: 'missing.extension' } }))
        .rejects.toMatchObject({ code: 'search.scope_unavailable' })
    } finally { await f.engine.close() }
  })
})
