import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type {
  CardSourceContent,
  MaterializedStateContribution,
  StateArtifact,
  StateContribution,
  StateEntityId,
  StateEntityRefAnnotation,
  StateEntityType,
  StateReferenceDiagnostic,
  TimelineStateBinding,
  TimelineStateTemplateDraft,
} from '../types.js'
import {
  expandTimelineStateBindings,
  materializeTimelineState,
  readEntityReferenceAnnotation,
  validateStateDefinitionDraft,
  validateTimelineStateBinding,
} from './state-definition.js'

export class StateContributionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StateContributionError'
  }
}

export function createStateArtifact(contribution: StateContribution): StateArtifact {
  validateStateContribution(contribution)
  return {
    kind: 'loom.state',
    schemaVersion: 1,
    contribution: structuredClone(contribution),
  }
}

export function createCardStateContribution(
  cardId: string,
  content: CardSourceContent,
  templates: Map<string, TimelineStateTemplateDraft>,
): StateContribution {
  return {
    id: `card:${cardId}`,
    entityTypes: structuredClone(content.stateEntityTypes ?? []),
    templates: [...templates].map(([id, template]) => ({
      id,
      templateVersion: template.templateVersion,
      schema: structuredClone(template.schema),
      initial: structuredClone(template.initial),
      ...(template.componentKey !== undefined ? { componentKey: template.componentKey } : {}),
      ...(template.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...template.targetEntityTypeIds] } : {}),
      ...(template.label !== undefined ? { label: template.label } : {}),
    })),
    entities: structuredClone(content.timelineStateEntities ?? []),
    componentMounts: structuredClone(content.timelineComponentMounts ?? []),
    bindings: structuredClone(content.timelineStateBindings ?? []),
  }
}

export function parseStateArtifact(value: unknown): StateArtifact {
  if (!isJsonObject(value) || value.kind !== 'loom.state' || value.schemaVersion !== 1 || !isJsonObject(value.contribution)) {
    throw new StateContributionError('state.artifact_invalid', 'State artifact must be loom.state schemaVersion 1')
  }
  const artifact = value as unknown as StateArtifact
  validateStateContribution(artifact.contribution)
  return structuredClone(artifact)
}

export function validateStateContribution(
  contribution: StateContribution,
  options?: { allowExternalReferences?: boolean },
): void {
  validateId(contribution.id, 'contribution id')
  validateArray(contribution.entityTypes, 'entityTypes')
  validateArray(contribution.templates, 'templates')
  validateArray(contribution.entities, 'entities')
  validateArray(contribution.componentMounts, 'componentMounts')
  validateArray(contribution.bindings, 'bindings')

  const entityTypes = new Map<string, StateEntityType>()
  const collectionPaths = new Set<string>()
  for (const entityType of contribution.entityTypes) {
    validateId(entityType.id, 'entity type id')
    validateCollectionPath(entityType.collectionPath)
    if (entityTypes.has(entityType.id)) throw duplicate('entity type', entityType.id)
    if (collectionPaths.has(entityType.collectionPath)) throw duplicate('entity collection path', entityType.collectionPath)
    entityTypes.set(entityType.id, entityType)
    collectionPaths.add(entityType.collectionPath)
  }

  const templates = new Map<string, TimelineStateTemplateDraft>()
  for (const template of contribution.templates) {
    validateId(template.id, 'template id')
    if (templates.has(template.id)) throw duplicate('template', template.id)
    if (template.componentKey !== undefined) validatePathSegment(template.componentKey, 'componentKey')
    for (const typeId of template.targetEntityTypeIds ?? []) {
      if (!entityTypes.has(typeId) && !options?.allowExternalReferences) throw new StateContributionError('state.entity_type_not_found', `Template target entity type not found: ${typeId}`)
    }
    const draft: TimelineStateTemplateDraft = {
      kind: 'timeline-template',
      templateVersion: template.templateVersion,
      schema: template.schema,
      initial: template.initial,
      ...(template.componentKey !== undefined ? { componentKey: template.componentKey } : {}),
      ...(template.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...template.targetEntityTypeIds] } : {}),
      ...(template.label !== undefined ? { label: template.label } : {}),
    }
    validateStateDefinitionDraft(draft)
    templates.set(template.id, draft)
  }

  const entities = new Set<string>()
  for (const entity of contribution.entities) {
    validateEntityId(entity)
    if (!entityTypes.has(entity.typeId) && !options?.allowExternalReferences) throw new StateContributionError('state.entity_type_not_found', `Entity type not found: ${entity.typeId}`)
    const key = entityKey(entity)
    if (entities.has(key)) throw duplicate('entity', key)
    entities.add(key)
  }

  for (const mount of contribution.componentMounts) {
    validatePathSegment(mount.componentKey, 'componentKey')
    const template = templates.get(mount.templateId)
    if (!template && !options?.allowExternalReferences) throw new StateContributionError('state.template_not_found', `Component template not found: ${mount.templateId}`)
    if (!template) continue
    if (template.templateVersion !== mount.templateVersion) {
      throw new StateContributionError('state.template_version_mismatch', `Component template version mismatch: ${mount.templateId}`)
    }
    if (template.componentKey !== undefined && template.componentKey !== mount.componentKey) {
      throw new StateContributionError('state.component_key_mismatch', `Component key does not match template: ${mount.templateId}`)
    }
    const targetTypeId = mount.target.kind === 'entity' ? mount.target.entity.typeId : mount.target.typeId
    if (!entityTypes.has(targetTypeId) && !options?.allowExternalReferences) throw new StateContributionError('state.entity_type_not_found', `Component target type not found: ${targetTypeId}`)
    if (template.targetEntityTypeIds && !template.targetEntityTypeIds.includes(targetTypeId)) {
      throw new StateContributionError('state.component_target_invalid', `Component template cannot target entity type: ${targetTypeId}`)
    }
    if (mount.target.kind === 'entity') {
      validateEntityId(mount.target.entity)
      if (!entities.has(entityKey(mount.target.entity)) && !options?.allowExternalReferences) {
        throw new StateContributionError('state.entity_not_found', `Component target entity not found: ${entityKey(mount.target.entity)}`)
      }
    }
  }

  for (const binding of contribution.bindings) validateTimelineStateBinding(binding)
}

export function composeStateContributions(id: string, contributions: readonly StateContribution[]): StateContribution {
  const composed: StateContribution = {
    id,
    entityTypes: contributions.flatMap(contribution => structuredClone(contribution.entityTypes)),
    templates: contributions.flatMap(contribution => structuredClone(contribution.templates)),
    entities: contributions.flatMap(contribution => structuredClone(contribution.entities)),
    componentMounts: contributions.flatMap(contribution => structuredClone(contribution.componentMounts)),
    bindings: contributions.flatMap(contribution => structuredClone(contribution.bindings)),
  }
  validateStateContribution(composed)
  return composed
}

export function materializeStateContribution(contribution: StateContribution): MaterializedStateContribution {
  validateStateContribution(contribution)
  const entityTypes = new Map(contribution.entityTypes.map(entityType => [entityType.id, entityType]))
  const templates = new Map<string, TimelineStateTemplateDraft>(contribution.templates.map(template => [template.id, {
    kind: 'timeline-template',
    templateVersion: template.templateVersion,
    schema: template.schema,
    initial: template.initial,
    ...(template.componentKey !== undefined ? { componentKey: template.componentKey } : {}),
    ...(template.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...template.targetEntityTypeIds] } : {}),
    ...(template.label !== undefined ? { label: template.label } : {}),
  }]))
  const base: JsonObject = {}
  for (const entity of contribution.entities) {
    const entityType = entityTypes.get(entity.typeId)!
    setObjectAtPath(base, [...entityType.collectionPath.split('.'), entity.entityId], { components: {} })
  }

  const exactMounts = contribution.componentMounts.filter(mount => mount.target.kind === 'entity')
  const batchMounts = contribution.componentMounts.filter(mount => mount.target.kind === 'entity-type')
  const mountBindings: TimelineStateBinding[] = []
  const components: MaterializedStateContribution['components'] = []
  for (const mount of [...exactMounts, ...batchMounts]) {
    const batchTypeId = mount.target.kind === 'entity-type' ? mount.target.typeId : undefined
    const targets = mount.target.kind === 'entity'
      ? [mount.target.entity]
      : contribution.entities.filter(entity => entity.typeId === batchTypeId)
    for (const entity of targets) {
      const entityType = entityTypes.get(entity.typeId)!
      const path = `${entityType.collectionPath}.${entity.entityId}.components.${mount.componentKey}`
      const template = templates.get(mount.templateId)!
      mountBindings.push({
        path,
        templateId: mount.templateId,
        templateVersion: mount.templateVersion,
        ...(mount.initial !== undefined ? { initial: structuredClone(mount.initial) } : {}),
      })
      components.push({
        path,
        schema: structuredClone(template.schema),
        templateId: mount.templateId,
        componentKey: mount.componentKey,
      })
    }
  }

  const bindings = [...mountBindings, ...structuredClone(contribution.bindings)]
  const snapshot = materializeTimelineState({ base, bindings, templates })
  const concreteBindings = expandTimelineStateBindings(bindings, snapshot)
  const references: MaterializedStateContribution['references'] = []
  const referenceDiagnostics: StateReferenceDiagnostic[] = []
  for (const binding of concreteBindings) {
    const template = templates.get(binding.templateId)!
    collectReferenceAnnotations(template.schema, binding.path, references)
    inspectReferenceDiagnostics({
      value: readObjectPath(snapshot, binding.path.split('.')),
      schema: template.schema,
      path: binding.path,
      snapshot,
      entityTypes,
      references,
      diagnostics: referenceDiagnostics,
    })
  }

  return {
    snapshot,
    entityTypes: structuredClone(contribution.entityTypes),
    entities: structuredClone(contribution.entities),
    components,
    references,
    referenceDiagnostics,
    bindings: concreteBindings,
  }
}

function collectReferenceAnnotations(
  schema: JsonObject,
  path: string,
  references: MaterializedStateContribution['references'],
): void {
  const annotation = readEntityReferenceAnnotation(schema, path)
  if (annotation) references.push({ path, annotation })
  if (isJsonObject(schema.items)) {
    collectReferenceAnnotations(schema.items, `${path}.*`, references)
  }
  if (!isJsonObject(schema.properties)) return
  for (const [key, childSchema] of Object.entries(schema.properties)) {
    if (isJsonObject(childSchema)) collectReferenceAnnotations(childSchema, `${path}.${key}`, references)
  }
}

function inspectReferenceDiagnostics(input: {
  value: JsonValue | undefined
  schema: JsonObject
  path: string
  snapshot: JsonObject
  entityTypes: Map<string, StateEntityType>
  references: MaterializedStateContribution['references']
  diagnostics: StateReferenceDiagnostic[]
}): void {
  const annotation = readEntityReferenceAnnotation(input.schema, input.path)
  if (annotation && input.value !== undefined) {
    inspectReferenceTarget(input.value, input.path, annotation, input.snapshot, input.entityTypes, input.diagnostics)
  }
  if (Array.isArray(input.value) && isJsonObject(input.schema.items)) {
    input.value.forEach((value, index) => inspectReferenceDiagnostics({
      ...input,
      value,
      schema: input.schema.items as JsonObject,
      path: `${input.path}.${index}`,
    }))
    return
  }
  if (!isJsonObject(input.value) || !isJsonObject(input.schema.properties)) return
  for (const [key, schema] of Object.entries(input.schema.properties)) {
    if (!isJsonObject(schema)) continue
    inspectReferenceDiagnostics({ ...input, value: input.value[key], schema, path: `${input.path}.${key}` })
  }
}

function inspectReferenceTarget(
  value: JsonValue,
  path: string,
  annotation: StateEntityRefAnnotation,
  snapshot: JsonObject,
  entityTypes: Map<string, StateEntityType>,
  diagnostics: StateReferenceDiagnostic[],
): void {
  if (!isJsonObject(value) || typeof value.typeId !== 'string' || typeof value.entityId !== 'string') return
  if (!annotation.allowedTypeIds.includes(value.typeId)) return
  const entityType = entityTypes.get(value.typeId)
  const target = entityType && readObjectPath(snapshot, [...entityType.collectionPath.split('.'), value.entityId])
  if (isJsonObject(target)) return
  diagnostics.push({
    code: 'state.entity_ref_unresolved',
    path,
    reference: { typeId: value.typeId, entityId: value.entityId },
  })
}

function setObjectAtPath(root: JsonObject, segments: string[], value: JsonObject): void {
  let current = root
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment]
    if (existing === undefined) {
      const child: JsonObject = {}
      Object.defineProperty(current, segment, { configurable: true, enumerable: true, writable: true, value: child })
      current = child
      continue
    }
    if (!isJsonObject(existing)) throw new StateContributionError('state.path_conflict', `State path conflicts at: ${segments.join('.')}`)
    current = existing
  }
  const key = segments.at(-1)!
  if (Object.hasOwn(current, key)) throw new StateContributionError('state.path_conflict', `State path is duplicated: ${segments.join('.')}`)
  Object.defineProperty(current, key, { configurable: true, enumerable: true, writable: true, value: structuredClone(value) })
}

function readObjectPath(root: JsonObject, segments: string[]): JsonValue | undefined {
  let current: JsonValue = root
  for (const segment of segments) {
    if (!isJsonObject(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function validateEntityId(entity: StateEntityId): void {
  validatePathSegment(entity.typeId, 'entity type id')
  validatePathSegment(entity.entityId, 'entity id')
}

function validateCollectionPath(path: string): void {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(path)) {
    throw new StateContributionError('state.entity_collection_path_invalid', `Entity collection path is invalid: ${path}`)
  }
}

function validatePathSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9_$-]+$/.test(value)) {
    throw new StateContributionError('state.path_segment_invalid', `${label} is invalid: ${value}`)
  }
}

function validateId(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StateContributionError('state.contribution_invalid', `${label} is required`)
  }
}

function validateArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new StateContributionError('state.contribution_invalid', `${label} must be an array`)
}

function duplicate(label: string, id: string): StateContributionError {
  return new StateContributionError('state.contribution_duplicate', `Duplicate ${label}: ${id}`)
}

function entityKey(entity: StateEntityId): string {
  return `${entity.typeId}:${entity.entityId}`
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
