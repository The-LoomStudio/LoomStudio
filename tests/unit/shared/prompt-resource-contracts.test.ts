import { describe, expect, it } from 'vitest'
import {
  listSettingMountsResultSchema,
  replaceSettingMountsInputSchema,
} from '@loom-studio/shared'

describe('shared prompt resource contracts', () => {
  it('accepts the supported Setting Mount sources', () => {
    expect(replaceSettingMountsInputSchema.parse({
      source: { kind: 'manual', id: 'global' },
      settingResourceIds: ['setting-1'],
    })).toEqual({
      source: { kind: 'manual', id: 'global' },
      settingResourceIds: ['setting-1'],
    })

    expect(replaceSettingMountsInputSchema.parse({
      source: { kind: 'preset', id: 'preset-1' },
      settingResourceIds: [],
    }).source).toEqual({ kind: 'preset', id: 'preset-1' })
  })

  it('rejects invalid sources and malformed mount responses', () => {
    expect(replaceSettingMountsInputSchema.safeParse({
      source: { kind: 'manual', id: 'workspace' },
      settingResourceIds: [],
    }).success).toBe(false)

    expect(listSettingMountsResultSchema.safeParse({
      mounts: [{
        id: 'mount-1',
        settingResourceId: 'setting-1',
        source: { kind: 'preset' },
        orderIndex: 0,
        origin: {},
        createdAt: '2026-09-14T00:00:00.000Z',
      }],
    }).success).toBe(false)
  })
})
