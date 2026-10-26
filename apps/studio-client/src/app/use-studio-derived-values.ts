import type { MacroInspection } from '@loom-studio/shared'
import { useMemo } from 'react'
import type { AgentSession, Card, NarrativeBranch, NarrativeNode, NarrativeTimeline, PromptProjection } from '../entities/index.js'
import { buildPromptBuildSteps } from '../features/prompt-build/model/build-prompt-build-steps.js'
import { renderTemplateMacros, type MacroRenderContext } from '../features/state-variables/model/macro-renderer.js'
import { readEmptyTimelineText } from './utils.js'
import { openingChoiceText, type OpeningChoice } from '../features/cards/model/opening-choice.js'

type Translator = ReturnType<typeof import('../shared/i18n/index.js').createTranslator>

export function useStudioDerivedValues(input: {
  t: Translator
  timeline?: NarrativeTimeline
  branch?: NarrativeBranch
  selectedCard?: Card
  selectedCardDetails?: Card
  openingChoice?: OpeningChoice
  nodes: NarrativeNode[]
  narrativeInput: string
  promptMessages?: Parameters<typeof buildPromptBuildSteps>[0]['messages']
  promptProjection?: PromptProjection
  activationFacts: Parameters<typeof buildPromptBuildSteps>[0]['activationFacts']
  macroInspection?: MacroInspection
  sessionBusy: boolean
  agentSessionReady: boolean
  agentInput: string
  selectedAgentPreset?: object
  primarySession?: AgentSession
  agentSession?: AgentSession
  agentChatBusy: boolean
  macroPreview: { key: string; inspection?: MacroInspection }
  macroKey: string
  macroContextCard?: Card
  user?: { name: string; description: string }
}) {
  const hasTimeline = Boolean(input.timeline)
  const macroContext = useMemo<MacroRenderContext>(() => ({
    snapshot: input.macroPreview.key === input.macroKey ? input.macroPreview.inspection?.snapshot : undefined,
    card: hasTimeline ? undefined : input.macroContextCard,
    user: input.user,
  }), [input.macroKey, input.macroPreview, hasTimeline, input.macroContextCard, input.user])

  const cardOpeningEntry = input.selectedCardDetails
    ? openingChoiceText(input.selectedCardDetails.opening, input.openingChoice ?? { kind: 'card', id: input.selectedCardDetails.opening.id }).trim()
    : undefined
  const rawOpeningContent = cardOpeningEntry && cardOpeningEntry.length > 0
    ? cardOpeningEntry
    : input.t('timeline.opening.placeholder')
  const openingDraft = input.selectedCardDetails ? {
    content: cardOpeningEntry && cardOpeningEntry.length > 0 && input.openingChoice?.kind !== 'custom'
      ? renderTemplateMacros(rawOpeningContent, macroContext)
      : rawOpeningContent,
    isPlaceholder: !cardOpeningEntry || cardOpeningEntry.length === 0,
  } : undefined

  const canSend = Boolean(input.timeline && input.branch)
    && !input.sessionBusy
    && input.narrativeInput.trim().length > 0
  const canSendAgent = Boolean(input.agentSession || input.selectedAgentPreset)
    && input.agentSessionReady
    && input.agentInput.trim().length > 0
    && !input.agentChatBusy
    && !input.sessionBusy

  const promptBuildSteps = buildPromptBuildSteps({
    card: input.selectedCardDetails,
    userName: renderTemplateMacros('{{user}}', input.macroInspection ? { snapshot: input.macroInspection.snapshot } : macroContext),
    timeline: input.timeline,
    branch: input.branch,
    nodes: input.nodes,
    input: input.narrativeInput,
    messages: input.promptMessages,
    projection: input.promptProjection,
    activationFacts: input.activationFacts,
    promptBuildTrace: undefined,
  }, input.t)

  return {
    canSend,
    canSendAgent,
    canPreviewPrompt: canSend && input.primarySession?.timelineId === input.timeline?.id,
    emptyTimelineText: readEmptyTimelineText({ timeline: input.timeline, branch: input.branch }, input.t),
    openingDraft,
    macroContext,
    promptBuildSteps,
  }
}
