import {
  createAiGateway,
  createOfficialFakeChatCompletion,
  createOfficialProviderAdapterRegistry,
  createProfiledAiGateway,
  officialFakeModelId,
  parseProviderOptions,
  type AiGatewayCapabilityRegistry,
  type ProfiledAiGateway,
  type ProviderAdapterRegistry,
  type AiGatewayEvent,
} from '@loom-studio/ai-gateway'
import type { DocumentStore } from '@loom-studio/document-store'
import type { SecretStore } from '@loom-studio/secret-store'
import type { JsonValue } from '@loom-studio/shared'
import { createId } from '@loom-studio/shared'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import type { ObservationStore } from '../observability/types.js'
import { safeGenerationConfiguration } from '../observability/gateway.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument } from '../foundation/document-store.js'
import type {
  AiGateway,
  AiCapabilityProfileContent,
  OpenAICompatibleGatewayOptions,
  ProviderProfileContent,
} from '../types.js'

export function createDocumentBackedProfiledAiGateway(options: {
  documents: DocumentStore
  registry: AiGatewayCapabilityRegistry
  secrets?: SecretStore
  observations?: ObservationStore
}): ProfiledAiGateway {
  const buildGateway = (id?: string, profileId?: string) => createProfiledAiGateway({
    registry: id && options.observations ? {
      ...options.registry,
      invokeRegistered: input => options.registry.invokeRegistered({
        ...input,
        onPrepared: evidence => options.observations!.capture(() => options.observations!.patch(id, {
          request: { phase: 'invoking', input: evidence.input,
            capability: { profileId: profileId!, providerId: input.providerId, capabilityId: input.capabilityId },
            providerCallId: evidence.providerCallId,
            configuration: safeGenerationConfiguration(evidence.profileConfig) },
        })),
      }),
    } : options.registry,
    resolveProfile: async profileId => {
      const profile = await readDocument<AiCapabilityProfileContent>(
        options.documents,
        profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      const providerProfile = await readDocument<ProviderProfileContent>(
        options.documents,
        profile.content.providerProfileId,
        applicationDocumentTypes.providerProfile,
      )
      return {
        profileId: profile.id,
        providerProfileId: providerProfile.id,
        providerId: providerProfile.content.providerExtensionId,
        capabilityId: profile.content.capabilityId,
        accountConfig: providerProfile.content.config,
        profileConfig: profile.content.config,
      }
    },
    credentials: {
      withCredential: async (profile, operation) => {
        const providerProfile = await readDocument<ProviderProfileContent>(
          options.documents,
          profile.providerProfileId,
          applicationDocumentTypes.providerProfile,
        )
        if (!providerProfile.content.secretRef) return await operation(undefined)
        if (!options.secrets) throw new Error('Provider credential is not configured')
        return await options.secrets.withSecret(providerProfile.content.secretRef, {
          caller: 'application.ai-gateway',
          owner: { type: 'provider-profile', id: providerProfile.id },
          purpose: 'provider.credentials',
        }, async secret => await operation({ ...secret.values }))
      },
    },
  })
  // A per-call closure preserves correlation through asynchronous profile/credential resolution.
  function prepare(input: Parameters<ProfiledAiGateway['invoke']>[0]) {
    const id = createId('api')
    const startedAt = performance.now()
    options.observations?.capture(() => options.observations!.write({
      id, kind: 'api', title: input.profileId, status: 'running',
      origin: { actor: input.caller?.id },
      request: { phase: 'prepared', capability: { profileId: input.profileId } },
    }))
    const complete = async (result: ReturnType<ProfiledAiGateway['invoke']>) => {
      try {
        const value = await result
        options.observations?.capture(() => options.observations!.patch(id, {
          status: 'completed', durationMs: performance.now() - startedAt,
          request: { phase: 'completed', providerCallId: value.providerCallId, response: value.output },
        }))
        return value
      } catch (error) {
        options.observations?.capture(() => {
          const status = input.signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'aborted' : 'failed'
          options.observations!.patch(id, { status, durationMs: performance.now() - startedAt,
            diagnostic: error instanceof Error ? error.message : String(error), request: { phase: status } })
        })
        throw error
      }
    }
    return { gateway: buildGateway(id, input.profileId), complete }
  }
  if (!options.observations) return buildGateway()
  return {
    invoke: input => { const call = prepare(input); return call.complete(call.gateway.invoke(input)) },
    createRun: input => {
      const call = prepare(input)
      const run = call.gateway.createRun(input)
      const result = call.complete(run.result)
      result.catch(() => undefined)
      return { ...run, result }
    },
  }
}

export function createFakeAiGateway(): AiGateway {
  return {
    invokeChat: input => invokeFakeChat(input),
  }
}

export function createDocumentBackedAiGateway(options: {
  documents: DocumentStore
  secrets?: SecretStore
  fallback?: AiGateway
  resolveProxyUrl?: () => string | undefined
  providerAdapters?: ProviderAdapterRegistry
  observations?: ObservationStore
}): AiGateway {
  const fallback = options.fallback ?? createFakeAiGateway()
  const providerAdapters = options.providerAdapters ?? createOfficialProviderAdapterRegistry()
  const proxyTransports = new Map<string, typeof fetch>()

  function resolveTransport(): typeof fetch {
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
      if (!providerProfile.content.secretRef) {
        const resolved = providerAdapters.resolve(providerExtensionId, { config: providerProfile.content.config })
        if (resolved.provider.kind !== 'fake') throw new Error('Provider credential is not configured')
        return { modelIds: [...providerProfile.content.enabledModelIds] }
      }
      if (!options.secrets) throw new Error('Provider credential is not configured')

      return await options.secrets.withSecret(providerProfile.content.secretRef, {
        caller: 'application.ai-gateway',
        owner: { type: 'provider-profile', id: providerProfile.id },
        purpose: 'provider.credentials',
      }, async secret => {
        return {
          modelIds: await providerAdapters.listModels(providerExtensionId, {
            config: providerProfile.content.config,
            credential: secret.values,
            fetch: resolveTransport(),
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
      providerAdapters.validateAccountConfig(providerExtensionId, providerProfile.content.config)
      if (providerProfile.content.secretRef) {
        if (!options.secrets) throw new Error('Provider credential is not configured')
        return await options.secrets.withSecret(providerProfile.content.secretRef, {
          caller: 'application.ai-gateway',
          owner: { type: 'provider-profile', id: providerProfile.id },
          purpose: 'provider.credentials',
        }, async secret => {
          const resolved = providerAdapters.resolve(providerExtensionId, {
            config: providerProfile.content.config,
            credential: secret.values,
            fetch: resolveTransport(),
          })
          if (resolved.provider.kind === 'fake') return await invokeFakeChat(input)
          const sanitizedMessages = input.request.messages.filter(message => {
            if (message.role === 'assistant') {
              return (typeof message.content === 'string' && message.content.trim().length > 0)
                || Boolean(message.tool_calls && message.tool_calls.length > 0)
            }
            return typeof message.content === 'string' && message.content.trim().length > 0
          })
          const providerKind = resolved.provider.kind
          options.observations?.capture(() => {
            const id = input.request.metadata?.observationRequestId
            if (typeof id === 'string') options.observations!.patch(id, { request: {
              messages: sanitizedMessages,
              configuration: { provider: providerKind, ...safeGenerationConfiguration(parseProviderOptions(providerKind, input.request.providerOptions)?.[providerKind]) },
            } })
          })
          return await invokePlatformGateway(createAiGateway(), {
            provider: resolved.provider,
            modelId: input.model!.modelId,
            messages: sanitizedMessages,
            ...(input.request.tools ? { tools: input.request.tools } : {}),
            ...(input.request.toolChoice ? { toolChoice: input.request.toolChoice } : {}),
            ...(input.request.providerOptions ? { providerOptions: input.request.providerOptions } : {}),
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            ...(input.delivery ? { delivery: input.delivery } : {}),
            ...(input.onEvent ? { onEvent: input.onEvent } : {}),
          })
        })
      }
      const resolved = providerAdapters.resolve(providerExtensionId, { config: providerProfile.content.config })
      if (resolved.provider.kind === 'fake') return await invokeFakeChat(input)
      throw new Error('Provider credential is not configured')
    },
  }
}

async function invokeFakeChat(
  input: Parameters<AiGateway['invokeChat']>[0],
) {
  const providerCallId = createId('provider-call')
  const { completion, text } = createOfficialFakeChatCompletion({
    id: providerCallId,
    messages: input.request.messages,
  })
  return {
    provider: 'fake',
    model: input.model?.modelId ?? officialFakeModelId,
    message: { role: 'assistant' as const, content: text },
    text,
    finishReason: 'stop' as const,
    usage: { inputTokens: 0, outputTokens: 0 },
    providerCallId,
    raw: completion,
  }
}

export function createOpenAICompatibleGateway(options: OpenAICompatibleGatewayOptions): AiGateway {
  const transport = options.fetch ?? fetch
  const platformGateway = createAiGateway()

  return {
    invokeChat: async input => {
      if (!options.providerProfile.enabledModelIds.includes(options.modelId)) {
        throw new Error(`Provider model is not enabled: ${options.modelId}`)
      }

      return await invokePlatformGateway(platformGateway, {
          provider: {
            kind: 'openai-compatible',
            apiKey: options.apiKey,
            baseUrl: options.providerProfile.config?.baseUrl ?? 'https://api.openai.com/v1',
            fetch: transport,
          },
          modelId: options.modelId,
          messages: input.request.messages,
          ...(input.request.tools ? { tools: input.request.tools } : {}),
          ...(input.request.toolChoice ? { toolChoice: input.request.toolChoice } : {}),
          ...(input.request.providerOptions ? { providerOptions: input.request.providerOptions } : {}),
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          ...(input.delivery ? { delivery: input.delivery } : {}),
          ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      })
    },
  }
}

type PlatformGateway = ReturnType<typeof createAiGateway>
type PlatformGatewayInput = Parameters<PlatformGateway['invokeChat']>[0] & {
  onEvent?: (event: AiGatewayEvent) => void
}

async function invokePlatformGateway(gateway: PlatformGateway, input: PlatformGatewayInput) {
  try {
    if (!input.onEvent || input.delivery !== 'stream') {
      return toApplicationGatewayResult(await gateway.invokeChat(input))
    }
    const run = gateway.createRun(input)
    for await (const event of run.events) input.onEvent(event)
    return toApplicationGatewayResult(await run.result)
  } catch (error) {
    const providerError = readProviderHttpError(error)
    if (providerError) throw providerError
    if (!isProviderNetworkFailure(error)) throw error
    throw normalizeProviderNetworkError(error)
  }
}

function toApplicationGatewayResult(result: Awaited<ReturnType<ReturnType<typeof createAiGateway>['invokeChat']>>) {
  return {
    message: result.message,
    text: result.text,
    ...(result.reasoning ? { reasoning: result.reasoning } : {}),
    ...(result.toolCallErrors ? { toolCallErrors: result.toolCallErrors } : {}),
    provider: result.provider,
    model: result.model,
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
    ...(result.rawFinishReason ? { rawStopReason: result.rawFinishReason } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
    providerCallId: result.providerCallId ?? createId('provider-call'),
    ...(result.raw ? { raw: result.raw } : {}),
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

function isProviderNetworkFailure(error: unknown): boolean {
  if (readCauseCode(error)) return true
  let current = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if (current instanceof TypeError) return true
    current = 'cause' in current ? Reflect.get(current, 'cause') : undefined
  }
  return false
}

function readProviderHttpError(error: unknown): Error | undefined {
  let current = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const statusCode = 'statusCode' in current ? Reflect.get(current, 'statusCode') : undefined
    const responseBody = 'responseBody' in current ? Reflect.get(current, 'responseBody') : undefined
    if (typeof statusCode === 'number') {
      let message: string | undefined
      if (typeof responseBody === 'string') {
        try {
          const parsed = JSON.parse(responseBody) as JsonValue
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
            const providerError = parsed.error
            if (providerError && typeof providerError === 'object' && !Array.isArray(providerError) && typeof providerError.message === 'string') {
              message = providerError.message
            }
          }
        } catch {
          // Keep the stable status-only fallback for non-JSON provider errors.
        }
      }
      return Object.assign(
        new Error(message ? `Provider request failed (${statusCode}): ${message}` : `Provider request failed (${statusCode})`),
        { statusCode },
      )
    }
    current = 'cause' in current ? Reflect.get(current, 'cause') : undefined
  }
  return undefined
}

function readCauseCode(error: unknown): string | undefined {
  let current = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current) {
      const code = Reflect.get(current, 'code')
      if (typeof code === 'string') return code
    }
    current = 'cause' in current ? Reflect.get(current, 'cause') : undefined
  }
  return undefined
}
