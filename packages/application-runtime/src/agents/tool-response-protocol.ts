import type { ChatMessage } from '@loom-studio/shared'
import type { GatewayChatResult } from '../types.js'
import type { ToolDefinition, ToolInvocation, ToolResult } from './tool-registry.js'
import type { CompiledToolExposure } from './tool-prompt-build.js'
import { projectHistoryEntries, type TextTransformRuleEntry } from '../transforms/history-text.js'
import { createLoomContentScannerState, finishLoomContentScan, pushLoomContentChunk, renderLoomContentToolResult } from './content-transport.js'
import { renderToolResult } from './tool-result-text.js'

type ResponseTool = {
  definition: Pick<ToolDefinition, 'id' | 'name' | 'input'>
  transport: CompiledToolExposure['transport']
}

/** Decode only: execution and transcript/checkpoint ordering belong to the loop. */
export function decodeToolResponse<T extends ResponseTool>({
  providerResult, sessionId, classificationRules, byExposedName, contentTools, createInvocationId,
}: {
  providerResult: GatewayChatResult
  sessionId: string
  classificationRules: TextTransformRuleEntry[]
  byExposedName: ReadonlyMap<string, T>
  contentTools: readonly T[]
  createInvocationId(): string
}) {
  const toolCalls = providerResult.message.tool_calls ?? []
  const nativeInvocationPairs = toolCalls.map((call) => {
    const resolved = byExposedName.get(call.function.name)
    const parsed = parseToolArguments(call.function.arguments, call.function.name)
    const validationError = providerResult.toolCallErrors?.[call.id] ?? parsed.error
    const recordedCall = parsed.replayArguments === call.function.arguments ? call
      : { ...call, function: { ...call.function, arguments: parsed.replayArguments } }
    const invocation: ToolInvocation = {
      id: createInvocationId(),
      toolId: resolved?.definition.id ?? `unresolved/${call.function.name}`,
      arguments: parsed.arguments,
      ...(validationError ? { rawInput: call.function.arguments } : {}),
      transport: 'native-function',
      ...(providerResult.providerCallId
        ? { providerCallId: providerResult.providerCallId }
        : {}),
      providerItemId: call.id,
    }
    return { call: recordedCall, invocation, resolved, validationError, transport: 'native-function' as const }
  })
  // Parse and protect original envelopes before prose transforms. Reasoning may
  // surround a quoted tool block; such blocks must never become invocations.
  const rawContent = providerResult.message.content ?? ''
  const rawScan = scanContentTools(rawContent, contentTools.map(tool => tool.definition.name))
  const blocks = [...rawContent.matchAll(/<loom_tool name="[A-Za-z0-9_.:/-]+">[\s\S]*?<\/loom_tool>/g)]
  const tokens = blocks.map((_, index) => `\u0000loom-protocol-${index}\u0000`)
  let blockIndex = 0
  const protectedContent = rawContent.replace(/<loom_tool name="[A-Za-z0-9_.:/-]+">[\s\S]*?<\/loom_tool>/g,
    () => tokens[blockIndex++]!)
  const promoted = classifyAssistantContent(protectedContent, sessionId,
    classificationRules.filter(rule => rule.effect.kind === 'promote-reasoning'))
  const restore = (text: string) => tokens.reduce((value, token, index) => value.replaceAll(token, blocks[index]![0]), text)
  const prose = tokens.reduce((text, token) => text.replaceAll(token, ''), promoted.text)
  const classified = classifyAssistantContent(prose, sessionId,
    classificationRules.filter(rule => rule.effect.kind !== 'promote-reasoning'))
  classified.reasoning = promoted.reasoning.map(part => ({ ...part, content: restore(part.content) }))
  const contentScan = { ...rawScan, text: classified.text,
    invocations: rawScan.invocations.filter((_, index) => promoted.text.includes(tokens[index]!)) }
  if (nativeInvocationPairs.length && contentScan.invocations.length)
    throw new Error(
      'Provider emitted native and content tool calls in the same Step',
    )
  const contentInvocationPairs = contentScan.invocations.map((parsed) => {
    const resolved = byExposedName.get(parsed.name)
    const invocation: ToolInvocation = {
      id: createInvocationId(),
      toolId: resolved?.definition.id ?? `unresolved/${parsed.name}`,
      // The content envelope requires metadata even when a freeform tool has no arguments.
      arguments: resolved?.definition.input.kind === 'freeform' && Object.keys(parsed.metadata).length === 0
        ? undefined
        : parsed.metadata,
      rawInput: parsed.content,
      transport: 'content',
      ...(providerResult.providerCallId
        ? { providerCallId: providerResult.providerCallId }
        : {}),
    }
    return {
      invocation,
      resolved,
      exposedName: parsed.name,
      transport: 'content' as const,
      sourceChanged: false,
    }
  })
  const invocationPairs = [
    ...nativeInvocationPairs,
    ...contentInvocationPairs,
  ]
  return { classified, contentScan, invocationPairs, providerMessage: nativeInvocationPairs.length
    ? { ...providerResult.message, tool_calls: nativeInvocationPairs.map(pair => pair.call) } : providerResult.message }
}

/** Native and content transports use the same encoding in live and recovery messages. */
export function encodeToolResultMessage(
  target: { transport: 'native-function'; call: { id: string } } | { transport: 'content'; exposedName: string },
  result: ToolResult,
): ChatMessage {
  if (target.transport === 'native-function') {
    return { role: 'tool', tool_call_id: target.call.id, content: renderToolResult(result) }
  }
  return {
    role: 'user',
    content: renderLoomContentToolResult({
      invocationId: result.invocationId,
      name: target.exposedName,
      status: result.status === 'completed' ? 'completed' : 'failed',
      content: renderToolResult(result),
    }),
  }
}

export function classifyAssistantContent(
  content: string,
  sessionId: string,
  rules: TextTransformRuleEntry[],
) {
  if (!content || rules.length === 0) return { text: content, reasoning: [] as import('../transforms/history-text.js').PromotedReasoningPart[] }
  const snapshot = projectHistoryEntries({
    source: { kind: 'agent-session', sessionId },
    phase: 'classify',
    entries: [{
      id: 'provider.current.assistant-content',
      source: { kind: 'agent-session', sessionId },
      role: 'assistant',
      text: content,
      sequence: 1,
    }],
    rules,
  })
  const entry = snapshot.entries[0]
  return { text: entry?.text ?? content, reasoning: entry?.promotedReasoning ?? [] }
}

export function scanContentTools(content: string, knownToolNames: string[]) {
  const options = { knownToolNames }
  const pushed = pushLoomContentChunk(
    createLoomContentScannerState(),
    content,
    options,
  )
  const finished = finishLoomContentScan(pushed.state, options)
  if (finished.result.status === 'failed')
    throw new Error(
      finished.result.error?.message ?? 'Content tool response is invalid',
    )
  return finished.result
}

function parseToolArguments(value: string, toolName: string): {
  arguments?: ToolInvocation['arguments']
  error?: { code: string; message: string }
  replayArguments: string
} {
  const error = { code: 'tool.invalid_input', message: `Provider tool arguments are invalid JSON object: ${toolName}` }
  let parsed: unknown
  try { parsed = JSON.parse(value) }
  catch {
    // Preserve malformed input as a JSON string for the next Provider request;
    // the original text remains on the invocation and is never executed.
    return { error, replayArguments: JSON.stringify(value) }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return { error, replayArguments: value }
  return { arguments: parsed as Record<string, import('@loom-studio/shared').JsonValue>, replayArguments: value }
}
