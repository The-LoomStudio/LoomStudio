import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type {
  AiGatewayCapabilityRegistry,
  AiGatewayInvocationCaller,
  AiGatewayInvokeResult,
} from './capability-registry.js'
import type { AiGatewayEvent, AiGatewayRun, AiGatewayRunState } from './types.js'

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
  }): AiGatewayRun
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

function createProfiledRun(start: (signal: AbortSignal) => Promise<AiGatewayInvokeResult>, externalSignal?: AbortSignal): AiGatewayRun {
  const id = `gateway-run-${Math.random().toString(36).slice(2)}`
  const controller = new AbortController()
  const events = new ProfiledEventStream()
  let state: AiGatewayRunState = 'running'
  let reason: string | undefined
  const cancel = (value?: string) => {
    if (state !== 'running') return
    reason = value
    controller.abort(value)
  }
  if (externalSignal) {
    if (externalSignal.aborted) cancel(readAbortReason(externalSignal))
    else externalSignal.addEventListener('abort', () => cancel(readAbortReason(externalSignal)), { once: true })
  }
  const result = (async () => {
    events.push({ type: 'started', runId: id })
    try {
      const value = await start(controller.signal)
      if (controller.signal.aborted) throw abortError(reason)
      const text = readOutputText(value.output)
      if (text) events.push({ type: 'text-delta', runId: id, delta: text })
      state = 'completed'
      events.push({ type: 'completed', runId: id, result: {
        message: { role: 'assistant', content: text },
        text,
        model: 'capability',
        provider: value.providerId,
        providerCallId: value.providerCallId,
      } })
      events.close()
      return value as never
    } catch (error) {
      state = controller.signal.aborted || isAbortError(error) ? 'cancelled' : 'failed'
      events.push(state === 'cancelled'
        ? { type: 'cancelled', runId: id, ...(reason ? { reason } : {}) }
        : { type: 'failed', runId: id, error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error) } })
      events.close()
      throw error
    }
  })()
  result.catch(() => undefined)
  return { id, events, readEvents: cursor => events.readEvents(cursor), result: result as Promise<never>, getState: () => state, cancel }
}

class ProfiledEventStream implements AsyncIterable<AiGatewayEvent> {
  private readonly values: AiGatewayEvent[] = []
  private readonly waiters: Array<() => void> = []
  private closed = false
  push(event: AiGatewayEvent) { if (!this.closed) { this.values.push(event); this.waiters.splice(0).forEach(resolve => resolve()) } }
  close() { this.closed = true; this.waiters.splice(0).forEach(resolve => resolve()) }
  readEvents(cursor = 0) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Gateway event cursor must be a non-negative integer')
    return { events: this.values.slice(cursor), nextCursor: this.values.length, done: this.closed }
  }
  async *[Symbol.asyncIterator]() { let index = 0; while (true) { if (index < this.values.length) yield this.values[index++]!; else if (this.closed) return; else await new Promise<void>(resolve => this.waiters.push(resolve)) } }
}

function readOutputText(output: JsonValue): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return ''
  const choices = 'choices' in output ? output.choices : undefined
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object' || Array.isArray(choices[0])) return ''
  const message = 'message' in choices[0] ? choices[0].message : undefined
  return message && typeof message === 'object' && !Array.isArray(message) && typeof message.content === 'string' ? message.content : ''
}

function readAbortReason(signal: AbortSignal): string | undefined {
  return typeof signal.reason === 'string' ? signal.reason : signal.reason instanceof Error ? signal.reason.message : undefined
}
function abortError(reason?: string) { const error = new Error(reason ?? 'Gateway run cancelled'); error.name = 'AbortError'; return error }
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError' }
