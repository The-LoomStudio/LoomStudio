import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server prompt rpc integration', () => {
  it('previews Prompt Builder messages and stores the same prompt during submit through /rpc', async () => {
    await withStudioServer(async port => {
      const card = await callRpc<{
        card: { id: string }
      }>(port, 'application.createCard', {
        name: 'RPC Prompt Card',
        description: '测试 RPC Prompt Builder。',
        opening: {
          entries: [
            { role: 'assistant', content: 'RPC 开场。' },
          ],
        },
        settingLayer: {
          entries: [
            {
              title: 'RPC Setting',
              content: 'RPC 设定注入。',
              activation: { kind: 'always' },
            },
          ],
        },
      })
      const created = await callRpc<{
        session: { id: string }
        branch: { id: string }
      }>(port, 'application.createSessionFromCard', {
        cardId: card.card.id,
      })
      const preview = await callRpc<{
        messages: Array<{ role: string; content: string }>
      }>(port, 'application.previewPrompt', {
        sessionId: created.session.id,
        branchId: created.branch.id,
        input: 'RPC 玩家输入。',
      })
      const turn = await callRpc<{
        run: { id: string }
      }>(port, 'application.submitTurn', {
        sessionId: created.session.id,
        branchId: created.branch.id,
        input: 'RPC 玩家输入。',
      })
      const run = await callRpc<{
        runtimeEntries: Array<{ kind: string; content: { messages?: Array<{ role: string; content: string }> } }>
      }>(port, 'application.getRun', {
        runId: turn.run.id,
      })
      const storedPrompt = run.runtimeEntries.find(entry => entry.kind === 'prompt')?.content.messages

      expect(preview.messages.map(message => message.role)).toEqual(['system', 'assistant', 'user'])
      expect(preview.messages[0]?.content).toContain('RPC Prompt Card')
      expect(preview.messages[0]?.content).toContain('RPC 设定注入。')
      expect(storedPrompt).toEqual(preview.messages)
    })
  })

  it('passes activation facts from prompt preview rpc into the backend prompt builder', async () => {
    await withStudioServer(async port => {
      const card = await callRpc<{
        card: { id: string }
      }>(port, 'application.createCard', {
        name: 'RPC Activation Card',
        settingLayer: {
          entries: [
            {
              title: 'Finalize Mode',
              content: '最终润色规则启用。',
              activation: {
                kind: 'condition',
                conditions: [{ fact: 'agent.mode', equals: 'finalize' }],
              },
            },
          ],
        },
      })
      const created = await callRpc<{
        session: { id: string }
        branch: { id: string }
      }>(port, 'application.createSessionFromCard', {
        cardId: card.card.id,
      })
      const inactivePreview = await callRpc<{
        messages: Array<{ role: string; content: string }>
      }>(port, 'application.previewPrompt', {
        sessionId: created.session.id,
        branchId: created.branch.id,
        input: '先进行短对话。',
      })
      const activePreview = await callRpc<{
        messages: Array<{ role: string; content: string }>
        projection: {
          editorProjection: {
            sourceRows: Array<{ active: boolean; activationReason: string; sourcePath: string }>
          }
        }
      }>(port, 'application.previewPrompt', {
        sessionId: created.session.id,
        branchId: created.branch.id,
        input: '准备最终输出。',
        activationFacts: {
          'agent.mode': 'finalize',
        },
      })
      const activationRow = activePreview.projection.editorProjection.sourceRows.find(row => row.sourcePath.includes('Finalize Mode'))

      expect(inactivePreview.messages[0]?.content).not.toContain('最终润色规则启用。')
      expect(activePreview.messages[0]?.content).toContain('最终润色规则启用。')
      expect(activationRow).toMatchObject({
        active: true,
        activationReason: 'activation: conditions matched',
      })
    })
  })
})
