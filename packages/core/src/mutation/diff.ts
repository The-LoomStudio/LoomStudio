import { cloneFragment } from '../fragment/clone.js'
import type { Fragment } from '../fragment/types.js'
import type { Mutation } from './types.js'

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function fragmentChanged<M>(before: Fragment<M>, after: Fragment<M>): boolean {
  return before.content !== after.content || !sameJson(before.meta, after.meta)
}

export function computeMutations<M>(
  before: readonly Fragment<M>[],
  after: readonly Fragment<M>[]
): Mutation<M>[] {
  const mutations: Mutation<M>[] = []
  const beforeById = new Map<string, { index: number; fragment: Fragment<M> }>()

  for (let i = 0; i < before.length; i++) {
    const fragment = before[i]
    if (fragment) beforeById.set(fragment.id, { index: i, fragment })
  }

  for (let i = 0; i < after.length; i++) {
    const fragment = after[i]
    if (!fragment) continue

    const previous = beforeById.get(fragment.id)
    if (!previous) {
      mutations.push({
        op: 'add',
        fragmentId: fragment.id,
        index: i,
        fragment: cloneFragment(fragment),
      })
    } else {
      if (previous.index !== i) {
        mutations.push({
          op: 'move',
          fragmentId: fragment.id,
          fromIndex: previous.index,
          toIndex: i,
        })
      }
      if (fragmentChanged(previous.fragment, fragment)) {
        mutations.push({
          op: 'update',
          fragmentId: fragment.id,
          index: i,
          before: cloneFragment(previous.fragment),
          after: cloneFragment(fragment),
        })
      }
      beforeById.delete(fragment.id)
    }
  }

  for (const [fragmentId, info] of beforeById) {
    mutations.push({
      op: 'remove',
      fragmentId,
      index: info.index,
      fragment: cloneFragment(info.fragment),
    })
  }

  return mutations
}
