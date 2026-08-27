import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('Studio Server state RPC', () => {
  it('exposes initialized global state and applies validated mutations', async () => {
    await withStudioServer(async port => {
      const initial = await callRpc<{
        snapshot: { revisionId: string; value: Record<string, unknown> }
      }>(port, 'application.getStateSnapshot', { target: { scope: 'global' } })
      const updated = await callRpc<{
        snapshot: { revisionId: string; value: Record<string, unknown> }
        mutation: { changesetId: string }
      }>(port, 'application.applyStateMutation', {
        target: { scope: 'global' },
        expectedRevisionId: initial.snapshot.revisionId,
        operations: [{ op: 'set', path: '/gold', value: 12 }],
      })

      expect(updated.snapshot.value).toEqual({ gold: 12 })
      expect(updated.mutation.changesetId).toMatch(/^chg-/)
      const definition = await callRpc<{ definition: { id: string } }>(port, 'application.upsertStateDefinition', {
        definitionId: 'state.score',
        definition: { kind: 'global', path: 'global.score', schema: { type: 'number' }, default: 1 },
      })
      expect(definition.definition.id).toBe('state.score')
      await expect(callRpc(port, 'application.listStateDefinitions', { kind: 'global' })).resolves.toMatchObject({
        definitions: [{ id: 'state.score' }],
      })
      await expect(callRpc(port, 'application.applyStateMutation', {
        target: { scope: 'global' },
        expectedRevisionId: updated.snapshot.revisionId,
        operations: [{ op: 'increment', path: '/gold', by: 'invalid' }],
      })).rejects.toThrow('Expected finite state increment')
    })
  })
})
