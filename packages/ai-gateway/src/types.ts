import type {
  AssistantChatMessage,
  ChatMessage,
  JsonObject,
  JsonValue,
} from '@loom-studio/shared'

export type AiProviderKind =
  'openai' | 'anthropic' | 'google' | 'openai-compatible'

export type AiProviderConfig = {
  kind: AiProviderKind
  apiKey: string
  baseUrl?: string
  name?: string
  fetch?: typeof fetch
}

export type AiFunctionTool = {
  name: string
  description?: string
  inputSchema: JsonObject
}

export type AiToolChoice =
  'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }

export type AiGatewayRequest = {
  provider: AiProviderConfig
  modelId: string
  messages: ChatMessage[]
  tools?: AiFunctionTool[]
  toolChoice?: AiToolChoice
  providerOptions?: JsonObject
  abortSignal?: AbortSignal
  delivery?: 'complete' | 'stream'
}

export type AiGatewayResult = {
  message: AssistantChatMessage
  text: string
  model: string
  provider: string
  finishReason?: 'stop' | 'length' | 'tool_call' | 'error'
  rawFinishReason?: string
  usage?: { inputTokens?: number; outputTokens?: number }
  providerCallId?: string
  requestId?: string
  raw?: JsonValue
}

export type AiGatewayUsage = NonNullable<AiGatewayResult['usage']>

export type AiGatewayError = {
  name: string
  message: string
}

export type AiGatewayEvent =
  | { type: 'started'; runId: string }
  | { type: 'text-delta'; runId: string; delta: string }
  | { type: 'tool-input-delta'; runId: string; toolCallId: string; toolName?: string; delta: string }
  | { type: 'usage'; runId: string; usage: AiGatewayUsage }
  | { type: 'completed'; runId: string; result: AiGatewayResult }
  | { type: 'failed'; runId: string; error: AiGatewayError }
  | { type: 'cancelled'; runId: string; reason?: string }

export type AiGatewayRun = {
  id: string
  events: AsyncIterable<AiGatewayEvent>
  result: Promise<AiGatewayResult>
  cancel(reason?: string): void
}

export type ProviderAccountSchema = {
  type: 'object'
  properties: JsonObject
  required?: string[]
  additionalProperties: false
}

export type ProviderModelCapability = {
  streaming: boolean
  nativeFunctionTools: boolean
  providerCustomTools: boolean
}

export type ResolvedProviderAdapter = {
  adapterId: string
  provider: AiProviderConfig | { kind: 'fake'; name: string }
  capability: ProviderModelCapability
}

export type ProviderAdapterRegistry = {
  getCapability(providerExtensionId: string): ProviderModelCapability
  resolve(providerExtensionId: string, input: {
    config: JsonObject
    credential?: Record<string, string>
    fetch?: typeof fetch
  }): ResolvedProviderAdapter
  validateAccountConfig(providerExtensionId: string, config: JsonObject): JsonObject
  validateCredential(providerExtensionId: string, credential: Record<string, string>): Record<string, string>
  getSchemas(providerExtensionId: string): {
    accountConfig: ProviderAccountSchema
    credential: ProviderAccountSchema
  }
  listModels(providerExtensionId: string, input: {
    config: JsonObject
    credential: Record<string, string>
    fetch?: typeof fetch
  }): Promise<string[]>
}
