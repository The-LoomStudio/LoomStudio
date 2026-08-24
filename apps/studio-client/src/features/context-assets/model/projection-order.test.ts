import { describe, expect, it } from 'vitest'
import type { ContextAssetNode } from '../../../entities/index.js'
import { buildProjectionOrder, buildProjectionZones, moveProjectionZone, readReorderedEntryOrder } from './projection-order.js'

function entry(id: string, zoneId: string, slotKey = `${id}@${zoneId}`): ContextAssetNode {
  return {
    id,
    kind: 'entry',
    label: id,
    projection: {
      lifecycle: 'always',
      order: 'default',
      slotKey,
      zoneId,
    },
  }
}

describe('projection order runlist', () => {
  const entries = buildProjectionOrder([
    entry('system-a', 'preset.system'),
    entry('lower-a', 'setting.lower', 'setting-layer:city-main@setting.lower'),
    entry('lower-b', 'setting.lower', 'setting-layer:city-main@setting.lower'),
    entry('tail-a', 'fresh.tail'),
  ])

  it('keeps zones and slot members as separate display levels', () => {
    const zones = buildProjectionZones(entries)

    expect(zones.map(zone => zone.id)).toEqual(['preset.system', 'setting.lower', 'fresh.tail'])
    expect(zones[1]?.rows).toHaveLength(1)
    expect(zones[1]?.rows[0]).toMatchObject({ type: 'slot', entries: [{ node: { id: 'lower-a' } }, { node: { id: 'lower-b' } }] })
  })

  it('moves a zone as one contiguous sequence without changing its members', () => {
    expect(moveProjectionZone(entries, 'fresh.tail', 'setting.lower')).toEqual([
      'system-a',
      'tail-a',
      'lower-a',
      'lower-b',
    ])
    expect(moveProjectionZone(entries, 'preset.system', 'setting.lower')).toEqual([
      'lower-a',
      'lower-b',
      'system-a',
      'tail-a',
    ])
  })

  it('calculates a downward entry drop after the target', () => {
    expect(readReorderedEntryOrder(entries, 'lower-a', 'lower-b', 'after')).toBeGreaterThan(
      entries.find(entry => entry.node.id === 'lower-b')!.entryOrder,
    )
  })
})
