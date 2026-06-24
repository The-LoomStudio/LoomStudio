import type { JsonObject, JsonValue } from '@loom-studio/shared'

export type ActivationFacts = JsonObject

export type ActivationCondition =
  | { fact: string; equals: JsonValue }
  | { fact: string; notEquals: JsonValue }
  | { fact: string; gt: number }
  | { fact: string; gte: number }
  | { fact: string; lt: number }
  | { fact: string; lte: number }
  | { fact: string; includes: JsonValue }
  | { fact: string; exists: boolean }
  | { allOf: ActivationCondition[] }
  | { anyOf: ActivationCondition[] }
  | { not: ActivationCondition }

export type PromptActivation =
  | { kind: 'always' }
  | { kind: 'manual' }
  | { kind: 'keyword'; keywords: string[]; caseSensitive?: boolean }
  | { kind: 'condition'; conditions: ActivationCondition[] }
  | { kind: 'all'; activations: PromptActivation[] }

export type ActivationEvaluation = {
  active: boolean
  reason: string
}

export function combineActivationGates(activations: PromptActivation[]): PromptActivation | undefined {
  if (activations.length === 0) return undefined
  if (activations.length === 1) return activations[0]
  return { kind: 'all', activations }
}

export function evaluatePromptActivation(input: {
  activation?: PromptActivation
  currentInput?: string
  facts?: ActivationFacts
}): ActivationEvaluation {
  const activation = input.activation ?? { kind: 'always' }

  if (activation.kind === 'always') return { active: true, reason: 'activation: always' }
  if (activation.kind === 'manual') return { active: false, reason: 'activation: manual' }
  if (activation.kind === 'all') {
    const evaluations = activation.activations.map(item => evaluatePromptActivation({
      activation: item,
      currentInput: input.currentInput,
      facts: input.facts,
    }))
    const inactive = evaluations.find(evaluation => !evaluation.active)
    return inactive
      ? { active: false, reason: `activation: all blocked (${inactive.reason})` }
      : { active: true, reason: 'activation: all matched' }
  }
  if (activation.kind === 'keyword') {
    const text = activation.caseSensitive ? input.currentInput ?? '' : (input.currentInput ?? '').toLocaleLowerCase()
    const hit = activation.keywords.some(keyword => text.includes(activation.caseSensitive ? keyword : keyword.toLocaleLowerCase()))
    return {
      active: hit,
      reason: hit ? 'activation: keyword matched' : 'activation: keyword not matched',
    }
  }

  const facts = input.facts ?? {}
  const active = activation.conditions.every(condition => evaluateCondition(condition, facts))

  return {
    active,
    reason: active ? 'activation: conditions matched' : 'activation: conditions not matched',
  }
}

export function evaluateCondition(condition: ActivationCondition, facts: ActivationFacts): boolean {
  if ('allOf' in condition) return condition.allOf.every(item => evaluateCondition(item, facts))
  if ('anyOf' in condition) return condition.anyOf.some(item => evaluateCondition(item, facts))
  if ('not' in condition) return !evaluateCondition(condition.not, facts)

  const actual = readFact(facts, condition.fact)

  if ('exists' in condition) return condition.exists ? actual !== undefined : actual === undefined
  if ('equals' in condition) return jsonEquals(actual, condition.equals)
  if ('notEquals' in condition) return !jsonEquals(actual, condition.notEquals)
  if ('includes' in condition) return valueIncludes(actual, condition.includes)
  if ('gt' in condition) return typeof actual === 'number' && actual > condition.gt
  if ('gte' in condition) return typeof actual === 'number' && actual >= condition.gte
  if ('lt' in condition) return typeof actual === 'number' && actual < condition.lt
  return typeof actual === 'number' && actual <= condition.lte
}

export function isPromptActivation(value: JsonValue | undefined): value is PromptActivation {
  if (!isObject(value) || typeof value.kind !== 'string') return false
  if (value.kind === 'always' || value.kind === 'manual') return true
  if (value.kind === 'keyword') {
    return Array.isArray(value.keywords)
      && value.keywords.every(keyword => typeof keyword === 'string')
      && (value.caseSensitive === undefined || typeof value.caseSensitive === 'boolean')
  }
  if (value.kind === 'all') {
    return Array.isArray(value.activations)
      && value.activations.every(isPromptActivation)
  }
  return value.kind === 'condition'
    && Array.isArray(value.conditions)
    && value.conditions.every(isActivationCondition)
}

export function isActivationCondition(value: JsonValue | undefined): value is ActivationCondition {
  if (!isObject(value)) return false
  if (typeof value.fact === 'string') {
    return Object.hasOwn(value, 'equals')
      || Object.hasOwn(value, 'notEquals')
      || typeof value.gt === 'number'
      || typeof value.gte === 'number'
      || typeof value.lt === 'number'
      || typeof value.lte === 'number'
      || Object.hasOwn(value, 'includes')
      || typeof value.exists === 'boolean'
  }
  if (Array.isArray(value.allOf)) return value.allOf.every(isActivationCondition)
  if (Array.isArray(value.anyOf)) return value.anyOf.every(isActivationCondition)
  return isActivationCondition(value.not)
}

function readFact(facts: ActivationFacts, path: string): JsonValue | undefined {
  if (Object.hasOwn(facts, path)) return facts[path]

  let cursor: JsonValue | undefined = facts
  for (const part of path.split('.')) {
    if (!isObject(cursor) || !Object.hasOwn(cursor, part)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

function valueIncludes(actual: JsonValue | undefined, expected: JsonValue): boolean {
  if (Array.isArray(actual)) return actual.some(item => jsonEquals(item, expected))
  return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue): boolean {
  if (left === right) return true
  if (left === undefined) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
