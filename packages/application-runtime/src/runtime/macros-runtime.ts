import type { JsonObject, MacroInspection, MacroSelectionMap } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument } from '../foundation/document-store.js'
import { readMappedResource } from '../prompt/prompt-resource-mapper.js'
import { createVariableRenderContext, type VariableRenderContext } from '../prompt/variables.js'
import { readAgentTurnVariables } from './narrative-runtime.js'
import { readTimelineRuntimeContext } from '../narrative/timeline-runtime-context.js'
import { getApplicationStateSnapshot } from '../state/state.js'
import type {
  CardSourceContent,
  InspectMacrosInput,
} from '../types.js'
import type { MacroStaticSource } from '../prompt/macro-provider-registry.js'

export async function inspectApplicationMacros(
  ctx: ApplicationRuntimeContext,
  input: InspectMacrosInput,
): Promise<{ macroInspection: MacroInspection }> {
  if (input.cardId && input.timelineTarget) throw new Error('Card and Timeline macro targets are mutually exclusive')
  const preset = input.presetId ? await readMappedResource(ctx.promptResources, input.presetId) : undefined
  if (preset && preset.resourceKind !== 'preset') throw new Error(`Prompt resource is not a Preset: ${input.presetId}`)

  let base: VariableRenderContext
  let context: { cardId?: string; presetId?: string; global: JsonObject; timeline?: JsonObject }
  const staticSources: MacroStaticSource[] = []

  if (input.timelineTarget) {
    if (!ctx.narratives) throw new Error('Narrative Store is not configured')
    const page = await ctx.narratives.getPage({
      timelineId: input.timelineTarget.timelineId,
      branchId: input.timelineTarget.branchId,
      limit: 1,
    })
    const runtimeContext = await readTimelineRuntimeContext(ctx, page.timeline.id)
    const state = await getApplicationStateSnapshot(ctx, {
      scope: 'timeline',
      timelineId: page.timeline.id,
      branchId: page.branch.id,
    })
    base = await readAgentTurnVariables(ctx, runtimeContext?.fallbackUserName, state.value, runtimeContext?.cardName)
    context = {
      global: base.snapshot.global,
      timeline: state.value,
      cardId: runtimeContext?.sourceCardId,
      ...(preset ? { presetId: preset.id } : {}),
    }
    if (runtimeContext?.macros && runtimeContext.sourceCardId) {
      staticSources.push({ sourceId: `card:${runtimeContext.sourceCardId}`, sourceKind: 'card', sourceLabel: `Card ${runtimeContext.sourceCardId}`, macros: runtimeContext.macros })
    }
  } else if (input.cardId) {
    const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
    base = await readAgentTurnVariables(ctx, card.content.userName, undefined, card.content.name)
    context = { global: base.snapshot.global, cardId: card.id, ...(preset ? { presetId: preset.id } : {}) }
    if (card.content.macros) staticSources.push({ sourceId: `card:${card.id}`, sourceKind: 'card', sourceLabel: `Card ${card.id}`, macros: card.content.macros })
  } else {
    base = await readAgentTurnVariables(ctx, undefined)
    context = { global: base.snapshot.global, ...(preset ? { presetId: preset.id } : {}) }
  }

  if (preset?.macros) staticSources.push({ sourceId: `preset:${preset.id}`, sourceKind: 'preset', sourceLabel: `Preset ${preset.id}`, macros: preset.macros })
  const macroInspection = await ctx.macroProviders.inspect({
    snapshot: base.snapshot,
    context,
    staticSources,
    macroSelections: input.macroSelections,
    capturedAt: ctx.now(),
  })
  return { macroInspection }
}

export async function inspectPreparedMacros(input: {
  ctx: ApplicationRuntimeContext
  variables: VariableRenderContext
  cardId?: string
  presetId?: string
  timeline?: JsonObject
  cardMacros?: Record<string, string>
  presetMacros?: Record<string, string>
  macroSelections?: MacroSelectionMap
}): Promise<MacroInspection> {
  const staticSources: MacroStaticSource[] = []
  if (input.cardId && input.cardMacros) staticSources.push({ sourceId: `card:${input.cardId}`, sourceKind: 'card', sourceLabel: `Card ${input.cardId}`, macros: input.cardMacros })
  if (input.presetId && input.presetMacros) staticSources.push({ sourceId: `preset:${input.presetId}`, sourceKind: 'preset', sourceLabel: `Preset ${input.presetId}`, macros: input.presetMacros })
  return await input.ctx.macroProviders.inspect({
    snapshot: input.variables.snapshot,
    context: {
      global: input.variables.snapshot.global,
      ...(input.timeline ? { timeline: input.timeline } : {}),
      ...(input.cardId ? { cardId: input.cardId } : {}),
      ...(input.presetId ? { presetId: input.presetId } : {}),
    },
    staticSources,
    macroSelections: input.macroSelections,
    capturedAt: input.ctx.now(),
  })
}

export function variableContextFromInspection(inspection: MacroInspection): VariableRenderContext {
  const context = createVariableRenderContext({
    global: inspection.snapshot.global,
    ...(inspection.snapshot.timeline ? { timeline: inspection.snapshot.timeline } : {}),
    computed: inspection.snapshot.computed,
    aliases: inspection.snapshot.aliases,
  })
  context.snapshot = inspection.snapshot
  return context
}
