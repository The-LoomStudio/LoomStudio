import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callRpc } from './helpers.js'

describe('studio server persistence integration', () => {
  it('rejects an injected Document Store without a shared Data Engine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-server-'))
    const documents = createSqliteDocumentStore({ filename: join(dir, 'store.sqlite') })
    try {
      expect(() => createStudioServer({ documents })).toThrow('shared SQLite Data Engine')
    } finally {
      documents.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists Narrative Timeline rows across server restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-server-narrative-'))
    const sqlitePath = join(dir, 'store.sqlite')

    try {
      const firstServer = createStudioServer({ sqlitePath })
      const first = await firstServer.listen(0)
      const card = await callRpc<{ card: { id: string } }>(first.port, 'application.createCard', {
        name: 'Persistent Narrative',
        opening: { entries: [{ content: 'Opening node' }] },
      })
      const created = await callRpc<{
        timeline: { id: string }
        branch: { id: string }
      }>(first.port, 'application.createNarrativeTimelineFromCard', { cardId: card.card.id })
      await firstServer.close()

      const secondServer = createStudioServer({ sqlitePath })
      const second = await secondServer.listen(0)
      const page = await callRpc<{ nodes: Array<{ body: { raw: string } }> }>(second.port, 'application.getNarrativePage', {
        timelineId: created.timeline.id,
        branchId: created.branch.id,
      })
      await secondServer.close()

      expect(page.nodes.map(node => node.body.raw)).toEqual(['Opening node'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists Agent Session rows across server restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-server-agent-'))
    const sqlitePath = join(dir, 'store.sqlite')
    try {
      const firstServer = createStudioServer({ sqlitePath })
      const first = await firstServer.listen(0)
      const presets = await callRpc<{ resources: Array<{ id: string }> }>(first.port, 'application.listPromptResources', { resourceKind: 'preset' })
      const presetId = presets.resources[0]!.id
      const provider = await callRpc<{ providerProfile: { id: string } }>(first.port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake',
        displayName: 'Persistent Provider',
        config: { baseUrl: 'https://example.test/v1' },
        enabledModelIds: ['test-model'],
      })
      const agentProfile = await callRpc<{ agentProfile: { id: string } }>(first.port, 'application.createAgentProfile', {
        name: 'Persistent Agent Profile',
        presetId,
        model: { providerProfileId: provider.providerProfile.id, modelId: 'test-model' },
      })
      const created = await callRpc<{ session: { id: string } }>(first.port, 'application.createAgentSession', {
        agentProfileId: agentProfile.agentProfile.id,
        title: 'Persistent Agent',
      })
      await callRpc(first.port, 'application.invokeAgentTurn', {
        agentSessionId: created.session.id,
        input: 'Remember this turn.',
      })
      await firstServer.close()

      const secondServer = createStudioServer({ sqlitePath })
      const second = await secondServer.listen(0)
      const read = await callRpc<{ session: { agentProfileId: string; title: string } }>(second.port, 'application.getAgentSession', {
        agentSessionId: created.session.id,
      })
      const page = await callRpc<{ messages: unknown[] }>(second.port, 'application.getAgentMessagePage', {
        agentSessionId: created.session.id,
      })
      await secondServer.close()

      expect(read.session).toMatchObject({ agentProfileId: agentProfile.agentProfile.id, title: 'Persistent Agent' })
      expect(page.messages).toMatchObject([
        { message: { role: 'user', content: 'Remember this turn.' } },
        { message: { role: 'assistant', content: 'Agent draft: Remember this turn.' } },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
