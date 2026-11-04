import { expect, it } from 'vitest'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

it('publishes one derived notification per raw commit for every SSE connection', async () => {
  await withStudioServer(async port => {
    const controllers = [new AbortController(), new AbortController()]
    const received: string[][] = [[], []]
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
    } finally {
      controllers.forEach(controller => controller.abort())
      await Promise.all(readers.map(reader => reader.cancel().catch(() => {})))
      await Promise.all(tasks)
    }
  })
})
