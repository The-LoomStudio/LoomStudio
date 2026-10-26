import { compareMessages } from './observation-message-diff.js'
import { t as defaultTranslator, type Translator } from '../../../shared/i18n/index.js'
import type { ObservationEntry, ObservationSummary } from '../../../entities/observation.js'
import type { ObservationRecord, ObservationStep } from './observation-view.js'

export function formatEvidence(value: unknown, t: Translator = defaultTranslator): string {
  return value === undefined ? t('observation.missing') : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export function mapObservationSummary(record: ObservationSummary, t: Translator = defaultTranslator): ObservationRecord {
  return {
    id: record.id, title: record.title, kind: record.kind === 'request' ? 'api' : record.kind,
    status: record.status, time: new Date(record.capturedAt).toLocaleTimeString(),
    origin: record.origin?.eventName ?? record.origin?.packageId ?? (record.origin?.actor ? t(record.origin.actor.startsWith('client:') ? 'observation.userTrigger' : 'observation.sourceRecorded') : t('observation.originMissing')),
    context: '',
    identity: { [record.kind === 'run' ? 'Run' : record.kind === 'build' ? 'Build' : 'Request record']: record.id, Timeline: record.timelineId, Session: record.agentSessionId, Branch: record.branchId, ...record.origin },
    diagnostic: [record.availability === 'partial' && t('observation.partial'), record.diagnostic].filter(Boolean).join(' · ') || undefined,
    steps: [],
  }
}

export function mapObservationStep(summary: ObservationSummary, entry?: ObservationEntry | null, buildEntry?: ObservationEntry | null, previous?: ObservationEntry | null, t: Translator = defaultTranslator): ObservationStep {
  // Query identities are checked before projection; late results cannot populate another selection.
  const current = entry?.id === summary.id ? entry : undefined
  const request = current?.request
  const linkedBuild = buildEntry && buildEntry.id === summary.buildId ? buildEntry : undefined
  const build = current?.build ?? linkedBuild?.build
  const messages = summary.kind === 'build' ? build?.messages : request?.messages
  const previousMessages = previous?.request?.messages
  const estimate = request?.estimate && typeof request.estimate === 'object' ? request.estimate as Record<string, unknown> : undefined
  // Estimates belong to prepared input. Gateway normalization can change message positions.
  const samePreparedInput = request?.preparedMessages !== undefined && JSON.stringify(request.preparedMessages) === JSON.stringify(request.messages)
  const messageEstimates = samePreparedInput && Array.isArray(estimate?.messages) ? estimate.messages : undefined
  const sources = build?.sources
  const delta = previousMessages && messages ? compareMessages(previousMessages, messages) : undefined
  const responseMessage = evidenceObject(evidenceObject(request?.response)?.message)
  const assistantContent = request?.assistantContent ?? (responseMessage?.role === 'assistant' && typeof responseMessage.content === 'string' ? responseMessage.content : '')
  const returnedCalls = responseMessage?.role === 'assistant' && Array.isArray(responseMessage.tool_calls) ? responseMessage.tool_calls : []
  const output = summary.output
  const action = output?.toolNames.length ? output.toolNames.slice(0, 2).join(' · ') + (output.toolNames.length > 2 ? ` +${output.toolNames.length - 2}` : '') + (output.hasText ? ` · ${t('observation.textOutput')}` : '') : output?.hasText ? t('observation.textOutput') : t('observation.requestStage')
  const emissions = (build?.transformations ?? []).map(evidenceObject).filter(item => item?.kind === 'emission')
  const emittedSourceIds = new Set([
    ...(sources ?? []).filter(source => source.fragmentIds?.length).map(source => source.id),
    ...emissions.map(item => item?.sourceNodeId ?? item?.hostId),
  ])

  return {
    id: summary.id, title: summary.kind === 'build' ? t('observation.buildStage') : `${summary.providerStep === undefined ? '' : `${summary.providerStep} · `}${action}`,
    description: '',
    identity: { 'Request record': summary.kind === 'build' ? undefined : summary.id, Build: summary.buildId ?? (summary.kind === 'build' ? summary.id : undefined), 'Provider call': request?.providerCallId, Provider: request?.model?.providerProfileId, Profile: request?.capability?.profileId },
    status: summary.status, kind: summary.kind === 'build' ? 'build' : 'request',
    duration: summary.durationMs === undefined ? t('observation.missing') : summary.durationMs >= 1000 ? `${(summary.durationMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s` : `${summary.durationMs.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`,
    model: request?.model ? request.model.modelId : undefined,
    finishReason: request?.finishReason,
    response: assistantContent.trim() ? { id: `${summary.id}:response`, role: 'assistant', content: assistantContent, raw: responseMessage } : undefined,
    outputRecorded: request?.assistantContent !== undefined || responseMessage !== undefined,
    messages: (messages ?? []).map((message, index) => {
      const fragmentIds = build?.messageFragments?.[index]
      // The link is valid only for the exact recorded build output, never inferred from equal text.
      const source = !request && fragmentIds ? sources?.find(item => item.fragmentIds?.some(id => fragmentIds.includes(id))) : undefined
      return {
        id: `${summary.id}:${index}`, position: index + 1, role: message.role, content: message.content ?? '', raw: message, toolCalls: message.role === 'assistant' ? message.tool_calls?.map(call => ({ name: call.function.name, arguments: call.function.arguments })) : undefined, sourceId: source?.id,
        estimatedTokens: typeof messageEstimates?.[index] === 'number' ? messageEstimates[index] : undefined,
        change: delta?.changes.has(index) ? t(delta.changes.get(index) === 'added' ? 'observation.positionAdded' : 'observation.positionChanged') : undefined,
      }
    }),
    removedMessages: delta?.removed.map(index => {
      const message = previousMessages![index]
      return { id: `${summary.id}:removed:${index}`, position: index + 1, role: message.role, content: message.content ?? '', raw: message, change: t('observation.removedMessage'), toolCalls: message.role === 'assistant' ? message.tool_calls?.map(call => ({ name: call.function.name, arguments: call.function.arguments })) : undefined }
    }),
    initialInput: summary.kind !== 'build' && !previousMessages && (summary.providerStep === 1 || !summary.parentId),
    sources: (sources ?? []).map(source => {
      const injections = emissions.filter(item => (item?.sourceNodeId ?? item?.hostId) === source.id).flatMap((item, index) => {
        const placement = evidenceObject(item?.placement)
        const targetAnchorId = typeof item?.targetAnchorId === 'string' ? item.targetAnchorId : typeof placement?.targetAnchorId === 'string' ? placement.targetAnchorId : undefined
        const original = typeof item?.original === 'string' ? item.original : undefined
        const messageIndex = build?.messageFragments?.findIndex(ids => typeof item?.fragmentId === 'string' && ids.includes(item.fragmentId))
        const base = { targetAnchorId, original, messageIndex: messageIndex !== undefined && messageIndex >= 0 ? messageIndex : undefined }
        const fragmentMessages = Array.isArray(item?.messages) ? item.messages : undefined
        if (fragmentMessages) return fragmentMessages.map((message, messageNumber) => ({ ...base, messageIndex: fragmentMessages.length === 1 ? base.messageIndex : undefined, id: `${source.id}:${index}:${messageNumber}`, role: typeof evidenceObject(message)?.role === 'string' ? String(evidenceObject(message)?.role) : undefined, rendered: String(evidenceObject(message)?.content ?? '') }))
        return [{ ...base, id: `${source.id}:${index}`, role: typeof placement?.role === 'string' ? placement.role : undefined, rendered: typeof item?.rendered === 'string' ? item.rendered : '' }]
      })
      return { ...source, included: !!source.fragmentIds?.length || injections.length > 0,
        injections, originalRecorded: source.original !== undefined, reason: sourceReason(source.reason, t), path: source.path ?? t('observation.sourcePathMissing'), original: formatEvidence(source.original, t), rendered: formatEvidence(source.rendered, t) }
    }),
    variables: (build?.variables ?? []).filter(variable => variable.hostId !== undefined && emittedSourceIds.has(variable.hostId)).map(variable => ({ ...variable, value: formatEvidence(variable.value, t), source: variable.source })),
    tools: request?.toolExecutions?.length ? request.toolExecutions.map(tool => ({ id: tool.id, name: tool.name, input: tool.input, result: tool.result, status: tool.status })) : returnedCalls.map((call, index) => {
      const item = evidenceObject(call)
      const fn = evidenceObject(item?.function)
      return { id: typeof item?.id === 'string' ? item.id : `${summary.id}:call:${index}`, name: typeof fn?.name === 'string' ? fn.name : t('observation.tools'), input: fn?.arguments, status: 'proposed' }
    }),
    measurement: request ? { estimatedTokens: typeof estimate?.estimatedTokens === 'number' ? estimate.estimatedTokens : undefined, toolTokens: Array.isArray(estimate?.tools) && estimate.tools.every(value => typeof value === 'number') ? estimate.tools.reduce((sum, value) => sum + value, 0) : undefined, inputTokens: typeof request.usage?.inputTokens === 'number' ? request.usage.inputTokens : undefined, outputTokens: typeof request.usage?.outputTokens === 'number' ? request.usage.outputTokens : undefined, note: t('observation.measurementNote') } : undefined,
    evidence: { messages: messages !== undefined, sources: sources !== undefined, variables: build?.variables !== undefined, tools: request?.toolExecutions !== undefined },
    capability: request?.capability, capabilityInput: request?.capability ? formatEvidence(request.input, t) : undefined,
    toolDefinitions: request?.tools, configuration: request?.configuration, firstOutputMs: request?.firstOutputMs,
    canCompare: !!previousMessages,
    comparison: previousMessages && messages ? [t('observation.comparison', { id: t('observation.previousRequest'), before: previousMessages.length, after: messages.length }),
      request?.tools !== undefined && previous.request?.tools !== undefined && JSON.stringify(request.tools) !== JSON.stringify(previous.request.tools) ? t('observation.toolsChanged') : '',
      request?.model !== undefined && previous.request?.model !== undefined && JSON.stringify(request.model) !== JSON.stringify(previous.request.model) ? t('observation.modelChanged') : '',
      request?.configuration !== undefined && previous.request?.configuration !== undefined && JSON.stringify(request.configuration) !== JSON.stringify(previous.request.configuration) ? t('observation.configChanged') : '',
    ].filter(Boolean).join(' ') : undefined,
    diagnostic: [summary.availability === 'partial' && t('observation.partial'), summary.diagnostic, linkedBuild?.availability === 'partial' && t('observation.partial'), linkedBuild?.diagnostic, buildEntry === null && t('observation.buildUnavailable')].filter(Boolean).join(' · ') || undefined,
    raw: { record: current, linkedBuild },
  }
}

function sourceReason(reason: string, t: Translator): string {
  if (reason === 'activation: manual') return t('observation.manualInactive')
  if (reason === 'activation: keyword not matched') return t('observation.keywordInactive')
  if (reason === 'activation: conditions not matched') return t('observation.conditionInactive')
  if (reason.startsWith('activation: all blocked (') && reason.endsWith(')')) return sourceReason(reason.slice(25, -1), t)
  if (reason.includes('no emitted fragment')) return t('observation.noEmission')
  if (reason === 'not evaluated in selected skeleton' || reason === 'not evaluated') return t('observation.notEvaluated')
  if (reason === 'author disabled' || reason === 'author or ancestor disabled') return t('observation.authorDisabled')
  return reason
}

function evidenceObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
