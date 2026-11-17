import type { MediaAssetLookup } from '../types.js'
import { validateMessageAttachments } from '../agents/message-attachments.js'
import type { StatisticsStore } from '../data/index.js'
import {
  createAiGateway,
  createOfficialFakeChatCompletion,
  createOfficialProviderAdapterRegistry,
  createProfiledRun,
  officialFakeModelId,
  parseProviderOptions,
  type AiGatewayCapabilityRegistry,
  type AiGatewayInvocationContext,
  type AiGatewayInvokeResult,
  type ProfiledAiGateway,
  type ProviderAdapterRegistry,
  type AiGatewayEvent,
} from '@loom-studio/ai-gateway'
import type { DocumentStore } from '@loom-studio/kernel/document-store'
import { readLogFailure, type Logger } from '@loom-studio/logging'
import type { SecretStore } from '@loom-studio/kernel/secret-store'
import type { JsonValue } from '@loom-studio/shared'
import { createId } from '@loom-studio/shared'
import type { TokenUsage } from '@loom-studio/shared/tokenizer/contracts'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import type { ObservationOrigin, ObservationStore } from '../observability/types.js'
import { readObservationRequestId, safeGenerationConfiguration } from '../observability/gateway.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument } from '../foundation/document-store.js'
import type {
  AiGateway,
  AiCapabilityProfileContent,
  GatewayChatResult,
  GatewayInvokeChatInput,
  OpenAICompatibleGatewayOptions,
  ProviderProfileContent,
} from '../types.js'

export type AiGatewayLogEvent =
  | {
      phase: 'started'
      kind: 'chat' | 'capability'
      invocationId: string
      model?: string
      providerProfileId?: string
      capabilityProfileId?: string
      runId?: string
      sessionId?: string
      branchId?: string
      messageCount?: number
      toolCount?: number
      delivery?: string
      providerStep?: number
      detail: string
      correlationId?: string
      callId?: string
      parentCallId?: string
    }
  | {
      phase: 'completed'
      kind: 'chat' | 'capability'
      invocationId: string
      provider: string
      model: string
      providerProfileId?: string
      capabilityProfileId?: string
      capabilityId?: string
      runId?: string
      sessionId?: string
      branchId?: string
      messageCount?: number
      toolCount?: number
      delivery?: string
      providerStep?: number
      outputCharacters?: number
      toolCallCount?: number
      detail: string
      firstOutputMs?: number
      durationMs: number
      providerCallId?: string
      finishReason?: string
      usage?: TokenUsage
      correlationId?: string
      callId?: string
      parentCallId?: string
    }
  | {
      phase: 'cancelled' | 'failed'
      kind: 'chat' | 'capability'
      invocationId: string
      model?: string
      providerProfileId?: string
      capabilityProfileId?: string
      runId?: string
      sessionId?: string
      branchId?: string
      messageCount?: number
      toolCount?: number
      delivery?: string
      providerStep?: number
      detail: string
      firstOutputMs?: number
      durationMs: number
      error: unknown
      correlationId?: string
      callId?: string
      parentCallId?: string
    }

export type AiGatewayLogHook = (event: AiGatewayLogEvent) => void

export type UnifiedAiGateway = AiGateway & ProfiledAiGateway

export type UnifiedAiGatewayOptions = {
  mediaAssets?: MediaAssetLookup
  documents: DocumentStore
  secrets?: SecretStore
  fallback?: AiGateway
  resolveProxyUrl?: () => string | undefined
  providerAdapters?: ProviderAdapterRegistry
  aiCapabilities?: AiGatewayCapabilityRegistry
  statistics?: StatisticsStore
  observations?: ObservationStore
  providerLogger?: Logger
  onLog?: AiGatewayLogHook
}

export function createProviderLoggerGatewayHook(logger: Logger): AiGatewayLogHook {
  return event => {
    const logContext = {
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
      ...(event.callId ? { callId: event.callId } : {}),
      ...(event.parentCallId ? { parentCallId: event.parentCallId } : {}),
    }
    const baseData = {
      invocationId: event.invocationId,
      ...(event.runId !== undefined ? { runId: event.runId } : {}),
      ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
      ...(event.branchId !== undefined ? { branchId: event.branchId } : {}),
      ...(event.providerProfileId !== undefined ? { providerProfileId: event.providerProfileId } : {}),
      ...(event.capabilityProfileId !== undefined ? { capabilityProfileId: event.capabilityProfileId } : {}),
      ...(event.model !== undefined ? { modelId: event.model } : {}),
      ...(event.messageCount !== undefined ? { messageCount: event.messageCount } : {}),
      ...(event.toolCount !== undefined ? { toolCount: event.toolCount } : {}),
      ...(event.delivery !== undefined ? { delivery: event.delivery } : {}),
      ...(event.providerStep !== undefined ? { providerStep: event.providerStep } : {}),
      detail: event.detail,
    }
    const label = event.model ?? event.capabilityProfileId ?? 'default model'
    if (event.phase === 'started') {
      logger.info(`${label} · request started`, {
        event: 'provider.invoke.started',
        data: { ...baseData, outcome: 'running' },
        ...logContext,
      })
      return
    }
    if (event.phase === 'completed') {
      const detail = event.kind === 'chat'
        ? `${event.detail} · ${event.outputCharacters ?? 0} output characters · ${event.toolCallCount ?? 0} native tool calls`
        : event.detail
      logger.info(`${event.model} · response completed${event.finishReason ? ` · ${event.finishReason}` : ''}`, {
        event: 'provider.invoke.completed',
        data: {
          ...baseData,
          provider: event.provider,
          model: event.model,
          outcome: 'completed',
          ...(event.capabilityId !== undefined ? { capabilityId: event.capabilityId } : {}),
          ...(event.outputCharacters !== undefined ? { outputCharacters: event.outputCharacters } : {}),
          ...(event.toolCallCount !== undefined ? { toolCallCount: event.toolCallCount } : {}),
          detail,
          ...(event.firstOutputMs === undefined ? {} : { firstOutputMs: event.firstOutputMs }),
          ...(event.providerCallId ? { providerCallId: event.providerCallId } : {}),
          ...(event.finishReason ? { finishReason: event.finishReason } : {}),
          ...(event.usage ? {
            usage: {
              ...(event.usage.inputTokens === undefined ? {} : { inputTokens: event.usage.inputTokens }),
              ...(event.usage.outputTokens === undefined ? {} : { outputTokens: event.usage.outputTokens }),
            },
          } : {}),
          durationMs: event.durationMs,
        },
        ...logContext,
      })
      return
    }
    const cancelled = event.phase === 'cancelled'
    const failure = readLogFailure(event.error)
    logger[cancelled ? 'info' : 'error'](`${label} · ${cancelled ? 'request cancelled' : failure.failureReason}`, {
      event: cancelled ? 'provider.invoke.cancelled' : 'provider.invoke.failed',
      data: {
        ...baseData,
        durationMs: event.durationMs,
        outcome: event.phase,
        ...failure,
        ...(event.firstOutputMs === undefined ? {} : { firstOutputMs: event.firstOutputMs }),
      },
      ...logContext,
    })
  }
}

export function createUnifiedAiGateway(options: UnifiedAiGatewayOptions): UnifiedAiGateway {
  const fallback = options.fallback ?? createFakeAiGateway()
  const providerAdapters = options.providerAdapters ?? createOfficialProviderAdapterRegistry()
  const platformGateway = createAiGateway()
  const proxyTransports = new Map<string, typeof fetch>()
  const logHook = combineLogHooks(
    options.providerLogger ? createProviderLoggerGatewayHook(options.providerLogger) : undefined,
    options.onLog,
  )

  function emitLog(event: AiGatewayLogEvent): void {
    if (!logHook) return
    try { logHook(event) } catch { /* Logging cannot interrupt provider execution. */ }
  }

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

  async function executeCapabilityInvoke(input: Parameters<ProfiledAiGateway['invoke']>[0]): Promise<AiGatewayInvokeResult> {
    if (!options.aiCapabilities) throw new Error('AI Gateway capability registry is not configured')
    const registry = options.aiCapabilities
    const id = createId('api')
    const invocationId = createId('invoke')
    const startedAt = performance.now()
    const context = input.context
    const timelineId = context?.timelineId
    const origin = buildCapabilityOrigin(input.caller, context)
    const detail = `capability ${input.profileId}`

    options.observations?.capture(() => options.observations!.write({
      id,
      kind: 'api',
      title: input.profileId,
      status: 'running',
      ...(timelineId ? { timelineId } : {}),
      ...(origin ? { origin } : {}),
      request: { phase: 'prepared', capability: { profileId: input.profileId } },
    }))
    emitLog({
      phase: 'started',
      kind: 'capability',
      invocationId,
      capabilityProfileId: input.profileId,
      detail,
      ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
      ...(context?.callId ? { callId: context.callId } : {}),
      ...(context?.parentCallId ? { parentCallId: context.parentCallId } : {}),
    })

    let resolvedCapabilityId: string | undefined
    let resolvedProviderProfileId: string | undefined
    let resolvedModelId: string | undefined
    try {
      const profile = await readDocument<AiCapabilityProfileContent>(
        options.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      const providerProfile = await readDocument<ProviderProfileContent>(
        options.documents,
        profile.content.providerProfileId,
        applicationDocumentTypes.providerProfile,
      )
      resolvedCapabilityId = profile.content.capabilityId
      resolvedProviderProfileId = providerProfile.id
      resolvedModelId = typeof profile.content.config.modelId === 'string' ? profile.content.config.modelId : undefined

      const runWithCredential = async (credential: Record<string, string> | undefined): Promise<AiGatewayInvokeResult> => {
        const invokeRegistered = (report?: Parameters<Parameters<StatisticsStore['track']>[1]>[0]) =>
          registry.invokeRegistered({
            providerId: providerProfile.content.providerExtensionId,
            capabilityId: profile.content.capabilityId,
            accountConfig: providerProfile.content.config,
            ...(credential ? { credential } : {}),
            profileConfig: profile.content.config,
            input: input.input,
            ...(input.signal ? { signal: input.signal } : {}),
            ...(input.caller ? { caller: input.caller } : {}),
            ...(report ? { onUsage: report } : {}),
            onPrepared: evidence => {
              options.observations?.capture(() => options.observations!.patch(id, {
                request: {
                  phase: 'invoking',
                  input: evidence.input,
                  capability: {
                    profileId: profile.id,
                    providerId: providerProfile.content.providerExtensionId,
                    capabilityId: profile.content.capabilityId,
                  },
                  providerCallId: evidence.providerCallId,
                  configuration: safeGenerationConfiguration(evidence.profileConfig),
                },
              }))
            },
          })

        const registeredResult = options.statistics
          ? await options.statistics.track({
              id,
              providerProfileId: providerProfile.id,
              providerId: providerProfile.content.providerExtensionId,
              providerName: providerProfile.content.displayName,
              capabilityId: profile.content.capabilityId,
              modelId: resolvedModelId,
              ...(timelineId ? { timelineId } : {}),
              purpose: input.caller?.kind === 'extension' ? 'extension-capability' : 'capability',
              simulated: providerProfile.content.providerExtensionId === 'official.fake',
            }, report => invokeRegistered(report), input.signal)
          : await invokeRegistered()
        return { profileId: profile.id, ...registeredResult }
      }

      const value = providerProfile.content.secretRef
        ? await (() => {
            if (!options.secrets) throw new Error('Provider credential is not configured')
            return options.secrets.withSecret(providerProfile.content.secretRef, {
              caller: 'application.ai-gateway',
              owner: { type: 'provider-profile', id: providerProfile.id },
              purpose: 'provider.credentials',
            }, async secret => await runWithCredential({ ...secret.values }))
          })()
        : await runWithCredential(undefined)

      const durationMs = readDurationMs(startedAt)
      options.observations?.capture(() => options.observations!.patch(id, {
        status: 'completed',
        durationMs,
        request: {
          phase: 'completed',
          providerCallId: value.providerCallId,
          ...(value.usage ? { usage: value.usage } : {}),
          response: value.output,
        },
      }))
      emitLog({
        phase: 'completed',
        kind: 'capability',
        invocationId,
        provider: value.providerId,
        model: resolvedModelId ?? value.capabilityId,
        providerProfileId: resolvedProviderProfileId,
        capabilityProfileId: value.profileId,
        capabilityId: value.capabilityId,
        detail,
        durationMs,
        providerCallId: value.providerCallId,
        ...(value.usage ? { usage: value.usage } : {}),
        ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
        ...(context?.callId ? { callId: context.callId } : {}),
        ...(context?.parentCallId ? { parentCallId: context.parentCallId } : {}),
      })
      return value
    } catch (error) {
      const durationMs = readDurationMs(startedAt)
      const aborted = Boolean(input.signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
      const status = aborted ? 'aborted' : 'failed'
      options.observations?.capture(() => options.observations!.patch(id, {
        status,
        durationMs,
        diagnostic: error instanceof Error ? error.message : String(error),
        request: { phase: status },
      }))
      emitLog({
        phase: aborted ? 'cancelled' : 'failed',
        kind: 'capability',
        invocationId,
        model: resolvedModelId ?? resolvedCapabilityId ?? input.profileId,
        providerProfileId: resolvedProviderProfileId,
        capabilityProfileId: input.profileId,
        detail,
        durationMs,
        error,
        ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
        ...(context?.callId ? { callId: context.callId } : {}),
        ...(context?.parentCallId ? { parentCallId: context.parentCallId } : {}),
      })
      throw error
    }
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
      const existingId = readObservationRequestId(input.request)
      const observationId = typeof existingId === 'string' ? existingId : createId('api')
      const invocationId = createId('invoke')
      const startedAt = performance.now()
      let firstOutputMs: number | undefined
      const timelineId = resolveChatTimelineId(input)
      const origin = buildChatOrigin(input)
      const references = buildChatLogReferences(input, invocationId)

      options.observations?.capture(() => {
        if (typeof existingId !== 'string') {
          options.observations!.write({
            id: observationId,
            kind: 'api',
            title: input.model?.modelId ?? 'Model API',
            status: 'running',
            modelId: input.model?.modelId,
            timelineId,
            ...(origin ? { origin } : {}),
            request: {
              preparedMessages: input.request.messages,
              messages: input.request.messages,
              tools: input.request.tools,
              toolChoice: input.request.toolChoice,
              model: input.model,
              delivery: input.delivery ?? 'complete',
              phase: 'prepared',
              configuration: safeGenerationConfiguration(input.request.providerOptions),
            },
          })
        }
        options.observations!.patch(observationId, { request: { phase: 'invoking' } })
      })

      emitLog({
        phase: 'started',
        kind: 'chat',
        ...references,
        ...(input.context?.correlationId ? { correlationId: input.context.correlationId } : {}),
        ...(input.context?.callId ? { callId: input.context.callId } : {}),
        ...(input.context?.parentCallId ? { parentCallId: input.context.parentCallId } : {}),
      })

      const trackedOnEvent = input.onEvent
        ? (event: AiGatewayEvent) => {
            if (
              firstOutputMs === undefined &&
              (event.type === 'text-delta' || event.type === 'reasoning-delta' || event.type === 'tool-input-delta')
            ) {
              firstOutputMs = readDurationMs(startedAt)
            }
            input.onEvent!(event)
          }
        : undefined

      try {
        let result: GatewayChatResult
        if (!input.model) {
          result = await fallback.invokeChat({
            ...input,
            ...(trackedOnEvent ? { onEvent: trackedOnEvent } : {}),
          })
        } else {
          const providerProfile = await readDocument<ProviderProfileContent>(
            options.documents,
            input.model.providerProfileId,
            applicationDocumentTypes.providerProfile,
          )
          if (!providerProfile.content.enabledModelIds.includes(input.model.modelId)) {
            throw new Error(`Provider model is not enabled: ${input.model.modelId}`)
          }
          const providerExtensionId = providerProfile.content.providerExtensionId
          providerAdapters.validateAccountConfig(providerExtensionId, providerProfile.content.config)

          if (providerProfile.content.secretRef) {
            if (!options.secrets) throw new Error('Provider credential is not configured')
            result = await options.secrets.withSecret(providerProfile.content.secretRef, {
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
              const sanitizedMessages = sanitizeChatMessages(input.request.messages)
              const actualProvider = resolved.provider
              const providerKind = actualProvider.kind
              options.observations?.capture(() => {
                options.observations!.patch(observationId, {
                  request: {
                    messages: sanitizedMessages,
                    configuration: {
                      provider: providerKind,
                      ...safeGenerationConfiguration(parseProviderOptions(providerKind, input.request.providerOptions)?.[providerKind]),
                    },
                  },
                })
              })
              const dispatch = async (report?: Parameters<Parameters<StatisticsStore['track']>[1]>[0]) => {
                const chatResult = await invokePlatformGateway(platformGateway, {
                  ...(report ? { onUsage: report } : {}),
                  provider: actualProvider,
                  modelId: input.model!.modelId,
                  messages: await prepareAttachmentTransport(sanitizedMessages, options.mediaAssets),
                  ...(input.request.tools ? { tools: input.request.tools } : {}),
                  ...(input.request.toolChoice ? { toolChoice: input.request.toolChoice } : {}),
                  ...(input.request.providerOptions ? { providerOptions: input.request.providerOptions } : {}),
                  ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
                  ...(input.delivery ? { delivery: input.delivery } : {}),
                  ...(trackedOnEvent ? { onEvent: trackedOnEvent } : {}),
                })
                if (chatResult.usage) report?.(chatResult.usage, chatResult.providerCallId)
                return chatResult
              }
              if (!options.statistics) return await dispatch()
              return await options.statistics.track({
                id: createId('usage'),
                providerProfileId: providerProfile.id,
                providerId: providerExtensionId,
                providerName: providerProfile.content.displayName,
                modelId: input.model!.modelId,
                ...(input.sessionId ? { sessionId: input.sessionId } : {}),
                ...(timelineId ? { timelineId } : {}),
                purpose: typeof input.request.metadata?.purpose === 'string' ? input.request.metadata.purpose : 'chat',
                simulated: false,
              }, report => dispatch(report), input.abortSignal)
            })
          } else {
            const resolved = providerAdapters.resolve(providerExtensionId, { config: providerProfile.content.config })
            if (resolved.provider.kind !== 'fake') throw new Error('Provider credential is not configured')
            result = await invokeFakeChat(input)
          }
        }

        const durationMs = readDurationMs(startedAt)
        options.observations?.capture(() => options.observations!.patch(observationId, {
          status: 'completed',
          durationMs,
          request: {
            phase: 'completed',
            usage: result.usage,
            finishReason: result.finishReason,
            providerCallId: result.providerCallId,
            firstOutputMs,
            response: {
              message: result.message,
              reasoning: result.reasoning,
              model: result.model,
              provider: result.provider,
            },
          },
        }))
        emitLog({
          phase: 'completed',
          kind: 'chat',
          ...references,
          provider: result.provider,
          model: result.model,
          outputCharacters: result.text.length,
          toolCallCount: result.message.tool_calls?.length ?? 0,
          ...(firstOutputMs === undefined ? {} : { firstOutputMs }),
          durationMs,
          ...(result.providerCallId ? { providerCallId: result.providerCallId } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(input.context?.correlationId ? { correlationId: input.context.correlationId } : {}),
          ...(input.context?.callId ? { callId: input.context.callId } : {}),
          ...(input.context?.parentCallId ? { parentCallId: input.context.parentCallId } : {}),
        })
        return result
      } catch (error) {
        const durationMs = readDurationMs(startedAt)
        const aborted = Boolean(input.abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError'))
        const status = aborted ? 'aborted' : 'failed'
        options.observations?.capture(() => options.observations!.patch(observationId, {
          status,
          durationMs,
          diagnostic: error instanceof Error ? error.message : String(error),
          request: { phase: status, firstOutputMs },
        }))
        emitLog({
          phase: aborted ? 'cancelled' : 'failed',
          kind: 'chat',
          ...references,
          ...(firstOutputMs === undefined ? {} : { firstOutputMs }),
          durationMs,
          error,
          ...(input.context?.correlationId ? { correlationId: input.context.correlationId } : {}),
          ...(input.context?.callId ? { callId: input.context.callId } : {}),
          ...(input.context?.parentCallId ? { parentCallId: input.context.parentCallId } : {}),
        })
        throw error
      }
    },

    invoke: executeCapabilityInvoke,
    createRun: input => createProfiledRun(signal => executeCapabilityInvoke({ ...input, signal }), input.signal),
  }
}

export function createDocumentBackedProfiledAiGateway(options: {
  documents: DocumentStore
  registry: AiGatewayCapabilityRegistry
  secrets?: SecretStore
  statistics?: StatisticsStore
  observations?: ObservationStore
  providerLogger?: Logger
  onLog?: AiGatewayLogHook
}): ProfiledAiGateway {
  const gateway = createUnifiedAiGateway({
    documents: options.documents,
    aiCapabilities: options.registry,
    secrets: options.secrets,
    statistics: options.statistics,
    observations: options.observations,
    providerLogger: options.providerLogger,
    onLog: options.onLog,
  })
  return {
    invoke: gateway.invoke,
    createRun: gateway.createRun,
  }
}

export function createFakeAiGateway(): AiGateway {
  return {
    invokeChat: input => invokeFakeChat(input),
  }
}

export function createDocumentBackedAiGateway(options: {
  mediaAssets?: MediaAssetLookup
  documents: DocumentStore
  secrets?: SecretStore
  fallback?: AiGateway
  resolveProxyUrl?: () => string | undefined
  providerAdapters?: ProviderAdapterRegistry
  statistics?: StatisticsStore
  observations?: ObservationStore
  providerLogger?: Logger
  onLog?: AiGatewayLogHook
}): AiGateway {
  const gateway = createUnifiedAiGateway(options)
  return {
    listModels: gateway.listModels,
    invokeChat: gateway.invokeChat,
  }
}

function combineLogHooks(
  primary?: AiGatewayLogHook,
  secondary?: AiGatewayLogHook,
): AiGatewayLogHook | undefined {
  if (!primary) return secondary
  if (!secondary) return primary
  return event => {
    primary(event)
    secondary(event)
  }
}

function buildCapabilityOrigin(
  caller: Parameters<ProfiledAiGateway['invoke']>[0]['caller'],
  context?: AiGatewayInvocationContext,
): ObservationOrigin | undefined {
  const origin: ObservationOrigin = {
    ...(context?.packageId ? { packageId: context.packageId } : {}),
    ...(context?.moduleId ? { moduleId: context.moduleId } : {}),
    ...(context?.installationId ? { installationId: context.installationId } : {}),
    ...(context?.timelineId ? { timelineId: context.timelineId } : {}),
    ...(context?.eventId ? { eventId: context.eventId } : {}),
    ...(context?.eventName ? { eventName: context.eventName } : {}),
    ...(caller?.id ? { actor: caller.id } : {}),
    ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
    ...(context?.callId ? { callId: context.callId } : {}),
    ...(context?.parentCallId ? { parentCallId: context.parentCallId } : {}),
  }
  return Object.keys(origin).length > 0 ? origin : undefined
}

function resolveChatTimelineId(input: GatewayInvokeChatInput): string | undefined {
  if (input.context?.observationOrigin?.timelineId) return input.context.observationOrigin.timelineId
  const metadataTimelineId = input.request.metadata?.timelineId
  return typeof metadataTimelineId === 'string' && metadataTimelineId.length > 0 ? metadataTimelineId : undefined
}

function buildChatOrigin(input: GatewayInvokeChatInput): ObservationOrigin | undefined {
  if (!input.context) return undefined
  return {
    ...input.context.observationOrigin,
    ...(input.context.actor?.id !== undefined ? { actor: input.context.actor.id } : {}),
    ...(input.context.correlationId !== undefined ? { correlationId: input.context.correlationId } : {}),
    ...(input.context.callId !== undefined ? { callId: input.context.callId } : {}),
    ...(input.context.parentCallId !== undefined ? { parentCallId: input.context.parentCallId } : {}),
  }
}

function buildChatLogReferences(input: GatewayInvokeChatInput, invocationId: string) {
  const providerStep = input.request.metadata?.providerStep
  return {
    invocationId,
    runId: input.runId,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
    ...(input.model ? {
      providerProfileId: input.model.providerProfileId,
      model: input.model.modelId,
    } : {}),
    messageCount: input.request.messages.length,
    toolCount: input.request.tools?.length ?? 0,
    delivery: input.delivery ?? 'complete',
    ...(typeof providerStep === 'number' ? { providerStep } : {}),
    detail: `${typeof providerStep === 'number' ? `Step ${providerStep} · ` : ''}${input.request.messages.length} messages · ${input.request.tools?.length ?? 0} native tools · ${input.delivery ?? 'complete'}`,
  }
}

function sanitizeChatMessages(messages: GatewayInvokeChatInput['request']['messages']) {
  return messages.filter(message => {
    if (message.role === 'assistant') {
      return (typeof message.content === 'string' && message.content.trim().length > 0)
        || Boolean(message.tool_calls && message.tool_calls.length > 0)
    }
    return typeof message.content === 'string'
      && (message.content.trim().length > 0 || (message.role === 'user' && Boolean(message.attachments?.length)))
  })
}

function readDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100
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
          messages: await prepareAttachmentTransport(input.request.messages, options.mediaAssets),
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

async function prepareAttachmentTransport(messages: import('@loom-studio/shared').ChatMessage[], assets?: MediaAssetLookup): Promise<import('@loom-studio/ai-gateway').AiGatewayRequest['messages']> {
  return Promise.all(messages.map(async message => {
    if (message.role !== 'user' || !message.attachments?.length) return message
    const attachments = await validateMessageAttachments(assets, message.attachments)
    const images = await Promise.all(attachments.filter(file => file.kind === 'image').map(async file => ({
      mediaType: file.mediaType,
      data: Buffer.from(await assets!.read!(file.assetId, { maxBytes: 32 * 1024 * 1024 })).toString('base64'),
    })))
    return { role: 'user' as const, content: message.content, ...(images.length ? { images } : {}) }
  }))
}
