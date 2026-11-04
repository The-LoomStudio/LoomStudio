import { parseLoomScriptSource, serializeLoomScriptMetadata } from '@loom-studio/shared/loom-scripts'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, unzipSync } from 'fflate'
import { createApplicationRuntime, type ImportExtensionPackageResourcesInput } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/asset-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { resolveEffectiveTextPipeline } from '../../../packages/application-runtime/src/runtime/transforms-runtime.js'
import type { TextTransformRuleContent } from '../../../packages/application-runtime/src/transforms/history-text.js'
import { createExtensionScriptArchiveExporter } from '../../../apps/studio-server/src/extensions/extension-script-export.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function fixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-10-26T00:00:00.000Z'
  const dataEngine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = await mkdtemp(join(tmpdir(), 'loom-rule-migration-'))
  cleanups.push(async () => { await dataEngine.close(); await rm(rootDirectory, { recursive: true, force: true }) })
  const context = { dataEngine, createId, now, documents: createSqliteDocumentStore({ engine: dataEngine }),
    promptResources: createPromptResourceStore({ engine: dataEngine, createId, now }),
    agents: createAgentStore({ engine: dataEngine, createId, now }),
    narratives: createNarrativeStore({ engine: dataEngine, createId, now }),
    blobs: createBlobStore({ engine: dataEngine, rootDirectory, createId, now }),
  }
  return { ...context, runtime: createApplicationRuntime(context) }
}

function rule(enabled = true): TextTransformRuleContent {
  return { name: 'Replacement', owner: { kind: 'workspace' }, enabled, orderIndex: 7,
    matcher: { kind: 'regex', pattern: 'old', flags: 'g' }, effect: { kind: 'replace', replacement: 'new\nline' },
    targets: ['narrative', 'agent-session'], phases: ['display', 'prompt'],
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }
}

describe('Text rules become Script contributions', () => {
  it('preserves full source, settings and cross-script addresses through two Preset round trips', async () => {
    const f = await fixture()
    const definition = rule()
    const { owner: _owner, createdAt: _created, updatedAt: _updated, ...plain } = definition
    const source = [
      '// ==LoomScript==', '// @format 1', '// @id roundtrip.example', '// @name Original source', '// @version 1.0.0', '// @runtime client',
      '// @setting {"key":"caption","label":"标题","type":"string","default":"默认"}',
      `// @contribution ${JSON.stringify({ kind: 'text-transform', id: 'rule', rule: plain })}`,
      '// @contribution {"kind":"renderer","id":"view","surface":"narrative.entry.inline","scope":"node","inputs":["match:old-rule"]}',
      '// ==/LoomScript==', '// This comment and formatting must remain byte-identical.', 'export function activate(ctx) { return undefined; }', '',
    ].join('\n')
    let artifact = { format: 'loom.promptResource' as const, schemaVersion: 2 as const, resourceKind: 'preset' as const,
      rootNode: { id: 'roundtrip-root', kind: 'module' as const, label: 'Round trip' },
      textUses: [{ id: 'old-rule', kind: 'rule' as const, enabled: true }],
      scriptAttachments: [{ orderIndex: 0, textResourceIds: { rule: 'old-rule' }, settings: { caption: '用户标题' },
        script: { format: 'loom.script' as const, schemaVersion: 1 as const, fileName: 'roundtrip.loom.js', source } }],
    }
    let previousId = 'old-rule'
    for (let index = 0; index < 2; index++) {
      const { resource } = await f.runtime.importPromptResource({ artifact })
      const mounts = (await f.runtime.listLoomScriptMounts({ target: { kind: 'preset', presetId: resource.id } })).mounts
      expect(mounts).toHaveLength(1)
      expect(mounts[0]).toMatchObject({ enabled: false, grantedCapabilities: [], settings: { caption: '用户标题' } })
      const script = (await f.runtime.getLoomScript({ scriptDocumentId: mounts[0]!.scriptDocumentId })).script
      const nextId = script.textResourceIds!.rule!
      expect(nextId).not.toBe(previousId)
      expect(script.textResourceReferences!['old-rule']).toBe(nextId)
      expect(resource.textUses?.[0]).toMatchObject({ id: nextId, reference: { kind: 'external', resourceId: nextId } })
      const mount = mounts[0]!
      await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version,
        enabled: true, orderIndex: mount.orderIndex, grantedCapabilities: [] })
      const { session } = await f.runtime.createAgentSession({ agentPresetId: resource.id })
      const effective = await resolveEffectiveTextPipeline(f, { kind: 'agent-session', sessionId: session.id }, 'display')
      expect(effective.rules.map(rule => rule.id)).toEqual([nextId])
      expect(effective.diagnostics.filter(diagnostic => diagnostic.code === 'text.use_unresolved')).toEqual([])
      const exported = (await f.runtime.exportPromptResource({ resourceId: resource.id })).artifact
      expect(exported.scriptAttachments?.[0]?.script.source).toBe(source)
      expect(exported.scriptAttachments?.[0]?.settings).toEqual({ caption: '用户标题' })
      await expect(createApplicationRuntime({ ...f, blobs: undefined }).exportPromptResource({ resourceId: resource.id }))
        .rejects.toThrow('Blob Store is required to export Script attachments')
      artifact = exported as typeof artifact
      previousId = nextId
    }
  })

  it('imports package rules directly as Scripts and preserves their address across a package update', async () => {
    const f = await fixture()
    const { owner: _owner, createdAt: _created, updatedAt: _updated, ...artifact } = rule()
    const input: ImportExtensionPackageResourcesInput = { packageId: 'example.rules', packageVersion: '1.0.0',
      promptResources: [{ contribution: { id: 'preset', source: 'preset.json', resourceKind: 'preset', scriptMounts: [{ scriptId: 'native' }] },
        artifact: { format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset', rootNode: { id: 'example.rules.native-preset-root', kind: 'module', label: 'Preset' } } }],
      loomScripts: [{ contribution: { id: 'native', source: 'native.rule.md' }, source: '---\nid: native.rule\nname: Native\nregex: before\n---\nafter' }],
      agentTools: [], textExtractors: [], transformRules: [{ contribution: { id: 'replacement', source: 'rule.json' }, artifact }] }
    const first = await f.runtime.importExtensionPackageResources(input)
    expect((await f.documents.list({ type: 'airp.textTransformRule' })).items).toEqual([])
    const ruleId = first.transformRules[0]!.ruleId
    const initialMount = (await f.runtime.listLoomScriptMounts()).mounts[0]!
    expect(initialMount).toMatchObject({ enabled: true, adoptedDocumentVersion: 1, adoptedSettings: {}, runtimeRevision: 1 })
    expect(initialMount.origin).not.toHaveProperty('legacyRuleId')
    expect(initialMount.origin).not.toHaveProperty('legacyPresetInheritance')
    const initial = (await f.runtime.getTextTransformRule({ ruleId })).rule
    const presetMount = (await f.runtime.listLoomScriptMounts()).mounts.find(mount => mount.target.kind === 'preset')!
    const adopted = (await f.runtime.updateLoomScriptMount({ mountId: presetMount.id, expectedVersion: presetMount.version,
      enabled: true, orderIndex: presetMount.orderIndex, grantedCapabilities: [] })).mount
    const installation = (await f.runtime.listExtensionInstallations()).installations[0]!
    const updated = await f.runtime.importExtensionPackageResources({ ...input, packageVersion: '1.1.0', update: { expectedInstallationVersion: installation.version },
      transformRules: [{ ...input.transformRules[0]!, artifact: { ...artifact, effect: { kind: 'replace', replacement: 'updated' } } }] })
    const retained = (await f.runtime.listLoomScriptMounts()).mounts.find(mount => mount.id === adopted.id)!
    expect(retained).toMatchObject({ enabled: true, runtimeRevision: adopted.runtimeRevision,
      adoptedDocumentVersion: adopted.adoptedDocumentVersion, adoptedSettings: adopted.adoptedSettings, settings: adopted.settings })
    expect((await f.runtime.getLoomScript({ scriptDocumentId: retained.scriptDocumentId })).script.version).toBeGreaterThan(retained.adoptedDocumentVersion!)
    expect(updated.transformRules[0]!.ruleId).toBe(ruleId)
    const latest = (await f.runtime.getTextTransformRule({ ruleId })).rule
    expect(latest.scriptDocumentId).toBe(initial.scriptDocumentId)
    expect(latest.effect).toEqual({ kind: 'replace', replacement: 'updated' })
    await f.runtime.removeExtensionPackageResources({ packageId: input.packageId })
    expect((await f.runtime.listLoomScripts()).scripts).toEqual([])
    expect((await f.runtime.listLoomScriptMounts()).mounts).toEqual([])
  })

  it('projects incoming snapshots through the active preset without persisting them', async () => {
    const f = await fixture()
    const { resource } = await f.runtime.importPromptResource({ artifact: { format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset', rootNode: { id: 'live-root', kind: 'module', label: 'Live' } } })
    const { session } = await f.runtime.createAgentSession({ agentPresetId: resource.id })
    const owner = { kind: 'preset' as const, presetId: resource.id }
    const { script } = await f.runtime.importLoomScript({ owner, fileName: 'live.md', source: '---\nid: example.live\nname: Live\nregex: "x"\nstreaming: true\n---\ny' })
    const { mount } = await f.runtime.createLoomScriptMount({ target: owner, scriptDocumentId: script.id, orderIndex: 0 })
    await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, orderIndex: 0, enabled: true, grantedCapabilities: [] })
    const source = { kind: 'agent-session' as const, sessionId: session.id }
    for (const text of ['x', 'xx']) {
      const { snapshot } = await f.runtime.projectHistory({ source, phase: 'display', streamingEntries: [{ id: 'live', text, role: 'assistant' }] })
      expect(snapshot.entries.find(entry => entry.id === 'live')).toMatchObject({ originalText: text, text: text.replaceAll('x', 'y') })
    }
    const { script: personal } = await f.runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'personal.md', source: '---\nid: example.personal\nname: Personal\nregex: y\nstreaming: true\n---\nz' })
    const { mount: personalMount } = await f.runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: personal.id, orderIndex: -100 })
    await f.runtime.updateLoomScriptMount({ mountId: personalMount.id, expectedVersion: personalMount.version, orderIndex: -100, enabled: true, grantedCapabilities: [] })
    const live = () => f.runtime.projectHistory({ source, phase: 'display', streamingEntries: [{ id: 'live', text: 'x' }] })
    expect((await live()).snapshot.entries.find(entry => entry.id === 'live')!.text).toBe('z')
    await f.runtime.reorderLoomScripts({ groups: [{ owner: { kind: 'user' }, scriptIds: [personal.id], groupOrder: -1 }] })
    expect((await live()).snapshot.entries.find(entry => entry.id === 'live')!.text).toBe('y')
    expect((await f.runtime.projectHistory({ source, phase: 'display' })).snapshot.entries.some(entry => entry.id === 'live')).toBe(false)
    await expect(f.runtime.projectHistory({ source, phase: 'classify', streamingEntries: [{ id: 'live', text: 'x' }] })).rejects.toThrow('display-only')
  })

  it('exports locally created extension Markdown, ordering, and explicit deletions', async () => {
    const f = await fixture()
    const packageId = 'example.local-rules'
    const input: ImportExtensionPackageResourcesInput = { packageId, packageVersion: '1.0.0', promptResources: [], agentTools: [], textExtractors: [], transformRules: [] }
    const installed = await f.runtime.importExtensionPackageResources(input)
    const owner = { kind: 'extension' as const, packageId, installationId: installed.installationId }
    const source = '---\nid: local.rule\nname: Local\nregex: secret\n---\n```html\n<div>$&</div>\n```'
    const { script } = await f.runtime.importLoomScript({ owner, fileName: 'local.md', source })
    await f.runtime.reorderLoomScripts({ groups: [{ owner, scriptIds: [script.id], groupOrder: 7 }] })
    const manifest = { manifestVersion: 2, id: packageId, version: '1.0.0', displayName: 'Local', engines: { studio: '*' } }
    const archive = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) })
    const exported = await createExtensionScriptArchiveExporter(f)({ archive, packageId, version: '1.0.0', installationId: installed.installationId })
    const files = unzipSync(exported)
    const result = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    const contribution = result.contributes.loomScripts[0]
    expect(contribution).toMatchObject({ orderIndex: 0, groupOrder: 7 })
    expect(new TextDecoder().decode(files[contribution.source])).toBe(source)
    const second = await fixture()
    const next = await second.runtime.importExtensionPackageResources({ ...input, loomScripts: [{ contribution, source }] })
    const importedScript = (await second.runtime.listLoomScripts()).scripts[0]!
    expect(importedScript.source.mediaType).toBe('text/markdown')
    expect((await second.runtime.listLoomScriptMounts()).mounts[0]).toMatchObject({ orderIndex: 0, enabled: false, origin: { groupOrder: 7 } })
    await second.runtime.deleteLoomScript({ scriptDocumentId: importedScript.id, expectedVersion: importedScript.version })
    const deleted = await createExtensionScriptArchiveExporter(second)({ archive: exported, packageId, version: '1.0.0', installationId: next.installationId })
    expect(JSON.parse(new TextDecoder().decode(unzipSync(deleted)['manifest.json'])).contributes.loomScripts).toEqual([])
  })

  it('exports a legacy package rule as complete source after adding JS, settings and a second rule', async () => {
    const f = await fixture()
    const { owner: _owner, createdAt: _created, updatedAt: _updated, ...definition } = rule()
    const packageId = 'example.packaged-rules'
    const input: ImportExtensionPackageResourcesInput = { packageId, packageVersion: '1.0.0',
      promptResources: [{ contribution: { id: 'preset', resourceKind: 'preset', source: 'preset.json', textUses: [
        { kind: 'rule', enabled: true, reference: { kind: 'package', contributionId: 'replacement' } },
      ] }, artifact: { format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset', rootNode: { id: 'example.packaged-rules.root', kind: 'module', label: 'Preset' } } }],
      agentTools: [], textExtractors: [], transformRules: [{ contribution: { id: 'replacement', source: 'rule.json' }, artifact: definition }] }
    const imported = await f.runtime.importExtensionPackageResources(input)
    const script = (await f.runtime.listLoomScripts()).scripts[0]!
    const original = (await f.runtime.exportLoomScript({ scriptDocumentId: script.id })).artifact.source
    const source = serializeLoomScriptMetadata(parseLoomScriptSource(original)).replace('// @runtime declarative', '// @runtime client').replace('// ==/LoomScript==', [
      '// @setting {"key":"caption","label":"标题","type":"string","default":"default"}',
      `// @contribution ${JSON.stringify({ kind: 'text-transform', id: 'extra', rule: { ...definition, name: 'Extra', matcher: { kind: 'regex', pattern: 'second', flags: 'g' } } })}`,
      '// ==/LoomScript==',
    ].join('\n')) + '\n// Preserve this author comment.\nexport function activate() { globalThis.unexpectedScriptRun = true; }\n'
    await f.runtime.updateLoomScript({ scriptDocumentId: script.id, expectedVersion: script.version, fileName: 'edited.loom.js', source })
    const mount = (await f.runtime.listLoomScriptMounts()).mounts[0]!
    const refreshed = (await f.runtime.refreshLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version })).mount
    await f.runtime.updateLoomScriptMount({ mountId: refreshed.id, expectedVersion: refreshed.version, enabled: refreshed.enabled,
      orderIndex: refreshed.orderIndex, grantedCapabilities: [], settings: { caption: 'saved value' } })
    const archive = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({ manifestVersion: 2, id: packageId, version: '1.0.0', displayName: 'Rules', engines: { studio: '*' },
        contributes: { transformRules: [{ id: 'replacement', source: 'rule.json' }], promptResources: [input.promptResources[0]!.contribution] } })),
      'rule.json': new TextEncoder().encode(JSON.stringify(definition)),
      'preset.json': new TextEncoder().encode(JSON.stringify(input.promptResources[0]!.artifact)),
    })
    const exporter = createExtensionScriptArchiveExporter(f)
    const exported = await exporter({ archive, packageId, version: '1.0.0', installationId: imported.installationId })
    const wrapped = JSON.parse(new TextDecoder().decode(unzipSync(exported)['rule.json']))
    expect(wrapped).toMatchObject({ format: 'loom.script', primaryContributionId: 'rule', fileName: 'edited.loom.js', source, settings: { caption: 'saved value' } })
    const second = await fixture()
    const reimported = await second.runtime.importExtensionPackageResources({ ...input, transformRules: [{ contribution: input.transformRules[0]!.contribution, artifact: wrapped }] })
    const nextScript = (await second.runtime.listLoomScripts()).scripts[0]!
    expect((await second.runtime.exportLoomScript({ scriptDocumentId: nextScript.id })).artifact.source).toBe(source)
    expect((await second.runtime.listLoomScriptMounts()).mounts[0]).toMatchObject({ grantedCapabilities: [], settings: { caption: 'saved value' } })
    const { session } = await second.runtime.createAgentSession({ agentPresetId: reimported.promptResources[0]!.resourceId })
    const effective = await resolveEffectiveTextPipeline(second, { kind: 'agent-session', sessionId: session.id }, 'display')
    expect(effective.rules.map(item => item.origin?.contributionId).sort()).toEqual(['replacement', 'replacement/extra'])
    expect(effective.rules.find(item => item.contributionId === 'rule')?.id).toBe(reimported.transformRules[0]!.ruleId)
    const installation = (await second.runtime.listExtensionInstallations()).installations[0]!
    await second.runtime.uninstallExtensionInstallation({ packageId, expectedInstallationVersion: installation.version })
    expect((await second.runtime.listLoomScripts()).scripts).toHaveLength(1)
    expect((await resolveEffectiveTextPipeline(second, { kind: 'agent-session', sessionId: session.id }, 'display')).rules).toEqual([])
  })
})
