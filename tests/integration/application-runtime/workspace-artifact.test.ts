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

  it('ignores prompt-facing placeholders and virtual source descriptions during workspace prompt collection', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const imported = await runtime.importWorkspaceArtifact({ artifact: placeholderArtifact() })
    const created = await runtime.createSessionFromCard({
      cardId: imported.card.id,
      workspaceId: imported.workspace.id,
    })
    const preview = await runtime.previewPrompt({
      sessionId: created.session.id,
      input: '继续。',
    })

    expect(preview.messages[0]?.content).toContain('Valid preset directive.')
    expect(preview.messages[0]?.content).not.toContain('Invalid chat history placeholder.')
    expect(preview.messages[0]?.content).not.toContain('Virtual macro description.')
  })

  it('imports a workspace artifact into SQL, edits runtime state, exports it, and re-imports as an isolated workspace', async () => {
    const artifact = await readLoomCityArtifact()
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const firstImport = await runtime.importWorkspaceArtifact({ artifact })
    const secondImport = await runtime.importWorkspaceArtifact({ artifact })
    const allWorkspaces = await runtime.listPromptWorkspaces()
    const firstCardWorkspaces = await runtime.listPromptWorkspaces({ cardId: firstImport.card.id })

    expect(firstImport.workspace.id).not.toBe(secondImport.workspace.id)
    expect(firstImport.card.id).not.toBe(secondImport.card.id)
    expect(allWorkspaces.workspaces.map(workspace => workspace.id)).toEqual(expect.arrayContaining([
      firstImport.workspace.id,
      secondImport.workspace.id,
    ]))
    expect(firstCardWorkspaces.workspaces.map(workspace => workspace.id)).toEqual([firstImport.workspace.id])
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

    const created = await runtime.createSessionFromCard({
      cardId: firstImport.card.id,
      workspaceId: firstImport.workspace.id,
    })
    const preview = await runtime.previewPrompt({
      sessionId: created.session.id,
      branchId: created.branch.id,
      input: '我把车票递给档案管理员。',
    })

    expect(created.session.workspaceId).toBe(firstImport.workspace.id)
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
    })

    expect(editedPreview.messages[0]?.content).toContain('地下铁回声')
    expect(editedPreview.messages[0]?.content).not.toContain('不要提前解释全部谜底')

    const turn = await runtime.submitTurn({
      sessionId: created.session.id,
      branchId: created.branch.id,
      input: '我把车票递给档案管理员。',
    })
    const run = await runtime.getRun({ runId: turn.run.id })
    const storedPrompt = run.runtimeEntries.find(entry => entry.kind === 'prompt')?.content as {
      messages?: Array<{ content: string }>
    }

    expect(storedPrompt.messages?.[0]?.content).toContain('地下铁回声')

    await runtime.updatePromptAsset({
      workspaceId: firstImport.workspace.id,
      assetId: 'preset-style-directive',
      capabilities: {
        activation: { kind: 'manual' },
        lifecycle: { lifecycle: 'conditional' },
        projection: {
          injectionGroupKey: 'preset.system',
          slotKey: 'preset:default-airp-preset@preset.system',
          entryOrderHint: 11,
        },
      },
    })

    const exported = await runtime.exportWorkspaceArtifact({
      workspaceId: firstImport.workspace.id,
    })
    const styleNode = findArtifactNode(exported.artifact, 'preset-style-directive')

    expect(styleNode?.body).toBe('使用冷静、精确、带一点地下铁回声的叙事风格。')
    expect(styleNode?.capabilities?.activation).toEqual({ kind: 'manual' })
    expect(styleNode?.capabilities?.projection).toMatchObject({
      injectionGroupKey: 'preset.system',
      entryOrderHint: 11,
    })
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

  it('creates, moves, and deletes prompt assets while keeping projection order references consistent', async () => {
    const artifact = await readLoomCityArtifact()
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const imported = await runtime.importWorkspaceArtifact({ artifact })
    const created = await runtime.createPromptAsset({
      workspaceId: imported.workspace.id,
      targetAssetId: 'preset-default-airp',
      position: 'inside',
      asset: {
        id: 'preset-extra-directive',
        label: '额外叙事规则',
        kind: 'entry',
        body: '新增的资源树叙事规则。',
        capabilities: {
          lifecycle: { lifecycle: 'always' },
          projection: {
            injectionGroupKey: 'preset.system',
            slotKey: 'preset:preset-default-airp@preset.system',
            entryOrderHint: 13,
          },
        },
      },
    })
    const moved = await runtime.movePromptAsset({
      workspaceId: imported.workspace.id,
      assetId: 'preset-extra-directive',
      targetAssetId: 'projection-order-profile-main',
      position: 'after',
    })
    const afterDelete = await runtime.deletePromptAsset({
      workspaceId: imported.workspace.id,
      assetId: 'preset-style-directive',
    })
    const createdSession = await runtime.createSessionFromCard({
      cardId: imported.card.id,
      workspaceId: imported.workspace.id,
    })
    const preview = await runtime.previewPrompt({
      sessionId: createdSession.session.id,
      input: '测试新增资源。',
    })
    const orderNode = findArtifactNode(afterDelete.workspace, 'projection-order-profile-main')

    expect(findArtifactNode(created.workspace, 'preset-extra-directive')?.body).toBe('新增的资源树叙事规则。')
    expect(findArtifactNode(moved.workspace, 'preset-default-airp')?.children?.map(node => node.id).slice(0, 2)).toEqual([
      'projection-order-profile-main',
      'preset-extra-directive',
    ])
    expect(preview.messages[0]?.content).toContain('新增的资源树叙事规则。')
    expect(preview.messages[0]?.content).not.toContain('使用清晰、克制、带有雨夜城市感的描写')
    expect(orderNode?.orderList).not.toContain('preset-style-directive')
    expect(orderNode?.slotRanks?.map(rank => rank.slotKey)).toContain('preset:preset-default-airp@preset.system')
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

function placeholderArtifact(): PromptWorkspaceArtifact {
  return {
    schemaVersion: 1,
    artifactId: 'placeholder-test',
    displayName: 'Placeholder Test',
    card: {
      name: 'Placeholder Card',
    },
    contextAssets: [
      {
        id: 'preset-module',
        label: 'Preset Module',
        category: 'preset',
        kind: 'module',
        children: [
          {
            id: 'valid-preset',
            label: 'Valid Preset',
            kind: 'entry',
            body: 'Valid preset directive.',
            capabilities: {
              projection: {
                injectionGroupKey: 'preset.system',
                slotKey: 'preset:test@preset.system',
              },
            },
          },
          {
            id: 'invalid-history-placeholder',
            label: 'Invalid History Placeholder',
            kind: 'entry',
            body: 'Invalid chat history placeholder.',
            capabilities: {
              projection: {
                injectionGroupKey: 'chat.history',
                slotKey: 'narrative-chat:test@chat.history',
                sourceKind: 'actual',
              },
            },
          },
        ],
      },
      {
        id: 'runtime-module',
        label: 'Runtime Module',
        category: 'runtime',
        kind: 'module',
        children: [
          {
            id: 'virtual-macro',
            label: 'Virtual Macro',
            kind: 'entry',
            body: 'Virtual macro description.',
            capabilities: {
              projection: {
                injectionGroupKey: 'runtime.macro',
                slotKey: 'runtime.macro',
                sourceKind: 'virtual',
              },
            },
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
