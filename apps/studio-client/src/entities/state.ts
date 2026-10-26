import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import type { MutationReceipt } from './common.js'
import type { StateContribution, StateEntityId, StateEntityRefAnnotation, StateEntityType } from '@loom-studio/shared'
import type { ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import type { ListExtensionInstallationsResult, TimelineExtensionParticipation } from './extension.js'

export type StateTarget =
  | { scope: 'global' }
  | { scope: 'timeline'; timelineId: string; branchId: string }

type StateMutationOperation =
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
  | { kind: 'timeline-template'; templateVersion: number; schema: { [key: string]: ClientJsonValue }; initial: { [key: string]: ClientJsonValue }; componentKey?: string; targetEntityTypeIds?: string[]; label?: string }

type StateDefinition = StateDefinitionDraft & {
  id: string
  version: number
  createdAt: string
  updatedAt: string
}

export type ListStateDefinitionsResult = { definitions: StateDefinition[] }
export type GetStateDefinitionResult = { definition: StateDefinition }
export type UpsertStateDefinitionResult = { definition: StateDefinition; mutation: MutationReceipt }
export type DeleteStateDefinitionResult = { deleted: true; mutation: MutationReceipt }

export type InspectStateSourcesInput = {
  cardId?: string
  target?: Extract<StateTarget, { scope: 'timeline' }>
}

type StateContributionSource = {
  installationId: string
  contributionId: string
  packageId: string
  moduleId: string
  packageVersion: string
  declaration: StateContribution
}

export type StateSourcesInspection = {
  card: {
    id: string
    version: number
    name: string
    declaration: StateContribution
    definitionIds: string[]
    contributionIds: string[]
  } | null
  definitions: StateDefinition[]
  extensions: Array<{
    installationId: string
    packageId: string
    target: ExtensionInstallationTarget | null
    installation: Omit<ListExtensionInstallationsResult['installations'][number], 'id'> | null
    cardDefault: boolean
    adoption: TimelineExtensionParticipation['entries'][number] | null
    eligible: boolean
    registered: StateContributionSource[]
    accepted: StateContributionSource[]
  }>
  timeline: {
    target: Extract<StateTarget, { scope: 'timeline' }>
    revisionId: string
    context: {
      timelineId: string
      sourceCardId: string
      sourceCardVersion: number
      cardName?: string
      fallbackUserName: string
      stateEntityTypes: StateEntityType[]
      stateEntities: StateEntityId[]
      stateComponents: Array<{ path: string; schema: Record<string, ClientJsonValue>; templateId: string; componentKey: string }>
      stateReferences: Array<{ path: string; annotation: StateEntityRefAnnotation }>
      stateContributionSources: StateContributionSource[]
      stateBindings: Array<{ installationId?: string; path: string; schema: Record<string, ClientJsonValue> }>
      createdAt: string
    } | null
    paths: Array<{ path: string; kind: 'entity' | 'component' | 'binding'; installationId?: string; present: boolean }>
  } | null
}
