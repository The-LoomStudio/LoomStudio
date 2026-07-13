import type { Fragment } from '../fragment/types.js'

export type Mutation<M = unknown> =
  | {
      readonly op: 'add'
      readonly fragmentId: string
      readonly index: number
      readonly fragment: Fragment<M>
    }
  | {
      readonly op: 'remove'
      readonly fragmentId: string
      readonly index: number
      readonly fragment: Fragment<M>
    }
  | {
      readonly op: 'update'
      readonly fragmentId: string
      readonly index: number
      readonly before: Fragment<M>
      readonly after: Fragment<M>
    }
  | {
      readonly op: 'move'
      readonly fragmentId: string
      readonly fromIndex: number
      readonly toIndex: number
    }
