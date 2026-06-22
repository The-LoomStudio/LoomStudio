import {
  applicationDocumentTypes,
  exportWorkspaceArtifact,
  getPromptWorkspace,
  importWorkspaceArtifact,
  updatePromptAsset,
  type PromptWorkspaceArtifact,
} from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

describe('workspace artifact import/export boundary', () => {
  it('records source artifact refs, import bundles, and card recommendations for prompt source modules', async () => {
    const documents = createInMemoryDocumentStore()
    const imported = await importWorkspaceArtifact({
      artifact: createArtifact(),
      documents,
      now: '2026-06-22T00:00:00.000Z',
      workspaceId: 'workspace-main',
    })

    expect(imported.workspace.sourceArtifactRef).toEqual({
      artifactId: 'test-workspace-v0',
      displayName: 'Test Workspace',
      format: 'loom.promptWorkspace',
      importedAt: '2026-06-22T00:00:00.000Z',
      schemaVersion: 1,
    })
    expect(imported.workspace.importBundle).toEqual(expect.objectContaining({
      artifactId: 'test-workspace-v0',
      bindingIds: imported.workspace.bindings?.map(binding => binding.id),
      documentIds: ['workspace-main', imported.card.id],
      sourceArtifactRef: imported.workspace.sourceArtifactRef,
    }))
    expect(imported.workspace.bindings).toEqual([
      expect.objectContaining({
        relationship: 'recommends',
        from: {
          documentId: imported.card.id,
          documentType: applicationDocumentTypes.cardSource,
        },
        to: {
          documentId: 'workspace-main',
          documentType: applicationDocumentTypes.promptWorkspace,
          nodeId: 'preset-main',
        },
      }),
      expect.objectContaining({
        relationship: 'recommends',
        from: {
          documentId: imported.card.id,
          documentType: applicationDocumentTypes.cardSource,
        },
        to: {
          documentId: 'workspace-main',
          documentType: applicationDocumentTypes.promptWorkspace,
          nodeId: 'setting-main',
        },
      }),
    ])
  })

  it('exports edited runtime state without mutating the retained source artifact snapshot', async () => {
    const documents = createInMemoryDocumentStore()
    const imported = await importWorkspaceArtifact({
      artifact: createArtifact(),
      documents,
      now: '2026-06-22T00:00:00.000Z',
      workspaceId: 'workspace-main',
    })

    await updatePromptAsset({
      assetId: 'preset-entry',
      body: 'Edited runtime prompt asset.',
      documents,
      now: '2026-06-22T01:00:00.000Z',
      workspaceId: imported.workspace.id,
    })

    const workspace = await getPromptWorkspace({ documents, workspaceId: imported.workspace.id })
    const exported = await exportWorkspaceArtifact({ documents, workspaceId: imported.workspace.id })

    expect(findNode(workspace.sourceArtifact, 'preset-entry')?.body).toBe('Original prompt asset.')
    expect(findNode(exported, 'preset-entry')?.body).toBe('Edited runtime prompt asset.')
    expect(exported.metadata).toMatchObject({
      kind: 'unit-test-artifact',
      sourceArtifactRef: imported.workspace.sourceArtifactRef,
      importBundle: imported.workspace.importBundle,
      bindings: imported.workspace.bindings,
      exportedFromWorkspaceId: imported.workspace.id,
    })
  })

  it('re-imports an exported artifact as a fresh runtime bundle instead of reusing stale document ids', async () => {
    const documents = createInMemoryDocumentStore()
    const first = await importWorkspaceArtifact({
      artifact: createArtifact(),
      documents,
      now: '2026-06-22T00:00:00.000Z',
      workspaceId: 'workspace-first',
    })
    const exported = await exportWorkspaceArtifact({ documents, workspaceId: first.workspace.id })
    const second = await importWorkspaceArtifact({
      artifact: exported,
      documents,
      now: '2026-06-22T02:00:00.000Z',
      workspaceId: 'workspace-second',
    })

    expect(second.card.id).not.toBe(first.card.id)
    expect(second.workspace.importBundle?.documentIds).toEqual(['workspace-second', second.card.id])
    expect(second.workspace.importBundle?.documentIds).not.toContain(first.card.id)
    expect(second.workspace.sourceArtifactRef).toEqual(expect.objectContaining({
      artifactId: 'test-workspace-v0',
      importedAt: '2026-06-22T02:00:00.000Z',
    }))
    expect(second.workspace.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: expect.objectContaining({ documentId: second.card.id }),
        to: expect.objectContaining({ documentId: 'workspace-second', nodeId: 'setting-main' }),
      }),
    ]))
  })
})

function createArtifact(): PromptWorkspaceArtifact {
  return {
    schemaVersion: 1,
    artifactId: 'test-workspace-v0',
    displayName: 'Test Workspace',
    card: {
      name: 'Test Card',
      preset: { system: 'Base system prompt.' },
    },
    contextAssets: [
      {
        id: 'preset-main',
        label: 'Preset',
        category: 'preset',
        kind: 'module',
        children: [
          {
            id: 'preset-entry',
            label: 'Preset Entry',
            category: 'preset',
            kind: 'entry',
            body: 'Original prompt asset.',
            enabled: true,
            capabilities: {
              projection: {
                injectionGroupKey: 'preset.system',
                slotKey: 'preset:preset-main@preset.system',
              },
            },
          },
        ],
      },
      {
        id: 'setting-main',
        label: 'Setting Layer',
        category: 'setting',
        kind: 'module',
        children: [
          {
            id: 'setting-entry',
            label: 'Setting Entry',
            category: 'setting',
            kind: 'entry',
            body: 'Setting content.',
          },
        ],
      },
      {
        id: 'runtime-main',
        label: 'Runtime',
        category: 'runtime',
        kind: 'module',
      },
    ],
    metadata: {
      kind: 'unit-test-artifact',
    },
  }
}

function findNode(artifact: PromptWorkspaceArtifact, nodeId: string): PromptWorkspaceArtifact['contextAssets'][number] | undefined {
  const queue = [...artifact.contextAssets]
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    if (node.id === nodeId) return node
    queue.push(...(node.children ?? []))
  }
  return undefined
}
