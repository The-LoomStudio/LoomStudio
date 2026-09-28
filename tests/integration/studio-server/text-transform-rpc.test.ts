import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('Studio Server text transform RPC', () => {
  it('previews card opening Display rules without creating history or modifying documents', async () => {
    await withStudioServer(async port => {
      const { card } = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Opening' })
      const { resource } = await callRpc<{ resource: { id: string } }>(port, 'application.createPromptResource', { resourceKind: 'preset', name: 'Preview' })
      const base = {
        enabled: true, orderIndex: 0, name: 'Preview', owner: { kind: 'workspace' },
        matcher: { kind: 'regex', pattern: 'Ready', flags: 'g' },
        effect: { kind: 'replace', replacement: 'Done' }, targets: ['narrative'], phases: ['display'],
      }
      const rules = [
        { ...base, name: 'Workspace' },
        { ...base, name: 'Card', orderIndex: 1, owner: { kind: 'card', cardId: card.id },
          matcher: { kind: 'regex', pattern: '<quick_reply>([\\s\\S]*?)</quick_reply>', flags: 'gi' },
          effect: { kind: 'replace', replacement: '```html\n<html><body>$1</body></html>\n```' } },
        { ...base, name: 'Preset', orderIndex: 2, owner: { kind: 'preset', presetId: resource.id },
          matcher: { kind: 'regex', pattern: 'Done', flags: 'g' }, effect: { kind: 'replace', replacement: 'Preset' } },
        { ...base, name: 'Other card', owner: { kind: 'card', cardId: 'another-card' } },
        { ...base, name: 'Depth', range: { minDepth: 1 }, orderIndex: -1 },
        { ...base, name: 'Prompt only', phases: ['prompt'], orderIndex: -1 },
        { ...base, name: 'Agent only', targets: ['agent-session'], orderIndex: -1 },
      ]
      // Excluded rules would destroy the opening tag if incorrectly selected.
      for (const [index, rule] of rules.entries()) {
        await callRpc(port, 'application.upsertTextTransformRule', {
          ruleId: `preview-${index}`,
          rule: index < 3 ? rule : { ...rule, matcher: { kind: 'regex', pattern: '<quick_reply>', flags: 'g' } },
        })
      }
      const before = await callRpc(port, 'docs.list', { limit: 100 })
      const timelines = await callRpc(port, 'application.listNarrativeTimelines', {})
      const text = '<quick_reply>Ready</quick_reply>'
      await expect(callRpc(port, 'application.previewCardOpeningDisplay', { cardId: card.id, text }))
        .resolves.toMatchObject({ originalText: text, text: '```html\n<html><body>Done</body></html>\n```', diagnostics: [] })
      await expect(callRpc(port, 'application.previewCardOpeningDisplay', { cardId: card.id, presetId: resource.id, text }))
        .resolves.toMatchObject({ text: '```html\n<html><body>Preset</body></html>\n```' })
      await expect(callRpc(port, 'application.previewCardOpeningDisplay', { cardId: 'missing', text })).rejects.toThrow()
      await expect(callRpc(port, 'application.previewCardOpeningDisplay', { cardId: card.id, presetId: card.id, text })).rejects.toThrow()
      expect(await callRpc(port, 'docs.list', { limit: 100 })).toEqual(before)
      expect(await callRpc(port, 'application.listNarrativeTimelines', {})).toEqual(timelines)

      await callRpc(port, 'application.upsertTextTransformRule', {
        ruleId: 'preview-1', expectedVersion: 1,
        rule: { ...rules[1], effect: { kind: 'replace', replacement: '<html><body>$1</body></html>' } },
      })
      const afterSave = await callRpc(port, 'docs.list', { limit: 100 })
      await expect(callRpc(port, 'application.previewCardOpeningDisplay', { cardId: card.id, text }))
        .resolves.toMatchObject({ originalText: text, text: '<html><body>Done</body></html>', diagnostics: [] })
      expect(await callRpc(port, 'docs.list', { limit: 100 })).toEqual(afterSave)
      expect(await callRpc(port, 'application.listNarrativeTimelines', {})).toEqual(timelines)
    })
  })

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
