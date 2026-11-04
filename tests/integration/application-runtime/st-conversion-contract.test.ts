import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createId, nowIso, createVariableRenderContext } from '@loom-studio/shared'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createBlobStore } from '@loom-studio/asset-store'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { convertSillyTavernPreset } from '../../../extensions/st-data-compat/src/normalizer/preset.js'
import { convertSillyTavernLorebook } from '../../../extensions/st-data-compat/src/normalizer/lorebook.js'
import { readPromptResourceInputs } from '../../../packages/application-runtime/src/cards/card-bundle.js'
import { compilePromptDataModel } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import { projectHistoryEntries } from '../../../packages/application-runtime/src/transforms/history-text.js'
import type { PromptResourceNode } from '@loom-studio/application-runtime'

function flatten(node: PromptResourceNode): PromptResourceNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)]
}

describe('ST conversion against current native contracts', () => {
  it.each([false, true])('retains inline order and roles with enabled markers=%s and no duplicate fallback anchors', async markersEnabled => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    try {
      const store = createPromptResourceStore({ engine })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents: createSqliteDocumentStore({ engine }), promptResources: store })
      const converted = convertSillyTavernPreset({ prompts: [
        { identifier: 'a', role: 'system', content: 'FIRST' },
        { identifier: 'worldInfoBefore', marker: true, enabled: markersEnabled },
        { identifier: 'b', role: 'assistant', content: 'SECOND' },
        { identifier: 'chatHistory', marker: true, enabled: false },
        { identifier: 'worldInfoAfter', marker: true, enabled: markersEnabled },
        { identifier: 'c', role: 'user', content: 'THIRD' },
      ] })
      const all = flatten(converted.artifact.rootNode)
      expect(converted.artifact.schemaVersion).toBe(2)
      expect(all.filter(node => node.kind === 'entry').every(node => !node.capabilities?.targetAnchorId)).toBe(true)
      expect(all.filter(node => node.capabilities?.targetAnchorId === '@lore.lower')).toHaveLength(1)
      expect(all.find(node => node.capabilities?.targetAnchorId === '@chat.session')?.enabled).toBe(false)
      const preset = (await runtime.importPromptResource({ artifact: converted.artifact })).resource
      const loreArtifact = convertSillyTavernLorebook({ entries: [
        { uid: 1, constant: true, content: 'STABLE' },
        { uid: 2, keys: ['trigger'], content: 'DYNAMIC' },
      ] }).artifact
      const lore = (await runtime.importPromptResource({ artifact: loreArtifact })).resource
      const data = await readPromptResourceInputs({ promptResources: store, resourceIds: [preset.id, lore.id], variables: createVariableRenderContext() })
      data.contributions.push({ id: 'history', sourceRef: { kind: 'sessionHistory', sourceId: 'session', sourceNodeId: 'history' },
        content: 'HIDDEN-HISTORY', capabilities: { targetAnchorId: '@chat.session' } })
      const result = compilePromptDataModel({ ...data, currentInput: 'trigger', skeletonRootId: preset.rootNode.id })
      expect(result.messages.map(({ role, content }) => ({ role, content }))).toEqual([
        { role: 'system', content: markersEnabled ? 'FIRST\n\nSTABLE' : 'FIRST' },
        { role: 'assistant', content: 'SECOND' },
        ...(markersEnabled ? [{ role: 'system', content: 'DYNAMIC' }] : []),
        { role: 'user', content: 'THIRD' },
      ])
      expect(JSON.stringify((await runtime.exportPromptResource({ resourceId: preset.id })).artifact)).not.toContain('localDepth')
    } finally { await engine.close() }
  })

  it('imports legacy regex payloads into rule.md and retains literal capture cleanup, phases and disabled adoption', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-st-contract-'))
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    try {
      const runtime = createApplicationRuntime({ dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
        promptResources: createPromptResourceStore({ engine }), blobs: createBlobStore({ engine, rootDirectory: directory, createId, now: nowIso }) })
      const artifact = convertSillyTavernPreset({ prompts: [{ identifier: 'main', content: 'System' }], extensions: { regex_scripts: [
        { scriptName: 'Clean capture', findRegex: '/AA(.*?)AA/g', replaceString: '[$1]', trimStrings: ['#'], promptOnly: true, markdownOnly: true },
        { scriptName: 'Disabled', findRegex: '/x/g', replaceString: '', disabled: true },
      ] } }).artifact
      const resource = (await runtime.importPromptResource({ artifact })).resource
      const rules = (await runtime.listTextTransformRules({ owner: { kind: 'preset', presetId: resource.id } })).rules
      const rule = rules.find(rule => rule.name === 'Clean capture')!
      expect(rule).toMatchObject({ enabled: true, captureRemove: ['#'], phases: ['prompt', 'display'] })
      expect(rules.find(rule => rule.name === 'Disabled')?.enabled).toBe(false)
      const source = { kind: 'agent-session' as const, sessionId: 'session' }
      for (const phase of ['prompt', 'display'] as const) {
        expect(projectHistoryEntries({ source, phase, entries: [{ id: 'entry', source, sequence: 0, text: 'AA#value#AA' }], rules: [rule] }).entries[0]?.text).toBe('[value]')
      }
      const exported = (await runtime.exportPromptResource({ resourceId: resource.id })).artifact
      expect(exported.scriptAttachments).toHaveLength(2)
      expect(exported.scriptAttachments?.every(item => item.script.fileName.endsWith('.rule.md'))).toBe(true)
      expect(exported.scriptAttachments?.some(item => item.script.source.includes('capture_remove:'))).toBe(true)
    } finally { await engine.close(); await rm(directory, { recursive: true, force: true }) }
  })
})
