import type { ContextAssetNode } from '../../../entities/index.js'

export type ActivationEditorMode = 'always' | 'manual' | 'keyword' | 'condition' | 'custom'
export type ActivationConditionPreset = 'agent.mode' | 'tags'
export type ActivationConditionValue = 'draft' | 'finalize' | 'scene:combat' | 'style:cinematic'

export type ActivationEditorDraft = {
  mode: ActivationEditorMode
  keywords: string
  conditionPreset: ActivationConditionPreset
  conditionValue: ActivationConditionValue
}

type ContextActivation = NonNullable<ContextAssetNode['capabilities']>['activation']

export function readActivationDraft(node: ContextAssetNode): ActivationEditorDraft {
  const activation = node.capabilities?.activation
  if (!activation) return defaultDraft('always')
  if (activation.kind === 'always' || activation.kind === 'manual') return defaultDraft(activation.kind)
  if (activation.kind === 'keyword') {
    return {
      ...defaultDraft('keyword'),
      keywords: activation.keywords?.join(', ') ?? '',
    }
  }
  if (activation.kind === 'condition' && activation.conditions?.length === 1) {
    const condition = activation.conditions[0]
    if (condition?.fact === 'agent.mode' && (condition.equals === 'draft' || condition.equals === 'finalize')) {
      return {
        ...defaultDraft('condition'),
        conditionPreset: 'agent.mode',
        conditionValue: condition.equals,
      }
    }
    if (condition?.fact === 'tags' && (condition.includes === 'scene:combat' || condition.includes === 'style:cinematic')) {
      return {
        ...defaultDraft('condition'),
        conditionPreset: 'tags',
        conditionValue: condition.includes,
      }
    }
  }
  return defaultDraft('custom')
}

export function buildActivationUpdate(input: {
  draft: ActivationEditorDraft
  node: ContextAssetNode
}): Partial<ContextAssetNode> {
  if (input.draft.mode === 'custom') return {}
  const activation = writeActivation(input.draft)
  const lifecycle = readLifecycle(input.draft.mode)

  return {
    capabilities: {
      ...input.node.capabilities,
      activation,
      lifecycle: { lifecycle },
    },
    ...(input.node.projection ? {
      projection: {
        ...input.node.projection,
        lifecycle,
      },
    } : {}),
  }
}

export function updateActivationDraft(
  draft: ActivationEditorDraft,
  partial: Partial<ActivationEditorDraft>,
): ActivationEditorDraft {
  const next = { ...draft, ...partial }
  if (partial.conditionPreset === 'agent.mode' && !isAgentMode(next.conditionValue)) {
    return { ...next, conditionValue: 'draft' }
  }
  if (partial.conditionPreset === 'tags' && !isTagValue(next.conditionValue)) {
    return { ...next, conditionValue: 'scene:combat' }
  }
  return next
}

export function normalizeKeywords(value: string): string[] {
  return [...new Set(value
    .split(',')
    .map(keyword => keyword.trim())
    .filter(Boolean))]
}

function writeActivation(draft: ActivationEditorDraft): ContextActivation {
  if (draft.mode === 'always' || draft.mode === 'manual') return { kind: draft.mode }
  if (draft.mode === 'keyword') return { kind: 'keyword', keywords: normalizeKeywords(draft.keywords) }
  if (draft.conditionPreset === 'agent.mode') {
    const value = isAgentMode(draft.conditionValue) ? draft.conditionValue : 'draft'
    return { kind: 'condition', conditions: [{ fact: 'agent.mode', equals: value }] }
  }
  const value = isTagValue(draft.conditionValue) ? draft.conditionValue : 'scene:combat'
  return { kind: 'condition', conditions: [{ fact: 'tags', includes: value }] }
}

function defaultDraft(mode: ActivationEditorMode): ActivationEditorDraft {
  return {
    mode,
    keywords: '',
    conditionPreset: 'agent.mode',
    conditionValue: 'draft',
  }
}

function readLifecycle(mode: ActivationEditorMode): string {
  if (mode === 'keyword') return 'keyword'
  if (mode === 'manual') return 'manual'
  if (mode === 'condition') return 'conditional'
  return 'always'
}

function isAgentMode(value: ActivationConditionValue): value is 'draft' | 'finalize' {
  return value === 'draft' || value === 'finalize'
}

function isTagValue(value: ActivationConditionValue): value is 'scene:combat' | 'style:cinematic' {
  return value === 'scene:combat' || value === 'style:cinematic'
}
