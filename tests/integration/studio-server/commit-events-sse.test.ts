import { expect, it } from 'vitest'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

it('broadcasts commit and Agent task list notifications to every SSE connection', async () => {
  await withStudioServer(async port => {
    const { card } = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Task owner' })
    const { timeline } = await callRpc<{ timeline: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.id })
    const { agentPreset } = await callRpc<{ agentPreset: { id: string } }>(port, 'application.createAgentPreset', { name: 'Task Agent' })
    const { session } = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
      agentPresetId: agentPreset.id, timelineId: timeline.id,
    })
    const controllers = [new AbortController(), new AbortController()]
    const received: string[][] = [[], []]
    const taskUpdates: unknown[][] = [[], []]
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
    const tasks: Promise<void>[] = []
    try {
      for (const [index, controller] of controllers.entries()) {
        const response = await authenticatedFetch(port, '/extensions/events', { signal: controller.signal })
        expect(response.status).toBe(200)
        const reader = response.body!.getReader()
        readers.push(reader)
        tasks.push((async () => {
          let buffer = ''
          const decoder = new TextDecoder()
          try {
            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              let end: number
              while ((end = buffer.indexOf('\n\n')) >= 0) {
                const frame = buffer.slice(0, end)
                buffer = buffer.slice(end + 2)
                const name = /^event: (.+)$/m.exec(frame)?.[1]
                if (name) received[index]!.push(name)
                if (name === 'agent.run-list.changed') {
                  const data = /^data: (.+)$/m.exec(frame)![1]!
                  taskUpdates[index]!.push(JSON.parse(data).payload)
                }
              }
            }
          } catch (error) { if (!controller.signal.aborted) throw error }
        })())
      }
      for (let i = 0; i < 2; i++) await callRpc(port, 'docs.write', {
        id: `test:sse-${i}`, type: 'test.note', content: {}, expectedVersion: 'new',
      })
      await expect.poll(() => received.map(events => events.filter(name => name === 'data.changed').length)).toEqual([2, 2])
      await expect.poll(() => received.map(events => events.filter(name => name === 'extensions.data.changed').length)).toEqual([2, 2])
      // Both commits have reached every connection; there must be no per-connection multiplier.
      expect(received.map(events => events.filter(name => name === 'extensions.data.changed').length)).toEqual([2, 2])
      expect(taskUpdates).toEqual([[], []])
      await callRpc(port, 'application.updateAgentSession', { agentSessionId: session.id, title: 'Renamed task' })
      await expect.poll(() => taskUpdates).toEqual([[{ timelineId: timeline.id }], [{ timelineId: timeline.id }]])
      // A preset without a model fails immediately, exercising the live lifecycle without a Provider.
      const { runId } = await callRpc<{ runId: string }>(port, 'application.agent.run.create', { agentSessionId: session.id, input: 'Private input' })
      await expect.poll(async () => (await callRpc<{ tasks: unknown[] }>(port, 'application.agent.run.list', { timelineId: timeline.id })).tasks)
        .toMatchObject([{ runId, title: 'Renamed task', state: 'failed' }])
      await expect.poll(() => taskUpdates.every(updates => updates.length >= 3)).toBe(true)
      for (const updates of taskUpdates) expect(updates.every(update => JSON.stringify(update) === JSON.stringify({ timelineId: timeline.id }))).toBe(true)
    } finally {
      controllers.forEach(controller => controller.abort())
      await Promise.all(readers.map(reader => reader.cancel().catch(() => {})))
      await Promise.all(tasks)
    }
  })
})
