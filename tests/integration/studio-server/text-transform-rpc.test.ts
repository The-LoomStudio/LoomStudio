import { describe, expect, it } from 'vitest'
import { parseLoomScriptSource, resolveLoomScriptSettings, resolveTextTransformContributionRule, serializeMarkdownTextRule } from '@loom-studio/shared/loom-scripts'
import { callRpc, withStudioServer } from './helpers.js'

describe('Studio Server text transform RPC', () => {
  it('lists only catalog metadata, filters owners and preserves full definition endpoints', async () => {
    await withStudioServer(async port => {
      const rule = {
        name: 'Catalog rule', owner: { kind: 'workspace' }, enabled: false, orderIndex: 0,
        description: 'Full description', matcher: { kind: 'regex', pattern: 'raw', flags: 'g' },
        effect: { kind: 'replace', replacement: 'display' }, targets: ['narrative'], phases: ['display'],
      }
      await callRpc(port, 'application.upsertTextTransformRule', { ruleId: 'catalog-rule', rule })
      await callRpc(port, 'application.upsertTextTransformRule', {
        ruleId: 'other-rule', rule: { ...rule, owner: { kind: 'card', cardId: 'other-card' } },
      })
      await expect(callRpc(port, 'application.listTextTransformRuleSummaries', { owner: { kind: 'workspace' } }))
        .resolves.toEqual({ rules: [{ id: 'catalog-rule', name: rule.name, owner: rule.owner, enabled: false }] })
      const all = await callRpc<{ rules: Array<{ id: string }> }>(port, 'application.listTextTransformRuleSummaries', {})
      expect(all.rules.map(item => item.id).sort()).toEqual(['catalog-rule', 'other-rule'])
      await expect(callRpc(port, 'application.listTextTransformRuleSummaries', { owner: { kind: 'card', cardId: 'missing' } }))
        .resolves.toEqual({ rules: [] })
      await expect(callRpc(port, 'application.listTextTransformRuleSummaries', { owner: { kind: 'unknown' } })).rejects.toThrow()
      await expect(callRpc(port, 'application.listTextTransformRuleSummaries', { owner: { kind: 'card' } })).rejects.toThrow()
      await expect(callRpc(port, 'application.listTextTransformRules', { owner: { kind: 'workspace' } }))
        .resolves.toMatchObject({ rules: [{ id: 'catalog-rule', matcher: rule.matcher, effect: rule.effect, description: rule.description }] })
      const { rule: savedRule } = await callRpc<{ rule: { scriptDocumentId: string } }>(port, 'application.getTextTransformRule', { ruleId: 'catalog-rule' })
      await expect(callRpc(port, 'application.getLoomScriptSummary', { scriptDocumentId: savedRule.scriptDocumentId }))
        .resolves.toEqual({ script: { id: savedRule.scriptDocumentId, contributionKinds: ['text-transform'] } })
      await expect(callRpc(port, 'application.getLoomScriptSummary', { scriptDocumentId: 'missing' }))
        .resolves.toEqual({ script: null })
      await callRpc(port, 'docs.write', {
        id: 'catalog-tool', type: 'airp.agentTool', expectedVersion: 'new',
        content: { owner: { kind: 'workspace' }, name: 'Catalog tool', description: 'Full tool description',
          input: { type: 'object', properties: { text: { type: 'string' } } }, createdAt: '', updatedAt: '' },
      })
      await expect(callRpc(port, 'application.getAgentToolSummary', { toolId: 'catalog-tool' }))
        .resolves.toEqual({ tool: { id: 'catalog-tool' } })
      await expect(callRpc(port, 'application.getAgentToolSummary', { toolId: 'missing' }))
        .resolves.toEqual({ tool: null })
      await expect(callRpc(port, 'application.getLoomScriptSummary', { scriptDocumentId: 'catalog-tool' }))
        .rejects.toThrow('Unexpected document type')
      const origin = { kind: 'extension-package', packageId: 'catalog-package', packageVersion: '1.0.0',
        contributionId: 'extractor', installationId: 'installation' }
      const extractor = {
        name: 'Catalog extractor', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
        targets: ['narrative'], matcher: { kind: 'regex', pattern: '(raw)', flags: 'g', contentGroup: 1 },
        strategy: 'latest-valid', parser: 'text', outputSchema: { type: 'string' }, origin,
      }
      await callRpc(port, 'application.upsertTextExtractor', { extractorId: 'catalog-extractor', extractor })
      await expect(callRpc(port, 'application.listTextExtractorSummaries', {})).resolves.toEqual({ extractors: [
        { id: 'catalog-extractor', name: extractor.name, owner: extractor.owner, enabled: true, origin },
      ] })
      await expect(callRpc(port, 'application.listTextExtractors', {})).resolves.toMatchObject({ extractors: [
        { id: 'catalog-extractor', matcher: extractor.matcher, parser: extractor.parser, outputSchema: extractor.outputSchema },
      ] })
    })
  })

  it('round-trips owner, definition IDs and projection IDs with empty subsets and validated parameters', async () => {
    await withStudioServer(async port => {
      const { card } = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Subset' })
      await callRpc(port, 'application.upsertTextTransformRule', {
        ruleId: 'subset-rule',
        rule: {
          name: 'Subset', owner: { kind: 'card', cardId: card.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'raw', flags: 'g' },
          effect: { kind: 'replace', replacement: 'display' }, targets: ['narrative'], phases: ['display'],
        },
      })
      await expect(callRpc(port, 'application.listTextTransformRules', { owner: { kind: 'card', cardId: card.id } }))
        .resolves.toMatchObject({ rules: [{ id: 'subset-rule' }] })
      await expect(callRpc(port, 'application.listTextTransformRules', { owner: { kind: 'card', cardId: 'other' } }))
        .resolves.toEqual({ rules: [] })
      await expect(callRpc(port, 'application.listTextTransformRules', { owner: { kind: 'unknown' } })).rejects.toThrow()
      await expect(callRpc(port, 'application.listTextTransformRules', { owner: { kind: 'card' } })).rejects.toThrow()
      await callRpc(port, 'application.upsertStateDefinition', {
        definitionId: 'subset-state',
        definition: { kind: 'timeline-template', templateVersion: 1, schema: { type: 'object' }, initial: {} },
      })
      await expect(callRpc(port, 'application.listStateDefinitions', { ids: ['subset-state', 'missing'], kind: 'timeline-template' }))
        .resolves.toMatchObject({ definitions: [{ id: 'subset-state' }] })
      await expect(callRpc(port, 'application.listStateDefinitions', { ids: [] })).resolves.toEqual({ definitions: [] })
      await expect(callRpc(port, 'application.listStateDefinitions', { ids: [1] })).rejects.toThrow()
      const created = await callRpc<{ timeline: { id: string }; branch: { id: string; headNodeId: string } }>(port, 'application.createNarrativeTimeline', {
        cardId: card.id, openingContent: 'raw first',
      })
      await callRpc(port, 'application.appendNarrativeInput', { timelineId: created.timeline.id, branchId: created.branch.id,
        nodeId: 'raw-second', expectedHeadNodeId: created.branch.headNodeId, content: 'raw second',
      })
      const input = {
        source: { kind: 'narrative', timelineId: created.timeline.id, branchId: created.branch.id }, phase: 'display',
      }
      const full = await callRpc<{ snapshot: { entries: Array<{ id: string }>; matches: Array<{ entryId: string }> } }>(port, 'application.projectHistory', input)
      expect(full.snapshot.entries).toHaveLength(2)
      const entryIds = [full.snapshot.entries[0]!.id]
      await expect(callRpc(port, 'application.projectHistory', { ...input, entryIds })).resolves.toEqual({
        snapshot: {
          ...full.snapshot, entries: full.snapshot.entries.slice(0, 1),
          matches: full.snapshot.matches.filter(match => entryIds.includes(match.entryId)),
        },
      })
      await expect(callRpc(port, 'application.projectHistory', { ...input, entryIds: [] })).resolves.toEqual({
        snapshot: { ...full.snapshot, entries: [], matches: [] },
      })
      await expect(callRpc(port, 'application.projectHistory', { ...input, entryIds: [1] })).rejects.toThrow()
    })
  })

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

      const { rule: savedRule } = await callRpc<{ rule: { scriptDocumentId: string; version: number } }>(port, 'application.getTextTransformRule', { ruleId: 'preview-1' })
      const { artifact } = await callRpc<{ artifact: { source: string; fileName: string } }>(port, 'application.exportLoomScript', { scriptDocumentId: savedRule.scriptDocumentId })
      const metadata = parseLoomScriptSource(artifact.source)
      const contribution = metadata.contributions[0]!
      if (contribution.kind !== 'text-transform') throw new Error('Expected a text rule')
      contribution.rule.effect = { kind: 'replace', replacement: '<html><body>$1</body></html>' }
      await callRpc(port, 'application.updateLoomScript', { scriptDocumentId: savedRule.scriptDocumentId,
        expectedVersion: savedRule.version, fileName: artifact.fileName, source: serializeMarkdownTextRule(resolveTextTransformContributionRule(contribution, resolveLoomScriptSettings(metadata.settings)), contribution.id) })
      // Saving source does not adopt it; the old projection remains visible until refresh.
      await expect(callRpc(port, 'application.previewCardOpeningDisplay', { cardId: card.id, text }))
        .resolves.toMatchObject({ text: '```html\n<html><body>Done</body></html>\n```' })
      const { mounts } = await callRpc<{ mounts: Array<{ id: string; version: number }> }>(port, 'application.listLoomScriptMounts', { scriptDocumentId: savedRule.scriptDocumentId })
      await callRpc(port, 'application.refreshLoomScriptMount', { mountId: mounts[0]!.id, expectedVersion: mounts[0]!.version })
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
