import type { JsonObject, MacroInspection, MacroSelectionMap, MacroOptions } from '@loom-studio/shared'
import { normalizeMacroSelections, macroSelectionMatches } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument, writeDocument } from '../foundation/document-store.js'
import { narrativeWriteContext, requireDocumentParticipant } from './context.js'
import { readTimelinePresetConfig, timelinePresetConfigId } from '../prompt/timeline-preset-config.js'
import type { TimelinePresetConfigContent } from '../prompt/timeline-preset-config.js'
import type { RuntimeRequestContext } from '../types.js'
import { readMappedResource } from '../prompt/prompt-resource-mapper.js'
import { createVariableRenderContext, type VariableRenderContext } from '../prompt/variables.js'
import { readAgentTurnVariables } from './narrative-runtime.js'
import { readTimelineRuntimeContext } from '../narrative/timeline-runtime-context.js'
import { getApplicationStateSnapshot } from '../state/state.js'
import type { ApplicationStateContext } from '../state/state.js'
import type {
  CardSourceContent,
  InspectMacrosInput,
} from '../types.js'
import type { MacroStaticSource } from '../prompt/macro-provider-registry.js'

type MacroRuntimeContext = ApplicationStateContext & Pick<ApplicationRuntimeContext,
  'macroProviders' | 'now' | 'promptResources'
>

export function createMacroConfigurationRuntimeMethods(ctx: MacroRuntimeContext) {
  async function assertTarget(input: { timelineId: string; presetId: string }) {
    if (!ctx.narratives || !await ctx.narratives.getTimeline(input.timelineId)) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
    const resource = await readMappedResource(ctx.promptResources, input.presetId)
    if (resource.resourceKind !== 'preset') throw new Error('Macro configuration requires a Preset')
  }
  return {
    getTimelinePresetConfig: async (input: { timelineId: string; presetId: string }) => {
      await assertTarget(input)
      return { config: await readTimelinePresetConfig(ctx.documents, input.timelineId, input.presetId) }
    },
    updateTimelinePresetConfig: async (
      input: { timelineId: string; presetId: string; expectedVersion: number; macroSelections: MacroSelectionMap },
      context?: RuntimeRequestContext,
    ) => {
      await assertTarget(input)
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error('Invalid configuration version')
      const macroSelections = normalizeMacroSelections(input.macroSelections)
      const { macroInspection } = await inspectApplicationMacros(ctx, {
        presetId: input.presetId, timelineTarget: { timelineId: input.timelineId }, macroSelections,
      })
      for (const [name, selection] of Object.entries(macroSelections)) {
        const entry = macroInspection.entries.find(entry => entry.name.toLowerCase() === name)
        if (!entry?.candidates.some(candidate => macroSelectionMatches(selection, candidate))) {
          throw new Error(`Macro candidate is unavailable: ${name}`)
        }
      }
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(context, 'application.updateTimelinePresetConfig'),
        dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
          if (!ctx.narratives!.transaction(dataTx).getTimeline(input.timelineId)) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
          return writeDocument<TimelinePresetConfigContent>(documents, {
            id: timelinePresetConfigId(input.timelineId, input.presetId),
            type: applicationDocumentTypes.timelinePresetConfig,
            content: { timelineId: input.timelineId, presetId: input.presetId, macroSelections },
            expectedVersion: input.expectedVersion === 0 ? 'new' : input.expectedVersion,
          })
        }),
      )
      return { config: { ...result.value.value.content, version: result.value.value.version }, mutation: { changesetId: result.commit.changesetId } }
    },
  }
}

export async function inspectApplicationMacros(
  ctx: MacroRuntimeContext,
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
    const cardId = page.timeline.createdFrom?.cardId
    const cardDocument = cardId ? await ctx.documents.get(cardId) : null
    if (cardDocument && cardDocument.type !== applicationDocumentTypes.cardSource) throw new Error(`Unexpected Card document type: ${cardId}`)
    const card = cardDocument?.content as CardSourceContent | undefined
    const state = await getApplicationStateSnapshot(ctx, {
      scope: 'timeline',
      timelineId: page.timeline.id,
      branchId: page.branch.id,
    })
    base = await readAgentTurnVariables(ctx, card ? card.userName : runtimeContext?.fallbackUserName, state.value, card?.name ?? runtimeContext?.cardName)
    context = {
      global: base.snapshot.global,
      timeline: state.value,
      cardId,
      ...(preset ? { presetId: preset.id } : {}),
    }
    if (card && (card.macros || card.macroOptions)) {
      staticSources.push({ sourceId: `card:${cardId}`, sourceKind: 'card', sourceLabel: `Card ${cardId}`, macros: card.macros ?? {}, macroOptions: card.macroOptions })
    }
  } else if (input.cardId) {
    const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
    base = await readAgentTurnVariables(ctx, card.content.userName, undefined, card.content.name)
    context = { global: base.snapshot.global, cardId: card.id, ...(preset ? { presetId: preset.id } : {}) }
    if (card.content.macros || card.content.macroOptions) staticSources.push({ sourceId: `card:${card.id}`, sourceKind: 'card', sourceLabel: `Card ${card.id}`, macros: card.content.macros ?? {}, macroOptions: card.content.macroOptions })
  } else {
    base = await readAgentTurnVariables(ctx, undefined)
    context = { global: base.snapshot.global, ...(preset ? { presetId: preset.id } : {}) }
  }

  if (preset && (preset.macros || preset.macroOptions)) staticSources.push({ sourceId: `preset:${preset.id}`, sourceKind: 'preset', sourceLabel: `Preset ${preset.id}`, macros: preset.macros ?? {}, macroOptions: preset.macroOptions })
  const savedSelections = input.timelineTarget && input.presetId
    ? (await readTimelinePresetConfig(ctx.documents, input.timelineTarget.timelineId, input.presetId)).macroSelections
    : undefined
  const macroInspection = await ctx.macroProviders.inspect({
    snapshot: base.snapshot,
    context,
    staticSources,
    macroSelections: input.macroSelections === undefined ? savedSelections : normalizeMacroSelections(input.macroSelections),
    capturedAt: ctx.now(),
  })
  return { macroInspection }
}

export async function inspectPreparedMacros(input: {
  ctx: Pick<ApplicationRuntimeContext, 'macroProviders' | 'now'>
  variables: VariableRenderContext
  cardId?: string
  presetId?: string
  timeline?: JsonObject
  cardMacros?: Record<string, string>
  presetMacros?: Record<string, string>
  cardMacroOptions?: MacroOptions
  presetMacroOptions?: MacroOptions
  macroSelections?: MacroSelectionMap
}): Promise<MacroInspection> {
  const staticSources: MacroStaticSource[] = []
  if (input.cardId && (input.cardMacros || input.cardMacroOptions)) staticSources.push({ sourceId: `card:${input.cardId}`, sourceKind: 'card', sourceLabel: `Card ${input.cardId}`, macros: input.cardMacros ?? {}, macroOptions: input.cardMacroOptions })
  if (input.presetId && (input.presetMacros || input.presetMacroOptions)) staticSources.push({ sourceId: `preset:${input.presetId}`, sourceKind: 'preset', sourceLabel: `Preset ${input.presetId}`, macros: input.presetMacros ?? {}, macroOptions: input.presetMacroOptions })
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
