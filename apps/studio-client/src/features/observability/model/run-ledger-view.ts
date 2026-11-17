import type { JsonValue } from '@loom-studio/shared'
import type { LogRecord } from '@loom-studio/logging'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { ObservationEntry, ObservationSummary } from '../../../entities/observation.js'
import type { PromptBuildStep } from '../../prompt-build/model/build-prompt-build-steps.js'

export type DiagnosticItem = Awaited<ReturnType<StudioApi['diagnostics']['list']>>['items'][number]

export type PromptProjectionSection = {
  id: string
  title: string
  path?: string
  active: boolean
  included: boolean
  reason: string
  activationKind?: string
  fragmentCount: number
  charCount: number
  estimatedTokens: number
}

export type PromptProjectionLedger = {
  source: 'build' | 'preview' | 'empty'
  buildId?: string
  status?: string
  durationMs?: number
  availability?: string
  activeSectionCount: number
  inactiveSectionCount: number
  fragmentCount?: number
  initialFragmentCount?: number
  finalFragmentCount?: number
  messageCount: number
  estimatedTokens?: number
  traceStatus?: string
  traceVersion?: string
  sections: PromptProjectionSection[]
  diagnosticsCount: number
  buildEntry?: ObservationEntry | null
}

export type ModelCallLedgerItem = {
  id: string
  step?: number
  title: string
  status: string
  phase?: string
  provider?: string
  model?: string
  capability?: string
  finishReason?: string
  durationMs?: number
  firstOutputMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimatedTokens?: number
  providerCallId?: string
  correlationId?: string
  toolCount: number
  diagnostic?: string
  raw: ObservationEntry | ObservationSummary
}

export type DiagnosticLogLedgerItem = {
  id: string
  kind: 'diagnostic' | 'log'
  severity: 'error' | 'warning' | 'info' | 'debug'
  timestamp?: string
  source: string
  code?: string
  message: string
  correlationId?: string
  runId?: string
  raw: unknown
}

export function formatLatencyMs(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms >= 1000) return `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`
  return `${Math.round(ms).toLocaleString()} ms`
}

function approximateTokens(text?: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readDiagnosticMessage(value: unknown): { severity: 'error' | 'warning' | 'info'; code?: string; message: string } {
  if (typeof value === 'string') return { severity: 'warning', message: value }
  const obj = asRecord(value)
  if (!obj) return { severity: 'warning', message: JSON.stringify(value) }
  const rawSeverity = typeof obj.severity === 'string' ? obj.severity : undefined
  const severity = rawSeverity === 'error' || rawSeverity === 'info' ? rawSeverity : 'warning'
  const code = typeof obj.code === 'string' ? obj.code : undefined
  const message = typeof obj.message === 'string'
    ? obj.message
    : typeof obj.reason === 'string'
      ? obj.reason
      : JSON.stringify(value)
  return { severity, code, message }
}

export function buildPromptProjectionLedger(
  buildEntry: ObservationEntry | null | undefined,
  fallback?: {
    tokenEstimate?: { estimatedTokens: number }
    promptBuildSteps?: PromptBuildStep[]
    promptBuildTrace?: unknown
    promptMessages?: unknown
  },
): PromptProjectionLedger {
  const build = buildEntry?.build
  if (build) {
    const trace = asRecord(build.promptBuildTrace)
    const sources = build.sources ?? []
    const sections: PromptProjectionSection[] = sources.map(source => {
      const fragmentCount = source.fragmentIds?.length ?? 0
      const included = fragmentCount > 0 || source.active
      const text = source.rendered ?? source.original ?? ''
      return {
        id: source.id,
        title: source.title || source.id,
        path: source.path,
        active: source.active,
        included,
        reason: source.reason,
        activationKind: source.activationKind,
        fragmentCount,
        charCount: text.length,
        estimatedTokens: approximateTokens(text),
      }
    })
    const activeSectionCount = sections.filter(item => item.active).length
    const inactiveSectionCount = sections.length - activeSectionCount
    const messages = build.messages ?? build.projection?.messages ?? []
    const estimatedTokens = fallback?.tokenEstimate?.estimatedTokens
      ?? (sections.some(item => item.estimatedTokens > 0)
        ? sections.filter(item => item.included).reduce((sum, item) => sum + item.estimatedTokens, 0)
        : undefined)
    const buildDiagnostics = [
      ...(build.diagnostics ?? []),
      ...(Array.isArray(trace?.diagnostics) ? trace.diagnostics : []),
      ...(Array.isArray(build.toolPromptBuildTrace?.diagnostics) ? build.toolPromptBuildTrace.diagnostics : []),
    ]

    return {
      source: 'build',
      buildId: buildEntry.id,
      status: buildEntry.status,
      durationMs: buildEntry.durationMs,
      availability: buildEntry.availability,
      activeSectionCount,
      inactiveSectionCount,
      fragmentCount: typeof trace?.messageFragmentCount === 'number' ? trace.messageFragmentCount : undefined,
      initialFragmentCount: typeof trace?.initialFragmentCount === 'number' ? trace.initialFragmentCount : undefined,
      finalFragmentCount: typeof trace?.finalFragmentCount === 'number' ? trace.finalFragmentCount : undefined,
      messageCount: messages.length,
      estimatedTokens,
      traceStatus: typeof trace?.status === 'string' ? trace.status : undefined,
      traceVersion: typeof trace?.version === 'string' ? trace.version : undefined,
      sections,
      diagnosticsCount: buildDiagnostics.length,
      buildEntry,
    }
  }

  const trace = asRecord(fallback?.promptBuildTrace)
  const fallbackMessages = Array.isArray(fallback?.promptMessages) ? fallback.promptMessages : []
  const hasFallback = Boolean(trace || fallbackMessages.length || (fallback?.promptBuildSteps?.length ?? 0) > 0 || fallback?.tokenEstimate)
  return {
    source: hasFallback ? 'preview' : 'empty',
    activeSectionCount: 0,
    inactiveSectionCount: 0,
    fragmentCount: typeof trace?.messageFragmentCount === 'number' ? trace.messageFragmentCount : undefined,
    initialFragmentCount: typeof trace?.initialFragmentCount === 'number' ? trace.initialFragmentCount : undefined,
    finalFragmentCount: typeof trace?.finalFragmentCount === 'number' ? trace.finalFragmentCount : undefined,
    messageCount: fallbackMessages.length,
    estimatedTokens: fallback?.tokenEstimate?.estimatedTokens,
    traceStatus: typeof trace?.status === 'string' ? trace.status : undefined,
    traceVersion: typeof trace?.version === 'string' ? trace.version : undefined,
    sections: [],
    diagnosticsCount: Array.isArray(trace?.diagnostics) ? trace.diagnostics.length : 0,
  }
}

export function buildModelCallLedger(
  summaries: ObservationSummary[],
  entries: Array<ObservationEntry | null | undefined>,
): ModelCallLedgerItem[] {
  const entryById = new Map<string, ObservationEntry>()
  for (const entry of entries) {
    if (entry) entryById.set(entry.id, entry)
  }

  return summaries.map(summary => {
    const entry = entryById.get(summary.id)
    const request = entry?.request
    const response = asRecord(request?.response)
    const estimate = asRecord(request?.estimate)
    const usage = request?.usage
    const inputTokens = typeof usage?.inputTokens === 'number' ? usage.inputTokens : undefined
    const outputTokens = typeof usage?.outputTokens === 'number' ? usage.outputTokens : undefined
    const totalTokens = typeof usage?.totalTokens === 'number'
      ? usage.totalTokens
      : inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined
    const provider = typeof response?.provider === 'string'
      ? response.provider
      : request?.model?.providerProfileId ?? request?.capability?.providerId
    const model = typeof response?.model === 'string'
      ? response.model
      : request?.model?.modelId ?? summary.modelId

    return {
      id: summary.id,
      step: summary.providerStep,
      title: summary.title,
      status: entry?.status ?? summary.status,
      phase: request?.phase,
      provider,
      model,
      capability: request?.capability?.capabilityId ?? request?.capability?.profileId,
      finishReason: request?.finishReason,
      durationMs: entry?.durationMs ?? summary.durationMs,
      firstOutputMs: request?.firstOutputMs,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedTokens: typeof estimate?.estimatedTokens === 'number' ? estimate.estimatedTokens : undefined,
      providerCallId: request?.providerCallId,
      correlationId: entry?.origin?.correlationId ?? summary.origin?.correlationId,
      toolCount: request?.toolExecutions?.length ?? summary.output?.toolNames.length ?? 0,
      diagnostic: entry?.diagnostic ?? summary.diagnostic,
      raw: entry ?? summary,
    }
  })
}

export function doesLogMatchRun(record: LogRecord, runId?: string, correlationId?: string): boolean {
  const dataRunId = typeof record.data?.runId === 'string' ? record.data.runId : undefined
  if (runId && dataRunId === runId) return true
  if (correlationId && record.correlationId === correlationId) return true
  return false
}

export function doesDiagnosticMatchRun(item: DiagnosticItem, runId?: string, correlationId?: string): boolean {
  if (correlationId && item.correlationId === correlationId) return true
  if (!runId) return false
  if (item.correlationId === runId || item.callId === runId || item.documentId === runId) return true
  return containsStringValue(item.details, runId)
}

function containsStringValue(value: JsonValue | undefined, target: string, depth = 0): boolean {
  if (value === undefined || value === null || depth > 4) return false
  if (typeof value === 'string') return value === target
  if (Array.isArray(value)) return value.some(entry => containsStringValue(entry, target, depth + 1))
  if (typeof value === 'object') return Object.values(value).some(entry => containsStringValue(entry, target, depth + 1))
  return false
}

export function buildDiagnosticLogLedger(input: {
  runId?: string
  correlationId?: string
  record?: ObservationSummary
  buildEntry?: ObservationEntry | null
  callItems?: ModelCallLedgerItem[]
  logs?: LogRecord[]
  diagnostics?: DiagnosticItem[]
}): DiagnosticLogLedgerItem[] {
  const items: DiagnosticLogLedgerItem[] = []

  if (input.record?.diagnostic) {
    items.push({
      id: `obs-run:${input.record.id}`,
      kind: 'diagnostic',
      severity: input.record.status === 'failed' ? 'error' : 'warning',
      timestamp: input.record.updatedAt,
      source: `observation:${input.record.kind}`,
      code: input.record.availability === 'partial' ? 'observation.partial' : undefined,
      message: input.record.diagnostic,
      correlationId: input.record.origin?.correlationId,
      runId: input.record.id,
      raw: input.record,
    })
  }

  if (input.buildEntry?.diagnostic) {
    items.push({
      id: `obs-build:${input.buildEntry.id}`,
      kind: 'diagnostic',
      severity: input.buildEntry.status === 'failed' ? 'error' : 'warning',
      timestamp: input.buildEntry.updatedAt,
      source: 'observation:build',
      message: input.buildEntry.diagnostic,
      correlationId: input.buildEntry.origin?.correlationId,
      runId: input.runId,
      raw: input.buildEntry,
    })
  }

  const build = input.buildEntry?.build
  const trace = asRecord(build?.promptBuildTrace)
  const buildDiags = [
    ...(build?.diagnostics ?? []).map((entry, idx) => ({ source: 'prompt.build', id: `build-diag:${idx}`, entry })),
    ...(Array.isArray(trace?.diagnostics) ? trace.diagnostics : []).map((entry, idx) => ({ source: 'prompt.trace', id: `trace-diag:${idx}`, entry })),
    ...(build?.toolPromptBuildTrace?.diagnostics ?? []).map((entry, idx) => ({ source: 'tool.prompt', id: `tool-diag:${idx}`, entry })),
  ]
  for (const item of buildDiags) {
    const parsed = readDiagnosticMessage(item.entry)
    items.push({
      id: item.id,
      kind: 'diagnostic',
      severity: parsed.severity,
      timestamp: input.buildEntry?.updatedAt,
      source: item.source,
      code: parsed.code,
      message: parsed.message,
      correlationId: input.correlationId,
      runId: input.runId,
      raw: item.entry,
    })
  }

  for (const call of input.callItems ?? []) {
    if (!call.diagnostic) continue
    items.push({
      id: `call-diag:${call.id}`,
      kind: 'diagnostic',
      severity: call.status === 'failed' ? 'error' : 'warning',
      source: `model:${call.model ?? call.title}`,
      message: call.diagnostic,
      correlationId: call.correlationId,
      runId: input.runId,
      raw: call.raw,
    })
  }

  for (const diag of input.diagnostics ?? []) {
    items.push({
      id: `runtime-diag:${diag.id}`,
      kind: 'diagnostic',
      severity: diag.severity,
      timestamp: diag.lastSeenAt ?? diag.createdAt,
      source: diag.packageId ? `${diag.source}:${diag.packageId}` : diag.source,
      code: diag.code,
      message: diag.message,
      correlationId: diag.correlationId,
      runId: input.runId,
      raw: diag,
    })
  }

  for (const [index, log] of (input.logs ?? []).entries()) {
    const severity = log.level === 'warn' ? 'warning' : log.level
    items.push({
      id: `log:${log.timestamp}:${index}`,
      kind: 'log',
      severity,
      timestamp: log.timestamp,
      source: log.extension?.packageId ? `${log.namespace} (${log.extension.packageId})` : log.namespace,
      code: log.event ?? log.error?.code,
      message: log.error?.message ? `${log.message} — ${log.error.message}` : log.message,
      correlationId: log.correlationId,
      runId: typeof log.data?.runId === 'string' ? log.data.runId : undefined,
      raw: log,
    })
  }

  return items.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
}
