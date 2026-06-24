import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server card and session rpc integration', () => {
  it('creates a card and opens a session from its frozen snapshot through /rpc', async () => {
    await withStudioServer(async port => {
      const created = await callRpc<{
        card: { id: string; version: number; name: string }
      }>(port, 'application.createCard', {
        name: 'RPC 假卡',
        description: '从 RPC 写入的卡。',
        opening: {
          entries: [
            { role: 'assistant', content: '第一束光落进房间。' },
          ],
        },
        settingLayer: {
          entries: [
            {
              title: 'Loom City',
              content: 'Loom City 是测试场景。',
              activation: { kind: 'always' },
            },
          ],
        },
      })
      const listed = await callRpc<{
        cards: Array<{ id: string; name: string }>
      }>(port, 'application.listCards', {})
      const session = await callRpc<{
        session: {
          cardSourceVersionId: string
          cardSnapshot: {
            name: string
            opening: { entries: Array<{ role: string; content: string }> }
            settingLayer: { entries: Array<{ title: string; content: string }> }
          }
        }
      }>(port, 'application.createSessionFromCard', {
        cardId: created.card.id,
      })

      expect(created.card).toMatchObject({ name: 'RPC 假卡', version: 1 })
      expect(listed.cards).toContainEqual(expect.objectContaining({ id: created.card.id, name: 'RPC 假卡' }))
      expect(session.session.cardSourceVersionId).toBe(`${created.card.id}@${created.card.version}`)
      expect(session.session.cardSnapshot).toMatchObject({
        name: 'RPC 假卡',
        opening: { entries: [{ role: 'assistant', content: '第一束光落进房间。' }] },
        settingLayer: { entries: [expect.objectContaining({ title: 'Loom City', content: 'Loom City 是测试场景。' })] },
      })

      const updated = await callRpc<{
        card: { id: string; name: string; userName?: string; description?: string }
      }>(port, 'application.updateCard', {
        cardId: created.card.id,
        name: 'RPC 改名卡',
        userName: '',
        description: 'RPC 改名后的卡。',
      })
      await callRpc(port, 'application.deleteCard', {
        cardId: created.card.id,
      })
      const afterDelete = await callRpc<{
        cards: Array<{ id: string }>
      }>(port, 'application.listCards', {})

      expect(updated.card).toMatchObject({ id: created.card.id, name: 'RPC 改名卡', description: 'RPC 改名后的卡。' })
      expect(updated.card.userName).toBeUndefined()
      expect(afterDelete.cards.map(card => card.id)).not.toContain(created.card.id)
    })
  })

  it('serves the application runtime turn loop through /rpc', async () => {
    await withStudioServer(async port => {
      const created = await callRpc<{
        session: { id: string; activeBranchId: string }
        branch: { id: string }
      }>(port, 'application.createSession', {
        cardSourceVersionId: 'card-version-rpc-1',
        cardSnapshot: { name: 'RPC Card' },
        title: 'RPC Session',
      })
      const turn = await callRpc<{
        run: { id: string; status: string }
        branch: { headEntryId: string }
        entries: {
          user: { id: string; content: string }
          assistant: { id: string; content: string }
        }
      }>(port, 'application.submitTurn', {
        sessionId: created.session.id,
        input: '服务器 RPC 回合。',
      })
      const timeline = await callRpc<{
        entries: Array<{ role: string; content: string }>
      }>(port, 'application.getTimeline', {
        sessionId: created.session.id,
      })
      const run = await callRpc<{
        runtimeEntries: Array<{ kind: string }>
        commitCandidates: Array<{ acceptedEntryId: string }>
      }>(port, 'application.getRun', {
        runId: turn.run.id,
      })

      expect(created.session.activeBranchId).toBe(created.branch.id)
      expect(turn.run.status).toBe('completed')
      expect(turn.branch.headEntryId).toBe(turn.entries.assistant.id)
      expect(timeline.entries.map(entry => entry.content)).toEqual([
        '服务器 RPC 回合。',
        'Agent draft: 服务器 RPC 回合。',
      ])
      expect(run.runtimeEntries.map(entry => entry.kind)).toEqual(['user_input', 'prompt', 'provider_result'])
      expect(run.commitCandidates[0]?.acceptedEntryId).toBe(turn.entries.assistant.id)
    })
  })
})
