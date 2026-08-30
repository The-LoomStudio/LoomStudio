import type {
  ApplicationRuntime,
  RuntimeRequestContext,
  StateDefinitionDraft,
  StateMutationOperation,
  StateTarget,
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readString,
} from '../../rpc-params.js'

export async function handleStatesRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.getStateSnapshot':
      return await runtime.getStateSnapshot({
        target: readStateTarget(params),
      }) as unknown as JsonValue

    case 'application.applyStateMutation':
      return await runtime.applyStateMutation({
        target: readStateTarget(params),
        expectedRevisionId: readString(params, 'expectedRevisionId'),
        operations: readStateMutationOperations(params),
        idempotencyKey: readOptionalString(params, 'idempotencyKey'),
      }, context) as unknown as JsonValue

    case 'application.listStateDefinitions':
      return await runtime.listStateDefinitions({ kind: readOptionalStateDefinitionKind(params, 'kind') }) as unknown as JsonValue

    case 'application.getStateDefinition':
      return await runtime.getStateDefinition({ definitionId: readString(params, 'definitionId') }) as unknown as JsonValue

    case 'application.upsertStateDefinition':
      return await runtime.upsertStateDefinition({
        definitionId: readString(params, 'definitionId'),
        expectedVersion: readOptionalNumber(params, 'expectedVersion'),
        definition: readStateDefinitionDraft(params),
      }, context) as unknown as JsonValue

    case 'application.deleteStateDefinition':
      return await runtime.deleteStateDefinition({
        definitionId: readString(params, 'definitionId'),
        expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}

function readStateTarget(params: JsonValue | undefined): StateTarget {
  const value = readOptionalObject(params, 'target')
  if (!value) throw new Error('Expected object param: target')
  if (value.scope === 'global') return { scope: 'global' }
  if (value.scope === 'timeline') {
    if (typeof value.timelineId !== 'string' || value.timelineId.length === 0) {
      throw new Error('Expected string param: target.timelineId')
    }
    if (typeof value.branchId !== 'string' || value.branchId.length === 0) {
      throw new Error('Expected string param: target.branchId')
    }
    return { scope: 'timeline', timelineId: value.timelineId, branchId: value.branchId }
  }
  throw new Error('Expected state target scope: target.scope')
}

function readStateMutationOperations(params: JsonValue | undefined): StateMutationOperation[] {
  if (!isRecord(params) || !Array.isArray(params.operations)) {
    throw new Error('Expected array param: operations')
  }
  return params.operations.map((value, index) => {
    if (!isRecord(value) || typeof value.path !== 'string') {
      throw new Error(`Expected state mutation operation: operations[${index}]`)
    }
    if (value.op === 'set') {
      if (!Object.hasOwn(value, 'value')) throw new Error(`Expected state set value: operations[${index}].value`)
      return { op: 'set', path: value.path, value: value.value as JsonValue }
    }
    if (value.op === 'remove') return { op: 'remove', path: value.path }
    if (value.op === 'increment') {
      if (typeof value.by !== 'number' || !Number.isFinite(value.by)) {
        throw new Error(`Expected finite state increment: operations[${index}].by`)
      }
      return { op: 'increment', path: value.path, by: value.by }
    }
    throw new Error(`Expected state mutation op: operations[${index}].op`)
  })
}

function readOptionalStateDefinitionKind(params: JsonValue | undefined, key: string): StateDefinitionDraft['kind'] | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (value === 'global' || value === 'timeline-template') return value
  throw new Error(`Expected State Definition kind: ${key}`)
}

function readStateDefinitionDraft(params: JsonValue | undefined): StateDefinitionDraft {
  const value = readOptionalObject(params, 'definition')
  if (!value) throw new Error('Expected object param: definition')
  if (!isRecord(value.schema)) throw new Error('Expected object param: definition.schema')
  const label = typeof value.label === 'string' ? value.label : undefined
  if (value.kind === 'global') {
    if (typeof value.path !== 'string') throw new Error('Expected string param: definition.path')
    if (value.readOnly !== undefined && typeof value.readOnly !== 'boolean') throw new Error('Expected boolean param: definition.readOnly')
    return {
      kind: 'global',
      path: value.path,
      schema: value.schema,
      ...(Object.hasOwn(value, 'default') ? { default: value.default as JsonValue } : {}),
      ...(typeof value.readOnly === 'boolean' ? { readOnly: value.readOnly } : {}),
      ...(label !== undefined ? { label } : {}),
    }
  }
  if (value.kind === 'timeline-template') {
    if (typeof value.templateVersion !== 'number') throw new Error('Expected number param: definition.templateVersion')
    if (!isRecord(value.initial)) throw new Error('Expected object param: definition.initial')
    return {
      kind: 'timeline-template',
      templateVersion: value.templateVersion,
      schema: value.schema,
      initial: value.initial,
      ...(label !== undefined ? { label } : {}),
    }
  }
  throw new Error('Expected State Definition kind: definition.kind')
}
