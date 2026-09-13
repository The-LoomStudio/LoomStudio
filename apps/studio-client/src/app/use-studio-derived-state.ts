import { useMemo } from 'react'
import { cardMediaUrl, useCardMediaRevision } from '../shared/lib/card-media.js'

export function useStudioDerivedState(
  state: {
    selectedCardId?: string
    selectedCard?: { id: string; name: string; media?: { avatarAssetId?: string } }
    selectedCardDetails?: { id: string; name: string; media?: { avatarAssetId?: string } }
    narrativeTimeline?: { createdFrom?: { cardId?: string } }
    cards: Array<{ id: string; name: string; media?: { avatarAssetId?: string } }>
    agentProfiles: Array<{ id: string; presetId?: string }>
    selectedAgentProfileId?: string
    operationPending: Record<string, { pendingCount: number }>
    providerAccountsLoaded: boolean
    agentChatSessionLoading: boolean
  },
  route: { panel: string | null; cardId?: string },
) {
  const mediaRevision = useCardMediaRevision()
  return useMemo(() => {
    const assetWorkspaceId = route.panel === 'preset' || route.panel === 'resource'
      ? route.cardId ?? state.selectedCardId ?? 'default'
      : state.selectedCardId ?? 'default'
    const bootstrapBusy = state.operationPending.bootstrap.pendingCount > 0
    const activeCardId = state.narrativeTimeline?.createdFrom?.cardId
      ?? (state.narrativeTimeline ? state.selectedCardId : undefined)
    const activeCard = activeCardId
      ? (state.cards.find(card => card.id === activeCardId)
        ?? (state.selectedCard?.id === activeCardId ? state.selectedCard : undefined))
      : undefined
    return {
      assetWorkspaceId,
      bootstrapBusy,
      cardsBusy: bootstrapBusy || state.operationPending.cards.pendingCount > 0,
      providerBusy: bootstrapBusy || state.operationPending['provider-settings'].pendingCount > 0,
      agentProfileBusy: bootstrapBusy || state.operationPending['agent-profiles'].pendingCount > 0,
      sessionBusy: state.operationPending.session.pendingCount > 0,
      mutationBusy: state.operationPending.mutation.pendingCount > 0,
      activePresetId: state.agentProfiles.find(profile => profile.id === state.selectedAgentProfileId)?.presetId,
      narrativeCharacterName: state.narrativeTimeline ? activeCard?.name : undefined,
      sourceCardId: state.narrativeTimeline?.createdFrom?.cardId,
      canOpenTimelineSource: Boolean(state.narrativeTimeline?.createdFrom?.cardId
        && state.cards.some(card => card.id === state.narrativeTimeline?.createdFrom?.cardId)),
      narrativeCharacterAvatarUrl: state.narrativeTimeline && activeCard?.media?.avatarAssetId
        ? cardMediaUrl(activeCard.id, 'avatar', activeCard.media.avatarAssetId, mediaRevision)
        : undefined,
      agentChatBusy: state.operationPending['agent-chat'].pendingCount > 0
        || state.operationPending.session.pendingCount > 0
        || state.agentChatSessionLoading,
    }
  }, [mediaRevision, route.cardId, route.panel, state])
}
