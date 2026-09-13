import type { MacroInspection } from '@loom-studio/shared'
import { useMemo } from 'react'
import type { Card, NarrativeBranch, NarrativeNode, NarrativeTimeline, PromptProjection } from '../entities/index.js'
import { buildPromptBuildSteps } from '../features/prompt-build/model/build-prompt-build-steps.js'
import { renderTemplateMacros, type MacroRenderContext } from '../features/state-variables/model/macro-renderer.js'
import { readEmptyTimelineText } from './utils.js'

type Translator = ReturnType<typeof import('../shared/i18n/index.js').createTranslator>

export function useStudioDerivedValues(input: {
  t: Translator
  timeline?: NarrativeTimeline
  branch?: NarrativeBranch
  selectedCard?: Card
  selectedCardDetails?: Card
  nodes: NarrativeNode[]
  narrativeInput: string
  promptMessages?: Parameters<typeof buildPromptBuildSteps>[0]['messages']
  promptProjection?: PromptProjection
  activationFacts: Parameters<typeof buildPromptBuildSteps>[0]['activationFacts']
  macroInspection?: MacroInspection
  lastRunMacroInspection?: MacroInspection
  promptPreviewMacroInspection?: MacroInspection
  sessionBusy: boolean
  agentSessionReady: boolean
  agentInput: string
  selectedAgentProfile?: object
  agentChatBusy: boolean
  macroPreview: { key: string; inspection?: MacroInspection }
  macroKey: string
  macroContextCard?: Card
}) {
  const macroContext = useMemo<MacroRenderContext>(() => ({
    snapshot: input.macroPreview.key === input.macroKey ? input.macroPreview.inspection?.snapshot : undefined,
    card: input.timeline ? undefined : input.macroContextCard,
  }), [input.macroKey, input.macroPreview, input.timeline, input.macroContextCard])

  const cardOpeningEntry = input.selectedCardDetails?.opening?.entries?.[0]?.content?.trim()
  const rawOpeningContent = cardOpeningEntry && cardOpeningEntry.length > 0
    ? cardOpeningEntry
    : input.t('timeline.opening.placeholder')
  const openingDraft = input.selectedCardDetails ? {
    content: cardOpeningEntry && cardOpeningEntry.length > 0
      ? renderTemplateMacros(rawOpeningContent, macroContext)
      : rawOpeningContent,
    isPlaceholder: !cardOpeningEntry || cardOpeningEntry.length === 0,
  } : undefined

  const canSend = Boolean(((input.timeline && input.branch) || input.selectedCardDetails) && input.selectedAgentProfile)
    && input.agentSessionReady
    && !input.sessionBusy
    && !input.agentChatBusy
    && input.narrativeInput.trim().length > 0
  const canSendAgent = Boolean(input.selectedAgentProfile)
    && input.agentSessionReady
    && input.agentInput.trim().length > 0
    && !input.agentChatBusy
    && !input.sessionBusy

  const promptBuildSteps = buildPromptBuildSteps({
    card: input.selectedCardDetails,
    timeline: input.timeline,
    branch: input.branch,
    nodes: input.nodes,
    input: input.narrativeInput,
    messages: input.promptMessages,
    projection: input.promptProjection,
    activationFacts: input.activationFacts,
    promptBuildTrace: undefined,
  }, input.t)

  const buildMacroInspection = [input.promptPreviewMacroInspection, input.lastRunMacroInspection]
    .filter((inspection): inspection is MacroInspection => Boolean(inspection))
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))[0]

  return {
    canSend,
    canSendAgent,
    canPreviewPrompt: canSend,
    emptyTimelineText: readEmptyTimelineText({ timeline: input.timeline, branch: input.branch }, input.t),
    openingDraft,
    macroContext,
    promptBuildSteps,
    buildMacroInspection,
  }
}
