import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { createId } from '@loom-studio/shared'
import { createOfficialFakeChatCompletion } from './fake-provider.js'

export type AiGatewayFieldType = 'string' | 'number' | 'boolean' | 'select' | 'secret' | 'json'

export type AiGatewayFieldDefinition = {
  key: string
  label: string
  type: AiGatewayFieldType
  required?: boolean
  description?: string
  defaultValue?: JsonValue
  options?: Array<{ label: string; value: string }>
}

export type AiGatewayCapabilityDefinition = {
  id: string
  displayName: string
  description?: string
  profileSchema?: JsonObject
  inputSchema?: JsonObject
  outputSchema?: JsonObject
  profileFields?: AiGatewayFieldDefinition[]
  inputFields?: AiGatewayFieldDefinition[]
}

export type AiGatewayProviderDefinition = {
  id: string
  displayName: string
  description?: string
  accountSchema?: JsonObject
  credentialSchema?: JsonObject
  accountFields?: AiGatewayFieldDefinition[]
  credentialFields?: AiGatewayFieldDefinition[]
  capabilities: AiGatewayCapabilityDefinition[]
}

export type AiGatewayRegistrationOwner =
  | { kind: 'platform' }
  | { kind: 'extension'; packageId: string; moduleId: string; instanceId: string }

export type RegisteredAiGatewayProvider = AiGatewayProviderDefinition & {
  registeredBy: AiGatewayRegistrationOwner
}

export type AiGatewayInvocationCaller = {
  kind: 'platform' | 'studio-client' | 'extension'
  id?: string
}

export type AiGatewayInvokeInput = {
  profileId: string
  input: JsonValue
  signal?: AbortSignal
  caller?: AiGatewayInvocationCaller
}

export type AiGatewayRegisteredInvokeInput = {
  providerId: string
  capabilityId: string
  accountConfig: JsonObject
  credential?: Record<string, string>
  profileConfig: JsonObject
  input: JsonValue
  signal?: AbortSignal
  caller?: AiGatewayInvocationCaller
}

export type AiGatewayInvokeResult = {
  profileId: string
  providerId: string
  capabilityId: string
  providerCallId: string
  output: JsonValue
}

export type AiGatewayCapabilityHandler = (input: {
  providerCallId: string
  accountConfig: JsonObject
  credential: Record<string, string>
  profileConfig: JsonObject
  input: JsonValue
  signal?: AbortSignal
  caller?: AiGatewayInvocationCaller
}) => JsonValue | Promise<JsonValue>

export type AiGatewayProviderRegistration = {
  provider: AiGatewayProviderDefinition
  handlers: Record<string, AiGatewayCapabilityHandler>
}

export type AiGatewayProviderRegistrationHandle = {
  dispose(): void
}

export type AiGatewayCapabilityRegistry = {
  register(
    registration: AiGatewayProviderRegistration,
    owner: AiGatewayRegistrationOwner,
  ): AiGatewayProviderRegistrationHandle
  list(): RegisteredAiGatewayProvider[]
  get(providerId: string): RegisteredAiGatewayProvider | undefined
  validateAccountConfig(providerId: string, value: JsonObject): JsonObject
  validateCredential(providerId: string, value: Record<string, string>): Record<string, string>
  validateProfileConfig(providerId: string, capabilityId: string, value: JsonObject): JsonObject
  invokeRegistered(input: AiGatewayRegisteredInvokeInput): Promise<Omit<AiGatewayInvokeResult, 'profileId'>>
}

type RegistryEntry = {
  provider: RegisteredAiGatewayProvider
  handlers: Map<string, AiGatewayCapabilityHandler>
}

const stableIdPattern = /^[a-z0-9][a-z0-9._-]*$/
const fieldKeyPattern = /^[A-Za-z_][A-Za-z0-9._-]*$/

export function createAiGatewayCapabilityRegistry(): AiGatewayCapabilityRegistry {
  const entries = new Map<string, RegistryEntry>()

  return {
    register: (registration, owner) => {
      validateProviderRegistration(registration)
      const providerId = registration.provider.id
      if (entries.has(providerId)) throw new Error(`AI Gateway provider is already registered: ${providerId}`)

      entries.set(providerId, {
        provider: cloneProvider(registration.provider, owner),
        handlers: new Map(Object.entries(registration.handlers)),
      })

      let active = true
      return {
        dispose: () => {
          if (!active) return
          active = false
          entries.delete(providerId)
        },
      }
    },

    list: () => [...entries.values()]
      .map(entry => structuredClone(entry.provider))
      .sort((left, right) => left.id.localeCompare(right.id)),

    get: providerId => {
      const provider = entries.get(providerId)?.provider
      return provider ? structuredClone(provider) : undefined
    },

    validateAccountConfig: (providerId, value) => {
      const entry = requireEntry(entries, providerId)
      return validateObjectFields(entry.provider.accountFields ?? [], value, 'account config')
    },

    validateCredential: (providerId, value) => {
      const entry = requireEntry(entries, providerId)
      return validateCredentialFields(entry.provider.credentialFields ?? [], value)
    },

    validateProfileConfig: (providerId, capabilityId, value) => {
      const entry = requireEntry(entries, providerId)
      const capability = requireCapability(entry, providerId, capabilityId)
      return validateObjectFields(capability.profileFields ?? [], value, 'profile config')
    },

    invokeRegistered: async input => {
      const entry = requireEntry(entries, input.providerId)
      const capability = requireCapability(entry, input.providerId, input.capabilityId)
      const handler = entry.handlers.get(input.capabilityId)
      if (!handler) throw new Error(`AI Gateway capability handler is not available: ${input.capabilityId}`)

      const accountConfig = validateObjectFields(entry.provider.accountFields ?? [], input.accountConfig, 'account config')
      const credential = validateCredentialFields(entry.provider.credentialFields ?? [], input.credential ?? {})
      const profileConfig = validateObjectFields(capability.profileFields ?? [], input.profileConfig, 'profile config')
      const capabilityInput = applyFieldDefaults(capability.inputFields ?? [], input.input)
      validateFieldValues(capability.inputFields ?? [], capabilityInput, 'input')
      const providerCallId = createId('provider-call')
      const output = await handler({
        providerCallId,
        accountConfig: structuredClone(accountConfig),
        credential: structuredClone(credential),
        profileConfig: structuredClone(profileConfig),
        input: structuredClone(capabilityInput),
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.caller ? { caller: structuredClone(input.caller) } : {}),
      })

      return {
        providerId: input.providerId,
        capabilityId: input.capabilityId,
        providerCallId,
        output: structuredClone(output),
      }
    },
  }
}

export function registerOfficialFakeAiProvider(
  registry: AiGatewayCapabilityRegistry,
): AiGatewayProviderRegistrationHandle {
  return registry.register({
    provider: {
      id: 'official.fake',
      displayName: 'Fake AI',
      description: 'Minimal OpenAI Chat Completion simulator for Studio and Extension development.',
      capabilities: [{
        id: 'chat.completions',
        displayName: 'Chat Completions',
        description: 'Accepts OpenAI-style messages and returns one deterministic Chat Completion response.',
        inputFields: [
          { key: 'messages', label: 'Messages', type: 'json', required: true },
        ],
      }],
    },
    handlers: {
      'chat.completions': ({ providerCallId, input }) => createOfficialFakeChatCompletion({
        id: providerCallId,
        messages: (input as JsonObject).messages,
      }).completion,
    },
  }, { kind: 'platform' })
}

function validateProviderRegistration(registration: AiGatewayProviderRegistration): void {
  const provider = registration.provider
  assertStableId(provider.id, 'AI Gateway provider id')
  if (!provider.displayName.trim()) throw new Error('AI Gateway provider displayName is required')
  if (provider.capabilities.length === 0) throw new Error(`AI Gateway provider has no capabilities: ${provider.id}`)
  validateFields(provider.accountFields ?? [], `${provider.id} account`)
  validateFields(provider.credentialFields ?? [], `${provider.id} credential`)
  assertNoSecretFields(provider.accountFields ?? [], `${provider.id} account`)
  assertCredentialFieldTypes(provider.credentialFields ?? [], `${provider.id} credential`)

  const capabilityIds = new Set<string>()
  for (const capability of provider.capabilities) {
    assertStableId(capability.id, 'AI Gateway capability id')
    if (!capability.displayName.trim()) throw new Error(`AI Gateway capability displayName is required: ${capability.id}`)
    if (capabilityIds.has(capability.id)) throw new Error(`Duplicate AI Gateway capability: ${capability.id}`)
    capabilityIds.add(capability.id)
    validateFields(capability.profileFields ?? [], `${capability.id} profile`)
    validateFields(capability.inputFields ?? [], `${capability.id} input`)
    assertNoSecretFields(capability.profileFields ?? [], `${capability.id} profile`)
    assertNoSecretFields(capability.inputFields ?? [], `${capability.id} input`)
    if (typeof registration.handlers[capability.id] !== 'function') {
      throw new Error(`AI Gateway capability handler is required: ${capability.id}`)
    }
  }

  for (const capabilityId of Object.keys(registration.handlers)) {
    if (!capabilityIds.has(capabilityId)) {
      throw new Error(`AI Gateway handler has no declared capability: ${capabilityId}`)
    }
  }
}

function validateFields(fields: AiGatewayFieldDefinition[], label: string): void {
  const keys = new Set<string>()
  for (const field of fields) {
    if (!fieldKeyPattern.test(field.key)) throw new Error(`Invalid ${label} field key: ${field.key}`)
    if (!field.label.trim()) throw new Error(`${label} field label is required: ${field.key}`)
    if (keys.has(field.key)) throw new Error(`Duplicate ${label} field: ${field.key}`)
    keys.add(field.key)
    if (field.type === 'select' && (!field.options || field.options.length === 0)) {
      throw new Error(`Select field options are required: ${field.key}`)
    }
  }
}

function assertNoSecretFields(fields: AiGatewayFieldDefinition[], label: string): void {
  const secret = fields.find(field => field.type === 'secret')
  if (secret) throw new Error(`AI Gateway secret field is only allowed in credentials: ${label}.${secret.key}`)
}

function assertCredentialFieldTypes(fields: AiGatewayFieldDefinition[], label: string): void {
  const unsupported = fields.find(field => !['string', 'secret', 'select'].includes(field.type))
  if (unsupported) throw new Error(`AI Gateway credential field must be string-like: ${label}.${unsupported.key}`)
}

function validateFieldValues(
  fields: AiGatewayFieldDefinition[],
  value: JsonValue,
  label: string,
): asserts value is JsonObject {
  if (!isJsonObject(value)) throw new Error(`AI Gateway ${label} must be an object`)
  for (const field of fields) {
    const fieldValue = value[field.key]
    if (fieldValue === undefined) {
      if (field.required && field.defaultValue === undefined) {
        throw new Error(`AI Gateway ${label} field is required: ${field.key}`)
      }
      continue
    }
    if (field.type === 'boolean' && typeof fieldValue !== 'boolean') throw fieldTypeError(label, field, 'boolean')
    if (field.type === 'number' && typeof fieldValue !== 'number') throw fieldTypeError(label, field, 'number')
    if ((field.type === 'string' || field.type === 'secret' || field.type === 'select') && typeof fieldValue !== 'string') {
      throw fieldTypeError(label, field, 'string')
    }
    if (field.type === 'select' && !field.options?.some(option => option.value === fieldValue)) {
      throw new Error(`AI Gateway ${label} field has an unsupported option: ${field.key}`)
    }
  }
}

function applyFieldDefaults(fields: AiGatewayFieldDefinition[], value: JsonValue): JsonValue {
  if (!isJsonObject(value)) return value
  const result = structuredClone(value)
  for (const field of fields) {
    if (result[field.key] === undefined && field.defaultValue !== undefined) {
      result[field.key] = structuredClone(field.defaultValue)
    }
  }
  return result
}

function validateObjectFields(
  fields: AiGatewayFieldDefinition[],
  value: JsonObject,
  label: string,
): JsonObject {
  const normalized = applyFieldDefaults(fields, value)
  validateFieldValues(fields, normalized, label)
  return structuredClone(normalized)
}

function validateCredentialFields(
  fields: AiGatewayFieldDefinition[],
  value: Record<string, string>,
): Record<string, string> {
  const normalized = validateObjectFields(fields, value, 'credential')
  return Object.fromEntries(Object.entries(normalized).map(([key, fieldValue]) => {
    if (typeof fieldValue !== 'string') throw new Error(`AI Gateway credential field must be string: ${key}`)
    return [key, fieldValue]
  }))
}

function fieldTypeError(label: string, field: AiGatewayFieldDefinition, expected: string): Error {
  return new Error(`AI Gateway ${label} field must be ${expected}: ${field.key}`)
}

function assertStableId(value: string, label: string): void {
  if (!stableIdPattern.test(value)) throw new Error(`${label} must be a stable namespaced id: ${value}`)
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneProvider(
  provider: AiGatewayProviderDefinition,
  owner: AiGatewayRegistrationOwner,
): RegisteredAiGatewayProvider {
  return {
    ...structuredClone(provider),
    registeredBy: structuredClone(owner),
  }
}

function requireEntry(entries: Map<string, RegistryEntry>, providerId: string): RegistryEntry {
  const entry = entries.get(providerId)
  if (!entry) throw new Error(`AI Gateway provider is not available: ${providerId}`)
  return entry
}

function requireCapability(
  entry: RegistryEntry,
  providerId: string,
  capabilityId: string,
): AiGatewayCapabilityDefinition {
  const capability = entry.provider.capabilities.find(item => item.id === capabilityId)
  if (!capability) throw new Error(`AI Gateway capability is not available: ${providerId}/${capabilityId}`)
  return capability
}
