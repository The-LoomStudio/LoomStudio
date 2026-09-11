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

  it('round-trips one normalized Text Pipeline Override with CAS and deletion', async () => {
    await withStudioServer(async port => {
      const source = { kind: 'agent-session', sessionId: 'session-override', headEntryId: 'head-1' }
      const created = await callRpc<{ override: { id: string; version: number; orderedRuleIds: string[] } }>(port, 'application.upsertTextPipelineOverride', {
        source,
        phase: 'display',
        disabledRuleIds: ['rule-disabled'],
        orderedRuleIds: ['rule-second', 'rule-first'],
      })
      expect(created.override).toMatchObject({ version: 1, orderedRuleIds: ['rule-second', 'rule-first'] })

      await expect(callRpc(port, 'application.getTextPipelineOverride', {
        source: { kind: 'agent-session', sessionId: 'session-override', headEntryId: 'head-2' },
        phase: 'display',
      })).resolves.toMatchObject({ override: { id: created.override.id, version: 1 } })
      await expect(callRpc(port, 'application.upsertTextPipelineOverride', {
        source,
        phase: 'display',
        expectedVersion: 0,
        disabledRuleIds: [],
        orderedRuleIds: [],
      })).rejects.toThrow('version conflict')

      await expect(callRpc(port, 'application.deleteTextPipelineOverride', {
        source,
        phase: 'display',
        expectedVersion: created.override.version,
      })).resolves.toMatchObject({ deleted: true })
      await expect(callRpc(port, 'application.getTextPipelineOverride', { source, phase: 'display' }))
        .resolves.toEqual({ override: null })
    })
  })
})
