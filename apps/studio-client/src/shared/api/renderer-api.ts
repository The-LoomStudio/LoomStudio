import type { ClientBridge } from '@loom-studio/client-bridge'
import type { RendererPocMessage, RendererPocSessionResult, RendererPocState } from '../../entities/index.js'

export type RendererApi = {
  sessions: {
    create(): Promise<RendererPocSessionResult>
    revoke(sessionId: string): Promise<RendererPocSessionResult>
  }
  state: {
    get(sessionId: string): Promise<RendererPocState>
    set(input: { sessionId: string; key: 'loveLevel'; value: number }): Promise<RendererPocState>
  }
  messages: {
    list(sessionId: string): Promise<RendererPocMessage[]>
    append(input: { sessionId: string; role: RendererPocMessage['role']; content: string }): Promise<{ message: RendererPocMessage; state: RendererPocState }>
  }
}

export function createRendererApi(bridge: ClientBridge): RendererApi {
  return {
    sessions: {
      create: () => bridge.call<RendererPocSessionResult>('renderer.createSession', {}),
      revoke: sessionId => bridge.call<RendererPocSessionResult>('renderer.revokeSession', { sessionId }),
    },
    state: {
      get: async sessionId => {
        const result = await bridge.call<{ state: RendererPocState }>('renderer.state.get', { sessionId })
        return result.state
      },
      set: async input => {
        const result = await bridge.call<{ state: RendererPocState }>('renderer.state.set', input)
        return result.state
      },
    },
    messages: {
      list: async sessionId => {
        const result = await bridge.call<{ messages: RendererPocMessage[] }>('renderer.messages.list', { sessionId })
        return result.messages
      },
      append: input => bridge.call<{ message: RendererPocMessage; state: RendererPocState }>('renderer.messages.append', input),
    },
  }
}
