import { createApplicationRuntime, type PromptWorkspaceArtifact } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('application runtime workspace artifact integration', () => {
  it('applies module and folder activation cascades to preset and setting contributions', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const imported = await runtime.importWorkspaceArtifact({ artifact: cascadingActivationArtifact() })
    const created = await runtime.createSessionFromCard({ cardId: imported.card.id })
    const inactive = await runtime.previewPrompt({
      sessionId: created.session.id,
      branchId: created.branch.id,
      input: '先短推演。',
      workspaceId: imported.workspace.id,
    })
    const presetOnly = await runtime.previewPrompt({
      sessionId: created.session.id,
      branchId: created.branch.id,
      input: '进入润色。',
      workspaceId: imported.workspace.id,
      activationFacts: { 'agent.mode': 'finalize' },
    })
    const allActive = await runtime.previewPrompt({
      sessionId: created.session.id,
      branchId: created.branch.id,
      input: '进入战斗润色。',
      workspaceId: imported.workspace.id,
      activationFacts: { 'agent.mode': 'finalize', tags: ['scene:combat'] },
    })

    expect(inactive.messages[0]?.content).not.toContain('Preset finalize directive.')
    expect(inactive.messages[0]?.content).not.toContain('Combat setting directive.')
    expect(presetOnly.messages[0]?.content).toContain('Preset finalize directive.')
    expect(presetOnly.messages[0]?.content).not.toContain('Combat setting directive.')
    expect(allActive.messages[0]?.content).toContain('Preset finalize directive.')
    expect(allActive.messages[0]?.content).toContain('Combat setting directive.')
    expect(allActive.messages[0]?.content).not.toContain('Manual preset directive.')
    expect(allActive.projection.editorProjection.sourceRows.find(row => row.sourcePath.includes('Combat Setting'))).toMatchObject({
      active: true,
      activationReason: 'activation: all matched',
    })
    expect(allActive.projection.editorProjection.sourceRows.find(row => row.sourcePath.includes('Manual Preset Entry'))).toMatchObject({
      active: false,
      activationReason: 'activation: all blocked (activation: manual)',
    })
  })

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

function cascadingActivationArtifact(): PromptWorkspaceArtifact {
  return {
    schemaVersion: 1,
    artifactId: 'activation-cascade-test',
    displayName: 'Activation Cascade Test',
    card: {
      name: 'Activation Card',
    },
    contextAssets: [
      {
        id: 'preset-module',
        label: 'Preset Module',
        category: 'preset',
        kind: 'module',
        capabilities: {
          activation: { kind: 'condition', conditions: [{ fact: 'agent.mode', equals: 'finalize' }] },
        },
        children: [
          {
            id: 'preset-entry',
            label: 'Preset Entry',
            kind: 'entry',
            body: 'Preset finalize directive.',
            capabilities: {
              projection: {
                injectionGroupKey: 'preset.system',
                slotKey: 'preset:test@preset.system',
                entryOrderHint: 10,
              },
            },
          },
          {
            id: 'manual-preset-entry',
            label: 'Manual Preset Entry',
            kind: 'entry',
            body: 'Manual preset directive.',
            capabilities: {
              activation: { kind: 'manual' },
              projection: {
                injectionGroupKey: 'preset.system',
                slotKey: 'preset:test@preset.system',
                entryOrderHint: 20,
              },
            },
          },
        ],
      },
      {
        id: 'setting-module',
        label: 'Setting Module',
        category: 'setting',
        kind: 'module',
        children: [
          {
            id: 'setting-folder',
            label: 'Combat Folder',
            kind: 'folder',
            capabilities: {
              activation: { kind: 'condition', conditions: [{ fact: 'tags', includes: 'scene:combat' }] },
            },
            children: [
              {
                id: 'setting-entry',
                label: 'Combat Setting',
                kind: 'entry',
                body: 'Combat setting directive.',
                capabilities: {
                  activation: { kind: 'condition', conditions: [{ fact: 'agent.mode', equals: 'finalize' }] },
                  projection: {
                    injectionGroupKey: 'setting.stable',
                    slotKey: 'setting-layer:test@setting.stable',
                    entryOrderHint: 10,
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

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
