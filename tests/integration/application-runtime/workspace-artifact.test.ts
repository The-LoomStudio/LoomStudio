import { createApplicationRuntime, type PromptWorkspaceArtifact } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('application runtime workspace artifact integration', () => {
  it('imports a workspace artifact into SQL, edits runtime state, exports it, and re-imports as an isolated workspace', async () => {
    const artifact = await readLoomCityArtifact()
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const firstImport = await runtime.importWorkspaceArtifact({ artifact })
    const secondImport = await runtime.importWorkspaceArtifact({ artifact })

    expect(firstImport.workspace.id).not.toBe(secondImport.workspace.id)
    expect(firstImport.card.id).not.toBe(secondImport.card.id)
    expect(firstImport.workspace.sourceArtifactRef).toEqual(expect.objectContaining({
      artifactId: 'loom-city-v0',
      displayName: 'Loom City',
      format: 'loom.promptWorkspace',
      schemaVersion: 1,
    }))
    expect(firstImport.workspace.importBundle).toEqual(expect.objectContaining({
      artifactId: 'loom-city-v0',
      documentIds: expect.arrayContaining([firstImport.workspace.id, firstImport.card.id]),
    }))
    expect(firstImport.workspace.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relationship: 'recommends',
        from: expect.objectContaining({ documentId: firstImport.card.id }),
        to: expect.objectContaining({
          documentId: firstImport.workspace.id,
          nodeId: 'preset-default-airp',
        }),
      }),
      expect.objectContaining({
        relationship: 'recommends',
        from: expect.objectContaining({ documentId: firstImport.card.id }),
        to: expect.objectContaining({
          documentId: firstImport.workspace.id,
          nodeId: 'setting-city-layers',
        }),
      }),
    ]))

    const created = await runtime.createSessionFromCard({ cardId: firstImport.card.id })
    const preview = await runtime.previewPrompt({
      sessionId: created.session.id,
      branchId: created.branch.id,
      input: '我把车票递给档案管理员。',
      workspaceId: firstImport.workspace.id,
    })

    expect(preview.messages[0]?.content).toContain('使用清晰、克制、带有雨夜城市感的描写')
    expect(preview.messages[0]?.content).toContain('雨线车站只在整点暴雨中显现')
    expect(preview.messages[0]?.content).toContain('档案管理员记得每一张被撕毁的车票')
    expect(preview.projection.editorProjection.promptRows).toContainEqual(expect.objectContaining({
      slotKey: 'setting-layer:city-layers-main@setting.stable',
    }))

    await runtime.updatePromptAsset({
      workspaceId: firstImport.workspace.id,
      assetId: 'preset-style-directive',
      body: '使用冷静、精确、带一点地下铁回声的叙事风格。',
    })
    const editedPreview = await runtime.previewPrompt({
      sessionId: created.session.id,
      branchId: created.branch.id,
      input: '我把车票递给档案管理员。',
      workspaceId: firstImport.workspace.id,
    })

    expect(editedPreview.messages[0]?.content).toContain('地下铁回声')
    expect(editedPreview.messages[0]?.content).not.toContain('不要提前解释全部谜底')

    const turn = await runtime.submitTurn({
      sessionId: created.session.id,
      branchId: created.branch.id,
      input: '我把车票递给档案管理员。',
      workspaceId: firstImport.workspace.id,
    })
    const run = await runtime.getRun({ runId: turn.run.id })
    const storedPrompt = run.runtimeEntries.find(entry => entry.kind === 'prompt')?.content as {
      messages?: Array<{ content: string }>
    }

    expect(storedPrompt.messages?.[0]?.content).toContain('地下铁回声')

    const exported = await runtime.exportWorkspaceArtifact({
      workspaceId: firstImport.workspace.id,
    })
    const styleNode = findArtifactNode(exported.artifact, 'preset-style-directive')

    expect(styleNode?.body).toBe('使用冷静、精确、带一点地下铁回声的叙事风格。')
    expect(exported.artifact.metadata).toMatchObject({
      sourceArtifactRef: {
        artifactId: 'loom-city-v0',
        format: 'loom.promptWorkspace',
      },
      importBundle: {
        artifactId: 'loom-city-v0',
      },
      bindings: expect.arrayContaining([
        expect.objectContaining({
          relationship: 'recommends',
          to: expect.objectContaining({ nodeId: 'setting-city-layers' }),
        }),
      ]),
    })

    const reimported = await runtime.importWorkspaceArtifact({ artifact: exported.artifact })
    const secondWorkspace = await runtime.getPromptWorkspace({ workspaceId: secondImport.workspace.id })
    const reimportedWorkspace = await runtime.getPromptWorkspace({ workspaceId: reimported.workspace.id })

    expect(findArtifactNode(secondWorkspace.workspace, 'preset-style-directive')?.body).toContain('不要提前解释全部谜底')
    expect(findArtifactNode(reimportedWorkspace.workspace, 'preset-style-directive')?.body).toContain('地下铁回声')
  })
})

async function readLoomCityArtifact(): Promise<PromptWorkspaceArtifact> {
  const text = await readFile(join(process.cwd(), 'packages/application-runtime/fixtures/workspaces/loom-city-v0.json'), 'utf8')
  return JSON.parse(text) as PromptWorkspaceArtifact
}

function findArtifactNode(input: { contextAssets: PromptWorkspaceArtifact['contextAssets'] }, id: string): PromptWorkspaceArtifact['contextAssets'][number] | undefined {
  const queue = [...input.contextAssets]
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    if (node.id === id) return node
    queue.push(...(node.children ?? []))
  }
  return undefined
}
