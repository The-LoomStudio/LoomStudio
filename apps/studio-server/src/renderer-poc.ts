import { createId } from '@loom-studio/shared'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createNamespaceRpcCapabilities, type RpcCapability } from './rpc-capability.js'
import { readNumber, readString } from './rpc-params.js'

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

export type RendererPocSession = {
  id: string
  createdAt: string
  revoked: boolean
  state: RendererPocState
}

export type RendererPocEvent =
  | { type: 'session.created'; sessionId: string; state: RendererPocState }
  | { type: 'session.revoked'; sessionId: string }
  | { type: 'state.changed'; sessionId: string; key: 'loveLevel'; value: number; state: RendererPocState }
  | { type: 'message.new'; sessionId: string; message: RendererPocMessage; state: RendererPocState }

type RendererPocSubscriber = {
  id: string
  sessionId: string
  response: ServerResponse
}

export type RendererPocService = {
  call(method: string, params: JsonValue | undefined): JsonValue
  handleEventsRequest(request: IncomingMessage, response: ServerResponse): void
  close(): void
}

const rendererPocRpcMethods = [
  'renderer.createSession',
  'renderer.revokeSession',
  'renderer.state.get',
  'renderer.state.set',
  'renderer.messages.list',
  'renderer.messages.append',
] as const

export function listRendererPocRpcCapabilities(): RpcCapability[] {
  return createNamespaceRpcCapabilities({
    names: rendererPocRpcMethods,
    namespace: 'renderer',
    owner: 'studio-server',
    stability: 'experimental',
  })
}

export function createRendererPocService(): RendererPocService {
  const sessions = new Map<string, RendererPocSession>()
  const subscribers = new Map<string, RendererPocSubscriber>()

  function getSession(sessionId: string): RendererPocSession {
    const session = sessions.get(sessionId)
    if (!session || session.revoked) {
      throw new Error(`Renderer session not found: ${sessionId}`)
    }
    return session
  }

  function emit(event: RendererPocEvent): void {
    for (const subscriber of subscribers.values()) {
      if (subscriber.sessionId !== event.sessionId) continue
      subscriber.response.write(`event: ${event.type}\n`)
      subscriber.response.write(`data: ${JSON.stringify(event)}\n\n`)
    }
  }

  function createSession(): JsonObject {
    const session: RendererPocSession = {
      id: createId('renderer'),
      createdAt: new Date().toISOString(),
      revoked: false,
      state: {
        loveLevel: 1,
        messages: [
          {
            id: createId('pocmsg'),
            role: 'assistant',
            content: 'Renderer PoC connected. This message is owned by the backend.',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    }
    sessions.set(session.id, session)
    emit({ type: 'session.created', sessionId: session.id, state: cloneState(session.state) })

    return serializeSession(session)
  }

  function revokeSession(params: JsonValue | undefined): JsonObject {
    const session = getSession(readString(params, 'sessionId'))
    session.revoked = true
    emit({ type: 'session.revoked', sessionId: session.id })
    for (const [subscriberId, subscriber] of subscribers) {
      if (subscriber.sessionId === session.id) {
        subscriber.response.end()
        subscribers.delete(subscriberId)
      }
    }
    return serializeSession(session)
  }

  function getState(params: JsonValue | undefined): JsonObject {
    const session = getSession(readString(params, 'sessionId'))
    return { state: cloneState(session.state) }
  }

  function setState(params: JsonValue | undefined): JsonObject {
    const session = getSession(readString(params, 'sessionId'))
    const key = readString(params, 'key')
    if (key !== 'loveLevel') {
      throw new Error(`Unsupported renderer state key: ${key}`)
    }
    const value = readNumber(params, 'value')
    session.state.loveLevel = value
    const event: RendererPocEvent = {
      type: 'state.changed',
      sessionId: session.id,
      key,
      value,
      state: cloneState(session.state),
    }
    emit(event)
    return { state: cloneState(session.state), event: event as unknown as JsonValue }
  }

  function listMessages(params: JsonValue | undefined): JsonObject {
    const session = getSession(readString(params, 'sessionId'))
    return { messages: session.state.messages.map(message => ({ ...message })) }
  }

  function appendMessage(params: JsonValue | undefined): JsonObject {
    const session = getSession(readString(params, 'sessionId'))
    const role = readRole(params, 'role')
    const content = readString(params, 'content')
    const message: RendererPocMessage = {
      id: createId('pocmsg'),
      role,
      content,
      createdAt: new Date().toISOString(),
    }
    session.state.messages.push(message)
    const event: RendererPocEvent = {
      type: 'message.new',
      sessionId: session.id,
      message,
      state: cloneState(session.state),
    }
    emit(event)
    return { message, state: cloneState(session.state), event: event as unknown as JsonValue }
  }

  return {
    call: (method, params) => {
      switch (method) {
        case 'renderer.createSession':
          return createSession()
        case 'renderer.revokeSession':
          return revokeSession(params)
        case 'renderer.state.get':
          return getState(params)
        case 'renderer.state.set':
          return setState(params)
        case 'renderer.messages.list':
          return listMessages(params)
        case 'renderer.messages.append':
          return appendMessage(params)
        default:
          throw new Error(`Renderer PoC RPC method not found: ${method}`)
      }
    },
    handleEventsRequest: (request, response) => {
      const url = new URL(request.url ?? '', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) {
        writeEventError(response, 400, 'Missing sessionId')
        return
      }
      const session = sessions.get(sessionId)
      if (!session || session.revoked) {
        writeEventError(response, 404, 'Renderer session not found')
        return
      }

      const subscriberId = createId('sse')
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      })
      response.write(`event: ready\n`)
      response.write(`data: ${JSON.stringify({ type: 'ready', sessionId, state: cloneState(session.state) })}\n\n`)
      subscribers.set(subscriberId, { id: subscriberId, sessionId, response })
      request.on('close', () => {
        subscribers.delete(subscriberId)
      })
    },
    close: () => {
      for (const subscriber of subscribers.values()) {
        subscriber.response.end()
      }
      subscribers.clear()
      sessions.clear()
    },
  }
}

function serializeSession(session: RendererPocSession): JsonObject {
  return {
    session: {
      id: session.id,
      createdAt: session.createdAt,
      revoked: session.revoked,
    },
    state: cloneState(session.state) as unknown as JsonValue,
  }
}

function cloneState(state: RendererPocState): RendererPocState {
  return {
    loveLevel: state.loveLevel,
    messages: state.messages.map(message => ({ ...message })),
  }
}

function writeEventError(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { code: 'renderer_poc_error', message } }))
}

function readRole(params: JsonValue | undefined, key: string): RendererPocMessage['role'] {
  const value = readString(params, key)
  if (value === 'user' || value === 'assistant' || value === 'system') return value
  throw new Error(`Expected renderer message role: ${key}`)
}
