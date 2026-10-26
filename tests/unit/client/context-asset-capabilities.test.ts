import { describe, expect, it } from 'vitest'
import type { PromptResource } from '@loom-studio/application-data'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { isPromptResourceArtifact } from '../../../packages/application-runtime/src/cards/workspace-codec.js'
import { fromStoredResource, toStoredNode } from '../../../packages/application-runtime/src/prompt/prompt-resource-mapper.js'
import { normalizeContextAssets } from '../../../apps/studio-client/src/features/prompt-resources/model/context-asset-normalization.js'
import { buildActivationUpdate } from '../../../apps/studio-client/src/features/prompt-resources/model/activation-editor.js'

describe('Prompt resource composition authority', () => {
  it('preserves the effective legacy projection on read and writes only capabilities', () => {
    const resource = {
      id: 'resource', version: 1, resourceKind: 'lore', rootNodeId: 'entry',
      label: 'Entry', metadata: {}, createdAt: '', updatedAt: '',
      rootNode: {
        id: 'entry', label: 'Entry', kind: 'entry',
        capabilities: {
          activation: { kind: 'keyword', keywords: ['forest'] },
          projection: { zoneId: 'lore.stable', entryOrderHint: 100, bindingId: 'binding' },
        },
        extra: {
          custom: { retained: true },
          projection: { zoneId: 'lore.lower', entryOrder: 900, lifecycle: 'conditional', slotKey: 'slot' },
        },
      },
    } as PromptResource

    const mapped = fromStoredResource(resource).rootNode
    expect(mapped.projection).toBeUndefined()
    expect(mapped.capabilities).toMatchObject({
      activation: { kind: 'keyword', keywords: ['forest'] },
      lifecycle: { lifecycle: 'conditional' },
      projection: { zoneId: 'lore.lower', entryOrderHint: 900, bindingId: 'binding', slotKey: 'slot' },
    })
    expect(mapped.extra).toEqual({ custom: { retained: true } })
    // Runtime DTOs cross the JSON transport before the client adds display projections.
    const transported: ContextAssetNode = JSON.parse(JSON.stringify(mapped))
    const view = normalizeContextAssets([transported])[0]!
    const editedArtifact = {
      format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore', rootNode: view,
    }
    if (!isPromptResourceArtifact(editedArtifact)) throw new Error('Client edit violates the artifact contract')
    const stored = toStoredNode(editedArtifact.rootNode)
    expect(stored.extra).toEqual({ custom: { retained: true } })
    expect(stored.capabilities).toEqual(mapped.capabilities)
    expect(Object.values(mapped.capabilities!.projection!)).not.toContain(undefined)
    expect(resource.rootNode.extra?.projection).toBeDefined()
  })

  it('derives display fields from edited capabilities instead of restoring the old view', () => {
    const node = normalizeContextAssets([{
      id: 'entry', label: 'Entry', kind: 'entry',
      capabilities: {
        projection: { zoneId: 'lore.stable', entryOrderHint: 100 },
        lifecycle: { lifecycle: 'always' },
      },
    }])[0]!
    const update = buildActivationUpdate({
      node,
      draft: { mode: 'keyword', keywords: 'forest', conditionPreset: 'tags', conditionValue: 'scene:combat' },
    })
    expect(update.projection).toBeUndefined()
    const edited = normalizeContextAssets([{
      ...node, ...update,
      capabilities: {
        ...update.capabilities,
        projection: { ...node.capabilities!.projection!, entryOrderHint: 900 },
      },
    }])[0]!
    expect(edited.projection).toMatchObject({ entryOrder: 900, lifecycle: 'keyword' })
    expect(edited.capabilities?.activation).toEqual({ kind: 'keyword', keywords: ['forest'] })
  })
})
