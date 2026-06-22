export type RendererPocMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export type RendererPocState = {
  loveLevel: number
  messages: RendererPocMessage[]
}

export type RendererPocEvent =
  | { type: 'ready'; sessionId: string; state: RendererPocState }
  | { type: 'session.revoked'; sessionId: string }
  | { type: 'state.changed'; sessionId: string; key: 'loveLevel'; value: number; state: RendererPocState }
  | { type: 'message.new'; sessionId: string; message: RendererPocMessage; state: RendererPocState }

export type RendererPocSessionResult = {
  session: {
    id: string
    createdAt: string
    revoked: boolean
  }
  state: RendererPocState
}
