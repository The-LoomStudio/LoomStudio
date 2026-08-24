import type { JsonObject, JsonValue } from '@loom-studio/shared'
import {
  isPromptActivation,
  type PromptActivation,
} from '../prompt-activation.js'

export type ToolOwnerRef = {
  namespace: string
}

export type ToolGrammar = {
  kind: 'lark' | 'regex' | 'custom'
  source: string
}

export type StructuredToolFallback = {
  schema: JsonObject
}

export type ToolInputDefinition =
  | {
      kind: 'structured'
      schema: JsonObject
    }
  | {
      kind: 'freeform'
      mediaType: string
      grammar?: ToolGrammar
      structuredFallback?: StructuredToolFallback
    }
  | {
      kind: 'hybrid'
      metadataSchema: JsonObject
      rawField: string
      mediaType: string
      grammar?: ToolGrammar
      structuredFallback?: StructuredToolFallback
    }

export type ToolDefinition = {
  id: string
  owner: ToolOwnerRef
  name: string
  description: string
  input: ToolInputDefinition
  prompt?: {
    parameterDescriptions?: Record<string, string>
    guidance?: string
    activation?: PromptActivation
    provider?: {
      order?: number
    }
    content?: {
      zone?: string
      slot?: string
      rankKey?: string
      orderHint?: number
    }
  }
}

export type ToolTransport = 'native-function' | 'provider-custom' | 'content'

export type ToolInvocation = {
  id: string
  toolId: string
  arguments?: JsonObject
  rawInput?: string
  transport?: ToolTransport
  providerCallId?: string
  providerItemId?: string
}

export type ToolResultPart =
  | { type: 'text'; text: string }
  | { type: 'json'; value: JsonValue }
  | { type: 'artifact-ref'; artifactId: string }

export type ToolResult = {
  invocationId: string
  toolId: string
  status: 'completed' | 'failed' | 'denied' | 'aborted' | 'skipped'
  content: ToolResultPart[]
  detailsRef?: string
  error?: {
    code: string
    message: string
  }
}

export type ToolDiagnostic = {
  severity: 'error' | 'warning'
  code: string
  message: string
  toolId?: string
  path?: string
}

export type ResolvedAgentTools = {
  tools: ToolDefinition[]
  diagnostics: ToolDiagnostic[]
}

export type ToolInvocationValidation = {
  valid: boolean
  tool?: ToolDefinition
  diagnostics: ToolDiagnostic[]
}

export type ToolApprovalContext = {
  tool: ToolDefinition
  invocation: ToolInvocation
}

export type ToolApprovalDecision =
  { decision: 'allow' } | { decision: 'deny'; reason?: string }

export type ToolApprovalHandler = (
  context: ToolApprovalContext,
) => ToolApprovalDecision | Promise<ToolApprovalDecision>

export type ToolExecutionContext = {
  tool: ToolDefinition
  invocation: ToolInvocation
  signal: AbortSignal
}

export type ToolExecutor = (
  context: ToolExecutionContext,
) => ToolResult | Promise<ToolResult>

export type ToolRuntimeRegistration = {
  toolId: string
  approve?: ToolApprovalHandler
  execute: ToolExecutor
}

export type ModelToolTransportCapabilities = {
  nativeFunction: boolean
  providerCustom: boolean
  content: boolean
}

export type ToolExposureAnalysis = {
  toolId: string
  exposed: boolean
  transport?: ToolTransport
  diagnostics: ToolDiagnostic[]
}

export type AgentToolAnalysis = {
  exposures: ToolExposureAnalysis[]
  diagnostics: ToolDiagnostic[]
}

export type AgentToolRegistry = {
  list(): ToolDefinition[]
  replaceDefinitions(definitions: readonly ToolDefinition[]): void
  resolve(toolIds: readonly string[]): ResolvedAgentTools
  validateInvocation(invocation: ToolInvocation): ToolInvocationValidation
  getRegistration(toolId: string): ToolRuntimeRegistration | undefined
  getExecutor(toolId: string): ToolExecutor | undefined
  approve(invocation: ToolInvocation): Promise<ToolApprovalDecision>
  execute(invocation: ToolInvocation, signal: AbortSignal): Promise<ToolResult>
  analyze(
    toolIds: readonly string[],
    capabilities: ModelToolTransportCapabilities,
  ): AgentToolAnalysis
}

export function createAgentToolRegistry(
  definitions: readonly ToolDefinition[],
  runtimeRegistrations: readonly ToolRuntimeRegistration[] = [],
): AgentToolRegistry {
  let { tools, byId } = buildDefinitionIndex(definitions)

  const registrations = new Map<string, ToolRuntimeRegistration>()
  for (const registration of runtimeRegistrations) {
    validateRuntimeRegistration(registration, byId)
    if (registrations.has(registration.toolId))
      throw new Error(
        `Duplicate agent tool runtime registration: ${registration.toolId}`,
      )
    registrations.set(registration.toolId, registration)
  }

  return {
    list: () => [...tools],
    replaceDefinitions: (definitions) => {
      const next = buildDefinitionIndex(definitions)
      for (const toolId of registrations.keys()) {
        if (!next.byId.has(toolId))
          throw new Error(`Agent tool definition is required by a runtime registration: ${toolId}`)
      }
      tools = next.tools
      byId = next.byId
    },
    resolve: (toolIds) => resolveTools(toolIds, byId),
    validateInvocation: (invocation) => validateInvocation(invocation, byId),
    getRegistration: (toolId) => registrations.get(toolId),
    getExecutor: (toolId) => registrations.get(toolId)?.execute,
    approve: (invocation) => approveInvocation(invocation, byId, registrations),
    execute: (invocation, signal) =>
      executeInvocation(invocation, signal, byId, registrations),
    analyze: (toolIds, capabilities) =>
      analyzeTools(toolIds, byId, capabilities),
  }
}

function buildDefinitionIndex(definitions: readonly ToolDefinition[]): {
  tools: ToolDefinition[]
  byId: Map<string, ToolDefinition>
} {
  const tools = definitions.map(validateDefinition)
  const byId = new Map<string, ToolDefinition>()
  for (const tool of tools) {
    if (byId.has(tool.id)) throw new Error(`Duplicate agent tool id: ${tool.id}`)
    byId.set(tool.id, tool)
  }
  return { tools, byId }
}

function validateRuntimeRegistration(
  registration: ToolRuntimeRegistration,
  byId: ReadonlyMap<string, ToolDefinition>,
): void {
  if (!isNonEmptyString(registration.toolId))
    throw new Error('Agent tool runtime registration toolId cannot be empty')
  if (!byId.has(registration.toolId))
    throw new Error(
      `Agent tool runtime registration has no matching definition: ${registration.toolId}`,
    )
  if (typeof registration.execute !== 'function')
    throw new Error(
      `Agent tool runtime registration executor is invalid: ${registration.toolId}`,
    )
  if (
    registration.approve !== undefined &&
    typeof registration.approve !== 'function'
  )
    throw new Error(
      `Agent tool runtime registration approval handler is invalid: ${registration.toolId}`,
    )
}

async function approveInvocation(
  invocation: ToolInvocation,
  byId: ReadonlyMap<string, ToolDefinition>,
  registrations: ReadonlyMap<string, ToolRuntimeRegistration>,
): Promise<ToolApprovalDecision> {
  const validation = validateInvocation(invocation, byId)
  if (!validation.valid || !validation.tool)
    throw invalidInvocationError(invocation, validation)

  const approval = registrations.get(invocation.toolId)?.approve
  if (!approval) return { decision: 'allow' }

  const decision = await approval({
    tool: validation.tool,
    invocation,
  })
  if (decision?.decision !== 'allow' && decision?.decision !== 'deny') {
    throw new Error(
      `Agent tool approval handler returned an invalid decision: ${invocation.toolId}`,
    )
  }
  return decision
}

async function executeInvocation(
  invocation: ToolInvocation,
  signal: AbortSignal,
  byId: ReadonlyMap<string, ToolDefinition>,
  registrations: ReadonlyMap<string, ToolRuntimeRegistration>,
): Promise<ToolResult> {
  const validation = validateInvocation(invocation, byId)
  if (!validation.valid || !validation.tool)
    throw invalidInvocationError(invocation, validation)

  const registration = registrations.get(invocation.toolId)
  if (!registration)
    throw new Error(
      `No runtime handler registered for agent tool: ${invocation.toolId}`,
    )

  if (signal.aborted) return createAbortedResult(invocation)

  let result: ToolResult
  try {
    result = await registration.execute({
      tool: validation.tool,
      invocation,
      signal,
    })
  } catch (error) {
    if (signal.aborted) return createAbortedResult(invocation)
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'failed',
      content: [],
      error: {
        code: 'tool.execution_failed',
        message: errorMessage(error),
      },
    }
  }

  assertExecutionResult(result, invocation)
  return result
}

function invalidInvocationError(
  invocation: ToolInvocation,
  validation: ToolInvocationValidation,
): Error {
  const details = validation.diagnostics
    .map((diagnostic) => diagnostic.code)
    .join(', ')
  return new Error(
    `Cannot execute agent tool invocation ${invocation.id || '<unknown>'}: ${details}`,
  )
}

function assertExecutionResult(
  result: ToolResult,
  invocation: ToolInvocation,
): void {
  if (!result || typeof result !== 'object')
    throw new Error(
      `Agent tool executor returned an invalid result: ${invocation.toolId}`,
    )
  if (result.invocationId !== invocation.id)
    throw new Error(
      `Agent tool executor returned mismatched invocationId for ${invocation.toolId}: expected ${invocation.id}, received ${result.invocationId}`,
    )
  if (result.toolId !== invocation.toolId)
    throw new Error(
      `Agent tool executor returned mismatched toolId: expected ${invocation.toolId}, received ${result.toolId}`,
    )
}

function createAbortedResult(invocation: ToolInvocation): ToolResult {
  return {
    invocationId: invocation.id,
    toolId: invocation.toolId,
    status: 'aborted',
    content: [],
    error: {
      code: 'tool.execution_aborted',
      message: 'Tool execution was aborted',
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateDefinition(tool: ToolDefinition): ToolDefinition {
  if (!isNonEmptyString(tool.id))
    throw new Error('Agent tool id cannot be empty')
  if (!isNonEmptyString(tool.owner.namespace))
    throw new Error(`Agent tool owner namespace cannot be empty: ${tool.id}`)
  if (!isNonEmptyString(tool.name))
    throw new Error(`Agent tool name cannot be empty: ${tool.id}`)
  if (!isNonEmptyString(tool.description))
    throw new Error(`Agent tool description cannot be empty: ${tool.id}`)
  if (tool.prompt) {
    if (
      tool.prompt.activation !== undefined &&
      !isPromptActivation(tool.prompt.activation)
    )
      throw new Error(`Agent tool activation is invalid: ${tool.id}`)
    if (
      tool.prompt.guidance !== undefined &&
      !isNonEmptyString(tool.prompt.guidance)
    )
      throw new Error(`Agent tool guidance cannot be empty: ${tool.id}`)
    for (const [path, description] of Object.entries(
      tool.prompt.parameterDescriptions ?? {},
    )) {
      if (!isNonEmptyString(path) || !isNonEmptyString(description))
        throw new Error(
          `Agent tool parameter description is invalid: ${tool.id}`,
        )
    }
    if (
      tool.prompt.content?.zone !== undefined &&
      !isNonEmptyString(tool.prompt.content.zone)
    )
      throw new Error(`Agent tool content zone cannot be empty: ${tool.id}`)
    if (
      tool.prompt.content?.slot !== undefined &&
      !isNonEmptyString(tool.prompt.content.slot)
    )
      throw new Error(`Agent tool content slot cannot be empty: ${tool.id}`)
    if (
      tool.prompt.content?.rankKey !== undefined &&
      !isNonEmptyString(tool.prompt.content.rankKey)
    )
      throw new Error(`Agent tool content rank cannot be empty: ${tool.id}`)
    if (
      tool.prompt.content?.orderHint !== undefined &&
      !Number.isFinite(tool.prompt.content.orderHint)
    )
      throw new Error(`Agent tool content order is invalid: ${tool.id}`)
    if (
      tool.prompt.provider?.order !== undefined &&
      !Number.isFinite(tool.prompt.provider.order)
    )
      throw new Error(`Agent tool provider order is invalid: ${tool.id}`)
  }
  validateInputDefinition(tool.input, tool.id)
  return tool
}

function validateInputDefinition(
  input: ToolInputDefinition,
  toolId: string,
): void {
  if (input.kind === 'structured') {
    assertSchemaObject(input.schema, `${toolId}.input.schema`)
    return
  }

  if (!isNonEmptyString(input.mediaType))
    throw new Error(`Agent tool mediaType cannot be empty: ${toolId}`)
  if (input.grammar) {
    if (
      !isNonEmptyString(input.grammar.kind) ||
      !isNonEmptyString(input.grammar.source)
    ) {
      throw new Error(`Agent tool grammar is invalid: ${toolId}`)
    }
  }
  if (input.kind === 'hybrid') {
    if (!isNonEmptyString(input.rawField))
      throw new Error(`Agent tool rawField cannot be empty: ${toolId}`)
    assertSchemaObject(input.metadataSchema, `${toolId}.input.metadataSchema`)
  }
  if (input.structuredFallback)
    assertSchemaObject(
      input.structuredFallback.schema,
      `${toolId}.input.structuredFallback.schema`,
    )
}

function resolveTools(
  toolIds: readonly string[],
  byId: ReadonlyMap<string, ToolDefinition>,
): ResolvedAgentTools {
  const tools: ToolDefinition[] = []
  const diagnostics: ToolDiagnostic[] = []

  for (const toolId of toolIds) {
    const tool = byId.get(toolId)
    if (tool) {
      tools.push(tool)
    } else {
      diagnostics.push({
        severity: 'error',
        code: 'tool.missing',
        message: `Agent tool is not registered: ${toolId}`,
        toolId,
      })
    }
  }

  return { tools, diagnostics }
}

function validateInvocation(
  invocation: ToolInvocation,
  byId: ReadonlyMap<string, ToolDefinition>,
): ToolInvocationValidation {
  const diagnostics: ToolDiagnostic[] = []
  if (!isNonEmptyString(invocation.id)) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.invocation.id_required',
      message: 'Tool invocation id cannot be empty',
    })
  }
  if (!isNonEmptyString(invocation.toolId)) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.invocation.tool_id_required',
      message: 'Tool invocation toolId cannot be empty',
    })
    return { valid: false, diagnostics }
  }

  const tool = byId.get(invocation.toolId)
  if (!tool) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.missing',
      message: `Agent tool is not registered: ${invocation.toolId}`,
      toolId: invocation.toolId,
    })
    return { valid: false, diagnostics }
  }

  if (
    invocation.arguments !== undefined &&
    !isJsonObject(invocation.arguments)
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.invocation.arguments_invalid',
      message: 'Tool invocation arguments must be a JSON object',
      toolId: tool.id,
      path: 'arguments',
    })
  }
  if (
    invocation.rawInput !== undefined &&
    typeof invocation.rawInput !== 'string'
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.invocation.raw_input_invalid',
      message: 'Tool invocation rawInput must be a string',
      toolId: tool.id,
      path: 'rawInput',
    })
  }

  if (diagnostics.length === 0)
    validateInvocationInput(invocation, tool, diagnostics)
  return { valid: diagnostics.length === 0, tool, diagnostics }
}

function validateInvocationInput(
  invocation: ToolInvocation,
  tool: ToolDefinition,
  diagnostics: ToolDiagnostic[],
): void {
  const input = tool.input

  if (input.kind === 'structured') {
    if (invocation.rawInput !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'tool.invocation.raw_input_not_allowed',
        message: 'Structured tools do not accept rawInput',
        toolId: tool.id,
        path: 'rawInput',
      })
    }
    if (invocation.arguments === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'tool.invocation.arguments_required',
        message: 'Structured tools require arguments',
        toolId: tool.id,
        path: 'arguments',
      })
    } else {
      validateJsonSchema(
        invocation.arguments,
        input.schema,
        'arguments',
        tool.id,
        diagnostics,
      )
    }
    return
  }

  if (input.kind === 'freeform') {
    if (invocation.arguments !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'tool.invocation.arguments_not_allowed',
        message: 'Freeform tools do not accept structured arguments',
        toolId: tool.id,
        path: 'arguments',
      })
    }
    if (invocation.rawInput === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'tool.invocation.raw_input_required',
        message: 'Freeform tools require rawInput',
        toolId: tool.id,
        path: 'rawInput',
      })
    }
    return
  }

  if (invocation.arguments === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.invocation.arguments_required',
      message: 'Hybrid tools require structured metadata in arguments',
      toolId: tool.id,
      path: 'arguments',
    })
  } else {
    validateJsonSchema(
      invocation.arguments,
      input.metadataSchema,
      'arguments',
      tool.id,
      diagnostics,
    )
  }
  if (invocation.rawInput === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.invocation.raw_input_required',
      message: `Hybrid tools require rawInput for ${input.rawField}`,
      toolId: tool.id,
      path: 'rawInput',
    })
  }
}

function analyzeTools(
  toolIds: readonly string[],
  byId: ReadonlyMap<string, ToolDefinition>,
  capabilities: ModelToolTransportCapabilities,
): AgentToolAnalysis {
  const exposures: ToolExposureAnalysis[] = []
  const diagnostics: ToolDiagnostic[] = []

  for (const toolId of toolIds) {
    const tool = byId.get(toolId)
    if (!tool) {
      const diagnostic: ToolDiagnostic = {
        severity: 'error',
        code: 'tool.missing',
        message: `Agent tool is not registered: ${toolId}`,
        toolId,
      }
      exposures.push({
        toolId,
        exposed: false,
        transport: undefined,
        diagnostics: [diagnostic],
      })
      diagnostics.push(diagnostic)
      continue
    }

    const result = chooseTransport(tool, capabilities)
    exposures.push({
      toolId: tool.id,
      exposed: result.transport !== undefined,
      transport: result.transport,
      diagnostics: result.diagnostics,
    })
    diagnostics.push(...result.diagnostics)
  }

  return { exposures, diagnostics }
}

function chooseTransport(
  tool: ToolDefinition,
  capabilities: ModelToolTransportCapabilities,
): {
  transport?: ToolTransport
  diagnostics: ToolDiagnostic[]
} {
  if (tool.input.kind === 'structured') {
    if (capabilities.nativeFunction)
      return { transport: 'native-function', diagnostics: [] }
    return unavailableTransport(tool)
  }

  if (capabilities.providerCustom)
    return { transport: 'provider-custom', diagnostics: [] }
  if (capabilities.content) return { transport: 'content', diagnostics: [] }
  if (tool.input.structuredFallback && capabilities.nativeFunction) {
    return {
      transport: 'native-function',
      diagnostics: [
        {
          severity: 'warning',
          code: 'tool.transport.structured_fallback',
          message: `Tool ${tool.id} is exposed through structured fallback`,
          toolId: tool.id,
        },
      ],
    }
  }
  return unavailableTransport(tool)
}

function unavailableTransport(tool: ToolDefinition): {
  transport?: undefined
  diagnostics: ToolDiagnostic[]
} {
  return {
    diagnostics: [
      {
        severity: 'error',
        code: 'tool.transport.unavailable',
        message: `No compatible transport is available for agent tool: ${tool.id}`,
        toolId: tool.id,
      },
    ],
  }
}

function validateJsonSchema(
  value: JsonValue,
  schema: JsonObject,
  path: string,
  toolId: string,
  diagnostics: ToolDiagnostic[],
): void {
  // ponytail: This foundation intentionally validates only the small JSON Schema subset needed for tool boundaries; provider-specific schema compilation remains outside the registry.
  const schemaType = schema.type
  if (typeof schemaType === 'string' && !matchesSchemaType(value, schemaType)) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.invocation.schema_type',
      message: `Expected ${schemaType}`,
      toolId,
      path,
    })
    return
  }

  const enumValues = schema.enum
  if (
    Array.isArray(enumValues) &&
    !enumValues.some((candidate) => jsonEquals(candidate, value))
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'tool.invocation.schema_enum',
      message: 'Value is not included in the allowed enum',
      toolId,
      path,
    })
  }

  if (!isJsonObject(value)) return
  const properties = schema.properties
  if (properties !== undefined && !isJsonObject(properties)) return

  const required = schema.required
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key === 'string' && value[key] === undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'tool.invocation.schema_required',
          message: `Required property is missing: ${key}`,
          toolId,
          path: `${path}.${key}`,
        })
      }
    }
  }

  if (isJsonObject(properties)) {
    for (const [key, propertySchema] of Object.entries(properties)) {
      const propertyValue = value[key]
      if (propertyValue !== undefined && isJsonObject(propertySchema)) {
        validateJsonSchema(
          propertyValue,
          propertySchema,
          `${path}.${key}`,
          toolId,
          diagnostics,
        )
      }
    }
  }

  if (schema.additionalProperties === false && isJsonObject(properties)) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        diagnostics.push({
          severity: 'error',
          code: 'tool.invocation.schema_additional_property',
          message: `Additional property is not allowed: ${key}`,
          toolId,
          path: `${path}.${key}`,
        })
      }
    }
  }
}

function matchesSchemaType(value: JsonValue, type: string): boolean {
  if (type === 'object') return isJsonObject(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number'
  if (type === 'integer')
    return typeof value === 'number' && Number.isInteger(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'null') return value === null
  return true
}

function assertSchemaObject(schema: JsonObject, path: string): void {
  if (!isJsonObject(schema))
    throw new Error(`Tool schema must be a JSON object: ${path}`)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  )
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(isJsonValue)
  )
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
