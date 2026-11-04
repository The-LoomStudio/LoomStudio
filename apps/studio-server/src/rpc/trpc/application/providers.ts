import type {
  ApplicationRuntime
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  readNumber,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readOptionalStringArray,
  readOptionalStringRecord,
  readString,
} from '../../rpc-params.js'
import { jsonInput, procedure } from '../context.js'

export const providersProcedures = {
  'createProviderProfile': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['createProviderProfile']>[0] => {
    return {
      providerExtensionId: readString(params, 'providerExtensionId'),
      displayName: readString(params, 'displayName'),
      config: readOptionalObject(params, 'config'),
      enabledModelIds: readOptionalStringArray(params, 'enabledModelIds'),
      credential: readOptionalStringRecord(params, 'credential'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.createProviderProfile(input, ctx.request)),
  'getProviderProfile': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getProviderProfile']>[0] => {
    return {
      providerProfileId: readString(params, 'providerProfileId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getProviderProfile(input)),
  'listProviderProfiles': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listProviderProfiles']>[0] => {
    return {
      cursor: readOptionalString(params, 'cursor'),
      limit: readOptionalNumber(params, 'limit'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listProviderProfiles(input)),
  'updateProviderProfile': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updateProviderProfile']>[0] => {
    return {
      providerProfileId: readString(params, 'providerProfileId'),
      displayName: readOptionalString(params, 'displayName'),
      config: readOptionalObject(params, 'config'),
      enabledModelIds: readOptionalStringArray(params, 'enabledModelIds'),
      tokenMultipliers: readTokenMultipliers(params),
      credential: readOptionalStringRecord(params, 'credential'),
      expectedVersion: readNumber(params, 'expectedVersion'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updateProviderProfile(input, ctx.request)),
  'replaceProviderCredential': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['replaceProviderCredential']>[0] => {
    return {
      providerProfileId: readString(params, 'providerProfileId'),
      credential: readRequiredStringRecord(params, 'credential'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.replaceProviderCredential(input, ctx.request)),
  'deleteProviderProfile': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteProviderProfile']>[0] => {
    return {
      providerProfileId: readString(params, 'providerProfileId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.deleteProviderProfile(input, ctx.request)),
  'createAiCapabilityProfile': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['createAiCapabilityProfile']>[0] => {
    return {
      providerProfileId: readString(params, 'providerProfileId'),
      capabilityId: readString(params, 'capabilityId'),
      displayName: readString(params, 'displayName'),
      config: readOptionalObject(params, 'config'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.createAiCapabilityProfile(input, ctx.request)),
  'getAiCapabilityProfile': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getAiCapabilityProfile']>[0] => {
    return {
      profileId: readString(params, 'profileId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getAiCapabilityProfile(input)),
  'listAiCapabilityProfiles': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listAiCapabilityProfiles']>[0] => {
    return {
      providerProfileId: readOptionalString(params, 'providerProfileId'),
      capabilityId: readOptionalString(params, 'capabilityId'),
      cursor: readOptionalString(params, 'cursor'),
      limit: readOptionalNumber(params, 'limit'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listAiCapabilityProfiles(input)),
  'updateAiCapabilityProfile': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updateAiCapabilityProfile']>[0] => {
    return {
      profileId: readString(params, 'profileId'),
      providerProfileId: readOptionalString(params, 'providerProfileId'),
      displayName: readOptionalString(params, 'displayName'),
      config: readOptionalObject(params, 'config'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updateAiCapabilityProfile(input, ctx.request)),
  'deleteAiCapabilityProfile': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteAiCapabilityProfile']>[0] => {
    return {
      profileId: readString(params, 'profileId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.deleteAiCapabilityProfile(input, ctx.request)),
  'listProviderModels': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listProviderModels']>[0] => {
    return {
      providerProfileId: readString(params, 'providerProfileId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listProviderModels(input, ctx.request)),
  'pingProviderModel': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['pingProviderModel']>[0] => {
    return {
      providerProfileId: readString(params, 'providerProfileId'),
      modelId: readString(params, 'modelId'),
      text: readOptionalString(params, 'text'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.pingProviderModel(input, ctx.request)),
}

function readRequiredStringRecord(params: JsonValue | undefined, key: string): Record<string, string> {
  const value = readOptionalStringRecord(params, key)
  if (!value) throw new Error(`Expected string record param: ${key}`)
  return value
}

function readTokenMultipliers(params: JsonValue | undefined): Record<string, number> | undefined {
  const value = readOptionalObject(params, 'tokenMultipliers')
  if (value === undefined) return undefined
  for (const [key, multiplier] of Object.entries(value)) {
    if (!key.trim() || typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error('Expected positive tokenMultipliers number record')
    }
  }
  return value as Record<string, number>
}
