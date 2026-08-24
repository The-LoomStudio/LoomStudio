import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { runPasses, type Fragment, type Pass } from '@loom/core'
import { renderMacros } from '../card.js'
import {
  evaluatePromptActivation,
  type ActivationFacts,
  type PromptActivation,
} from '../prompt-activation.js'
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
  zone: string
  slot: string
  rankKey?: string
  orderHint?: number
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
  coreExecutions: Array<{
    passName: string
    passIndex: number
    mutationCount: number
  }>
}

export type ToolPromptBuildResult = {
  exposures: CompiledToolExposure[]
  trace: ToolPromptBuildTrace
}

export type ToolPromptBuildInput = {
  sources: readonly ToolPromptSource[]
  macroContext: { user: string }
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
  const initial = input.sources.map(
    (source, sourceIndex): Fragment<ToolPromptCoreMeta> => ({
      id: `tool.prompt:${source.tool.id}`,
      content: source.template.description,
      meta: { toolPrompt: { source, sourceIndex } },
    }),
  )
  const passes: Pass<ToolPromptCoreMeta>[] = [
    {
      name: 'tool.prompt.materialize',
      version: '1',
      run: (fragments) =>
        fragments.map((fragment) => {
          const meta = readSourceCoreMeta(fragment)
          const activation = evaluatePromptActivation({
            activation: meta.source.activation,
            currentInput: input.currentInput,
            facts: input.activationFacts,
          })
          const prompt = compilePromptTemplate(
            meta.source.template,
            input.macroContext,
          )
          return {
            ...fragment,
            content: prompt.description,
            meta: {
              ...fragment.meta,
              toolPrompt: { ...meta, activation, prompt },
            },
          }
        }),
    },
    {
      name: 'tool.prompt.order',
      version: '1',
      run: (fragments) =>
        [...fragments].sort((left, right) =>
          compareRequestedOrder(readCoreMeta(left), readCoreMeta(right)),
        ),
    },
  ]
  const core = runPasses({ fragments: initial, passes })
  if (core.status === 'error')
    throw new Error(core.error?.message ?? 'Tool Prompt Build failed')
  const requested = core.fragments.map(readCoreMeta)
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
          zone: item.source.contentPlacement.zone,
          slot: item.source.contentPlacement.slot,
          ...(item.source.contentPlacement.rankKey === undefined ? {} : { rankKey: item.source.contentPlacement.rankKey }),
          ...(item.source.contentPlacement.orderHint === undefined ? {} : { orderHint: item.source.contentPlacement.orderHint }),
        }),
        ...(item.source.transport === 'content' || item.source.providerOrder === undefined
          ? {}
          : { providerOrder: item.source.providerOrder }),
      })),
      coreExecutions: core.trace.executions.map((execution) => ({
        passName: execution.passName,
        passIndex: execution.passIndex,
        mutationCount: execution.mutations.length,
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

type ToolPromptCoreMeta = {
  toolPrompt: {
    source: ToolPromptSource
    sourceIndex: number
    activation?: ReturnType<typeof evaluatePromptActivation>
    prompt?: CompiledToolPrompt
  }
}

function readSourceCoreMeta(fragment: Fragment<ToolPromptCoreMeta>): {
  source: ToolPromptSource
  sourceIndex: number
} {
  const meta = fragment.meta?.toolPrompt
  if (!meta)
    throw new Error(`Tool Prompt fragment has no source meta: ${fragment.id}`)
  return { source: meta.source, sourceIndex: meta.sourceIndex }
}

function readCoreMeta(fragment: Fragment<ToolPromptCoreMeta>): {
  source: ToolPromptSource
  sourceIndex: number
  activation: ReturnType<typeof evaluatePromptActivation>
  prompt: CompiledToolPrompt
} {
  const meta = fragment.meta?.toolPrompt
  if (!meta?.activation || !meta.prompt)
    throw new Error(`Tool Prompt fragment is not materialized: ${fragment.id}`)
  return {
    source: meta.source,
    sourceIndex: meta.sourceIndex,
    activation: meta.activation,
    prompt: meta.prompt,
  }
}

function compilePromptTemplate(
  template: ToolPromptTemplate,
  macroContext: { user: string },
): CompiledToolPrompt {
  return {
    description: renderMacros(template.description, macroContext),
    ...(template.parameterDescriptions === undefined
      ? {}
      : {
          parameterDescriptions: Object.fromEntries(
            Object.entries(template.parameterDescriptions).map(([key, value]) => [
              key,
              renderMacros(value, macroContext),
            ]),
          ),
        }),
    ...(template.guidance === undefined
      ? {}
      : { guidance: renderMacros(template.guidance, macroContext) }),
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
    zone: 'tools',
    slot: `${left.source.tool.owner.namespace}-tools`,
  }
  const rightSlot = right.source.contentPlacement ?? {
    zone: 'tools',
    slot: `${right.source.tool.owner.namespace}-tools`,
  }

  const zoneComparison = compareText(leftSlot.zone, rightSlot.zone)
  if (zoneComparison !== 0) return zoneComparison

  const rankComparison = compareOptionalText(leftSlot.rankKey, rightSlot.rankKey)
  if (rankComparison !== 0) return rankComparison

  const slotHintComparison = compareOptionalNumber(leftSlot.orderHint, rightSlot.orderHint)
  if (slotHintComparison !== 0) return slotHintComparison

  const slotComparison = compareText(leftSlot.slot, rightSlot.slot)
  if (slotComparison !== 0) return slotComparison

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
