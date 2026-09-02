import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { renderVariableMacros, type VariableRenderContext } from '../prompt/variables.js'
import {
  evaluatePromptActivation,
  type ActivationFacts,
  type PromptActivation,
} from '../prompt/prompt-activation.js'
import type {
  ToolDefinition,
  ToolInputDefinition,
  ToolTransport,
} from './tool-registry.js'

export type ToolPromptTemplate = {
  description: string
  parameterDescriptions?: Readonly<Record<string, string>>
  guidance?: string
}

export type ToolContentPlacement = {
  targetAnchorId: string
  localDepth: number
}

export type ToolPromptSource = {
  tool: ToolDefinition
  template: ToolPromptTemplate
  activation?: PromptActivation
  providerOrder?: number
  contentPlacement?: ToolContentPlacement
  transport: ToolTransport
}

export type CompiledToolPrompt = {
  description: string
  parameterDescriptions?: Record<string, string>
  guidance?: string
}

export type CompiledToolExposure = {
  toolId: string
  owner: ToolDefinition['owner']
  name: string
  transport: ToolTransport
  active: true
  input: ToolInputDefinition
  prompt: CompiledToolPrompt
  order: {
    requestedIndex: number
    effectiveIndex: number
  }
}

export type ToolPromptActivationTrace = {
  toolId: string
  active: boolean
  reason: string
}

export type ToolPromptOrderTrace = {
  toolId: string
  requestedIndex: number
  effectiveIndex?: number
  projection: 'provider-tools' | 'content-message'
  zone?: string
  slot?: string
  rankKey?: string
  orderHint?: number
  providerOrder?: number
}

export type ToolPromptBuildTrace = {
  sourceCount: number
  activeCount: number
  requestedOrder: string[]
  effectiveOrder: string[]
  activations: ToolPromptActivationTrace[]
  orders: ToolPromptOrderTrace[]
}

export type ToolPromptBuildResult = {
  exposures: CompiledToolExposure[]
  trace: ToolPromptBuildTrace
}

export type ToolPromptBuildInput = {
  sources: readonly ToolPromptSource[]
  variables: VariableRenderContext
  currentInput?: string
  activationFacts?: ActivationFacts
}

/**
 * Compiles the model-visible part of selected tools without producing a Provider payload.
 * Structural tool identity and input definitions are deliberately copied unchanged.
 */
export function compileToolPromptSources(
  input: ToolPromptBuildInput,
): ToolPromptBuildResult {
  const requested = input.sources.map((source, sourceIndex) => ({
    source,
    sourceIndex,
    activation: evaluatePromptActivation({
      activation: source.activation,
      currentInput: input.currentInput,
      facts: input.activationFacts,
    }),
    prompt: compilePromptTemplate(source.template, input.variables),
  })).sort(compareRequestedOrder)
  const active = requested.filter(item => item.activation.active)
  assertUniqueExposedNames(active)
  const requestedIndexByToolId = new Map(
    requested.map((item, index) => [item.source.tool.id, index]),
  )

  const exposures = active.map((item, effectiveIndex) => ({
    toolId: item.source.tool.id,
    owner: { ...item.source.tool.owner },
    name: item.source.tool.name,
    transport: item.source.transport,
    active: true as const,
    input: cloneToolInputDefinition(item.source.tool.input),
    prompt: item.prompt,
    order: {
      requestedIndex: requestedIndexByToolId.get(item.source.tool.id) ?? effectiveIndex,
      effectiveIndex,
    },
  }))

  const effectiveIndexByToolId = new Map(
    exposures.map((exposure, index) => [exposure.toolId, index]),
  )

  return {
    exposures,
    trace: {
      sourceCount: input.sources.length,
      activeCount: active.length,
      requestedOrder: requested.map(item => item.source.tool.id),
      effectiveOrder: exposures.map(exposure => exposure.toolId),
      activations: [...requested]
        .sort((left, right) => left.sourceIndex - right.sourceIndex)
        .map(item => ({
        toolId: item.source.tool.id,
        active: item.activation.active,
        reason: item.activation.reason,
        })),
      orders: requested.map(item => ({
        toolId: item.source.tool.id,
        requestedIndex: requestedIndexByToolId.get(item.source.tool.id) ?? item.sourceIndex,
        ...(effectiveIndexByToolId.has(item.source.tool.id)
          ? { effectiveIndex: effectiveIndexByToolId.get(item.source.tool.id) }
          : {}),
        projection: item.source.transport === 'content' ? 'content-message' : 'provider-tools',
        ...(item.source.transport !== 'content' || item.source.contentPlacement === undefined ? {} : {
          targetAnchorId: item.source.contentPlacement.targetAnchorId,
          localDepth: item.source.contentPlacement.localDepth,
        }),
        ...(item.source.transport === 'content' || item.source.providerOrder === undefined
          ? {}
          : { providerOrder: item.source.providerOrder }),
      })),
    },
  }
}

function assertUniqueExposedNames(
  items: Array<{ source: ToolPromptSource }>,
): void {
  const toolIdByName = new Map<string, string>()
  for (const item of items) {
    const existingToolId = toolIdByName.get(item.source.tool.name)
    if (existingToolId) {
      throw new Error(
        `Agent tools expose duplicate model name ${item.source.tool.name}: ${existingToolId}, ${item.source.tool.id}`,
      )
    }
    toolIdByName.set(item.source.tool.name, item.source.tool.id)
  }
}

function compilePromptTemplate(
  template: ToolPromptTemplate,
  variables: VariableRenderContext,
): CompiledToolPrompt {
  return {
    description: renderVariableMacros(template.description, variables),
    ...(template.parameterDescriptions === undefined
      ? {}
      : {
          parameterDescriptions: Object.fromEntries(
            Object.entries(template.parameterDescriptions).map(([key, value]) => [
              key,
              renderVariableMacros(value, variables),
            ]),
          ),
        }),
    ...(template.guidance === undefined
      ? {}
      : { guidance: renderVariableMacros(template.guidance, variables) }),
  }
}

function compareRequestedOrder(
  left: { source: ToolPromptSource; sourceIndex: number },
  right: { source: ToolPromptSource; sourceIndex: number },
): number {
  const leftContent = left.source.transport === 'content'
  const rightContent = right.source.transport === 'content'
  if (leftContent !== rightContent) return leftContent ? 1 : -1

  if (!leftContent && !rightContent) {
    const providerOrderComparison = compareOptionalNumber(
      left.source.providerOrder,
      right.source.providerOrder,
    )
    if (providerOrderComparison !== 0) return providerOrderComparison
    return left.sourceIndex - right.sourceIndex
  }

  const leftSlot = left.source.contentPlacement ?? {
    targetAnchorId: '@chat.tools',
    localDepth: 0,
  }
  const rightSlot = right.source.contentPlacement ?? {
    targetAnchorId: '@chat.tools',
    localDepth: 0,
  }

  const anchorComparison = compareText(leftSlot.targetAnchorId, rightSlot.targetAnchorId)
  if (anchorComparison !== 0) return anchorComparison

  const depthComparison = leftSlot.localDepth - rightSlot.localDepth
  if (depthComparison !== 0) return depthComparison

  const sourceIndexComparison = left.sourceIndex - right.sourceIndex
  if (sourceIndexComparison !== 0) return sourceIndexComparison

  return compareText(left.source.tool.id, right.source.tool.id)
}

function compareOptionalText(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  return compareText(left, right)
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0
  return (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function cloneToolInputDefinition(input: ToolInputDefinition): ToolInputDefinition {
  if (input.kind === 'structured') {
    return { kind: input.kind, schema: cloneJsonObject(input.schema) }
  }

  if (input.kind === 'freeform') {
    return {
      kind: 'freeform',
      mediaType: input.mediaType,
      ...(input.grammar === undefined ? {} : { grammar: { ...input.grammar } }),
      ...(input.structuredFallback === undefined
        ? {}
        : { structuredFallback: { schema: cloneJsonObject(input.structuredFallback.schema) } }),
    }
  }

  return {
    kind: 'hybrid',
    mediaType: input.mediaType,
    rawField: input.rawField,
    metadataSchema: cloneJsonObject(input.metadataSchema),
    ...(input.grammar === undefined ? {} : { grammar: { ...input.grammar } }),
    ...(input.structuredFallback === undefined
      ? {}
      : { structuredFallback: { schema: cloneJsonObject(input.structuredFallback.schema) } }),
  }
}

function cloneJsonObject(input: JsonObject): JsonObject {
  return cloneJsonValue(input) as JsonObject
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    )
  }
  return value
}
