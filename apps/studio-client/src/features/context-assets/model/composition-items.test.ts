import { describe, expect, it } from 'vitest'
import type {
  PromptCompositionEntry,
  PromptCompositionItem,
  PromptCompositionZone,
  PromptMessageBlock,
} from '../../../entities/index.js'
import {
  appendCompositionItem,
  moveCompositionItem,
  removeCompositionItem,
} from './composition-items.js'

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

function sortedIds(items: PromptCompositionItem[]): string[] {
  return [...items].sort((left, right) => left.orderIndex - right.orderIndex).map(item => item.id)
}
