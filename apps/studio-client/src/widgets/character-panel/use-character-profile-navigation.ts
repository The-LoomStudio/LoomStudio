import { useEffect, useRef, useState } from 'react'
import { beginCharacterProfileClose, finishCharacterProfileClose, openCharacterProfile, type CharacterProfileNavigationState } from './character-profile-navigation-model.js'

export function useCharacterProfileNavigation(routeCardId: string | undefined, transitionDelay: () => number) {
  const [state, setState] = useState<CharacterProfileNavigationState>({ cardId: routeCardId, leaving: false, transitionId: 0 })
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function cancelClose() {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    transitionTimerRef.current = undefined
    setState(current => current.leaving ? { ...current, leaving: false } : current)
  }

  function openProfile(cardId: string) {
    cancelClose()
    setState(current => openCharacterProfile(current, cardId))
  }

  function closeProfile() {
    if (state.leaving) return
    const closing = beginCharacterProfileClose(state)
    setState(closing)
    transitionTimerRef.current = setTimeout(() => {
      transitionTimerRef.current = undefined
      setState(current => finishCharacterProfileClose(current, closing.transitionId))
    }, transitionDelay())
  }

  useEffect(() => {
    cancelClose()
    setState(current => routeCardId ? openCharacterProfile(current, routeCardId) : { cardId: undefined, leaving: false, transitionId: current.transitionId + 1 })
  }, [routeCardId])

  useEffect(() => () => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
  }, [])

  return { closeProfile, openProfile, profileCardId: state.cardId, profileLeaving: state.leaving }
}
