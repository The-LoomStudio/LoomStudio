import { describe, expect, it } from 'vitest'
import type { PromptResource } from '@loom-studio/application-data'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { isPromptResourceArtifact } from '../../../packages/application-runtime/src/cards/card-bundle-codec.js'
import { fromStoredResource, toStoredNode } from '../../../packages/application-runtime/src/prompt/prompt-resource-mapper.js'
import { normalizeContextAssets } from '../../../apps/studio-client/src/features/prompt-resources/model/context-asset-normalization.js'
import { buildActivationUpdate } from '../../../apps/studio-client/src/features/prompt-resources/model/activation-editor.js'

describe('Prompt resource composition authority', () => {
  it('preserves current capabilities on read and derives client view fields', () => {
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
        },
      },
    } as PromptResource

    const mapped = fromStoredResource(resource).rootNode
    expect('projection' in mapped).toBe(false)
    expect(mapped.capabilities).toMatchObject({
      activation: { kind: 'keyword', keywords: ['forest'] },
      projection: { zoneId: 'lore.stable', entryOrderHint: 100, bindingId: 'binding' },
    })
    expect(mapped.extra).toEqual({ custom: { retained: true } })
    // Runtime DTOs cross the JSON transport before the client adds display projections.
    const transported: ContextAssetNode = JSON.parse(JSON.stringify(mapped))
    const view = normalizeContextAssets([transported])[0]!
    const editedArtifact = {
      format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore', rootNode: mapped,
    }
    if (!isPromptResourceArtifact(editedArtifact)) throw new Error('Client edit violates the artifact contract')
    const stored = toStoredNode(editedArtifact.rootNode)
    expect(stored.extra).toEqual({ custom: { retained: true } })
    expect(stored.capabilities).toEqual(mapped.capabilities)
    expect(Object.values(mapped.capabilities!.projection!)).not.toContain(undefined)
    expect(view.projection).toMatchObject({ zoneId: 'lore.stable', entryOrder: 100 })
    expect(isPromptResourceArtifact({ ...editedArtifact, rootNode: view })).toBe(false)
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
