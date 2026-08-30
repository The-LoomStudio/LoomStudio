import { describe, expect, it } from 'vitest'
import type {
  PromptCompositionEntry,
  PromptCompositionItem,
  PromptCompositionZone,
  PromptMessageBlock,
} from '../../../apps/studio-client/src/entities/index.js'
import {
  appendCompositionItem,
  moveCompositionItem,
  moveCompositionItemTo,
  removeCompositionItem,
} from '../../../apps/studio-client/src/features/context-assets/model/composition-items.js'

describe('prompt composition items', () => {
  it('moves top-level blocks and swaps their persisted order indexes', () => {
    const items = [message('system', 10), message('user', 20)]
    const moved = moveCompositionItem(items, 'message.user', 'up')

    expect(sortedIds(moved)).toEqual(['message.user', 'message.system'])
    expect(moved.find(item => item.id === 'message.user')?.orderIndex).toBe(10)
    expect(moved.find(item => item.id === 'message.system')?.orderIndex).toBe(20)
    expect(moveCompositionItem(moved, 'message.user', 'up')).toEqual(moved)
  })

  it('moves only within a message block and preserves the block boundary', () => {
    const first = zone('zone.first', 10)
    const second = entry('entry.second', 20)
    const block = message('system', 10, [first, second])
    const moved = moveCompositionItem([block], second.id, 'up')

    expect(moved[0]?.kind).toBe('message')
    expect(moved[0]?.kind === 'message' ? sortedIds(moved[0].items) : []).toEqual(['entry.second', 'zone.first'])
    expect(appendCompositionItem([block], message('user', 20), block.id)).toEqual([block])
  })

  it('removes a child without deleting its containing block', () => {
    const block = message('system', 10, [zone('zone.first', 10), entry('entry.second', 20)])
    const next = removeCompositionItem([block], 'zone.first')

    expect(next).toHaveLength(1)
    expect(next[0]?.kind === 'message' ? next[0].items.map(item => item.id) : []).toEqual(['entry.second'])
  })

  it('moves blocks freely before and after root composition items', () => {
    const items = [message('system', 10), slot('session', 20), message('user', 30)]

    expect(sortedIds(moveCompositionItemTo(items, 'message.system', 'message.user', 'after'))).toEqual([
      'slot.session',
      'message.user',
      'message.system',
    ])
    expect(sortedIds(moveCompositionItemTo(items, 'message.user', 'message.system', 'before'))).toEqual([
      'message.user',
      'message.system',
      'slot.session',
    ])
  })

  it('moves zones before, after, and inside another block without moving slots', () => {
    const first = message('system', 10, [zone('zone.first', 10), slot('fixed', 20)])
    const second = message('user', 20, [zone('zone.second', 10)])

    const afterSlot = moveCompositionItemTo([first, second], 'zone.first', 'slot.fixed', 'after')
    expect(afterSlot[0]?.kind === 'message' ? sortedIds(afterSlot[0].items) : []).toEqual(['slot.fixed', 'zone.first'])

    const insideSecond = moveCompositionItemTo(afterSlot, 'zone.first', 'message.user', 'inside')
    expect(insideSecond[0]?.kind === 'message' ? insideSecond[0].items.map(item => item.id) : []).toEqual(['slot.fixed'])
    expect(insideSecond[1]?.kind === 'message' ? sortedIds(insideSecond[1].items) : []).toEqual(['zone.second', 'zone.first'])

    expect(moveCompositionItemTo(insideSecond, 'slot.fixed', 'zone.second', 'after')).toEqual(insideSecond)
  })

  it('extracts a zone to a new sibling block while preserving its provider role', () => {
    const items = [message('system', 10, [zone('zone.first', 10)]), slot('session', 20)]
    const extracted = moveCompositionItemTo(items, 'zone.first', 'slot.session', 'after')

    expect(extracted).toHaveLength(3)
    expect(extracted[0]).toMatchObject({ kind: 'message', role: 'system', items: [] })
    expect(extracted[1]).toMatchObject({ kind: 'slot', id: 'slot.session' })
    expect(extracted[2]).toMatchObject({ kind: 'message', role: 'system', items: [{ id: 'zone.first' }] })
  })
})

function message(role: PromptMessageBlock['role'], orderIndex: number, items: PromptMessageBlock['items'] = []): PromptMessageBlock {
  return {
    id: `message.${role}`,
    kind: 'message',
    displayName: role,
    orderIndex,
    role,
    items,
  }
}

function zone(id: string, orderIndex: number): PromptCompositionZone {
  return {
    id,
    kind: 'zone',
    displayName: id,
    orderIndex,
    parentId: null,
    band: 'current-turn',
  }
}

function entry(id: string, orderIndex: number): PromptCompositionEntry {
  return {
    id,
    kind: 'entry',
    displayName: id,
    orderIndex,
    source: { kind: 'preset', nodeId: id },
  }
}

function slot(id: string, orderIndex: number) {
  return {
    id: `slot.${id}`,
    kind: 'slot' as const,
    displayName: id,
    orderIndex,
    bindingId: id,
    messageMode: 'native' as const,
  }
}

function sortedIds(items: PromptCompositionItem[]): string[] {
  return [...items].sort((left, right) => left.orderIndex - right.orderIndex).map(item => item.id)
}
