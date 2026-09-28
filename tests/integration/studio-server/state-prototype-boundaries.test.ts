import { expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

it('keeps prototype-like State keys as own JSON data across authenticated RPC and persistence', async () => {
  const key = 'fr008Rpc'
  try {
    await withStudioServer(async port => {
      const target = { scope: 'global' }
      const read = () => callRpc<{ snapshot: { revisionId: string; value: Record<string, unknown> } }>(
        port, 'application.getStateSnapshot', { target },
      )
      const before = await read()
      for (const path of [`/__proto__/${key}`, `/constructor/prototype/${key}`]) {
        await expect(callRpc(port, 'application.applyStateMutation', {
          target,
          expectedRevisionId: before.snapshot.revisionId,
          operations: [{ op: 'increment', path, by: 1 }],
        })).rejects.toThrow('State path does not exist')
      }
      expect((await read()).snapshot).toEqual(before.snapshot)
      await callRpc(port, 'application.applyStateMutation', {
        target,
        expectedRevisionId: before.snapshot.revisionId,
        operations: [
          { op: 'set', path: `/__proto__/${key}`, value: 7 },
          { op: 'set', path: `/constructor/prototype/${key}`, value: null },
          { op: 'set', path: '/escaped/a~1b/~0/', value: 'retained' },
        ],
      })
      const after = await read()
      expect(after.snapshot.revisionId).not.toBe(before.snapshot.revisionId)
      expect(Object.hasOwn(after.snapshot.value, '__proto__')).toBe(true)
      expect(after.snapshot.value).toMatchObject(JSON.parse(
        `{"__proto__":{"${key}":7},"constructor":{"prototype":{"${key}":null}},"escaped":{"a/b":{"~":{"":"retained"}}}}`,
      ))
      expect(Object.hasOwn(Object.prototype, key)).toBe(false)
    })
  } finally {
    Reflect.deleteProperty(Object.prototype, key)
  }
})
