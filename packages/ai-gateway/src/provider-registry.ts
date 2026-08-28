import type { JsonObject } from '@loom-studio/shared'
import { z } from 'zod'
import { listOpenAICompatibleModels } from './gateway.js'
import { officialFakeModelId } from './fake-provider.js'
import type { AiGatewayCapabilityRegistry, AiGatewayFieldDefinition } from './capability-registry.js'
import type {
  AiProviderConfig,
  AiProviderKind,
  ProviderAccountSchema,
  ProviderAdapterRegistry,
  ProviderModelCapability,
  ResolvedProviderAdapter,
} from './types.js'

type ProviderAdapter = {
  id: string
  aliases: string[]
  kind: AiProviderKind | 'fake'
  accountConfigSchema: ProviderAccountSchema
  credentialSchema: ProviderAccountSchema
  parseAccountConfig(input: JsonObject): JsonObject
  parseCredential(input: Record<string, string>): { apiKey?: string }
  capability: ProviderModelCapability
  listModels?: (input: { config: JsonObject; credential: Record<string, string>; fetch?: typeof fetch }) => Promise<string[]>
}

const baseUrlSchema = z.strictObject({ baseUrl: z.string().url().optional() })
const apiKeySchema = z.strictObject({ apiKey: z.string().trim().min(1) })
const emptySchema = z.strictObject({})
const fakeAccountConfigParser = z.strictObject({
  responseTemplate: z.string().optional(),
  baseUrl: z.string().url().optional(),
}).transform(() => ({}))
const accountConfigSchema: ProviderAccountSchema = {
  type: 'object',
  properties: { baseUrl: { type: 'string', format: 'uri' } },
  additionalProperties: false,
}
const credentialSchema: ProviderAccountSchema = {
  type: 'object',
  properties: { apiKey: { type: 'string', minLength: 1 } },
  required: ['apiKey'],
  additionalProperties: false,
}
const emptyAccountSchema: ProviderAccountSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

export function createOfficialProviderAdapterRegistry(options: {
  aiCapabilities?: AiGatewayCapabilityRegistry
} = {}): ProviderAdapterRegistry {
  const adapters = createOfficialAdapters()
  const aliases = new Map(adapters.flatMap(adapter => adapter.aliases.map(alias => [alias, adapter] as const)))

  function requireAdapter(providerExtensionId: string): ProviderAdapter {
    const adapter = aliases.get(providerExtensionId)
    if (!adapter) throw new Error(`Unsupported provider extension: ${providerExtensionId}`)
    return adapter
  }

  function getDynamicProvider(providerExtensionId: string) {
    return options.aiCapabilities?.get(providerExtensionId)
  }

  return {
    getCapability: providerExtensionId => requireAdapter(providerExtensionId).capability,
    resolve: (providerExtensionId, input): ResolvedProviderAdapter => {
      const adapter = requireAdapter(providerExtensionId)
      const config = adapter.parseAccountConfig(input.config)
      if (adapter.kind === 'fake') {
        if (input.credential) adapter.parseCredential(input.credential)
        return { adapterId: adapter.id, provider: { kind: 'fake', name: 'fake' }, capability: adapter.capability }
      }
      if (!input.credential) throw new Error('Provider credential is not configured')
      const credential = adapter.parseCredential(input.credential)
      if (!credential.apiKey) throw new Error('Provider credential is missing apiKey')
      const provider: AiProviderConfig = {
        kind: adapter.kind,
        apiKey: credential.apiKey,
        name: adapter.kind,
        ...(typeof config.baseUrl === 'string' ? { baseUrl: config.baseUrl } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      }
      return { adapterId: adapter.id, provider, capability: adapter.capability }
    },
    validateAccountConfig: (providerExtensionId, config) => {
      const adapter = aliases.get(providerExtensionId)
      if (adapter) return adapter.parseAccountConfig(config) as JsonObject
      if (getDynamicProvider(providerExtensionId)) {
        return options.aiCapabilities!.validateAccountConfig(providerExtensionId, config)
      }
      throw new Error(`Unsupported provider extension: ${providerExtensionId}`)
    },
    validateCredential: (providerExtensionId, credential) => {
      const adapter = aliases.get(providerExtensionId)
      if (adapter) return adapter.parseCredential(credential) as Record<string, string>
      if (getDynamicProvider(providerExtensionId)) {
        return options.aiCapabilities!.validateCredential(providerExtensionId, credential)
      }
      throw new Error(`Unsupported provider extension: ${providerExtensionId}`)
    },
    getSchemas: providerExtensionId => {
      const adapter = aliases.get(providerExtensionId)
      if (adapter) return { accountConfig: adapter.accountConfigSchema, credential: adapter.credentialSchema }
      const provider = getDynamicProvider(providerExtensionId)
      if (!provider) throw new Error(`Unsupported provider extension: ${providerExtensionId}`)
      return {
        accountConfig: readObjectSchema(provider.accountSchema, provider.accountFields ?? []),
        credential: readObjectSchema(provider.credentialSchema, provider.credentialFields ?? []),
      }
    },
    listModels: async (providerExtensionId, input) => {
      const adapter = requireAdapter(providerExtensionId)
      if (!adapter.listModels) throw new Error(`Provider does not support model discovery: ${providerExtensionId}`)
      adapter.parseAccountConfig(input.config)
      adapter.parseCredential(input.credential)
      return await adapter.listModels(input)
    },
  }
}

function readObjectSchema(schema: JsonObject | undefined, fields: AiGatewayFieldDefinition[]): ProviderAccountSchema {
  if (schema?.type === 'object' && schema.additionalProperties === false && schema.properties) {
    return schema as ProviderAccountSchema
  }
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map(field => [field.key, fieldSchema(field)])),
    ...(fields.some(field => field.required) ? { required: fields.filter(field => field.required).map(field => field.key) } : {}),
    additionalProperties: false,
  }
}

function fieldSchema(field: AiGatewayFieldDefinition): JsonObject {
  if (field.type === 'boolean') return { type: 'boolean' }
  if (field.type === 'number') return { type: 'number' }
  if (field.type === 'json') return {}
  if (field.type === 'select') return { type: 'string', enum: field.options?.map(option => option.value) ?? [] }
  return { type: 'string' }
}

function createOfficialAdapters(): ProviderAdapter[] {
  const discoverModels = async (input: { config: JsonObject; credential: Record<string, string>; fetch?: typeof fetch }) => {
    const config = baseUrlSchema.parse(input.config)
    const credential = apiKeySchema.parse(input.credential)
    return await listOpenAICompatibleModels({
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      apiKey: credential.apiKey,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    })
  }
  const provider = (id: string, aliases: string[], kind: AiProviderKind, listModels?: ProviderAdapter['listModels']): ProviderAdapter => ({
    id,
    aliases,
    kind,
    accountConfigSchema,
    credentialSchema,
    parseAccountConfig: input => baseUrlSchema.parse(input),
    parseCredential: input => apiKeySchema.parse(input),
    capability: { streaming: true, nativeFunctionTools: true, providerCustomTools: false },
    ...(listModels ? { listModels } : {}),
  })
  return [
    provider('official.openai', ['official.openai', 'openai'], 'openai', discoverModels),
    provider('official.anthropic', ['official.anthropic', 'anthropic'], 'anthropic'),
    provider('official.google', ['official.google', 'google'], 'google'),
    provider('official.openai-compatible', ['official.openai-compatible', 'openai-compatible'], 'openai-compatible', discoverModels),
    {
      id: 'official.fake',
      aliases: ['official.fake', 'fake'],
      kind: 'fake',
      accountConfigSchema: emptyAccountSchema,
      credentialSchema: emptyAccountSchema,
      parseAccountConfig: input => fakeAccountConfigParser.parse(input),
      parseCredential: input => emptySchema.parse(input),
      capability: { streaming: false, nativeFunctionTools: false, providerCustomTools: false },
      listModels: async () => [officialFakeModelId],
    },
  ]
}
