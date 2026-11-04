import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime, createOfficialAgentToolRegistry, type ApplicationRuntimeOptions } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import type { ChatAttachment, ChatMessage } from '@loom-studio/shared'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

async function fixture(attachment: ChatAttachment, invokeChat: NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat'], content = '', codeAct = false) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-11-02T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  onTestFinished(() => engine.close())
  const read = vi.fn(async () => new TextEncoder().encode(content))
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
    agents: createAgentStore({ engine, createId, now }),
    narratives: createNarrativeStore({ engine, createId, now }),
    promptResources: createPromptResourceStore({ engine, createId, now }),
    agentTools: createOfficialAgentToolRegistry(),
    mediaAssets: { get: async id => id === attachment.assetId ? { id, kind: 'session-attachment', mediaType: attachment.mediaType, sizeBytes: attachment.sizeBytes } : undefined, read },
    gateway: { invokeChat },
  })
  await runtime.initialize()
  const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Attachment reader' })
  if (codeAct) await runtime.replacePresetToolMounts({ expectedMountIds: (await runtime.listPresetToolMounts({ presetId: preset.id })).mounts.map(mount => mount.id), presetId: preset.id, mounts: [{ toolId: 'official/codeact_json', defaultEnabled: true, orderIndex: 0 }] })
  const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test'] })
  const { agentPreset } = await runtime.updateAgentPreset({ name: 'Reader', agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: 'test' } })
  const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id })
  return { runtime, session, read }
}

const done = () => ({ provider: 'test', model: 'test', text: 'DONE', finishReason: 'stop' as const, message: { role: 'assistant' as const, content: 'DONE' } })

describe('attachment references through ordinary Prompt Build', () => {
  it('preserves an image reference through current input, persistence and next-turn history', async () => {
    const attachment: ChatAttachment = { assetId: 'picture-1', name: 'picture.png', kind: 'image', mediaType: 'image/png', sizeBytes: 12 }
    const requests: ChatMessage[][] = []
    const f = await fixture(attachment, async ({ request }) => { requests.push(structuredClone(request.messages)); return done() })
    await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Describe this picture', attachments: [attachment] })
    expect(requests[0]).toContainEqual(expect.objectContaining({ role: 'user', attachments: [attachment] }))
    const page = await f.runtime.getAgentTranscriptPage({ agentSessionId: f.session.id })
    expect(page.entries.map(item => item.entry)).toContainEqual(expect.objectContaining({ kind: 'message', role: 'user', content: 'Describe this picture', attachments: [attachment] }))
    await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Compare with the earlier picture' })
    expect(requests[1]).toContainEqual(expect.objectContaining({ role: 'user', attachments: [attachment] }))
    expect(requests[1]!.filter(message => message.role === 'user' && message.attachments?.length)).toHaveLength(1)
  })

  it('initially sends only a Markdown manifest and reads a range through the real CodeAct tool loop', async () => {
    const source = '# SECRET_FULL_DOCUMENT\nREQUESTED_LINE\nUNREQUESTED_TAIL'
    const attachment: ChatAttachment = { assetId: 'notes-1', name: 'notes.md', kind: 'text', mediaType: 'text/markdown', sizeBytes: new TextEncoder().encode(source).byteLength }
    const requests: ChatMessage[][] = []
    const f = await fixture(attachment, async ({ request }) => {
      requests.push(structuredClone(request.messages))
      if (requests.length > 1) return done()
      return { provider: 'test', model: 'test', text: '', finishReason: 'tool_call', message: { role: 'assistant', tool_calls: [{ id: 'read-notes', type: 'function', function: { name: 'codeact_json', arguments: JSON.stringify({ code: 'print(await ctx.read("/session-files/notes-1", {startLine:2,endLine:2}));' }) } }] } }
    }, source, true)
    await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Read line two', attachments: [attachment] })
    expect(JSON.stringify(requests[0])).toContain('/session-files/notes-1')
    expect(JSON.stringify(requests[0])).not.toContain('SECRET_FULL_DOCUMENT')
    expect(JSON.stringify(requests[0])).not.toContain('REQUESTED_LINE')
    expect(f.read).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toContainEqual(expect.objectContaining({ role: 'tool', content: expect.stringContaining('REQUESTED_LINE') }))
    expect(JSON.stringify(requests[1])).not.toContain('UNREQUESTED_TAIL')
  })
})
