import type {
  ApplicationRuntime,
  PresetToolMountInput,
  RuntimeRequestContext,
  ToolDefinition,
} from '@loom-studio/application-runtime'
import { isPromptActivation } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readNumber,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readString,
} from '../../rpc-params.js'

export async function handleAgentsRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.createAgentProfile':
      return await runtime.createAgentProfile({
        name: readString(params, 'name'),
        presetId: readString(params, 'presetId'),
        model: readRequiredProviderModelSelection(params, 'model'),
        toolOverrides: readOptionalBooleanRecord(params, 'toolOverrides'),
      }) as unknown as JsonValue

    case 'application.getAgentProfile':
      return await runtime.getAgentProfile({ agentProfileId: readString(params, 'agentProfileId') }) as unknown as JsonValue

    case 'application.listAgentProfiles':
      return await runtime.listAgentProfiles({ cursor: readOptionalString(params, 'cursor'), limit: readOptionalNumber(params, 'limit') }) as unknown as JsonValue

    case 'application.updateAgentProfile':
      return await runtime.updateAgentProfile({
        agentProfileId: readString(params, 'agentProfileId'),
        name: readOptionalString(params, 'name'),
        presetId: readOptionalString(params, 'presetId'),
        model: readOptionalProviderModelSelection(params, 'model'),
        toolOverrides: readOptionalBooleanRecord(params, 'toolOverrides'),
      }) as unknown as JsonValue

    case 'application.deleteAgentProfile':
      return await runtime.deleteAgentProfile({ agentProfileId: readString(params, 'agentProfileId') }) as unknown as JsonValue

    case 'application.listAgentTools':
      return await runtime.listAgentTools() as unknown as JsonValue

    case 'application.updateAgentTool':
      return await runtime.updateAgentTool({
        toolId: readString(params, 'toolId'),
        expectedVersion: readNumber(params, 'expectedVersion'),
        definition: readAgentToolDefinition(params),
      }) as unknown as JsonValue

    case 'application.listPresetToolMounts':
      return await runtime.listPresetToolMounts({
        presetId: readOptionalString(params, 'presetId'),
        toolId: readOptionalString(params, 'toolId'),
      }) as unknown as JsonValue

    case 'application.replacePresetToolMounts':
      return await runtime.replacePresetToolMounts({
        presetId: readString(params, 'presetId'),
        mounts: readPresetToolMountInputs(params, 'mounts'),
      }, context) as unknown as JsonValue

    case 'application.createAgentSession':
      return await runtime.createAgentSession({
        agentProfileId: readString(params, 'agentProfileId'),
        title: readOptionalString(params, 'title'),
      }, context) as unknown as JsonValue

    case 'application.getAgentSession':
      return await runtime.getAgentSession({
        agentSessionId: readString(params, 'agentSessionId'),
      }) as unknown as JsonValue

    case 'application.getAgentTranscriptPage':
      return await runtime.getAgentTranscriptPage({
        agentSessionId: readString(params, 'agentSessionId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.deleteAgentSession':
      return await runtime.deleteAgentSession({
        agentSessionId: readString(params, 'agentSessionId'),
      }, context) as unknown as JsonValue

    case 'application.invokeAgentTurn':
      return await runtime.invokeAgentTurn({
        agentSessionId: readString(params, 'agentSessionId'),
        input: readString(params, 'input'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
        narrativeTarget: readOptionalNarrativeTarget(params),
      }, context) as unknown as JsonValue

    case 'application.previewAgentTurn':
      return await runtime.previewAgentTurn({
        agentSessionId: readString(params, 'agentSessionId'),
        input: readString(params, 'input'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
        narrativeTarget: readOptionalNarrativeTarget(params),
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}

function readAgentToolDefinition(params: JsonValue | undefined): ToolDefinition {
  const definition = readOptionalObject(params, 'definition')
  if (!definition) throw new Error('Expected agent tool definition: definition')
  return definition as unknown as ToolDefinition
}

function readOptionalBooleanRecord(params: JsonValue | undefined, key: string): Record<string, boolean> | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value) || !Object.values(value).every(item => typeof item === 'boolean')) {
    throw new Error(`Expected optional boolean record param: ${key}`)
  }
  return value as Record<string, boolean>
}

function readPresetToolMountInputs(params: JsonValue | undefined, key: string): PresetToolMountInput[] {
  if (!isRecord(params) || !Array.isArray(params[key])) throw new Error(`Expected Preset Tool mount array param: ${key}`)
  return params[key].map((value, index) => {
    if (!isRecord(value)) throw new Error(`Expected Preset Tool mount object: ${key}[${index}]`)
    const activation = value.activation
    if (activation !== undefined && !isPromptActivation(activation)) {
      throw new Error(`Expected Preset Tool mount activation: ${key}[${index}].activation`)
    }
    const provider = value.provider
    if (provider !== undefined && (!isRecord(provider) || (provider.order !== undefined && typeof provider.order !== 'number'))) {
      throw new Error(`Expected Preset Tool provider placement: ${key}[${index}].provider`)
    }
    const content = value.content
    if (content !== undefined && (!isRecord(content)
      || (content.zone !== undefined && typeof content.zone !== 'string')
      || (content.slot !== undefined && typeof content.slot !== 'string')
      || (content.rankKey !== undefined && typeof content.rankKey !== 'string')
      || (content.orderHint !== undefined && typeof content.orderHint !== 'number'))) {
      throw new Error(`Expected Preset Tool content placement: ${key}[${index}].content`)
    }
    if (typeof value.toolId !== 'string' || typeof value.orderIndex !== 'number' || typeof value.defaultEnabled !== 'boolean') {
      throw new Error(`Expected Preset Tool mount fields: ${key}[${index}]`)
    }
    return {
      toolId: value.toolId,
      orderIndex: value.orderIndex,
      defaultEnabled: value.defaultEnabled,
      ...(activation === undefined ? {} : { activation }),
      ...(provider === undefined ? {} : { provider: provider as PresetToolMountInput['provider'] }),
      ...(content === undefined ? {} : { content: content as PresetToolMountInput['content'] }),
    }
  })
}

function readOptionalProviderModelSelection(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value) || typeof value.providerProfileId !== 'string' || typeof value.modelId !== 'string') {
    throw new Error(`Expected Provider model selection param: ${key}`)
  }
  return { providerProfileId: value.providerProfileId, modelId: value.modelId }
}

function readRequiredProviderModelSelection(params: JsonValue | undefined, key: string) {
  const value = readOptionalProviderModelSelection(params, key)
  if (!value) throw new Error(`Expected Provider model selection param: ${key}`)
  return value
}

function readOptionalNarrativeTarget(params: JsonValue | undefined): {
  timelineId: string
  branchId?: string
  commit: boolean
} | undefined {
  const value = readOptionalObject(params, 'narrativeTarget')
  if (value === undefined) return undefined
  if (typeof value.timelineId !== 'string') throw new Error('Expected string param: narrativeTarget.timelineId')
  if (value.branchId !== undefined && typeof value.branchId !== 'string') {
    throw new Error('Expected optional string param: narrativeTarget.branchId')
  }
  if (typeof value.commit !== 'boolean') throw new Error('Expected boolean param: narrativeTarget.commit')
  return {
    timelineId: value.timelineId,
    ...(typeof value.branchId === 'string' ? { branchId: value.branchId } : {}),
    commit: value.commit,
  }
}
