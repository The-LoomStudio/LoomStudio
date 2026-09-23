import { officialFakeModelId } from '@loom-studio/ai-gateway'
import type { AgentToolEntry } from '@loom-studio/application-runtime'
import { createMemorySecretBackend } from '@loom-studio/secret-store'
import type { StudioEvent } from '@loom-studio/transport'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { callRpc, createApplicationSession } from './helpers.js'

const captured = vi.hoisted(() => ({ events: [] as StudioEvent[] }))
vi.mock('@loom-studio/kernel', async importOriginal => {
  const original = await importOriginal<typeof import('@loom-studio/kernel')>()
  return {
    ...original,
    createKernel: (...args: Parameters<typeof original.createKernel>) => {
      const kernel = original.createKernel(...args)
      kernel.getEventBus().subscribe(['data.changed', 'docs.changed'], event => captured.events.push(event))
      return kernel
    },
  }
})

describe('Application mutation request context', () => {
  it('carries HTTP actor and call metadata through profile/tool writes, credentials and compensation', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-mutation-context-')))
    const localPaths = resolveLoomStudioLocalPaths({ home: root, environment: {} })
    const server = createStudioServer({ localPaths, secretBackend: createMemorySecretBackend() })
    let database: DatabaseSync | undefined
    try {
      const { port } = await server.listen(0)
      database = new DatabaseSync(localPaths.databaseFile)
      const cookie = await createApplicationSession(port)
      captured.events = []
      let sequence = 0

      async function checked<T>(method: string, params: unknown, reasons = [method], failure = false): Promise<T> {
        const correlationId = `mutation-context-${++sequence}`
        const parentCallId = `parent-${sequence}`
        const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: sequence, method, params, meta: { correlationId, parentCallId } }),
        })
        const payload = await response.json() as {
          result: T
          error?: { message: string }
          meta: { clientId: string; correlationId: string; callId: string }
        }
        if (failure) expect(payload.error?.message).toContain('injected document failure')
        else expect(payload.error).toBeUndefined()
        expect(payload.meta).toMatchObject({ correlationId, clientId: expect.any(String), callId: expect.any(String) })
        const rows = database!.prepare('SELECT * FROM changesets WHERE correlation_id = ? ORDER BY rowid').all(correlationId)
        expect(rows.map(row => row.reason)).toEqual(reasons)
        for (const row of rows) {
          expect(JSON.parse(String(row.created_by_json))).toEqual({ kind: 'client', id: payload.meta.clientId })
          expect(row.call_id).toBe(payload.meta.callId)
          expect(row.parent_call_id).toBe(parentCallId)
          const event = captured.events.find(item => item.name === 'data.changed' && item.payload && (item.payload as { changesetId: string }).changesetId === row.id)
          expect(event?.meta).toMatchObject({
            clientId: payload.meta.clientId, correlationId, callId: payload.meta.callId, parentCallId,
          })
          const operations = JSON.parse(String(row.operations_json)) as { store: string; entityId: string }[]
          if (operations.some(operation => operation.store === 'documents')) {
            expect(captured.events.find(item => item.name === 'docs.changed' && (item.payload as { changesetId: string }).changesetId === row.id)?.meta)
              .toMatchObject({ clientId: payload.meta.clientId, correlationId, callId: payload.meta.callId, parentCallId })
          }
        }
        return payload.result
      }

      const provider = await checked<{ providerProfile: { id: string } }>('application.createProviderProfile', {
        providerExtensionId: 'official.fake', displayName: 'Context Provider', enabledModelIds: [officialFakeModelId],
      })
      const providerProfileId = provider.providerProfile.id
      await checked('application.updateProviderProfile', { providerProfileId, displayName: 'Updated Provider' })
      const capability = await checked<{ profile: { id: string } }>('application.createAiCapabilityProfile', {
        providerProfileId, capabilityId: 'chat.completions', displayName: 'Context Capability',
      })
      await checked('application.updateAiCapabilityProfile', { profileId: capability.profile.id, displayName: 'Updated Capability' })
      await checked('application.deleteAiCapabilityProfile', { profileId: capability.profile.id })

      const preset = await callRpc<{ resource: { id: string } }>(port, 'application.createPromptResource', {
        resourceKind: 'preset', name: 'Context Preset',
      })
      const profile = await checked<{ agentProfile: { id: string } }>('application.createAgentProfile', {
        name: 'Context Agent', presetId: preset.resource.id, model: { providerProfileId, modelId: officialFakeModelId },
      })
      await checked('application.updateAgentProfile', { agentProfileId: profile.agentProfile.id, name: 'Updated Agent' })
      await checked('application.deleteAgentProfile', { agentProfileId: profile.agentProfile.id })
      const { tools } = await callRpc<{ tools: AgentToolEntry[] }>(port, 'application.listAgentTools', {})
      expect(tools.length).toBeGreaterThan(0)
      const tool = tools[0]!
      await checked('application.updateAgentTool', { toolId: tool.id, expectedVersion: tool.version, definition: tool })
      await checked('application.deleteProviderProfile', { providerProfileId })

      const credentialProvider = await checked<{ providerProfile: { id: string } }>('application.createProviderProfile', {
        providerExtensionId: 'official.openai-compatible', displayName: 'Credentials', config: { baseUrl: 'https://example.test/v1' },
      })
      const credentialId = credentialProvider.providerProfile.id
      await checked('application.replaceProviderCredential', { providerProfileId: credentialId, credential: { apiKey: 'test-only-key' } }, [
        'application.replaceProviderCredential', 'application.replaceProviderCredential', 'application.replaceProviderCredential',
      ])
      await checked('application.replaceProviderCredential', { providerProfileId: credentialId, credential: { apiKey: 'replacement-test-key' } }, [
        'application.replaceProviderCredential', 'application.replaceProviderCredential', 'application.replaceProviderCredential',
      ])
      await checked('application.deleteProviderProfile', { providerProfileId: credentialId }, [
        'application.deleteProviderProfile', 'application.deleteProviderProfile.credential', 'application.deleteProviderProfile.credential',
      ])

      await checked('application.createProviderProfile', {
        providerExtensionId: 'official.openai-compatible', displayName: 'With credential',
        config: { baseUrl: 'https://example.test/v1' }, credential: { apiKey: 'creation-test-key' },
      }, ['application.createProviderProfile.credential', 'application.createProviderProfile.credential', 'application.createProviderProfile'])
      database.exec(`
        CREATE TRIGGER reject_context_provider BEFORE INSERT ON documents
        WHEN json_extract(NEW.content_json, '$.displayName') = 'Reject create'
        BEGIN SELECT RAISE(ABORT, 'injected document failure'); END;
      `)
      await checked('application.createProviderProfile', {
        providerExtensionId: 'official.openai-compatible', displayName: 'Reject create',
        config: { baseUrl: 'https://example.test/v1' }, credential: { apiKey: 'rollback-test-key' },
      }, [
        'application.createProviderProfile.credential', 'application.createProviderProfile.credential',
        'application.createProviderProfile.rollback', 'application.createProviderProfile.rollback',
      ], true)
    } finally {
      database?.close()
      await server.close()
      await rm(root, { recursive: true, force: true })
      captured.events = []
    }
  })
})
