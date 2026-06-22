import { createClientBridge } from '@loom-studio/client-bridge'
import type { RendererPocEvent, RendererPocMessage, RendererPocState } from './entities/index.js'
import { createRendererApi } from './shared/api/renderer-api.js'

export type RendererSdk = {
  state: {
    get(): Promise<RendererPocState>
    set(key: 'loveLevel', value: number): Promise<RendererPocState>
  }
  messages: {
    list(): Promise<RendererPocMessage[]>
    append(input: { role: RendererPocMessage['role']; content: string }): Promise<RendererPocMessage>
  }
  events: {
    subscribe(handler: (event: RendererPocEvent) => void): () => void
  }
}

export function createRendererSdk(input: { sessionId: string; endpoint?: string; eventsEndpoint?: string }): RendererSdk {
  const endpoint = input.endpoint ?? '/rpc'
  const eventsEndpoint = input.eventsEndpoint ?? '/renderer/events'
  const bridge = createClientBridge({ endpoint, source: 'renderer-poc' })
  const api = createRendererApi(bridge)

  return {
    state: {
      get: () => api.state.get(input.sessionId),
      set: (key, value) => api.state.set({
        sessionId: input.sessionId,
        key,
        value,
      }),
    },
    messages: {
      list: () => api.messages.list(input.sessionId),
      append: async item => {
        const result = await api.messages.append({
          sessionId: input.sessionId,
          role: item.role,
          content: item.content,
        })
        return result.message
      },
    },
    events: {
      subscribe: handler => {
        const source = new EventSource(`${eventsEndpoint}?sessionId=${encodeURIComponent(input.sessionId)}`)
        const listener = (event: MessageEvent<string>) => {
          handler(JSON.parse(event.data) as RendererPocEvent)
        }

        source.addEventListener('ready', listener)
        source.addEventListener('state.changed', listener)
        source.addEventListener('message.new', listener)
        source.addEventListener('session.revoked', listener)

        return () => {
          source.close()
        }
      },
    },
  }
}
