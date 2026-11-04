import { describe, expect, it } from 'vitest'
import { createAgentStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createOpenAICompatibleGateway } from '@loom-studio/application-runtime'
import type { ChatAttachment } from '@loom-studio/shared'
import { projectSessionHistory } from '../../../packages/application-runtime/src/agents/session-history.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII='
const attachment: ChatAttachment = { assetId: 'image-1', kind: 'image', name: 'image.png', mediaType: 'image/png', sizeBytes: Buffer.from(png, 'base64').length }

describe('persisted Session attachment transport', () => {
  it('replays an image-only persistent message and resolves bytes only at transport', async () => {
    let id = 0
    const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${++id}`, now: () => new Date().toISOString() })
    try {
      const store = createAgentStore({ engine })
      const actor = { kind: 'client' as const, id: 'client' }
      const { session } = await store.createSession({ actor, agentPresetId: 'preset' })
      await store.appendEntries({ actor, agentSessionId: session.id, expectedEntryCount: 0,
        entries: [{ entry: { kind: 'message', role: 'user', content: '', attachments: [attachment] } }] })
      const restored = await store.getEntryPage({ agentSessionId: session.id })
      expect(JSON.stringify(restored)).not.toContain(png)
      const messages = projectSessionHistory(restored.entries, new Map([[restored.entries[0]!.id, '']])).flatMap(block => block.messages)
      expect(messages).toEqual([{ role: 'user', content: '', attachments: [attachment] }])
      const requests: Record<string, unknown>[] = []
      const gateway = createOpenAICompatibleGateway({
        apiKey: 'test', modelId: 'vision',
        providerProfile: { id: 'test-provider', providerExtensionId: 'official.openai-compatible', displayName: 'test', config: {}, enabledModelIds: ['vision'] },
        mediaAssets: {
          get: async () => ({ id: attachment.assetId, kind: 'session-attachment', mediaType: attachment.mediaType, sizeBytes: attachment.sizeBytes }),
          read: async () => Buffer.from(png, 'base64'),
        },
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)))
          return new Response(JSON.stringify({ id: 'response', model: 'vision', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'image response' } }] }), { headers: { 'content-type': 'application/json' } })
        },
      })
      await gateway.invokeChat({ request: { messages }, sessionId: session.id, runId: 'run', branchId: 'agent-only' })
      expect(requests[0]?.messages).toEqual([{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] }])
      expect(JSON.stringify(messages)).not.toContain(png)
    } finally { engine.close() }
  })

  it('fails on missing attachment storage instead of sending a text-only request', async () => {
    let called = false
    const gateway = createOpenAICompatibleGateway({ apiKey: 'test', modelId: 'vision',
      providerProfile: { id: 'test-provider', providerExtensionId: 'official.openai-compatible', displayName: 'test', config: {}, enabledModelIds: ['vision'] },
      fetch: async () => { called = true; throw new Error('must not send') },
    })
    await expect(gateway.invokeChat({ request: { messages: [{ role: 'user', content: 'look', attachments: [attachment] }] },
      sessionId: 'session', runId: 'run', branchId: 'agent-only' })).rejects.toThrow('attachment storage is unavailable')
    expect(called).toBe(false)
  })
})
