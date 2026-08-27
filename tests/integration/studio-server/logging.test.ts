import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { callRpc } from './helpers.js'

describe('Studio Server logging', () => {
  it('emits structured lifecycle records through an injected logger', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-server-logging-'))
    const memory = createMemoryLogSink({ capacity: 10 })
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'integration-test',
      sinks: [memory],
    })
    const server = createStudioServer({
      sqlitePath: join(directory, 'store.sqlite'),
      logger: root.child('system'),
      logs: memory,
      rpcLogger: root.child('transport.rpc'),
    })

    try {
      const { port } = await server.listen(0)
      await callRpc(port, 'system.ping', { echo: 'logging-test' })
      const page = await callRpc<{
        items: Array<{ event?: string; namespace: string }>
        cursor: string
        hasMore: boolean
      }>(port, 'logs.list', { limit: 10, namespacePrefix: 'system' })

      expect(page.items.map(record => record.event)).toEqual(['server.starting', 'server.started'])
      expect(page.items.every(record => record.namespace === 'system')).toBe(true)
      expect(page.cursor).toMatch(/^memory:/)
      expect(page.hasMore).toBe(false)
      await expect(callRpc(port, 'logs.list', { limit: 0 })).rejects.toThrow('integer between 1 and 500')
    } finally {
      await server.close()
      await root.close()
      await rm(directory, { recursive: true, force: true })
    }

    expect(memory.list().map(record => record.event)).toEqual([
      'server.starting',
      'server.started',
      'rpc.completed',
      'rpc.failed',
      'server.stopping',
      'server.stopped',
    ])
    expect(memory.list().map(record => record.namespace)).toEqual([
      'system',
      'system',
      'transport.rpc',
      'transport.rpc',
      'system',
      'system',
    ])
    expect(memory.list()[2]?.message).toMatch(/^system\.ping completed in \d+(?:\.\d+)? ms$/)
    expect(memory.list()[3]?.message).toMatch(/^logs\.list failed after \d+(?:\.\d+)? ms$/)
  })

  it('logs committed and failed resource mutations without resource content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-server-document-logging-'))
    const memory = createMemoryLogSink({ capacity: 20 })
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'document-integration-test',
      sinks: [memory],
    })
    const server = createStudioServer({
      sqlitePath: join(directory, 'store.sqlite'),
      logs: memory,
      documentLogger: root.child('document.store'),
    })

    try {
      const { port } = await server.listen(0)
      await callRpc(port, 'application.createCard', {
        name: 'Private card name',
        description: 'Private card description',
        preset: { system: 'Private preset content' },
      })
      await expect(callRpc(port, 'application.updateCard', {
        cardId: 'missing-card',
        description: 'Still private',
      })).rejects.toThrow('Document not found')

      const page = await callRpc<{
        items: Array<{
          event?: string
          data?: {
            reason?: string
            operations?: Array<{ kind: string; type: string }>
          }
        }>
      }>(port, 'logs.list', { limit: 10, namespacePrefix: 'document.store' })

      const operationItems = page.items.filter(record => record.data?.reason !== 'application.initializePromptResources')
      expect(operationItems.map(record => record.event)).toEqual([
        'document.changeset.committed',
        'document.operation.failed',
      ])
      expect(operationItems[0]?.data).toMatchObject({
        reason: 'application.createCard',
        operations: [{ kind: 'create', type: 'airp.cardSource' }],
      })
      expect(JSON.stringify(page.items)).not.toContain('Private')
    } finally {
      await server.close()
      await root.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps Card bundle import working with document logging enabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-server-card-logging-'))
    const memory = createMemoryLogSink({ capacity: 20 })
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'card-document-integration-test',
      sinks: [memory],
    })
    const server = createStudioServer({
      sqlitePath: join(directory, 'store.sqlite'),
      logs: memory,
      documentLogger: root.child('document.store'),
    })

    try {
      const { port } = await server.listen(0)
      const artifact = JSON.parse(await readFile(join(process.cwd(), 'packages/application-runtime/fixtures/workspaces/loom-city-v0.json'), 'utf8'))
      const imported = await callRpc<{
        card: { id: string; promptResourceIds: string[] }
        importBundle: { id: string }
      }>(port, 'application.importCardBundle', { artifact })

      expect(imported.card.promptResourceIds.length).toBeGreaterThan(0)
      expect(imported.importBundle.id).toEqual(expect.any(String))
    } finally {
      await server.close()
      await root.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('logs PromptBuild lifecycle summaries without prompt content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-server-prompt-logging-'))
    const memory = createMemoryLogSink({ capacity: 20 })
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'prompt-integration-test',
      sinks: [memory],
    })
    const server = createStudioServer({
      sqlitePath: join(directory, 'store.sqlite'),
      logs: memory,
      documentLogger: root.child('document.store'),
      promptBuildLogger: root.child('prompt.build'),
      providerLogger: root.child('runtime.provider'),
    })

    try {
      const { port } = await server.listen(0)
      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', {
        name: 'Private Prompt Card',
        description: 'Private Prompt Description',
      })
      const timeline = await callRpc<{
        timeline: { id: string }
      }>(port, 'application.createNarrativeTimeline', { cardId: card.card.id })
      const presets = await callRpc<{ resources: Array<{ id: string }> }>(port, 'application.listPromptResources', { resourceKind: 'preset' })
      const presetId = presets.resources[0]!.id
      const provider = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake',
        displayName: 'Private Provider',
        config: { baseUrl: 'https://example.test/v1' },
        enabledModelIds: ['test-model'],
      })
      const agentProfile = await callRpc<{ agentProfile: { id: string } }>(port, 'application.createAgentProfile', {
        name: 'Private Agent Profile',
        presetId,
        model: { providerProfileId: provider.providerProfile.id, modelId: 'test-model' },
      })
      const created = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
        agentProfileId: agentProfile.agentProfile.id,
      })

      await callRpc(port, 'application.previewAgentTurn', {
        agentSessionId: created.session.id,
        input: 'Private user prompt',
        narrativeTarget: { timelineId: timeline.timeline.id, commit: false },
      })
      const turn = await callRpc<{ runId: string }>(port, 'application.invokeAgentTurn', {
        agentSessionId: created.session.id,
        input: 'Private runtime prompt',
        narrativeTarget: { timelineId: timeline.timeline.id, commit: true },
      })
      const page = await callRpc<{
        items: Array<{
          event?: string
          message: string
          correlationId?: string
          data?: {
            buildId?: string
            mode?: string
            runId?: string
            messageCount?: number
            durationMs?: number
          }
        }>
      }>(port, 'logs.list', { limit: 10, namespacePrefix: 'prompt.build' })

      expect(page.items.map(record => record.event)).toEqual([
        'prompt.build.started',
        'prompt.build.completed',
        'prompt.build.started',
        'prompt.build.completed',
      ])
      expect(page.items[0]?.message).toBe('preview prompt build started')
      expect(page.items[1]?.message).toMatch(/^preview prompt build completed · 2 messages · \d+(?:\.\d+)? ms$/)
      expect(page.items[2]?.message).toBe('runtime prompt build started')
      expect(page.items[3]?.message).toMatch(/^runtime prompt build completed · 2 messages · \d+(?:\.\d+)? ms$/)
      expect(page.items[1]?.data).toMatchObject({ mode: 'preview', messageCount: 2 })
      expect(page.items[0]?.data?.buildId).toBe(page.items[1]?.data?.buildId)
      expect(page.items[0]?.correlationId).toBe(page.items[1]?.correlationId)
      expect(page.items[3]?.data).toMatchObject({ mode: 'runtime', messageCount: 2 })
      expect(page.items[3]?.data?.runId).toMatch(/^run-/)
      expect(page.items[2]?.data?.buildId).toBe(page.items[3]?.data?.buildId)
      expect(JSON.stringify(page.items)).not.toContain('Private')

      const providerPage = await callRpc<{
        items: Array<{
          event?: string
          correlationId?: string
          data?: {
            runId?: string
            provider?: string
            model?: string
            messageCount?: number
          }
        }>
      }>(port, 'logs.list', { limit: 10, namespacePrefix: 'runtime.provider' })
      expect(providerPage.items.map(record => record.event)).toEqual([
        'provider.invoke.started',
        'provider.invoke.completed',
      ])
      expect(providerPage.items[1]?.data).toMatchObject({
        runId: turn.runId,
        provider: 'fake',
        model: 'fake-echo-m0',
        messageCount: 2,
      })
      expect(JSON.stringify(providerPage.items)).not.toContain('Private')
    } finally {
      await server.close()
      await root.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
