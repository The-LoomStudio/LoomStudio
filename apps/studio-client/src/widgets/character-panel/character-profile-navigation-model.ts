export type CharacterProfileNavigationState = {
  cardId?: string
  leaving: boolean
  transitionId: number
}

export function openCharacterProfile(state: CharacterProfileNavigationState, cardId: string): CharacterProfileNavigationState {
  return { cardId, leaving: false, transitionId: state.transitionId + 1 }
}

export function beginCharacterProfileClose(state: CharacterProfileNavigationState): CharacterProfileNavigationState {
  return { ...state, leaving: true, transitionId: state.transitionId + 1 }
}

export function finishCharacterProfileClose(state: CharacterProfileNavigationState, transitionId: number): CharacterProfileNavigationState {
  if (state.transitionId !== transitionId) return state
  return { ...state, cardId: undefined, leaving: false }
}
