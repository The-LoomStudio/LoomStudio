import type { JsonObject, JsonValue } from '@loom-studio/shared'

const TOOL_START_PREFIX = '<loom_tool'
const TOOL_CLOSE = '</loom_tool>'
const METADATA_OPEN = '<metadata>'
const METADATA_CLOSE = '</metadata>'
const CONTENT_OPEN = '<content>'
const CONTENT_CLOSE = '</content>'
const DEFAULT_MAX_INPUT_LENGTH = 64 * 1024
const DEFAULT_MAX_TOOL_LENGTH = 48 * 1024
const DEFAULT_MAX_METADATA_LENGTH = 8 * 1024
const DEFAULT_MAX_CONTENT_LENGTH = 40 * 1024

export type LoomContentToolInvocation = {
  name: string
  metadata: JsonObject
  content: string
  rawInput: string
}

export type LoomContentScanErrorCode =
  | 'content.invalid_chunk'
  | 'content.input_too_large'
  | 'content.tool_too_large'
  | 'content.malformed_start_tag'
  | 'content.unknown_tool'
  | 'content.invalid_metadata'
  | 'content.metadata_not_object'
  | 'content.duplicate_field'
  | 'content.unknown_field'
  | 'content.reserved_delimiter_conflict'
  | 'content.unclosed_tool'
  | 'content.unclosed_field'

export type LoomContentScanError = {
  code: LoomContentScanErrorCode
  message: string
}

export type LoomContentScanEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; invocation: LoomContentToolInvocation }
  | { type: 'error'; error: LoomContentScanError }

export type LoomContentScannerOptions = {
  knownToolNames?: readonly string[]
  maxInputLength?: number
  maxToolLength?: number
  maxMetadataLength?: number
  maxContentLength?: number
}

export type LoomContentScannerState = {
  pending: string
  text: string
  invocations: LoomContentToolInvocation[]
  totalLength: number
  status: 'open' | 'completed' | 'failed'
  error?: LoomContentScanError
}

export type LoomContentScanResult = {
  status: 'completed' | 'failed'
  text: string
  invocations: LoomContentToolInvocation[]
  error?: LoomContentScanError
}

export type LoomContentToolResult = {
  invocationId: string
  name: string
  status: 'completed' | 'failed'
  content: string
}

export function createLoomContentScannerState(): LoomContentScannerState {
  return {
    pending: '',
    text: '',
    invocations: [],
    totalLength: 0,
    status: 'open',
  }
}

export function pushLoomContentChunk(
  state: LoomContentScannerState,
  chunk: string,
  options: LoomContentScannerOptions = {},
): { state: LoomContentScannerState; events: LoomContentScanEvent[] } {
  if (state.status !== 'open') return { state, events: [] }

  if (typeof chunk !== 'string') {
    return fail(state, {
      code: 'content.invalid_chunk',
      message: 'Content tool scanner chunks must be strings.',
    })
  }

  const limits = resolveLimits(options)
  const totalLength = state.totalLength + chunk.length
  if (totalLength > limits.maxInputLength) {
    return fail(state, {
      code: 'content.input_too_large',
      message: `Content tool input exceeds ${limits.maxInputLength} characters.`,
    })
  }

  return processPending(
    {
      ...state,
      pending: state.pending + chunk,
      totalLength,
    },
    options,
    false,
  )
}

export function finishLoomContentScan(
  state: LoomContentScannerState,
  options: LoomContentScannerOptions = {},
): {
  state: LoomContentScannerState
  result: LoomContentScanResult
  events: LoomContentScanEvent[]
} {
  if (state.status === 'failed') {
    return { state, result: toResult(state), events: [] }
  }
  if (state.status === 'completed') {
    return { state, result: toResult(state), events: [] }
  }

  const processed = processPending(state, options, true)
  if (processed.state.status === 'failed') {
    return {
      state: processed.state,
      result: toResult(processed.state),
      events: processed.events,
    }
  }

  const finalState = processed.state
  if (finalState.pending.length > 0) {
    const error = hasToolStartPrefix(finalState.pending)
      ? {
          code: 'content.unclosed_tool' as const,
          message: 'Content tool block is not closed.',
        }
      : undefined
    if (error) {
      const failed = { ...finalState, status: 'failed' as const, error }
      return {
        state: failed,
        result: toResult(failed),
        events: [...processed.events, { type: 'error', error }],
      }
    }
  }

  const completed = { ...finalState, status: 'completed' as const, pending: '' }
  return {
    state: completed,
    result: toResult(completed),
    events: processed.events,
  }
}

export function renderLoomContentToolResult(
  input: LoomContentToolResult,
): string {
  assertNonEmpty(input.invocationId, 'invocationId')
  assertNonEmpty(input.name, 'name')
  if (input.status !== 'completed' && input.status !== 'failed') {
    throw new Error(`Unsupported content tool result status: ${input.status}`)
  }
  if (typeof input.content !== 'string') {
    throw new Error('Content tool result content must be a string.')
  }
  return `<loom_tool_result invocation_id="${escapeAttribute(input.invocationId)}" name="${escapeAttribute(input.name)}" status="${input.status}">${escapeResultContent(input.content)}</loom_tool_result>`
}

function processPending(
  state: LoomContentScannerState,
  options: LoomContentScannerOptions,
  final: boolean,
): { state: LoomContentScannerState; events: LoomContentScanEvent[] } {
  const limits = resolveLimits(options)
  let current = state
  const events: LoomContentScanEvent[] = []

  while (current.pending.length > 0) {
    const startIndex = current.pending.indexOf(TOOL_START_PREFIX)
    if (startIndex < 0) {
      if (final && hasToolStartPrefix(current.pending)) {
        return fail(
          current,
          {
            code: 'content.unclosed_tool',
            message: 'Content tool opening tag is not closed.',
          },
          events,
        )
      }
      const keepLength = final
        ? 0
        : partialPrefixLength(current.pending, TOOL_START_PREFIX)
      const textLength = current.pending.length - keepLength
      if (textLength > 0) {
        const text = current.pending.slice(0, textLength)
        events.push({ type: 'text', text })
        current = {
          ...current,
          pending: current.pending.slice(textLength),
          text: current.text + text,
        }
      }
      if (final && current.pending.length > 0) {
        const text = current.pending
        events.push({ type: 'text', text })
        current = { ...current, pending: '', text: current.text + text }
      }
      break
    }

    if (startIndex > 0) {
      const text = current.pending.slice(0, startIndex)
      events.push({ type: 'text', text })
      current = {
        ...current,
        pending: current.pending.slice(startIndex),
        text: current.text + text,
      }
      continue
    }

    const startEnd = current.pending.indexOf('>')
    if (startEnd < 0) {
      if (final) {
        return fail(
          current,
          {
            code: 'content.unclosed_tool',
            message: 'Content tool opening tag is not closed.',
          },
          events,
        )
      }
      break
    }

    const startTag = current.pending.slice(0, startEnd + 1)
    const name = readToolName(startTag)
    if (!name) {
      return fail(
        current,
        {
          code: 'content.malformed_start_tag',
          message: 'Content tool opening tag must be <loom_tool name="...">.',
        },
        events,
      )
    }

    const closeIndex = current.pending.indexOf(TOOL_CLOSE, startEnd + 1)
    if (closeIndex < 0) {
      if (current.pending.length > limits.maxToolLength) {
        return fail(
          current,
          {
            code: 'content.tool_too_large',
            message: `Content tool block exceeds ${limits.maxToolLength} characters.`,
          },
          events,
        )
      }
      if (final) {
        return fail(
          current,
          {
            code: 'content.unclosed_tool',
            message: 'Content tool block is not closed.',
          },
          events,
        )
      }
      break
    }

    const blockLength = closeIndex + TOOL_CLOSE.length
    if (blockLength > limits.maxToolLength) {
      return fail(
        current,
        {
          code: 'content.tool_too_large',
          message: `Content tool block exceeds ${limits.maxToolLength} characters.`,
        },
        events,
      )
    }
    const block = current.pending.slice(0, blockLength)
    const parsed = parseToolBlock(block, name, options)
    if (!parsed.ok) return fail(current, parsed.error, events)

    events.push({ type: 'tool', invocation: parsed.invocation })
    current = {
      ...current,
      pending: current.pending.slice(blockLength),
      invocations: [...current.invocations, parsed.invocation],
    }
  }

  return { state: current, events }
}

function parseToolBlock(
  block: string,
  name: string,
  options: LoomContentScannerOptions,
):
  | { ok: true; invocation: LoomContentToolInvocation }
  | { ok: false; error: LoomContentScanError } {
  const knownToolNames = options.knownToolNames
  if (!knownToolNames || !knownToolNames.includes(name)) {
    return {
      ok: false,
      error: {
        code: 'content.unknown_tool',
        message: `Content tool is not registered: ${name}.`,
      },
    }
  }

  const inner = block.slice(block.indexOf('>') + 1, -TOOL_CLOSE.length)
  const metadataStart = inner.indexOf(METADATA_OPEN)
  if (metadataStart < 0) {
    return {
      ok: false,
      error: {
        code: 'content.unclosed_field',
        message:
          'Content tool requires exactly one metadata and one content field.',
      },
    }
  }

  if (inner.slice(0, metadataStart).trim().length > 0) {
    return {
      ok: false,
      error: {
        code: inner.slice(0, metadataStart).includes(METADATA_OPEN)
          ? 'content.duplicate_field'
          : 'content.unknown_field',
        message: 'Content tool metadata must be the first field.',
      },
    }
  }

  const metadataEnd = inner.indexOf(
    METADATA_CLOSE,
    metadataStart + METADATA_OPEN.length,
  )
  if (metadataEnd < 0) {
    return {
      ok: false,
      error: {
        code: 'content.unclosed_field',
        message: 'Content tool metadata field is not closed.',
      },
    }
  }

  const metadataText = inner.slice(
    metadataStart + METADATA_OPEN.length,
    metadataEnd,
  )
  if (metadataText.length > resolveLimits(options).maxMetadataLength) {
    return {
      ok: false,
      error: {
        code: 'content.tool_too_large',
        message: `Content tool metadata exceeds ${resolveLimits(options).maxMetadataLength} characters.`,
      },
    }
  }

  const contentStart = inner.indexOf(
    CONTENT_OPEN,
    metadataEnd + METADATA_CLOSE.length,
  )
  if (contentStart < 0) {
    return {
      ok: false,
      error: {
        code: 'content.unknown_field',
        message: 'Content tool content field must follow metadata.',
      },
    }
  }
  const contentEnd = inner.indexOf(
    CONTENT_CLOSE,
    contentStart + CONTENT_OPEN.length,
  )
  if (contentEnd < 0) {
    return {
      ok: false,
      error: {
        code: 'content.reserved_delimiter_conflict',
        message:
          'Content tool content is interrupted by a reserved closing delimiter.',
      },
    }
  }

  const betweenMetadataAndContent = inner.slice(
    metadataEnd + METADATA_CLOSE.length,
    contentStart,
  )
  const content = inner.slice(contentStart + CONTENT_OPEN.length, contentEnd)
  const afterContent = inner.slice(contentEnd + CONTENT_CLOSE.length)
  if (
    containsReservedDelimiter(content) ||
    containsReservedDelimiter(afterContent)
  ) {
    return {
      ok: false,
      error: {
        code: 'content.reserved_delimiter_conflict',
        message: 'Content tool content contains a reserved closing delimiter.',
      },
    }
  }
  if (
    betweenMetadataAndContent.trim().length > 0 ||
    afterContent.trim().length > 0
  ) {
    const hasKnownField =
      betweenMetadataAndContent.includes(METADATA_OPEN) ||
      betweenMetadataAndContent.includes(CONTENT_OPEN) ||
      afterContent.includes(METADATA_OPEN) ||
      afterContent.includes(CONTENT_OPEN)
    const afterContentIsRawText =
      afterContent.trim().length > 0 && !afterContent.trim().startsWith('<')
    return {
      ok: false,
      error: {
        code: hasKnownField
          ? 'content.duplicate_field'
          : afterContentIsRawText
            ? 'content.reserved_delimiter_conflict'
            : 'content.unknown_field',
        message: hasKnownField
          ? 'Content tool metadata and content fields may not be repeated.'
          : afterContentIsRawText
            ? 'Content tool content contains a reserved closing delimiter.'
            : 'Content tool contains an unknown field or unexpected text.',
      },
    }
  }
  if (content.length > resolveLimits(options).maxContentLength) {
    return {
      ok: false,
      error: {
        code: 'content.tool_too_large',
        message: `Content tool content exceeds ${resolveLimits(options).maxContentLength} characters.`,
      },
    }
  }

  let metadataValue: JsonValue
  try {
    metadataValue = JSON.parse(metadataText) as JsonValue
  } catch {
    return {
      ok: false,
      error: {
        code: 'content.invalid_metadata',
        message: 'Content tool metadata must be valid JSON.',
      },
    }
  }
  if (!isJsonObject(metadataValue)) {
    return {
      ok: false,
      error: {
        code: 'content.metadata_not_object',
        message: 'Content tool metadata must be a JSON object.',
      },
    }
  }

  return {
    ok: true,
    invocation: {
      name,
      metadata: metadataValue,
      content,
      rawInput: content,
    },
  }
}

function readToolName(startTag: string): string | undefined {
  const match = /^<loom_tool name="([A-Za-z0-9_.:/-]+)">$/.exec(startTag)
  return match?.[1]
}

function containsReservedDelimiter(input: string): boolean {
  return input.includes(CONTENT_CLOSE) || input.includes(TOOL_CLOSE)
}

function partialPrefixLength(input: string, prefix: string): number {
  const max = Math.min(input.length, prefix.length - 1)
  for (let length = max; length > 0; length -= 1) {
    if (input.endsWith(prefix.slice(0, length))) return length
  }
  return 0
}

function hasToolStartPrefix(input: string): boolean {
  return (
    input.includes(TOOL_START_PREFIX) ||
    partialPrefixLength(input, TOOL_START_PREFIX) > 0
  )
}

function fail(
  state: LoomContentScannerState,
  error: LoomContentScanError,
  existingEvents: LoomContentScanEvent[] = [],
): { state: LoomContentScannerState; events: LoomContentScanEvent[] } {
  const failed = { ...state, status: 'failed' as const, error }
  return {
    state: failed,
    events: [...existingEvents, { type: 'error', error }],
  }
}

function toResult(state: LoomContentScannerState): LoomContentScanResult {
  return {
    status: state.status === 'failed' ? 'failed' : 'completed',
    text: state.text,
    invocations: state.invocations,
    ...(state.error ? { error: state.error } : {}),
  }
}

function resolveLimits(
  options: LoomContentScannerOptions,
): Required<Omit<LoomContentScannerOptions, 'knownToolNames'>> {
  return {
    maxInputLength: options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH,
    maxToolLength: options.maxToolLength ?? DEFAULT_MAX_TOOL_LENGTH,
    maxMetadataLength: options.maxMetadataLength ?? DEFAULT_MAX_METADATA_LENGTH,
    maxContentLength: options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH,
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeResultContent(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Content tool result ${field} cannot be empty.`)
  }
}
