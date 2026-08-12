import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callRpc } from './helpers.js'

describe('studio server persistence integration', () => {
  it('does not close an injected document store when the server closes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-server-'))
    const documents = createSqliteDocumentStore({ filename: join(dir, 'store.sqlite') })
    const server = createStudioServer({ documents })

    try {
      await server.listen(0)
      await server.close()

      await documents.write({
        id: 'still-open',
        type: 'example.note',
        content: { ok: true },
        expectedVersion: 'new',
      })
      expect(await documents.get('still-open')).toMatchObject({ content: { ok: true } })
      documents.close()
    } finally {
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
      const preset = await callRpc<{ agentPreset: { id: string } }>(first.port, 'application.createAgentPreset', {
        name: 'Persistent Agent Preset',
        instructions: 'Persist this Agent.',
      })
      const created = await callRpc<{ session: { id: string } }>(first.port, 'application.createAgentSession', {
        agentPresetId: preset.agentPreset.id,
        title: 'Persistent Agent',
      })
      await callRpc(first.port, 'application.invokeAgentTurn', {
        agentSessionId: created.session.id,
        input: 'Remember this turn.',
      })
      await firstServer.close()

      const secondServer = createStudioServer({ sqlitePath })
      const second = await secondServer.listen(0)
      const read = await callRpc<{ session: { agentPresetId: string; title: string } }>(second.port, 'application.getAgentSession', {
        agentSessionId: created.session.id,
      })
      const page = await callRpc<{ messages: unknown[] }>(second.port, 'application.getAgentMessagePage', {
        agentSessionId: created.session.id,
      })
      await secondServer.close()

      expect(read.session).toMatchObject({ agentPresetId: preset.agentPreset.id, title: 'Persistent Agent' })
      expect(page.messages).toMatchObject([
        { message: { role: 'user', content: 'Remember this turn.' } },
        { message: { role: 'assistant', content: 'Agent draft: Remember this turn.' } },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
