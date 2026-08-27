import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { Card, StateDefinition, StateDefinitionDraft, StateSnapshot } from '../../../entities/index.js'

export function createSnapshotReplaceInput(snapshot: StateSnapshot, text: string) {
  return {
    target: snapshot.target,
    expectedRevisionId: snapshot.revisionId,
    operations: [{ op: 'set' as const, path: '', value: parseJsonObject(text, 'State Snapshot') }],
  }
}

export function parseCardStateConfig(text: string): {
  stateDefinitionIds: string[]
  timelineStateBindings: NonNullable<Card['timelineStateBindings']>
} {
  const value = parseJsonObject(text, 'Card State config')
  if (!Array.isArray(value.stateDefinitionIds) || !value.stateDefinitionIds.every(item => typeof item === 'string')) {
    throw new Error('Card State config stateDefinitionIds must be a string array')
  }
  if (!Array.isArray(value.timelineStateBindings)) {
    throw new Error('Card State config timelineStateBindings must be an array')
  }
  return {
    stateDefinitionIds: value.stateDefinitionIds,
    timelineStateBindings: value.timelineStateBindings as NonNullable<Card['timelineStateBindings']>,
  }
}

export function toStateDefinitionDraft(definition: StateDefinition): StateDefinitionDraft {
  const { id: _id, version: _version, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = definition
  return draft
}

function parseJsonObject(text: string, label: string): Record<string, ClientJsonValue> {
  const value = JSON.parse(text) as ClientJsonValue
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value
}
