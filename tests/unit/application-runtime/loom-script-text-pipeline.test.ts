import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/asset-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLoomScriptSource, serializeLoomScriptMetadata, resolveLoomScriptSettings, resolveTextTransformContributionRule } from '@loom-studio/shared/loom-scripts'
import { resolveScriptTextContributions } from '../../../packages/application-runtime/src/scripts/loom-script-text-pipeline.js'
import { resolveEffectiveTextPipeline } from '../../../packages/application-runtime/src/runtime/transforms-runtime.js'
import { migrateLegacyTextTransformRules } from '../../../packages/application-runtime/src/scripts/loom-script-text-migration.js'

function ruleSource(runtime: 'declarative' | 'server' = 'declarative', requiresCode = false) {
  return serializeLoomScriptMetadata({ formatVersion: 1, metadataId: 'example.configured-rule', scriptVersion: '1.0.0', name: '配置规则', runtime,
    requestedCapabilities: [], tags: ['UI'], settings: [{ key: 'replacement', type: 'string', label: '替换为', default: '旁白' }],
    contributions: [{ kind: 'text-transform', id: 'rule', ...(requiresCode ? { requiresCode: true } : {}), rule: {
      name: '替换角色名称', enabled: true, orderIndex: 0, matcher: { kind: 'regex', pattern: 'Alice', flags: 'g' },
      effect: { kind: 'replace', replacement: { $config: 'replacement' } }, targets: ['narrative', 'agent-session'], phases: ['display', 'prompt'],
    } }],
  }) + (runtime === 'server' ? '\nexport function activate() {}' : '')
}

async function fixture() {
  let id = 0
  const createId = (prefix: string) => `${prefix}-${++id}`
  const now = () => '2026-10-26T00:00:00.000Z'
  const dataEngine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const directory = await mkdtemp(join(tmpdir(), 'loom-rule-'))
  const ctx = { createId, now, dataEngine, documents: createSqliteDocumentStore({ engine: dataEngine }),
    promptResources: createPromptResourceStore({ engine: dataEngine, createId, now }),
    narratives: createNarrativeStore({ engine: dataEngine, createId, now }), blobs: createBlobStore({ engine: dataEngine, rootDirectory: directory, createId, now }) }
  return { ctx, runtime: createApplicationRuntime(ctx), async close() { await dataEngine.close(); await rm(directory, { recursive: true, force: true }) } }
}

describe('declarative Script pipeline', () => {
  it('parses multiline metadata and literal setting references without evaluating JavaScript', async () => {
    const f = await fixture()
    try {
      const source = ruleSource()
      const parsed = parseLoomScriptSource(source)
      expect(parsed.runtime).toBe('declarative')
      expect(parsed.requestedCapabilities).toEqual([])
      expect(parsed.tags).toEqual(['ui'])
      expect(parseLoomScriptSource(serializeLoomScriptMetadata(parsed))).toEqual(parsed)
      const preview = await f.runtime.previewLoomScript({ source, text: 'Alice Alice', settings: { replacement: '$&' } })
      expect(preview.output).toBe('$& $&')
      expect(preview.matches).toHaveLength(2)
      parsed.contributions.push({ kind: 'text-extractor', id: 'status', extractor: { name: '状态', enabled: true, orderIndex: 0,
        targets: ['narrative'], matcher: { kind: 'regex', pattern: 'STATUS:([^\\n]+)', flags: 'g', contentGroup: 1 },
        strategy: 'latest-valid', parser: 'text', artifactType: 'example.status' } })
      const extracted = await f.runtime.previewLoomScript({ source: serializeLoomScriptMetadata(parsed), text: 'STATUS:ready' })
      expect(extracted.extractions).toMatchObject([{ extractorId: 'status', values: ['ready'] }])

      const missingRuntime = source.replace('// @runtime declarative\n', '')
      expect(parseLoomScriptSource(missingRuntime).runtime).toBe('declarative')
      expect(() => parseLoomScriptSource(missingRuntime + '\nglobalThis.changed = true')).toThrow('Declare @runtime')
      expect(() => parseLoomScriptSource(source.replace('"default": "旁白"', '"default": false'))).toThrow('must be string')
      const textBlock = source.replace('// @runtime declarative', '// @runtime declarative\n// @text replacement <<END\n// <section>\n//   内容\n// </section>\n// END')
        .replace('"$config": "replacement"', '"$text": "replacement"')
      const text = await f.runtime.previewLoomScript({ source: textBlock, text: 'Alice' })
      expect(text.output).toBe('<section>\n  内容\n</section>')
      const configuredPattern = parseLoomScriptSource(source.replace('"pattern": "Alice"', '"pattern": {"$config":"replacement"}'))
      const contribution = configuredPattern.contributions[0]!
      if (contribution.kind !== 'text-transform') throw new Error('Expected rule')
      expect(resolveTextTransformContributionRule(contribution, resolveLoomScriptSettings(configuredPattern.settings, { replacement: '(a)+' })).matcher.pattern).toBe('\\(a\\)\\+')
    } finally { await f.close() }
  })

  it('uses adopted values until refresh, runs once and respects role OFF for background requests', async () => {
    const f = await fixture()
    try {
      const script = (await f.runtime.importLoomScript({ owner: { kind: 'user' }, source: ruleSource(), fileName: 'rule.loom.js' })).script
      let global = (await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })).mount
      global = (await f.runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: global.version, enabled: true, orderIndex: 0, grantedCapabilities: [], settings: { replacement: '记录员' } })).mount
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]?.effect).toEqual({ kind: 'replace', replacement: '记录员' })
      global = (await f.runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: global.version, enabled: true, orderIndex: 0, grantedCapabilities: [], settings: { replacement: '新名称' } })).mount
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]?.effect).toEqual({ kind: 'replace', replacement: '记录员' })
      await f.runtime.refreshLoomScriptMount({ mountId: global.id, expectedVersion: global.version })
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]?.effect).toEqual({ kind: 'replace', replacement: '新名称' })
      const role = (await f.runtime.createLoomScriptMount({ target: { kind: 'card', cardId: 'role' }, scriptDocumentId: script.id, orderIndex: 0 })).mount
      expect((await resolveScriptTextContributions(f.ctx, { cardId: 'role' })).rules).toEqual([])
      await f.runtime.updateLoomScriptMount({ mountId: role.id, expectedVersion: role.version, enabled: true, orderIndex: 0, grantedCapabilities: [] })
      const selected = await resolveScriptTextContributions(f.ctx, { cardId: 'role' })
      expect(selected.rules).toHaveLength(1)
      expect(selected.rules[0]?.effect).toEqual({ kind: 'replace', replacement: '新名称' })
      expect((await f.runtime.exportLoomScript({ scriptDocumentId: script.id })).artifact.source).toBe(ruleSource())
    } finally { await f.close() }
  })

  it('keeps independent declarations usable without code trust and blocks explicit code dependencies until active', async () => {
    const f = await fixture()
    try {
      const independent = (await f.runtime.importLoomScript({ owner: { kind: 'user' }, source: ruleSource('server'), fileName: 'mixed.loom.js' })).script
      const global = (await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: independent.id, orderIndex: 0 })).mount
      await f.runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: global.version, enabled: true, orderIndex: 0, grantedCapabilities: [] })
      expect((await resolveScriptTextContributions(f.ctx, {})).rules).toHaveLength(1)
      const dependent = (await f.runtime.importLoomScript({ owner: { kind: 'user' }, source: ruleSource('server', true), fileName: 'dependent.loom.js' })).script
      const created = (await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: dependent.id, orderIndex: 1 })).mount
      const enabled = (await f.runtime.updateLoomScriptMount({ mountId: created.id, expectedVersion: created.version, enabled: true, orderIndex: 1, grantedCapabilities: ['runtime.server'] })).mount
      expect((await resolveScriptTextContributions(f.ctx, {})).diagnostics[0]?.code).toBe('script.code_dependency_unavailable')
      f.runtime.setLoomScriptExecutionStates([{ mountId: enabled.id, revision: enabled.runtimeRevision!, active: true }])
      expect((await resolveScriptTextContributions(f.ctx, {})).rules).toHaveLength(2)
      await f.runtime.refreshLoomScriptMount({ mountId: enabled.id, expectedVersion: enabled.version })
      expect((await resolveScriptTextContributions(f.ctx, {})).rules).toHaveLength(1)
    } finally { await f.close() }
  })

  it('preserves preset adoption of a migrated disabled rule without enabling an explicitly disabled role override', async () => {
    const f = await fixture()
    try {
      const timestamp = f.ctx.now()
      await f.ctx.documents.write({ id: 'old-rule', type: 'airp.textTransformRule', expectedVersion: 'new',
        content: { name: 'legacy', owner: { kind: 'workspace' }, enabled: false, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'Alice', flags: 'g' }, effect: { kind: 'replace', replacement: '旧规则' },
          targets: ['narrative'], phases: ['display'], createdAt: timestamp, updatedAt: timestamp } })
      await migrateLegacyTextTransformRules(f.ctx)
      const timeline = await f.ctx.narratives.createTimeline({ actor: { kind: 'system', id: 'test' }, stateRevisionId: 'state-0', createdFrom: { cardId: 'role', cardVersion: 1 } })
      const preset = await f.ctx.promptResources.createResource({ actor: { kind: 'system', id: 'test' }, resourceKind: 'preset', rootNode: { id: 'preset-root', kind: 'module', label: 'preset' }, metadata: { textUses: [{ id: 'old-rule', kind: 'rule', enabled: true }] } })
      const source = { kind: 'narrative' as const, timelineId: timeline.timeline.id, branchId: timeline.branch.id }
      const before = await resolveEffectiveTextPipeline(f.ctx, source, 'display', undefined, preset.resource.id)
      expect(before.rules.map(rule => rule.id)).toEqual(['old-rule'])
      const script = (await f.runtime.listLoomScripts()).scripts[0]!
      await f.runtime.createLoomScriptMount({ target: { kind: 'card', cardId: 'role' }, scriptDocumentId: script.id, orderIndex: 0 })
      expect((await resolveEffectiveTextPipeline(f.ctx, source, 'display', undefined, preset.resource.id)).rules).toEqual([])
    } finally { await f.close() }
  })
})
