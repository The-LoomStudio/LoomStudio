import { useEffect, useState } from 'react'
import type { RendererApi } from '../../../shared/api/renderer-api.js'
import type { RendererPocEvent, RendererPocState } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'

type UseRendererSessionInput = {
  rendererApi: RendererApi
  runAction: (action: () => Promise<void>) => Promise<void>
  t: Translator
}

export function useRendererSession(input: UseRendererSessionInput) {
  const [rendererSessionId, setRendererSessionId] = useState<string>()
  const [rendererState, setRendererState] = useState<RendererPocState>()
  const [rendererEvents, setRendererEvents] = useState<string[]>([])

  useEffect(() => {
    if (!rendererSessionId) return
    const source = new EventSource(`/renderer/events?sessionId=${encodeURIComponent(rendererSessionId)}`)
    const listener = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as RendererPocEvent
      setRendererEvents(current => [formatRendererEventLabel(payload, new Date()), ...current].slice(0, 8))
      if ('state' in payload) setRendererState(payload.state)
      if (payload.type === 'session.revoked') setRendererSessionId(undefined)
    }

    source.addEventListener('ready', listener)
    source.addEventListener('state.changed', listener)
    source.addEventListener('message.new', listener)
    source.addEventListener('session.revoked', listener)

    return () => {
      source.close()
    }
  }, [rendererSessionId])

  async function createRendererSession() {
    await input.runAction(async () => {
      const result = await input.rendererApi.sessions.create()
      setRendererSessionId(result.session.id)
      setRendererState(result.state)
      setRendererEvents([input.t('renderer.eventCreated', { id: shortId(result.session.id) })])
    })
  }

  async function revokeRendererSession() {
    if (!rendererSessionId) return
    await input.runAction(async () => {
      await input.rendererApi.sessions.revoke(rendererSessionId)
      setRendererSessionId(undefined)
    })
  }

  async function incrementRendererLove() {
    if (!rendererSessionId || !rendererState) return
    await input.runAction(async () => {
      const state = await input.rendererApi.state.set({
        sessionId: rendererSessionId,
        key: 'loveLevel',
        value: rendererState.loveLevel + 1,
      })
      setRendererState(state)
    })
  }

  async function appendRendererMessage() {
    if (!rendererSessionId) return
    await input.runAction(async () => {
      const result = await input.rendererApi.messages.append({
        sessionId: rendererSessionId,
        role: 'user',
        content: input.t('renderer.hostMessage', { time: new Date().toLocaleTimeString() }),
      })
      setRendererState(result.state)
    })
  }

  function openRendererWindow() {
    if (!rendererSessionId) return
    window.open(`/renderer.html#session=${encodeURIComponent(rendererSessionId)}`, 'loom-renderer-poc')
  }

  return {
    rendererSessionId,
    rendererState,
    rendererEvents,
    createRendererSession,
    revokeRendererSession,
    incrementRendererLove,
    appendRendererMessage,
    openRendererWindow,
  }
}

export function formatRendererEventLabel(payload: Pick<RendererPocEvent, 'type'>, time: Date): string {
  return `${time.toLocaleTimeString()} ${payload.type}`
}

function shortId(id: string): string {
  return id.slice(0, 13)
}
