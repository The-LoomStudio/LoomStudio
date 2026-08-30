import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('Studio Server text transform RPC', () => {
  it('round-trips Rule and Extractor documents and exposes host renderers', async () => {
    await withStudioServer(async port => {
      const created = await callRpc<{ rule: { id: string; version: number } }>(port, 'application.upsertTextTransformRule', {
        ruleId: 'workspace.hide-think',
        rule: {
          name: 'Hide Think', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: '<think>([\\s\\S]*?)</think>', flags: 'g' },
          effect: { kind: 'promote-reasoning', contentGroup: 1, visibility: 'collapsed', replay: 'omit' },
          targets: ['agent-session'], phases: ['classify'],
        },
      })
      expect(created.rule).toMatchObject({ id: 'workspace.hide-think', version: 1 })
      await expect(callRpc(port, 'application.listTextTransformRules', {})).resolves.toMatchObject({ rules: [{ id: 'workspace.hide-think' }] })

      await callRpc(port, 'application.upsertTextExtractor', {
        extractorId: 'workspace.world-state',
        extractor: {
          name: 'World State', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
          targets: ['narrative'], matcher: { kind: 'regex', pattern: '<WorldState>([\\s\\S]*?)</WorldState>', flags: 'g', contentGroup: 1 },
          strategy: 'latest-valid', parser: 'key-value-lines',
        },
      })
      await expect(callRpc(port, 'application.listTextExtractors', {})).resolves.toMatchObject({ extractors: [{ id: 'workspace.world-state' }] })
      await expect(callRpc(port, 'application.listRenderers', {})).resolves.toMatchObject({
        renderers: [{ id: 'official/json-artifact', surface: 'shell.workspace-panel', instanceScope: 'workspace' }],
      })
    })
  })
})
