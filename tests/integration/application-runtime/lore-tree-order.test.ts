import { describe, expect, it } from 'vitest'
import { createId, nowIso, createVariableRenderContext } from '@loom-studio/shared'
import { createSqliteDataEngine } from '../../../packages/data-engine/src/index.js'
import { createPromptResourceStore, type PromptResourceTreeNode } from '../../../packages/application-data/src/index.js'
import { createSqliteDocumentStore } from '../../../packages/document-store/src/index.js'
import { createApplicationRuntime } from '../../../packages/application-runtime/src/index.js'
import { readPromptResourceInputs } from '../../../packages/application-runtime/src/cards/card-bundle.js'
import { planPromptBlocks } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import { projectResourceAuthoring, restoreResourceAuthoring } from '../../../apps/studio-server/src/codecs/resource-authoring.js'

const actor = { kind: 'system' as const, id: 'test' }
const entry = (id: string, anchor: string, localDepth: number): PromptResourceTreeNode => ({
  id, kind: 'entry', label: id, body: id, capabilities: { targetAnchorId: anchor, localDepth },
})

describe('Lore tree is the author injection order', () => {
  it('keeps folder order inside each anchor and adopted books contiguous after a real move and file round trip', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const store = createPromptResourceStore({ engine })
    const runtime = createApplicationRuntime({ dataEngine: engine, documents: createSqliteDocumentStore({ engine }), promptResources: store })
    try {
      await store.createResource({ actor, id: 'preset', resourceKind: 'preset', rootNode: {
        id: 'preset-root', kind: 'module', category: 'preset', label: 'Preset', children: [
          { id: 'stable', kind: 'virtual', label: 'Stable', capabilities: { targetAnchorId: '@lore.stable' } },
          { id: 'dynamic', kind: 'virtual', label: 'Dynamic', capabilities: { targetAnchorId: '@lore.lower' } },
        ],
      } })
      await store.createResource({ actor, id: 'lore', resourceKind: 'lore', rootNode: {
        id: 'lore-root', kind: 'module', category: 'lore', label: 'People', children: ['alice', 'bob'].map((id, index) => ({
          id, kind: 'folder', label: id, children: [entry(`${id}-summary`, '@lore.stable', index * 10),
            { ...entry(`${id}-dynamic`, '@lore.lower', index * 10), capabilities: {
              targetAnchorId: '@lore.lower', activation: { kind: 'keyword', keywords: [id] },
            } }],
        })),
      } })
      await store.createResource({ actor, id: 'other', resourceKind: 'lore', rootNode: {
        id: 'other-root', kind: 'module', category: 'lore', label: 'Other', children: [entry('other-summary', '@lore.stable', -100)],
      } })
      const build = async (currentInput: string) => {
        const data = await readPromptResourceInputs({ promptResources: store, resourceIds: ['preset', 'lore', 'other'], variables: createVariableRenderContext({}) })
        return planPromptBlocks({ ...data, currentInput, skeletonRootId: 'preset-root' }).flat().map(fragment => fragment.content)
      }
      expect(await build('alice bob')).toEqual(['alice-summary', 'bob-summary', 'other-summary', 'alice-dynamic', 'bob-dynamic'])
      await runtime.movePromptResourceAsset({ resourceId: 'lore', assetId: 'bob', targetAssetId: 'alice', position: 'before' })
      expect(await build('alice bob')).toEqual(['bob-summary', 'alice-summary', 'other-summary', 'bob-dynamic', 'alice-dynamic'])
      expect(await build('alice')).toEqual(['bob-summary', 'alice-summary', 'other-summary', 'alice-dynamic'])
      const snapshot = await runtime.captureResourceAuthoring({ resourceId: 'lore' })
      const restored = restoreResourceAuthoring(projectResourceAuthoring(snapshot.resource))
      expect(restored.rootNode.children?.map(node => node.id)).toEqual(['bob', 'alice'])
      expect(JSON.stringify(restored)).not.toContain('localDepth')
      await runtime.applyResourceAuthoring({ resources: [{ resource: restored, expectedVersion: snapshot.version, expectedDigest: snapshot.digest }] })
      expect(await build('alice bob')).toEqual(['bob-summary', 'alice-summary', 'other-summary', 'bob-dynamic', 'alice-dynamic'])
    } finally { await engine.close() }
  })

  it('keeps current author depth out of writes and preserves runtime depth', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const store = createPromptResourceStore({ engine })
    try {
      await store.createResource({ actor, id: 'lore', resourceKind: 'lore', rootNode: {
        id: 'root', kind: 'module', label: 'Lore', children: [entry('text', '@lore.stable', 10)],
      } })
      await store.createResource({ actor, id: 'runtime', resourceKind: 'runtime', rootNode: {
        id: 'runtime-root', kind: 'module', label: 'Runtime', capabilities: { localDepth: 7 },
      } })
      const edited = await store.mutateResource({ actor, resourceId: 'lore', expectedVersion: 1,
        mutations: [{ kind: 'node.update', nodeId: 'text', patch: { body: 'changed' } }],
      })
      const historyBefore = engine.database.prepare('SELECT before_json FROM prompt_resource_node_revisions WHERE changeset_id = ? AND node_id = ?')
        .get(edited.commit.changesetId, 'text')
      expect(JSON.stringify(historyBefore)).not.toContain('localDepth')
      await store.revertChangeset({ actor, changesetId: edited.commit.changesetId, expectedVersion: 2 })
      expect((await store.getResource('lore'))?.rootNode.children?.[0]?.capabilities).toEqual({ targetAnchorId: '@lore.stable' })
      expect((await store.getResource('lore'))?.rootNode.children?.[0]?.capabilities).toEqual({ targetAnchorId: '@lore.stable' })
      expect((await store.getResource('runtime'))?.rootNode.capabilities).toEqual({ localDepth: 7 })
      expect(engine.database.prepare('SELECT before_json FROM prompt_resource_node_revisions WHERE changeset_id = ? AND node_id = ?')
        .get(edited.commit.changesetId, 'text')).toEqual(historyBefore)
    } finally { await engine.close() }
  })
})
