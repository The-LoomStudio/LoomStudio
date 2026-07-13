import type { Fragment } from './types.js'
import { cloneJson } from '../utils/clone.js'

export function cloneFragment<M>(fragment: Fragment<M>): Fragment<M> {
  return {
    id: fragment.id,
    content: fragment.content,
    meta: cloneJson(fragment.meta),
  }
}

export function cloneFragments<M>(fragments: readonly Fragment<M>[]): Fragment<M>[] {
  return fragments.map((fragment) => cloneFragment(fragment))
}
