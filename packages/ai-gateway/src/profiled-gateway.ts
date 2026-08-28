import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type {
  AiGatewayCapabilityRegistry,
  AiGatewayInvocationCaller,
  AiGatewayInvokeResult,
} from './capability-registry.js'

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
}

export function createProfiledAiGateway(options: {
  registry: AiGatewayCapabilityRegistry
  resolveProfile(profileId: string): Promise<ResolvedAiCapabilityProfile>
  credentials?: AiGatewayCredentialScope
}): ProfiledAiGateway {
  return {
    invoke: async input => {
      const profile = await options.resolveProfile(input.profileId)
      if (profile.profileId !== input.profileId) {
        throw new Error(`AI Gateway resolved the wrong capability profile: ${input.profileId}`)
      }

      const invoke = async (credential: Record<string, string> | undefined) => {
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
        ? await options.credentials.withCredential(profile, invoke)
        : await invoke(undefined)
    },
  }
}
