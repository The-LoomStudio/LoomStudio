import { createServer } from 'node:http'
import { cp } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from '../../integration/studio-server/helpers.js'

describe('The World through the real Studio Server tool bridge', () => {
  it('reads and updates only the adopted Timeline, then hides its Prompt and tools when paused', async () => {
    let steps = 0
    let revision: string | undefined
    const requests: Array<{ messages: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> }> = []
    const provider = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push(body)
      const step = ++steps
      if (step === 2) revision = JSON.parse(body.messages.findLast((message: { role: string }) => message.role === 'tool').content).revisionId
      const tool = step <= 2 ? {
        id: `call-${step}`, type: 'function',
        function: {
          name: body.tools[step - 1].function.name,
          arguments: JSON.stringify(step === 1 ? {} : {
            expectedRevisionId: revision,
            patch: [{ op: 'add', path: '/entities/world/components/weather', value: { kind: 'rain' } }],
          }),
        },
      } : undefined
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        id: `response-${step}`, object: 'chat.completion', created: 1, model: 'fixture',
        choices: [{ index: 0, message: { role: 'assistant', content: tool ? null : 'Done.', ...(tool ? { tool_calls: [tool] } : {}) },
          finish_reason: tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
    })
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address() as { port: number }
    try {
      await withStudioServer(async (port, root) => {
        const sourceDirectory = join(root, 'the-world')
        await cp(fileURLToPath(new URL('../../../extensions/the-world/', import.meta.url)), sourceDirectory, {
          recursive: true, filter: source => !['node_modules', '.git', '.DS_Store'].includes(basename(source)),
        })
        const rpc = <T>(method: string, params: unknown) => callRpc<T>(port, method, params)
        await rpc('extensions.installPackage', { sourceDirectory })
        await rpc('extensions.enableModule', { packageId: 'official.the-world', moduleId: 'server' })
        const { card } = await rpc<{ card: { id: string } }>('application.createCard', { name: 'World' })
        await rpc('application.updateCard', { cardId: card.id, extensionAdoptions: [{ packageId: 'official.the-world', target: 'global' }] })
        const a = await rpc<{ timeline: { id: string }; branch: { id: string } }>('application.createNarrativeTimeline', { cardId: card.id })
        const b = await rpc<typeof a>('application.createNarrativeTimeline', { cardId: card.id })
        const target = { scope: 'timeline', timelineId: a.timeline.id, branchId: a.branch.id }
        const { agentPreset } = await rpc<{ agentPreset: { id: string; version: number } }>('application.createAgentPreset', { name: 'World test' })
        const { providerProfile } = await rpc<{ providerProfile: { id: string } }>('application.createProviderProfile', {
          providerExtensionId: 'official.openai-compatible', displayName: 'Local fixture',
          config: { baseUrl: `http://127.0.0.1:${address.port}/v1` }, enabledModelIds: ['fixture'],
          credential: { apiKey: 'local-fixture-only' },
        })
        await rpc('application.updateAgentPreset', {
          agentPresetId: agentPreset.id, expectedVersion: agentPreset.version,
          model: { providerProfileId: providerProfile.id, modelId: 'fixture' }, delivery: 'complete',
        })
        const { resources } = await rpc<{ resources: Array<{ id: string; origin?: { packageId: string } }> }>('application.listPromptResources', {})
        const setting = resources.find(resource => resource.origin?.packageId === 'official.the-world')!
        await rpc('application.replaceLoreMounts', { expectedMountIds: (await rpc<{ mounts: Array<{ id: string }> }>('application.listLoreMounts', { source: { kind: 'preset', id: agentPreset.id } })).mounts.map(mount => mount.id), source: { kind: 'preset', id: agentPreset.id }, loreResourceIds: [setting.id] })
        await rpc('application.replacePresetToolMounts', { expectedMountIds: (await rpc<{ mounts: Array<{ id: string }> }>('application.listPresetToolMounts', { presetId: agentPreset.id })).mounts.map(mount => mount.id),
          presetId: agentPreset.id,
          mounts: ['read-world-state', 'update-world-state'].map((id, orderIndex) => ({
            toolId: `official.the-world/${id}`, defaultEnabled: true, orderIndex,
          })),
        })
        const { session } = await rpc<{ session: { id: string } }>('application.createAgentSession', {
          agentPresetId: agentPreset.id, timelineId: a.timeline.id,
        })
        await rpc('application.invokeAgentTurn', { agentSessionId: session.id, input: 'It starts raining.' })
        expect(steps).toBe(3)
        expect(revision).toBeTruthy()
        expect(requests[0]!.messages.some(message => message.content?.includes('先调用 official.the-world/read-world-state'))).toBe(true)
        const current = await rpc<{ snapshot: { value: unknown } }>('application.getStateSnapshot', { target })
        expect(current.snapshot.value).toMatchObject({ theWorld: { entities: { world: { components: { weather: { kind: 'rain' } } } } } })
        const other = await rpc<typeof current>('application.getStateSnapshot', { target: { ...target, timelineId: b.timeline.id, branchId: b.branch.id } })
        expect(other.snapshot.value).toHaveProperty('theWorld.entities.world.components.weather.kind', null)
        const config = await rpc<{ version: number; entries: Array<{ installationId: string }> }>('application.getTimelineExtensionParticipation', { timelineId: a.timeline.id })
        await rpc('application.updateTimelineExtensionParticipation', {
          timelineId: a.timeline.id, installationId: config.entries[0]!.installationId, expectedVersion: config.version, enabled: false,
        })
        const preview = await rpc<{ toolExposures: unknown[]; projection: { messages: Array<{ content: string }> } }>('application.previewAgentTurn', {
          agentSessionId: session.id, input: 'Continue.',
        })
        expect(preview.toolExposures).toEqual([])
        expect(preview.projection.messages.some(message => message.content.includes('先调用 official.the-world/read-world-state'))).toBe(false)
        expect((await rpc<typeof current>('application.getStateSnapshot', { target })).snapshot.value).toEqual(current.snapshot.value)
      })
    } finally {
      await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
    }
  })
})
