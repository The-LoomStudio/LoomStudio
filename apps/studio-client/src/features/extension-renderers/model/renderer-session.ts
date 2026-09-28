import type { ClientRendererScope, ClientRendererSessionHandle } from '@loom-studio/extension-sdk'
import type { ClientRendererHost, ClientRendererRegistration } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { rendererContributionKey } from '../../../shared/extension-renderer-runtime/renderer-registry.js'

type RendererSessionSummary = {
  sessionId: string
  contributionKey: string
  scope: ClientRendererScope
  state: ReturnType<ClientRendererSessionHandle['state']>
}

export type RendererSessionHost = {
  open(registration: ClientRendererRegistration, scope: ClientRendererScope): ClientRendererSessionHandle
  summaries(): RendererSessionSummary[]
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createRendererSessionHost(rendererHost?: ClientRendererHost): RendererSessionHost {
  const sessions = new Map<string, RendererSessionSummary & { channel?: BroadcastChannel; window?: Window }>()
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function setState(sessionId: string, state: RendererSessionSummary['state']): void {
    const session = sessions.get(sessionId)
    if (!session || session.state === state) return
    session.state = state
    emit()
  }

  function revoke(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) return
    session.channel?.postMessage({ type: 'loom:renderer-session-revoked', sessionId })
    session.channel?.close()
    session.window?.close()
    sessions.delete(sessionId)
    emit()
  }

  let unsubscribe: (() => void) | undefined

  return {
    open: (registration, scope) => {
      if (rendererHost && !rendererHost.canUse(rendererContributionKey(registration), scope)) throw new Error('Standalone Renderer is unavailable in this scope')
      if (!rendererHost && registration.owner.kind === 'extension' && registration.owner.target?.kind === 'card') throw new Error('Card Renderer requires an installation-aware host')
      if (registration.definition.surface !== 'standalone.page' || !registration.frame?.src) {
        throw new Error(`Standalone Renderer requires a frame source: ${rendererContributionKey(registration)}`)
      }
      unsubscribe ??= rendererHost?.subscribe(() => {
        for (const [sessionId, session] of sessions) {
          if (!rendererHost.canUse(session.contributionKey, session.scope)) revoke(sessionId)
        }
      })
      const sessionId = globalThis.crypto?.randomUUID?.() ?? `renderer-session-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const separator = registration.frame.src.includes('?') ? '&' : '?'
      const url = `${registration.frame.src}${separator}loomRendererSession=${encodeURIComponent(sessionId)}`
      const opened = typeof window === 'undefined' ? undefined : window.open(url, '_blank') ?? undefined
      if (opened) opened.opener = null
      const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(`loom-renderer:${sessionId}`)
      const session: RendererSessionSummary & { channel?: BroadcastChannel; window?: Window } = {
        sessionId,
        contributionKey: rendererContributionKey(registration),
        scope: structuredClone(scope),
        state: opened ? 'opening' : 'disconnected',
        ...(channel ? { channel } : {}),
        ...(opened ? { window: opened } : {}),
      }
      sessions.set(sessionId, session)
      if (channel) {
        channel.onmessage = event => {
          if (!event.data || typeof event.data !== 'object') return
          if (event.data.type === 'loom:renderer-session-ready') {
            setState(sessionId, 'connected')
            channel.postMessage({
              type: 'loom:renderer-session-context',
              sessionId,
              contributionKey: session.contributionKey,
              scope: session.scope,
            })
          } else if (event.data.type === 'loom:renderer-session-disconnected') {
            setState(sessionId, 'disconnected')
          }
        }
      }
      emit()
      return {
        sessionId,
        state: () => sessions.get(sessionId)?.state ?? 'revoked',
        dispose: () => revoke(sessionId),
      }
    },
    summaries: () => [...sessions.values()].map(session => ({
      sessionId: session.sessionId,
      contributionKey: session.contributionKey,
      scope: structuredClone(session.scope),
      state: session.state,
    })),
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      unsubscribe?.()
      unsubscribe = undefined
      for (const sessionId of sessions.keys()) revoke(sessionId)
      listeners.clear()
    },
  }
}
