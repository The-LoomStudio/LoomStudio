import type { DocumentStore } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { createId } from '@loom-studio/shared'
import { applicationDocumentTypes } from './document-types.js'
import { readDocument } from './document-store.js'
import { isObject } from './json.js'
import type {
  AiGateway,
  ApplicationProvider,
  GatewayChatResult,
  ModelProfileConfig,
  ModelProfileContent,
  OpenAICompatibleGatewayOptions,
  ProviderAccountConfig,
  ProviderAccountContent,
} from './types.js'

export function createFakeAiGateway(): AiGateway {
  return {
    invokeChat: async input => {
      const lastUser = [...input.request.messages].reverse().find(message => message.role === 'user')
      return {
        provider: 'fake',
        model: 'fake-echo-m0',
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
  fallback?: AiGateway
}): AiGateway {
  const fallback = options.fallback ?? createFakeAiGateway()

  return {
    invokeChat: async input => {
      if (!input.modelProfileId) {
        return await fallback.invokeChat(input)
      }

      const modelProfile = await readDocument<ModelProfileContent>(options.documents, input.modelProfileId, applicationDocumentTypes.modelProfile)
      const providerAccount = await readDocument<ProviderAccountContent>(options.documents, modelProfile.content.providerAccountId, applicationDocumentTypes.providerAccount)
      const providerExtensionId = providerAccount.content.providerExtensionId

      if (providerExtensionId === 'official.openai-compatible' || providerExtensionId === 'openai-compatible') {
        return await createOpenAICompatibleGateway({
          providerAccount: {
            id: providerAccount.id,
            providerExtensionId: providerAccount.content.providerExtensionId,
            displayName: providerAccount.content.displayName,
            config: providerAccount.content.config,
            secretRefs: providerAccount.content.secretRefs,
          },
          modelProfile: {
            id: modelProfile.id,
            providerAccountId: modelProfile.content.providerAccountId,
            capability: modelProfile.content.capability,
            displayName: modelProfile.content.displayName,
            providerModelId: modelProfile.content.providerModelId,
            config: modelProfile.content.config,
          },
        }).invokeChat(input)
      }

      if (providerExtensionId === 'official.fake' || providerExtensionId === 'fake') {
        return await fallback.invokeChat(input)
      }

      throw new Error(`Unsupported provider extension for AI Gateway M0: ${providerExtensionId}`)
    },
  }
}

export function createOpenAICompatibleGateway(options: OpenAICompatibleGatewayOptions): AiGateway {
  const transport = options.fetch ?? fetch
  const baseUrl = normalizeBaseUrl(options.providerAccount.config?.baseUrl ?? 'https://api.openai.com/v1')

  return {
    invokeChat: async input => {
      assertChatModelProfile(options.providerAccount, options.modelProfile)

      const apiKey = resolveSecret(options.providerAccount.secretRefs?.apiKey)
      const payload = stripUndefined({
        ...options.modelProfile.config,
        model: options.modelProfile.providerModelId,
        messages: input.request.messages,
        stream: false,
      })
      const response = await transport(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      })
      const responseBody = await response.json() as JsonValue

      if (!response.ok) {
        throw new Error(readProviderErrorMessage(responseBody, response.status))
      }

      return parseOpenAICompatibleChatResult(responseBody, options.modelProfile.providerModelId)
    },
  }
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

      return {
        text: result.content,
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
        content: result.text,
        provider: result.provider,
        model: result.model,
        raw: result.raw,
      }
    },
  }
}

function assertChatModelProfile(providerAccount: ProviderAccountConfig, modelProfile: ModelProfileConfig): void {
  if (modelProfile.providerAccountId !== providerAccount.id) {
    throw new Error(`ModelProfile ${modelProfile.id} does not belong to ProviderAccount ${providerAccount.id}`)
  }

  if (modelProfile.capability !== 'chat.completion') {
    throw new Error(`Unsupported model capability: ${modelProfile.capability}`)
  }
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, '')
}

function resolveSecret(ref: string | undefined): string {
  if (!ref) throw new Error('Provider account is missing apiKey secret ref')
  if (ref.startsWith('plain:')) return ref.slice('plain:'.length)
  if (ref.startsWith('env:')) {
    const envName = ref.slice('env:'.length)
    const value = process.env[envName]
    if (!value) throw new Error(`Provider apiKey env var is not set: ${envName}`)
    return value
  }
  if (ref.startsWith('secret:')) {
    throw new Error('secret: refs are not implemented in AI Gateway M0')
  }
  throw new Error(`Unsupported secret ref: ${ref}`)
}

function stripUndefined(input: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as JsonObject
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
  const text = typeof message?.content === 'string' ? message.content : undefined

  if (!text) {
    throw new Error('Provider response did not include choices[0].message.content')
  }

  const usage = isObject(body.usage)
    ? {
        inputTokens: typeof body.usage.prompt_tokens === 'number' ? body.usage.prompt_tokens : undefined,
        outputTokens: typeof body.usage.completion_tokens === 'number' ? body.usage.completion_tokens : undefined,
      }
    : undefined
  const finishReason = typeof firstChoice?.finish_reason === 'string' ? normalizeFinishReason(firstChoice.finish_reason) : undefined

  return {
    text,
    provider: 'openai-compatible',
    model: typeof body.model === 'string' ? body.model : fallbackModel,
    finishReason,
    usage,
    providerCallId: typeof body.id === 'string' ? body.id : createId('provider-call'),
    raw: body,
  }
}

function normalizeFinishReason(input: string): GatewayChatResult['finishReason'] {
  if (input === 'stop') return 'stop'
  if (input === 'length') return 'length'
  if (input === 'tool_calls' || input === 'tool_call') return 'tool_call'
  return undefined
}
