import { createApplicationRuntime, importCardBundle, exportCardArtifact } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/asset-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLoomScriptSource, serializeLoomScriptMetadata, resolveLoomScriptSettings, resolveTextTransformContributionRule } from '@loom-studio/shared/loom-scripts'
import { resolveScriptTextContributions } from '../../../packages/application-runtime/src/scripts/loom-script-text-pipeline.js'
import { resolveEffectiveTextPipeline } from '../../../packages/application-runtime/src/runtime/transforms-runtime.js'

function ruleSource(runtime: 'declarative' | 'server' = 'declarative', requiresCode = false) {
  return serializeLoomScriptMetadata({ formatVersion: 1, metadataId: 'example.configured-rule', scriptVersion: '1.0.0', name: '配置规则', runtime,
    requestedCapabilities: [], tags: ['UI'], settings: [{ key: 'replacement', type: 'string', label: '替换为', default: '旁白' }],
    contributions: [{ kind: 'text-transform', id: 'rule', ...(requiresCode ? { requiresCode: true } : {}), rule: {
      name: '替换角色名称', description: { $config: 'replacement' }, enabled: true, orderIndex: 0, matcher: { kind: 'regex', pattern: 'Alice', flags: 'g' },
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
    agents: createAgentStore({ engine: dataEngine, createId, now }),
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
        .replaceAll('"$config": "replacement"', '"$text": "replacement"')
      const text = await f.runtime.previewLoomScript({ source: textBlock, text: 'Alice' })
      expect(text.output).toBe('<section>\n  内容\n</section>')
      const configuredPattern = parseLoomScriptSource(source.replace('"pattern": "Alice"', '"pattern": {"$config":"replacement"}'))
      const contribution = configuredPattern.contributions[0]!
      if (contribution.kind !== 'text-transform') throw new Error('Expected rule')
      expect(resolveTextTransformContributionRule(contribution, resolveLoomScriptSettings(configuredPattern.settings, { replacement: '(a)+' })).matcher.pattern).toBe('\\(a\\)\\+')
    } finally { await f.close() }
  })

  it('rebases Lore links to the imported Card copy across repeated exports, preserving usage', async () => {
    const f = await fixture()
    try {
      const source = '---\nid: example.linked\nname: Linked\nregex: test\nlore_refs:\n  - resourceId: original-lore\n    nodeId: lore-child\n---\nreplacement'
      let artifact: Parameters<typeof importCardBundle>[0]['artifact'] = {
        schemaVersion: 4, artifactId: 'linked-card', displayName: 'Linked', card: { name: 'Linked' },
        contextAssets: [{ id: 'lore-root', kind: 'module', category: 'lore', label: 'Lore', children: [{ id: 'lore-child', kind: 'entry', label: 'Instructions', body: 'Use test' }] }],
        scriptAttachments: [{ script: { format: 'loom.script', schemaVersion: 1, fileName: 'linked.rule.md', source }, orderIndex: 0,
          loreResourceReferences: { 'original-lore': 'lore-root' }, ruleUsage: { rule: { maxDepth: null, minDepth: 2 } } }],
      }
      for (let index = 0; index < 3; index++) {
        const imported = await importCardBundle({ ...f.ctx, artifact, now: f.ctx.now() })
        const mount = (await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: imported.card.id } })).mounts[0]!
        const script = (await f.runtime.getLoomScript({ scriptDocumentId: mount.scriptDocumentId })).script
        await f.runtime.updateLoomScript({ scriptDocumentId: script.id, expectedVersion: script.version, fileName: 'linked.rule.md', source })
        const settings = await f.runtime.getLoomScriptSettings({ mountId: mount.id })
        const ref = settings.ruleDefaults[0]!.rule.loreRefs![0]!
        expect(ref.resourceId).toBe(imported.card.promptResourceIds![0])
        expect((await f.runtime.getPromptResource({ resourceId: ref.resourceId })).resource.rootNode.children![0]!.id).toBe(ref.nodeId)
        expect(mount.ruleUsage).toEqual({ rule: { maxDepth: null, minDepth: 2 } })
        artifact = JSON.parse(JSON.stringify(await exportCardArtifact({ ...f.ctx, cardId: imported.card.id })))
      }
    } finally { await f.close() }
  })

  it('isolates Script Config, requires explicit grants and concurrency, and rejects stopped instances', async () => {
    const f = await fixture()
    try {
      const source = ruleSource('server').replace('// @runtime server', '// @runtime server\n// @capability configs.read\n// @capability configs.write')
      const script = (await f.runtime.importLoomScript({ owner: { kind: 'user' }, source, fileName: 'config.loom.js' })).script
      let mount = (await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })).mount
      await expect(f.runtime.listLoomScriptConfigs({ mountId: mount.id, runtimeRevision: mount.runtimeRevision ?? mount.version, scope: { kind: 'global' } })).rejects.toThrow('no longer active')
      const grants = ['runtime.server', 'configs.read', 'configs.write']
      mount = (await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: grants })).mount
      const query = { mountId: mount.id, runtimeRevision: mount.runtimeRevision!, scope: { kind: 'global' as const } }
      const config = await f.runtime.upsertLoomScriptConfig({ ...query, key: 'mode', value: 'A' })
      expect(config.scriptDocumentId).toBe(script.id)
      expect(config).not.toHaveProperty('packageId')
      expect(await f.runtime.listLoomScriptConfigs(query)).toEqual([config])
      await expect(f.runtime.upsertLoomScriptConfig({ ...query, key: 'mode', value: 'B' })).rejects.toThrow('expectedVersion')
      const updated = await f.runtime.upsertLoomScriptConfig({ ...query, key: 'mode', value: 'B', expectedVersion: config.version })
      expect(updated.value).toBe('B')
      const other = (await f.runtime.importLoomScript({ owner: { kind: 'user' }, source, fileName: 'config.loom.js' })).script
      let second = (await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: other.id, orderIndex: 0 })).mount
      second = (await f.runtime.updateLoomScriptMount({ mountId: second.id, expectedVersion: second.version, enabled: true, orderIndex: 0, grantedCapabilities: grants })).mount
      expect(await f.runtime.listLoomScriptConfigs({ ...query, mountId: second.id, runtimeRevision: second.runtimeRevision! })).toEqual([])
      mount = (await f.runtime.refreshLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version })).mount
      await expect(f.runtime.listLoomScriptConfigs(query)).rejects.toThrow('no longer active')
      expect((await f.runtime.listLoomScriptConfigs({ ...query, runtimeRevision: mount.runtimeRevision! }))[0]?.value).toBe('B')
      await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: false, orderIndex: 0, grantedCapabilities: grants })
      await expect(f.runtime.listLoomScriptConfigs(query)).rejects.toThrow('no longer active')
    } finally { await f.close() }
  })

  it('writes Card, Timeline and Agent Session configs in one transaction and rejects deleted scopes', async () => {
    const f = await fixture()
    try {
      const { card } = await f.runtime.createCard({ name: 'Scoped config' })
      const story = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const source = ruleSource('server').replace('// @runtime server', '// @runtime server\n// @capability configs.read\n// @capability configs.write')
      const { script } = await f.runtime.importLoomScript({ owner: { kind: 'user' }, source, fileName: 'config.loom.js' })
      const created = await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })
      const { mount } = await f.runtime.updateLoomScriptMount({ mountId: created.mount.id, expectedVersion: created.mount.version,
        enabled: true, orderIndex: 0, grantedCapabilities: ['runtime.server', 'configs.read', 'configs.write'] })
      const base = { mountId: mount.id, runtimeRevision: mount.runtimeRevision }
      const scopes = [{ kind: 'card', cardId: card.id }, { kind: 'timeline', timelineId: story.timeline.id },
        { kind: 'agent-session', agentSessionId: story.timeline.id }] as const
      for (const scope of scopes) {
        const saved = await f.runtime.upsertLoomScriptConfig({ ...base, scope, key: 'mode', value: 'A' })
        expect((await f.runtime.listLoomScriptConfigs({ ...base, scope }))[0]).toEqual(saved)
        await expect(f.runtime.upsertLoomScriptConfig({ ...base, scope, key: 'mode', value: 'B' })).rejects.toThrow('expectedVersion')
      }
      await f.runtime.deleteNarrativeTimeline({ timelineId: story.timeline.id })
      for (const scope of scopes.slice(1)) await expect(f.runtime.upsertLoomScriptConfig({ ...base, scope, key: 'new', value: 'B' })).rejects.toThrow('not found')
    } finally { await f.close() }
  })

  it('persists usage overrides without refreshing source or runtime, and resets to adopted defaults', async () => {
    const f = await fixture()
    try {
      const script = (await f.runtime.importLoomScript({ owner: { kind: 'user' }, source: ruleSource(), fileName: 'rule.loom.js' })).script
      let mount = (await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })).mount
      mount = (await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: [] })).mount
      const revision = mount.runtimeRevision
      mount = (await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: [], settings: { replacement: '即时配置' } })).mount
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]).toMatchObject({ description: '即时配置', effect: { kind: 'replace', replacement: '即时配置' } })
      const defaults = (await f.runtime.getLoomScriptSettings({ mountId: mount.id })).ruleDefaults
      const id = defaults[0]!.id
      mount = (await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: [],
        ruleUsage: { [id]: { minDepth: 2, maxDepth: null, streaming: false, phases: ['display'], targets: ['agent-session'] } } })).mount
      expect(mount.runtimeRevision).toBe(revision)
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]).toMatchObject({ range: { minDepth: 2, maxDepth: undefined }, streaming: false, phases: ['display'], targets: ['agent-session'] })
      mount = (await f.runtime.refreshLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version })).mount
      expect(mount.ruleUsage?.[id]?.minDepth).toBe(2)
      await expect(f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: [], ruleUsage: { [id]: { minDepth: 3, maxDepth: 1 } } })).rejects.toThrow('最大深度')
      await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: [], ruleUsage: {} })
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]?.targets).toEqual(defaults[0]!.rule.targets)
    } finally { await f.close() }
  })

  it('uses adopted values until refresh, runs once and respects role OFF for background requests', async () => {
    const f = await fixture()
    try {
      const script = (await f.runtime.importLoomScript({ owner: { kind: 'user' }, source: ruleSource('server'), fileName: 'rule.loom.js' })).script
      let global = (await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })).mount
      global = (await f.runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: global.version, enabled: true, orderIndex: 0, grantedCapabilities: ['runtime.server'], settings: { replacement: '记录员' } })).mount
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]).toMatchObject({ description: '记录员', effect: { kind: 'replace', replacement: '记录员' } })
      global = (await f.runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: global.version, enabled: true, orderIndex: 0, grantedCapabilities: ['runtime.server'], settings: { replacement: '新名称' } })).mount
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]).toMatchObject({ description: '记录员', effect: { kind: 'replace', replacement: '记录员' } })
      await f.runtime.refreshLoomScriptMount({ mountId: global.id, expectedVersion: global.version })
      expect((await resolveScriptTextContributions(f.ctx, {})).rules[0]).toMatchObject({ description: '新名称', effect: { kind: 'replace', replacement: '新名称' } })
      const role = (await f.runtime.createLoomScriptMount({ target: { kind: 'card', cardId: 'role' }, scriptDocumentId: script.id, orderIndex: 0 })).mount
      expect((await resolveScriptTextContributions(f.ctx, { cardId: 'role' })).rules).toEqual([])
      await f.runtime.updateLoomScriptMount({ mountId: role.id, expectedVersion: role.version, enabled: true, orderIndex: 0, grantedCapabilities: ['runtime.server'] })
      const selected = await resolveScriptTextContributions(f.ctx, { cardId: 'role' })
      expect(selected.rules).toHaveLength(1)
      expect(selected.rules[0]?.effect).toEqual({ kind: 'replace', replacement: '新名称' })
      expect((await f.runtime.exportLoomScript({ scriptDocumentId: script.id })).artifact.source).toBe(ruleSource('server'))
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

  it('saves optional reference fields as JSON and applies current-card/global inheritance without losing explicit uses', async () => {
    const f = await fixture()
    try {
      for (const [id, owner] of [['global', { kind: 'workspace' }], ['current', { kind: 'card', cardId: 'role' }], ['other', { kind: 'card', cardId: 'other' }]] as const) {
        await f.runtime.upsertTextTransformRule({ ruleId: id, rule: {
          name: id, owner, enabled: true, orderIndex: 0, matcher: { kind: 'regex', pattern: 'Alice', flags: 'g' },
          effect: { kind: 'replace', replacement: id }, targets: ['narrative'], phases: ['display'],
        } })
      }
      const timeline = await f.ctx.narratives.createTimeline({ actor: { kind: 'system', id: 'test' }, stateRevisionId: 'state-0', createdFrom: { cardId: 'role', cardVersion: 1 } })
      const created = await f.ctx.promptResources.createResource({ actor: { kind: 'system', id: 'test' }, resourceKind: 'preset', rootNode: { id: 'root', kind: 'module', label: 'preset' }, metadata: {
        textUses: [{ id: 'deleted', kind: 'rule', enabled: true, reference: { kind: 'external', resourceId: 'deleted' } }],
      } })
      const source = { kind: 'narrative' as const, timelineId: timeline.timeline.id, branchId: timeline.branch.id }
      const pipeline = () => resolveEffectiveTextPipeline(f.ctx, source, 'display', undefined, created.resource.id)
      expect((await pipeline()).rules.map(rule => rule.id).sort()).toEqual(['current', 'global'])
      const { agentPreset: saved } = await f.runtime.updateAgentPreset({ agentPresetId: created.resource.id, expectedVersion: created.resource.version,
        useCardText: false, useGlobalText: false, textUses: [{ id: 'deleted', kind: 'rule', enabled: true, orderIndex: undefined }],
      })
      expect(saved.textUses?.[0]).toEqual({ id: 'deleted', kind: 'rule', enabled: true, reference: { kind: 'external', resourceId: 'deleted' } })
      expect((await pipeline()).rules).toEqual([])
      expect((await pipeline()).diagnostics.some(item => item.code === 'text.use_unresolved')).toBe(true)
      await f.runtime.updateAgentPreset({ agentPresetId: saved.id, expectedVersion: saved.version,
        textUses: [{ id: 'current', kind: 'rule', enabled: true, orderIndex: undefined }],
      })
      expect((await pipeline()).rules.map(rule => rule.id)).toEqual(['current'])
      expect((await pipeline()).diagnostics).toEqual([])
    } finally { await f.close() }
  })

  it('allows a preset to select a disabled rule default but respects a disabled Script override', async () => {
    const f = await fixture()
    try {
      await f.runtime.upsertTextTransformRule({ ruleId: 'old-rule',
        rule: { name: 'legacy', owner: { kind: 'workspace' }, enabled: false, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'Alice', flags: 'g' }, effect: { kind: 'replace', replacement: '旧规则' },
          targets: ['narrative'], phases: ['display'] } })
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
