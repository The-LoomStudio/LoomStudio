import type { PromptWorkspaceArtifact } from '@loom-studio/application-runtime'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server workspace artifact rpc integration', () => {
  it('imports, previews, updates, and exports a workspace artifact through /rpc', async () => {
    const artifact = await readLoomCityArtifact()

    await withStudioServer(async port => {
      const imported = await callRpc<{
        workspace: {
          id: string
          sourceArtifactRef?: { artifactId: string; format: string }
          bindings?: Array<{ relationship: string; to: { nodeId?: string } }>
        }
        card: { id: string }
      }>(port, 'application.importWorkspaceArtifact', { artifact })

      expect(imported.workspace.sourceArtifactRef).toEqual(expect.objectContaining({
        artifactId: 'loom-city-v0',
        format: 'loom.promptWorkspace',
      }))
      expect(imported.workspace.bindings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          relationship: 'recommends',
          to: expect.objectContaining({ nodeId: 'setting-city-layers' }),
        }),
      ]))

      const created = await callRpc<{
        session: { id: string }
        branch: { id: string }
      }>(port, 'application.createSessionFromCard', {
        cardId: imported.card.id,
      })
      const preview = await callRpc<{
        messages: Array<{ content: string }>
      }>(port, 'application.previewPrompt', {
        sessionId: created.session.id,
        branchId: created.branch.id,
        input: '我把车票递给档案管理员。',
        workspaceId: imported.workspace.id,
      })

      expect(preview.messages[0]?.content).toContain('雨线车站只在整点暴雨中显现')

      await callRpc(port, 'application.updatePromptAsset', {
        workspaceId: imported.workspace.id,
        assetId: 'preset-style-directive',
        body: 'RPC 编辑后的叙事风格。',
      })
      const exported = await callRpc<{
        artifact: PromptWorkspaceArtifact
      }>(port, 'application.exportWorkspaceArtifact', {
        workspaceId: imported.workspace.id,
      })

      expect(findArtifactNode(exported.artifact, 'preset-style-directive')?.body).toBe('RPC 编辑后的叙事风格。')
      expect(exported.artifact.metadata).toMatchObject({
        sourceArtifactRef: {
          artifactId: 'loom-city-v0',
          format: 'loom.promptWorkspace',
        },
        bindings: expect.arrayContaining([
          expect.objectContaining({
            relationship: 'recommends',
            to: expect.objectContaining({ nodeId: 'setting-city-layers' }),
          }),
        ]),
      })
    })
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
