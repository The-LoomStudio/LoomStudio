import type {
  ApplicationRuntime,
  RuntimeRequestContext,
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readOptionalStringRecord,
  readString,
} from '../../rpc-params.js'

export async function handleProvidersRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.createProviderProfile':
      return await runtime.createProviderProfile({
        providerExtensionId: readString(params, 'providerExtensionId'),
        displayName: readString(params, 'displayName'),
        config: readOptionalObject(params, 'config'),
        enabledModelIds: readOptionalStringArray(params, 'enabledModelIds'),
        credential: readOptionalStringRecord(params, 'credential'),
      }, context) as unknown as JsonValue

    case 'application.getProviderProfile':
      return await runtime.getProviderProfile({
        providerProfileId: readString(params, 'providerProfileId'),
      }) as unknown as JsonValue

    case 'application.listProviderProfiles':
      return await runtime.listProviderProfiles({
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.updateProviderProfile':
      return await runtime.updateProviderProfile({
        providerProfileId: readString(params, 'providerProfileId'),
        displayName: readOptionalString(params, 'displayName'),
        config: readOptionalObject(params, 'config'),
        enabledModelIds: readOptionalStringArray(params, 'enabledModelIds'),
      }) as unknown as JsonValue

    case 'application.replaceProviderCredential':
      return await runtime.replaceProviderCredential({
        providerProfileId: readString(params, 'providerProfileId'),
        credential: readRequiredStringRecord(params, 'credential'),
      }, context) as unknown as JsonValue

    case 'application.deleteProviderProfile':
      return await runtime.deleteProviderProfile({
        providerProfileId: readString(params, 'providerProfileId'),
      }, context) as unknown as JsonValue

    case 'application.createAiCapabilityProfile':
      return await runtime.createAiCapabilityProfile({
        providerProfileId: readString(params, 'providerProfileId'),
        capabilityId: readString(params, 'capabilityId'),
        displayName: readString(params, 'displayName'),
        config: readOptionalObject(params, 'config'),
      }) as unknown as JsonValue

    case 'application.getAiCapabilityProfile':
      return await runtime.getAiCapabilityProfile({
        profileId: readString(params, 'profileId'),
      }) as unknown as JsonValue

    case 'application.listAiCapabilityProfiles':
      return await runtime.listAiCapabilityProfiles({
        providerProfileId: readOptionalString(params, 'providerProfileId'),
        capabilityId: readOptionalString(params, 'capabilityId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.updateAiCapabilityProfile':
      return await runtime.updateAiCapabilityProfile({
        profileId: readString(params, 'profileId'),
        displayName: readOptionalString(params, 'displayName'),
        config: readOptionalObject(params, 'config'),
      }) as unknown as JsonValue

    case 'application.deleteAiCapabilityProfile':
      return await runtime.deleteAiCapabilityProfile({
        profileId: readString(params, 'profileId'),
      }) as unknown as JsonValue

    case 'application.listProviderModels':
      return await runtime.listProviderModels({
        providerProfileId: readString(params, 'providerProfileId'),
      }, context) as unknown as JsonValue

    case 'application.pingProviderModel':
      return await runtime.pingProviderModel({
        providerProfileId: readString(params, 'providerProfileId'),
        modelId: readString(params, 'modelId'),
        text: readOptionalString(params, 'text'),
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}

function readOptionalStringArray(params: JsonValue | undefined, key: string): string[] | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`Expected optional string array param: ${key}`)
  }
  return value
}

function readRequiredStringRecord(params: JsonValue | undefined, key: string): Record<string, string> {
  const value = readOptionalStringRecord(params, key)
  if (!value) throw new Error(`Expected string record param: ${key}`)
  return value
}
