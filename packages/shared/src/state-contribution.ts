import type { JsonObject } from './index.js'

export type StateEntityType = {
  id: string
  collectionPath: string
  label?: string
}

export type StateEntityId = {
  typeId: string
  entityId: string
}

export type StateComponentTemplate = {
  id: string
  templateVersion: number
  schema: JsonObject
  initial: JsonObject
  componentKey?: string
  targetEntityTypeIds?: string[]
  label?: string
}

export type TimelineComponentMount = {
  templateId: string
  templateVersion: number
  componentKey: string
  target:
    | { kind: 'entity'; entity: StateEntityId }
    | { kind: 'entity-type'; typeId: string }
  initial?: JsonObject
}

export type TimelineStateBinding = {
  path: string
  templateId: string
  templateVersion: number
  initial?: JsonObject
}

export type StateEntityRefAnnotation = {
  allowedTypeIds: string[]
}

export type StateContribution = {
  id: string
  entityTypes: StateEntityType[]
  templates: StateComponentTemplate[]
  entities: StateEntityId[]
  componentMounts: TimelineComponentMount[]
  bindings: TimelineStateBinding[]
}

export type StateArtifact = {
  kind: 'loom.state'
  schemaVersion: 1
  contribution: StateContribution
}
