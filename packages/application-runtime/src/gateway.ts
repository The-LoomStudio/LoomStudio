import type { DocumentStore } from '@loom-studio/document-store'
import type { SecretStore } from '@loom-studio/secret-store'
import type { JsonValue } from '@loom-studio/shared'
import type { AssistantChatMessage, ChatToolCall } from '@loom-studio/shared'
import { createId } from '@loom-studio/shared'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { applicationDocumentTypes } from './document-types.js'
import { readDocument } from './document-store.js'
import { isObject } from './json.js'
import { buildOpenAIChatPayload } from './provider-payload.js'
import type {
  AiGateway,
  ApplicationProvider,
  GatewayChatResult,
  OpenAICompatibleGatewayOptions,
  ProviderProfileContent,
} from './types.js'

export function createFakeAiGateway(): AiGateway {
  return {
    invokeChat: async input => {
      const lastUser = [...input.request.messages].reverse().find(message => message.role === 'user')
      return {
        provider: 'fake',
        model: 'fake-echo-m0',
        message: { role: 'assistant', content: `Agent draft: ${lastUser?.content ?? ''}` },
        text: `Agent draft: ${lastUser?.content ?? ''}`,
        providerCallId: createId('provider-call'),
        raw: {
          messageCount: input.request.messages.length,
          runId: input.runId,
        },
      }
    },
  }
}

export function createFakeProvider(): ApplicationProvider {
  return gatewayToProvider(createFakeAiGateway())
}

export function createDocumentBackedAiGateway(options: {
  documents: DocumentStore
  secrets?: SecretStore
  fallback?: AiGateway
  resolveProxyUrl?: () => string | undefined
}): AiGateway {
  const fallback = options.fallback ?? createFakeAiGateway()
  const proxyTransports = new Map<string, typeof fetch>()

  function resolveTransport(providerProfile: ProviderProfileContent): typeof fetch {
    const proxyUrl = options.resolveProxyUrl?.()
    if (!proxyUrl) return fetch
    const existing = proxyTransports.get(proxyUrl)
    if (existing) return existing
    const dispatcher = new ProxyAgent(proxyUrl)
    const transport = (async (input, init) => {
      return await undiciFetch(input as never, { ...init, dispatcher } as never) as unknown as Response
    }) as typeof fetch
    proxyTransports.set(proxyUrl, transport)
    return transport
  }

  return {
    listModels: async input => {
      const providerProfile = await readDocument<ProviderProfileContent>(options.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      const providerExtensionId = providerProfile.content.providerExtensionId

      if (providerExtensionId === 'official.fake' || providerExtensionId === 'fake') {
        return { modelIds: [...providerProfile.content.enabledModelIds] }
      }
      if (providerExtensionId !== 'official.openai-compatible' && providerExtensionId !== 'openai-compatible') {
        throw new Error(`Provider does not support model discovery: ${providerExtensionId}`)
      }
      if (!options.secrets || !providerProfile.content.secretRef) throw new Error('Provider credential is not configured')

      return await options.secrets.withSecret(providerProfile.content.secretRef, {
        caller: 'application.ai-gateway',
        owner: { type: 'provider-profile', id: providerProfile.id },
        purpose: 'provider.credentials',
      }, async secret => {
        const apiKey = secret.values.apiKey
        if (!apiKey) throw new Error('Provider credential is missing apiKey')
        return {
          modelIds: await listOpenAICompatibleModels({
            baseUrl: providerProfile.content.config.baseUrl,
            apiKey,
            fetch: resolveTransport(providerProfile.content),
          }),
        }
      })
    },
    invokeChat: async input => {
      if (!input.model) {
        return await fallback.invokeChat(input)
      }

      const providerProfile = await readDocument<ProviderProfileContent>(options.documents, input.model.providerProfileId, applicationDocumentTypes.providerProfile)
      if (!providerProfile.content.enabledModelIds.includes(input.model.modelId)) {
        throw new Error(`Provider model is not enabled: ${input.model.modelId}`)
      }
      const providerExtensionId = providerProfile.content.providerExtensionId

      if (providerExtensionId === 'official.openai-compatible' || providerExtensionId === 'openai-compatible') {
        if (!options.secrets || !providerProfile.content.secretRef) throw new Error('Provider credential is not configured')
        return await options.secrets.withSecret(providerProfile.content.secretRef, {
          caller: 'application.ai-gateway',
          owner: { type: 'provider-profile', id: providerProfile.id },
          purpose: 'provider.credentials',
        }, async secret => {
          const apiKey = secret.values.apiKey
          if (!apiKey) throw new Error('Provider credential is missing apiKey')
          return await createOpenAICompatibleGateway({
            providerProfile: {
              id: providerProfile.id,
              providerExtensionId: providerProfile.content.providerExtensionId,
              displayName: providerProfile.content.displayName,
              config: providerProfile.content.config,
              enabledModelIds: providerProfile.content.enabledModelIds,
            },
            modelId: input.model!.modelId,
            apiKey,
            fetch: resolveTransport(providerProfile.content),
          }).invokeChat(input)
        })
      }

      if (providerExtensionId === 'official.fake' || providerExtensionId === 'fake') {
        return await fallback.invokeChat(input)
      }

      throw new Error(`Unsupported provider extension for AI Gateway M0: ${providerExtensionId}`)
    },
  }
}

export async function listOpenAICompatibleModels(options: {
  baseUrl?: JsonValue
  apiKey: string
  fetch?: typeof fetch
}): Promise<string[]> {
  const transport = options.fetch ?? fetch
  const baseUrl = normalizeBaseUrl(typeof options.baseUrl === 'string' ? options.baseUrl : 'https://api.openai.com/v1')
  const response = await requestProvider(transport, `${baseUrl}/models`, {
    headers: { authorization: `Bearer ${options.apiKey}` },
  })
  const responseBody = await response.json() as JsonValue

  if (!response.ok) throw new Error(readProviderErrorMessage(responseBody, response.status))
  if (!isObject(responseBody) || !Array.isArray(responseBody.data)) {
    throw new Error('Provider model list response is invalid')
  }

  return [...new Set(responseBody.data.flatMap(item => {
    if (!isObject(item) || typeof item.id !== 'string') return []
    const id = item.id.trim()
    return id ? [id] : []
  }))]
}

export function createOpenAICompatibleGateway(options: OpenAICompatibleGatewayOptions): AiGateway {
  const transport = options.fetch ?? fetch
  const baseUrl = normalizeBaseUrl(options.providerProfile.config?.baseUrl ?? 'https://api.openai.com/v1')

  return {
    invokeChat: async input => {
      if (!options.providerProfile.enabledModelIds.includes(options.modelId)) {
        throw new Error(`Provider model is not enabled: ${options.modelId}`)
      }

      const payload = buildOpenAIChatPayload({
        messages: input.request.messages,
        modelId: options.modelId,
      })
      const response = await requestProvider(transport, `${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(payload),
      })
      const responseBody = await response.json() as JsonValue

      if (!response.ok) {
        throw new Error(readProviderErrorMessage(responseBody, response.status))
      }

      return parseOpenAICompatibleChatResult(responseBody, options.modelId)
    },
  }
}

async function requestProvider(transport: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await transport(url, init)
  } catch (error) {
    throw normalizeProviderNetworkError(error)
  }
}

function normalizeProviderNetworkError(error: unknown): Error {
  const causeCode = readCauseCode(error)
  const normalized = causeCode === 'UND_ERR_CONNECT_TIMEOUT' || causeCode === 'ETIMEDOUT'
    ? new Error('Provider network connection timed out')
    : causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN'
      ? new Error('Provider host could not be resolved')
      : causeCode?.startsWith('CERT_') || causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
        ? new Error('Provider TLS validation failed')
        : new Error('Provider network request failed')
  normalized.name = causeCode === 'UND_ERR_CONNECT_TIMEOUT' || causeCode === 'ETIMEDOUT'
    ? 'ProviderConnectTimeoutError'
    : causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN'
      ? 'ProviderDnsError'
      : causeCode?.startsWith('CERT_') || causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
        ? 'ProviderTlsError'
        : 'ProviderNetworkError'
  return normalized
}

function readCauseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('cause' in error)) return undefined
  const cause = Reflect.get(error, 'cause')
  if (!cause || typeof cause !== 'object' || !('code' in cause)) return undefined
  const code = Reflect.get(cause, 'code')
  return typeof code === 'string' ? code : undefined
}

export function providerToGateway(provider: ApplicationProvider): AiGateway {
  return {
    invokeChat: async input => {
      const result = await provider.invoke({
        messages: input.request.messages,
        runId: input.runId,
        sessionId: input.sessionId,
        branchId: input.branchId,
      })
      const message = result.message ?? { role: 'assistant' as const, content: result.content }

      return {
        message,
        text: message.content ?? '',
        provider: result.provider,
        model: result.model,
        raw: result.raw,
      }
    },
  }
}

function gatewayToProvider(gateway: AiGateway): ApplicationProvider {
  return {
    invoke: async input => {
      const result = await gateway.invokeChat({
        request: { messages: input.messages },
        runId: input.runId,
        sessionId: input.sessionId,
        branchId: input.branchId,
      })

      return {
        message: result.message,
        content: result.text,
        provider: result.provider,
        model: result.model,
        raw: result.raw,
      }
    },
  }
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === 'https://api.openai.com') return 'https://api.openai.com/v1'
  return trimmed
}

function readProviderErrorMessage(body: JsonValue, status: number): string {
  if (isObject(body) && isObject(body.error) && typeof body.error.message === 'string') {
    return `Provider request failed (${status}): ${body.error.message}`
  }

  return `Provider request failed (${status})`
}

function parseOpenAICompatibleChatResult(body: JsonValue, fallbackModel: string): GatewayChatResult {
  if (!isObject(body)) {
    throw new Error('Provider response must be an object')
  }

  const choices = Array.isArray(body.choices) ? body.choices : []
  const firstChoice = choices.find(isObject)
  const message = isObject(firstChoice?.message) ? firstChoice.message : undefined
  const assistantMessage = parseAssistantMessage(message)
  const text = assistantMessage.content ?? ''

  const usage = isObject(body.usage)
    ? {
        inputTokens: typeof body.usage.prompt_tokens === 'number' ? body.usage.prompt_tokens : undefined,
        outputTokens: typeof body.usage.completion_tokens === 'number' ? body.usage.completion_tokens : undefined,
      }
    : undefined
  const finishReason = typeof firstChoice?.finish_reason === 'string' ? normalizeFinishReason(firstChoice.finish_reason) : undefined

  return {
    message: assistantMessage,
    text,
    provider: 'openai-compatible',
    model: typeof body.model === 'string' ? body.model : fallbackModel,
    finishReason,
    usage,
    providerCallId: typeof body.id === 'string' ? body.id : createId('provider-call'),
    raw: body,
  }
}

function parseAssistantMessage(message: Record<string, JsonValue> | undefined): AssistantChatMessage {
  if (!message || message.role !== 'assistant') {
    throw new Error('Provider response did not include choices[0].message')
  }
  const content = typeof message.content === 'string' && message.content.length > 0 ? message.content : undefined
  const toolCalls = message.tool_calls === undefined ? undefined : parseToolCalls(message.tool_calls)
  if (!content && (!toolCalls || toolCalls.length === 0)) {
    throw new Error('Provider assistant response did not include content or tool_calls')
  }
  return {
    role: 'assistant',
    ...(content ? { content } : {}),
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
  }
}

function parseToolCalls(value: JsonValue): ChatToolCall[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Provider assistant tool_calls must be a non-empty array')
  }
  return value.map((item, index) => {
    if (!isObject(item) || item.type !== 'function' || typeof item.id !== 'string' || !isObject(item.function)) {
      throw new Error(`Provider assistant tool call is invalid: tool_calls[${index}]`)
    }
    if (typeof item.function.name !== 'string' || typeof item.function.arguments !== 'string') {
      throw new Error(`Provider assistant tool function is invalid: tool_calls[${index}].function`)
    }
    return {
      id: item.id,
      type: 'function',
      function: { name: item.function.name, arguments: item.function.arguments },
    }
  })
}

function normalizeFinishReason(input: string): GatewayChatResult['finishReason'] {
  if (input === 'stop') return 'stop'
  if (input === 'length') return 'length'
  if (input === 'tool_calls' || input === 'tool_call') return 'tool_call'
  return undefined
}
