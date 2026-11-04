import { describe, expect, it } from 'vitest'
import {
  listLoreMountsResultSchema,
  replaceLoreMountsInputSchema,
} from '@loom-studio/shared'

describe('shared prompt resource contracts', () => {
  it('accepts the supported Setting Mount sources', () => {
    expect(replaceLoreMountsInputSchema.parse({
      expectedMountIds: [],
      source: { kind: 'manual', id: 'global' },
      loreResourceIds: ['setting-1'],
    })).toEqual({
      expectedMountIds: [],
      source: { kind: 'manual', id: 'global' },
      loreResourceIds: ['setting-1'],
    })

    expect(replaceLoreMountsInputSchema.parse({
      expectedMountIds: [],
      source: { kind: 'preset', id: 'preset-1' },
      loreResourceIds: [],
    }).source).toEqual({ kind: 'preset', id: 'preset-1' })
  })

  it('rejects invalid sources and malformed mount responses', () => {
    expect(replaceLoreMountsInputSchema.safeParse({
      expectedMountIds: [],
      source: { kind: 'manual', id: 'workspace' },
      loreResourceIds: [],
    }).success).toBe(false)

    expect(listLoreMountsResultSchema.safeParse({
      mounts: [{
        id: 'mount-1',
        loreResourceId: 'setting-1',
        expectedMountIds: [],
      source: { kind: 'preset' },
        orderIndex: 0,
        origin: {},
        createdAt: '2026-09-14T00:00:00.000Z',
      }],
    }).success).toBe(false)
  })
})
