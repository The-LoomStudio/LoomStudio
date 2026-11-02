import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createApplicationRuntime, projectHistoryEntries } from '../../packages/application-runtime/src/index.js'
import { createBlobStore } from '../../packages/asset-store/src/index.js'
import { createSqliteDataEngine } from '../../packages/data-engine/src/index.js'
import { createSqliteDocumentStore } from '../../packages/document-store/src/index.js'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '../../packages/application-data/src/index.js'
import { parseLoomScriptSource } from '../../packages/shared/src/loom-script-metadata.js'
import { resolveEffectiveTextPipeline } from '../../packages/application-runtime/src/runtime/transforms-runtime.js'
import type { RegexLabRequest, RegexLabState, RegexLabProjection } from '../../apps/studio-client/src/dev-preview/regex-lab-contract.js'

/** Native stores and runtime in a separate SQLite database. Only provider output is a fixture. */
export async function createRegexPreviewRuntime(directory: string) {
  await mkdir(directory, { recursive: true })
  const createId = (prefix: string) => `${prefix}-${randomUUID()}`
  const now = () => new Date().toISOString()
  const dataEngine = createSqliteDataEngine({ filename: join(directory, 'studio.sqlite'), createId, now })
  const documents = createSqliteDocumentStore({ engine: dataEngine })
  const context = { dataEngine, documents, createId, now,
    agents: createAgentStore({ engine: dataEngine, createId, now }),
    narratives: createNarrativeStore({ engine: dataEngine, createId, now }),
    promptResources: createPromptResourceStore({ engine: dataEngine, createId, now }),
    blobs: createBlobStore({ engine: dataEngine, rootDirectory: join(directory, 'blobs'), createId, now }),
  }
  let providerOutput: string | undefined
  const runtime = createApplicationRuntime({ ...context, gateway: { invokeChat: async () => {
    if (providerOutput === undefined) throw new Error('Preview provider has no queued output')
    const content = providerOutput
    providerOutput = undefined
    return { provider: 'regex-preview', model: 'fixture', text: content, message: { role: 'assistant', content } }
  } } })
  await runtime.initialize()
  let index = await documents.get('dev.regex-lab')
  if (!index) {
    const { resource } = await runtime.createPromptResource({ resourceKind: 'preset', name: '正则实验 · 隔离预设' })
    const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: '本地样例输出（不联网）', config: {}, enabledModelIds: ['fixture'] })
    await runtime.updateAgentPreset({ agentPresetId: resource.id, expectedVersion: resource.version, model: { providerProfileId: providerProfile.id, modelId: 'fixture' } })
    const { session } = await runtime.createAgentSession({ agentPresetId: resource.id })
    await documents.write({ id: 'dev.regex-lab', type: 'dev.regexLab', expectedVersion: 'new', content: { presetId: resource.id, sessionId: session.id, caseId: 'finish' } })
    index = await documents.get('dev.regex-lab')
  }
  const stored = index!.content as { presetId: string; sessionId: string; caseId: string }
  const owner = { kind: 'preset' as const, presetId: stored.presetId }
  const source = { kind: 'agent-session' as const, sessionId: stored.sessionId }
  async function state(): Promise<RegexLabState> {
    const [scripts, mounts, page, display, prompt] = await Promise.all([
      runtime.listLoomScripts({ owner }), runtime.listLoomScriptMounts({ target: owner }),
      runtime.getAgentTranscriptPage({ agentSessionId: stored.sessionId, limit: 50 }),
      runtime.projectHistory({ source, phase: 'display' }), runtime.projectHistory({ source, phase: 'prompt' }),
    ])
    const latest = [...page.entries].reverse().find(item => item.entry.kind === 'message' && item.entry.role === 'assistant')
    return { caseId: stored.caseId, sessionId: stored.sessionId,
      rules: await Promise.all(scripts.scripts.map(async script => { const mount = mounts.mounts.find(item => item.scriptDocumentId === script.id); return {
        id: script.id, source: (await runtime.exportLoomScript({ scriptDocumentId: script.id })).artifact.source,
        enabled: mount?.enabled ?? false, order: mount?.orderIndex ?? 0,
      } })),
      history: page.entries.filter(item => item.entry.kind === 'message' || item.entry.kind === 'reasoning').map(item => ({
        id: item.id, kind: item.entry.kind === 'message' ? item.entry.role : item.entry.kind,
        text: 'content' in item.entry && typeof item.entry.content === 'string' ? item.entry.content : '',
      })),
      storedDisplay: display.snapshot.entries.find(item => item.id === latest?.id)?.text,
      storedPrompt: prompt.snapshot.entries.find(item => item.id === latest?.id)?.text,
    }
  }
  async function handle(request: RegexLabRequest): Promise<RegexLabState | RegexLabProjection | Awaited<ReturnType<typeof runtime.previewLoomScript>>> {
    if (request.action === 'state') return state()
    if (request.action === 'preview') return runtime.previewLoomScript(request)
    if (request.action === 'install') {
      // Validate all source before making changes. Never enable executable scripts in this lab.
      const metadata = request.sources.map(parseLoomScriptSource)
      if (new Set(metadata.map(item => item.metadataId)).size !== metadata.length) throw new Error('示例中的规则 ID 不能重复')
      if (metadata.some(item => item.runtime !== 'declarative')) throw new Error('实验只接受声明式 MD 规则')
      const previous = (await runtime.listLoomScriptMounts({ target: owner })).mounts
      for (const mount of previous) if (mount.enabled) await runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: false, orderIndex: mount.orderIndex, grantedCapabilities: [] })
      const scripts = (await runtime.listLoomScripts({ owner })).scripts
      for (const [orderIndex, code] of request.sources.entries()) {
        const old = scripts.find(item => item.metadataId === metadata[orderIndex]!.metadataId)
        const { script } = old
          ? await runtime.updateLoomScript({ scriptDocumentId: old.id, expectedVersion: old.version, fileName: 'example.md', source: code })
          : await runtime.importLoomScript({ owner, fileName: 'example.md', source: code })
        let mount = (await runtime.listLoomScriptMounts({ target: owner, scriptDocumentId: script.id })).mounts[0]
        if (!mount) mount = (await runtime.createLoomScriptMount({ target: owner, scriptDocumentId: script.id, orderIndex })).mount
        await runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex, grantedCapabilities: [] })
      }
      stored.caseId = request.caseId
      await documents.write({ id: index!.id, type: index!.type, expectedVersion: index!.version, content: stored })
      index = await documents.get('dev.regex-lab')
      return state()
    }
    if (request.action === 'commit') {
      providerOutput = request.text
      try { await runtime.invokeAgentTurn({ agentSessionId: stored.sessionId, input: '提交这一份测试输出；仅使用本地样例 Provider。' }) }
      finally { providerOutput = undefined }
      return state()
    }
    const effective = await resolveEffectiveTextPipeline(context, source, 'display')
    const snapshot = request.streaming
      ? (await runtime.projectHistory({ source, phase: 'display', entryIds: ['preview.live'], streamingEntries: [{ id: 'preview.live', text: request.text, role: 'assistant' }] })).snapshot
      : projectHistoryEntries({ source, phase: 'display', preserveRuleOrder: true, rules: effective.rules,
        entries: [{ id: 'preview.live', sequence: 1, source, text: request.text, role: 'assistant' }] })
    return { text: snapshot.entries[0]?.text ?? request.text, matches: snapshot.matches.length, rules: snapshot.ruleIds,
      diagnostics: [...effective.diagnostics, ...snapshot.diagnostics].map(item => item.message) }
  }
  return { handle, close: () => dataEngine.close() }
}
