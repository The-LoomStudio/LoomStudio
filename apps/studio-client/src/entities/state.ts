import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { MutationReceipt } from './common.js'

export type StateTarget =
  | { scope: 'global' }
  | { scope: 'timeline'; timelineId: string; branchId: string }

export type StateMutationOperation =
  | { op: 'set'; path: string; value: ClientJsonValue }
  | { op: 'remove'; path: string }
  | { op: 'increment'; path: string; by: number }

export type StateSnapshot = {
  scopeId: string
  target: StateTarget
  revisionId: string
  value: { [key: string]: ClientJsonValue }
  createdAt: string
}

export type GetStateSnapshotResult = {
  snapshot: StateSnapshot
}

export type ApplyStateMutationInput = {
  target: StateTarget
  expectedRevisionId: string
  operations: StateMutationOperation[]
  idempotencyKey?: string
}

export type ApplyStateMutationResult = {
  snapshot: StateSnapshot
  mutation: MutationReceipt
}

export type StateDefinitionDraft =
  | { kind: 'global'; path: string; schema: { [key: string]: ClientJsonValue }; default?: ClientJsonValue; readOnly?: boolean; label?: string }
  | { kind: 'timeline-template'; templateVersion: number; schema: { [key: string]: ClientJsonValue }; initial: { [key: string]: ClientJsonValue }; label?: string }

export type StateDefinition = StateDefinitionDraft & {
  id: string
  version: number
  createdAt: string
  updatedAt: string
}

export type ListStateDefinitionsResult = { definitions: StateDefinition[] }
export type GetStateDefinitionResult = { definition: StateDefinition }
export type UpsertStateDefinitionResult = { definition: StateDefinition; mutation: MutationReceipt }
export type DeleteStateDefinitionResult = { deleted: true; mutation: MutationReceipt }
