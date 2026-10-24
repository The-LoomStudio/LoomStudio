import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type {
  AiGatewayCapabilityRegistry,
  AiGatewayInvocationCaller,
  AiGatewayInvokeResult,
} from './capability-registry.js'
import type { AiGatewayRun, AiGatewayRunState } from './types.js'
import { GatewayEventStream } from './event-stream.js'

export type ResolvedAiCapabilityProfile = {
  profileId: string
  providerProfileId: string
  providerId: string
  capabilityId: string
  accountConfig: JsonObject
  profileConfig: JsonObject
}

export type AiGatewayCredentialScope = {
  withCredential<T>(
    profile: ResolvedAiCapabilityProfile,
    operation: (credential: Record<string, string> | undefined) => Promise<T>,
  ): Promise<T>
}

export type ProfiledAiGateway = {
  invoke(input: {
    profileId: string
    input: JsonValue
    signal?: AbortSignal
    caller?: AiGatewayInvocationCaller
  }): Promise<AiGatewayInvokeResult>
  createRun(input: {
    profileId: string
    input: JsonValue
    signal?: AbortSignal
    caller?: AiGatewayInvocationCaller
  }): AiGatewayRun<AiGatewayInvokeResult>
}

export function createProfiledAiGateway(options: {
  registry: AiGatewayCapabilityRegistry
  resolveProfile(profileId: string): Promise<ResolvedAiCapabilityProfile>
  credentials?: AiGatewayCredentialScope
}): ProfiledAiGateway {
  const invoke = async (input: Parameters<ProfiledAiGateway['invoke']>[0]): Promise<AiGatewayInvokeResult> => {
    const profile = await options.resolveProfile(input.profileId)
    if (profile.profileId !== input.profileId) {
      throw new Error(`AI Gateway resolved the wrong capability profile: ${input.profileId}`)
    }

    const operation = async (credential: Record<string, string> | undefined) => {
      const result = await options.registry.invokeRegistered({
        providerId: profile.providerId,
        capabilityId: profile.capabilityId,
        accountConfig: profile.accountConfig,
        ...(credential ? { credential } : {}),
        profileConfig: profile.profileConfig,
        input: input.input,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.caller ? { caller: input.caller } : {}),
      })
      return { profileId: profile.profileId, ...result }
    }
    return options.credentials
      ? await options.credentials.withCredential(profile, operation)
      : await operation(undefined)
  }

  return {
    invoke,
    createRun: input => createProfiledRun(signal => invoke({ ...input, signal }), input.signal),
  }
}

function createProfiledRun(start: (signal: AbortSignal) => Promise<AiGatewayInvokeResult>, externalSignal?: AbortSignal): AiGatewayRun<AiGatewayInvokeResult> {
  const id = `gateway-run-${Math.random().toString(36).slice(2)}`
  const controller = new AbortController()
  const events = new GatewayEventStream<AiGatewayInvokeResult>()
  let state: AiGatewayRunState = 'running'
  let reason: string | undefined
  const cancel = (value?: string) => {
    if (state !== 'running') return
    reason = value
    controller.abort(value)
  }
  const onExternalAbort = () => cancel(readAbortReason(externalSignal!))
  if (externalSignal) {
    if (externalSignal.aborted) cancel(readAbortReason(externalSignal))
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const result = (async () => {
    events.push({ type: 'started', runId: id })
    try {
      const value = await start(controller.signal)
      if (controller.signal.aborted) throw abortError(reason)
      state = 'completed'
      events.push({ type: 'completed', runId: id, result: value })
      events.close()
      return value
    } catch (error) {
      state = controller.signal.aborted || isAbortError(error) ? 'cancelled' : 'failed'
      events.push(state === 'cancelled'
        ? { type: 'cancelled', runId: id, ...(reason ? { reason } : {}) }
        : { type: 'failed', runId: id, error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error) } })
      events.close()
      throw error
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  })()
  result.catch(() => undefined)
  return { id, events, readEvents: cursor => events.readEvents(cursor), result, getState: () => state, cancel }
}

function readAbortReason(signal: AbortSignal): string | undefined {
  return typeof signal.reason === 'string' ? signal.reason : signal.reason instanceof Error ? signal.reason.message : undefined
}
function abortError(reason?: string) { const error = new Error(reason ?? 'Gateway run cancelled'); error.name = 'AbortError'; return error }
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError' }
