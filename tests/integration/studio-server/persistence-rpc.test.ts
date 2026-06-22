import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callRpc } from './helpers.js'

describe('studio server persistence integration', () => {
  it('persists Application Runtime documents across server restarts with SQLite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-server-'))
    const sqlitePath = join(dir, 'store.sqlite')

    try {
      const firstServer = createStudioServer({ sqlitePath })
      const first = await firstServer.listen(0)
      const created = await callRpc<{
        session: { id: string }
      }>(first.port, 'application.createSession', {
        cardSourceVersionId: 'card-version-restart-1',
        cardSnapshot: { name: 'Restart Card' },
      })
      await callRpc(first.port, 'application.submitTurn', {
        sessionId: created.session.id,
        input: '重启前的回合。',
      })
      await firstServer.close()

      const secondServer = createStudioServer({ sqlitePath })
      const second = await secondServer.listen(0)
      const timeline = await callRpc<{
        entries: Array<{ content: string }>
      }>(second.port, 'application.getTimeline', {
        sessionId: created.session.id,
      })
      await secondServer.close()

      expect(timeline.entries.map(entry => entry.content)).toEqual([
        '重启前的回合。',
        'Agent draft: 重启前的回合。',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

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
})
