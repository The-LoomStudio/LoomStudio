import type { DocumentRecord } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type {
  StateDefinitionContent,
  StateDefinitionDraft,
  StateDefinitionEntry,
  TimelineStateBinding,
  TimelineStateTemplateDraft,
} from '../types.js'

export class StateDefinitionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StateDefinitionError'
  }
}

export function validateStateDefinitionDraft(definition: StateDefinitionDraft): void {
  validateSchema(definition.schema, `${definition.kind}.schema`)
  validateOptionalLabel(definition.label)
  if (definition.kind === 'global') {
    if (!/^global(?:\.[A-Za-z_$][\w$]*)+$/.test(definition.path)) {
      throw new StateDefinitionError('state.definition_path_invalid', `Global definition path is invalid: ${definition.path}`)
    }
    if (definition.default !== undefined) validateStateValue(definition.default, definition.schema, definition.path)
    return
  }
  if (!Number.isInteger(definition.templateVersion) || definition.templateVersion < 1) {
    throw new StateDefinitionError('state.template_version_invalid', 'Timeline templateVersion must be a positive integer')
  }
  validateStateValue(definition.initial, definition.schema, 'initial')
}

export function validateTimelineStateBinding(binding: TimelineStateBinding): void {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(binding.path)) {
    throw new StateDefinitionError('state.binding_path_invalid', `Timeline state binding path is invalid: ${binding.path}`)
  }
  if (!binding.templateId.trim()) {
    throw new StateDefinitionError('state.binding_template_invalid', 'Timeline state binding templateId is required')
  }
  if (!Number.isInteger(binding.templateVersion) || binding.templateVersion < 1) {
    throw new StateDefinitionError('state.binding_template_version_invalid', 'Timeline state binding templateVersion must be a positive integer')
  }
  if (binding.initial !== undefined && !isJsonObject(binding.initial)) {
    throw new StateDefinitionError('state.binding_initial_invalid', 'Timeline state binding initial value must be an object')
  }
}

export function materializeTimelineState(input: {
  bindings: TimelineStateBinding[]
  templates: Map<string, TimelineStateTemplateDraft>
}): JsonObject {
  const result: JsonObject = {}
  const paths = new Set<string>()
  for (const binding of input.bindings) {
    validateTimelineStateBinding(binding)
    if (paths.has(binding.path)) {
      throw new StateDefinitionError('state.binding_path_conflict', `Timeline state binding path is duplicated: ${binding.path}`)
    }
    paths.add(binding.path)
    const template = input.templates.get(binding.templateId)
    if (!template) {
      throw new StateDefinitionError('state.template_not_found', `Timeline state template not found: ${binding.templateId}`)
    }
    if (template.templateVersion !== binding.templateVersion) {
      throw new StateDefinitionError('state.template_version_mismatch', `Timeline state template version mismatch: ${binding.templateId}`)
    }
    const value = deepMerge(template.initial, binding.initial ?? {})
    validateStateValue(value, template.schema, binding.path)
    setObjectPath(result, binding.path.split('.'), value)
  }
  return result
}

export function validateStateValue(value: JsonValue, schema: JsonObject, path = '$'): void {
  const type = schema.type
  if (typeof type === 'string' && !matchesType(value, type)) {
    throw new StateDefinitionError('state.schema_type', `Expected ${type} at ${path}`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => jsonEquals(candidate, value))) {
    throw new StateDefinitionError('state.schema_enum', `Value is not allowed at ${path}`)
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      throw new StateDefinitionError('state.schema_minimum', `Value is below minimum at ${path}`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      throw new StateDefinitionError('state.schema_maximum', `Value is above maximum at ${path}`)
    }
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      throw new StateDefinitionError('state.schema_min_length', `String is shorter than minLength at ${path}`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      throw new StateDefinitionError('state.schema_max_length', `String is longer than maxLength at ${path}`)
    }
  }
  if (Array.isArray(value)) {
    if (isJsonObject(schema.items)) {
      value.forEach((item, index) => validateStateValue(item, schema.items as JsonObject, `${path}/${index}`))
    }
    return
  }
  if (!isJsonObject(value)) return
  const properties = isJsonObject(schema.properties) ? schema.properties : {}
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key === 'string' && !(key in value)) {
        throw new StateDefinitionError('state.schema_required', `Required property is missing at ${path}/${key}`)
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key]
    if (isJsonObject(childSchema)) {
      validateStateValue(child, childSchema, `${path}/${key}`)
    } else if (schema.additionalProperties === false) {
      throw new StateDefinitionError('state.schema_additional_property', `Additional property is not allowed at ${path}/${key}`)
    }
  }
}

export function toStateDefinitionEntry(document: DocumentRecord<StateDefinitionContent>): StateDefinitionEntry {
  return {
    ...document.content,
    id: document.id,
    version: document.version,
  }
}

function validateSchema(schema: JsonObject, path: string): void {
  const allowedTypes = new Set(['null', 'boolean', 'number', 'integer', 'string', 'array', 'object'])
  if (schema.type !== undefined && (typeof schema.type !== 'string' || !allowedTypes.has(schema.type))) {
    throw new StateDefinitionError('state.schema_invalid', `Schema type is unsupported: ${path}`)
  }
  if (schema.properties !== undefined && !isJsonObject(schema.properties)) {
    throw new StateDefinitionError('state.schema_invalid', `Schema properties must be an object: ${path}`)
  }
  if (isJsonObject(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!isJsonObject(child)) throw new StateDefinitionError('state.schema_invalid', `Property Schema must be an object: ${path}.properties.${key}`)
      validateSchema(child, `${path}.properties.${key}`)
    }
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(item => typeof item !== 'string'))) {
    throw new StateDefinitionError('state.schema_invalid', `Schema required must be a string array: ${path}`)
  }
  if (Array.isArray(schema.required) && new Set(schema.required).size !== schema.required.length) {
    throw new StateDefinitionError('state.schema_invalid', `Schema required entries must be unique: ${path}`)
  }
  if (schema.items !== undefined) {
    if (!isJsonObject(schema.items)) throw new StateDefinitionError('state.schema_invalid', `Schema items must be an object: ${path}`)
    validateSchema(schema.items, `${path}.items`)
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    throw new StateDefinitionError('state.schema_invalid', `Schema additionalProperties must be boolean: ${path}`)
  }
  for (const key of ['minimum', 'maximum'] as const) {
    if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) {
      throw new StateDefinitionError('state.schema_invalid', `Schema ${key} must be finite: ${path}`)
    }
  }
  for (const key of ['minLength', 'maxLength'] as const) {
    if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isInteger(schema[key]) || schema[key] < 0)) {
      throw new StateDefinitionError('state.schema_invalid', `Schema ${key} must be a non-negative integer: ${path}`)
    }
  }
  if (typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && schema.minimum > schema.maximum) {
    throw new StateDefinitionError('state.schema_invalid', `Schema minimum cannot exceed maximum: ${path}`)
  }
  if (typeof schema.minLength === 'number' && typeof schema.maxLength === 'number' && schema.minLength > schema.maxLength) {
    throw new StateDefinitionError('state.schema_invalid', `Schema minLength cannot exceed maxLength: ${path}`)
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw new StateDefinitionError('state.schema_invalid', `Schema enum must be a non-empty array: ${path}`)
  }
}

function validateOptionalLabel(value: string | undefined): void {
  if (value !== undefined && value.trim().length === 0) {
    throw new StateDefinitionError('state.definition_label_invalid', 'State definition label cannot be empty')
  }
}

function matchesType(value: JsonValue, type: string): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isJsonObject(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeof value === type
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(override)) {
    const current = result[key]
    result[key] = isJsonObject(current) && isJsonObject(value)
      ? deepMerge(current, value)
      : structuredClone(value)
  }
  return result
}

function setObjectPath(root: JsonObject, segments: string[], value: JsonObject): void {
  let current = root
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment]
    if (existing === undefined) {
      const child: JsonObject = {}
      current[segment] = child
      current = child
      continue
    }
    if (!isJsonObject(existing)) {
      throw new StateDefinitionError('state.binding_path_conflict', `Timeline state binding path conflicts at: ${segment}`)
    }
    current = existing
  }
  const key = segments.at(-1)!
  if (key in current) {
    throw new StateDefinitionError('state.binding_path_conflict', `Timeline state binding path conflicts at: ${segments.join('.')}`)
  }
  current[key] = structuredClone(value)
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
