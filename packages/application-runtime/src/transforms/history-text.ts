import { createHash } from 'node:crypto'
import type { RendererContributionDefinition } from '@loom-studio/extension-sdk'
import type { JsonObject, JsonValue } from '@loom-studio/shared'

export type HistorySource =
  | { kind: 'narrative'; timelineId: string; branchId: string }
  | { kind: 'agent-session'; sessionId: string; headEntryId?: string }

export type HistoryTarget = HistorySource['kind']
export type TextTransformPhase = 'classify' | 'prompt' | 'display'

export type TextPipelineConsumer = {
  agentSessionId: string
  agentProfileId: string
  presetId: string
}

export type InspectTextPipelineInput = {
  source: HistorySource
  phase: TextTransformPhase
  consumerAgentSessionId?: string
  traceEntryId?: string
}

export type TextPipelineOverrideSource =
  | { kind: 'narrative'; timelineId: string; branchId: string }
  | { kind: 'agent-session'; sessionId: string }

export type TextPipelineOverrideContent = {
  source: TextPipelineOverrideSource
  phase: TextTransformPhase
  consumerAgentSessionId?: string
  disabledRuleIds: string[]
  orderedRuleIds: string[]
  createdAt: string
  updatedAt: string
}

export type TextPipelineOverrideEntry = TextPipelineOverrideContent & {
  id: string
  version: number
}

export type TextRuleOwner =
  | { kind: 'workspace' }
  | { kind: 'preset'; presetId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'extension'; packageId: string; moduleId?: string }
  | { kind: 'user-override' }

export type TextTransformRuleEffect =
  | { kind: 'replace'; replacement: string }
  | { kind: 'mark'; markerType?: string }
  | {
      kind: 'promote-reasoning'
      contentGroup?: number | string
      visibility: 'collapsed' | 'hidden' | 'visible'
      replay: 'omit' | 'assistant-content'
      dialect?: string
    }

export type TextTransformRuleDraft = {
  name: string
  owner: TextRuleOwner
  enabled: boolean
  orderIndex: number
  matcher: { kind: 'regex'; pattern: string; flags: string }
  effect: TextTransformRuleEffect
  targets: HistoryTarget[]
  phases: TextTransformPhase[]
  range?: { minDepth?: number; maxDepth?: number }
}

export type TextTransformRuleContent = TextTransformRuleDraft & {
  origin?: {
    kind: 'extension-package'
    packageId: string
    packageVersion: string
    contributionId: string
  }
  createdAt: string
  updatedAt: string
}

export type TextTransformRuleEntry = TextTransformRuleContent & {
  id: string
  version: number
}

export type HistoryTextEntry = {
  id: string
  source: HistorySource
  role?: 'user' | 'assistant'
  text: string
  sequence: number
  createdAt?: string
  archived?: boolean
}

export type TextTransformDiagnostic = {
  code: string
  message: string
  ruleId?: string
  entryId?: string
}

export type TextMatchRecord = {
  matchId: string
  ruleId: string
  ruleVersion: number
  entryId: string
  depth: number
  stepIndex: number
  occurrenceIndex: number
  inputRange: { start: number; end: number }
  displayRange?: { start: number; end: number }
  match: string
  captures: Array<string | undefined>
  namedCaptures: Record<string, string | undefined>
}

export type TextPipelineTraceStep = {
  ruleId: string
  ruleVersion: number
  stepIndex: number
  effect: TextTransformRuleEffect['kind']
  matched: boolean
  inputText: string
  outputText: string
  matchIds: string[]
}

export type TextPipelineEntryTrace = {
  entryId: string
  canonicalText: string
  finalText: string
  steps: TextPipelineTraceStep[]
}

export type PromotedReasoningPart = {
  ruleId: string
  entryId: string
  content: string
  visibility: 'collapsed' | 'hidden' | 'visible'
  replay: 'omit' | 'assistant-content'
  dialect?: string
}

export type TransformedHistoryEntry = HistoryTextEntry & {
  depth: number
  originalText: string
  appliedRuleIds: string[]
  promotedReasoning: PromotedReasoningPart[]
}

export type HistoryProjectionSnapshot = {
  source: HistorySource
  phase: TextTransformPhase
  entries: TransformedHistoryEntry[]
  matches: TextMatchRecord[]
  diagnostics: TextTransformDiagnostic[]
  ruleIds: string[]
  trace?: TextPipelineEntryTrace
}

export type HistoryProjectionBudget = {
  maxEntries: number
  maxInputCharacters: number
  maxOutputCharacters: number
  maxMatchesPerRulePerEntry: number
}

export const defaultHistoryProjectionBudget: HistoryProjectionBudget = {
  maxEntries: 1_000,
  maxInputCharacters: 2_000_000,
  maxOutputCharacters: 2_000_000,
  maxMatchesPerRulePerEntry: 10_000,
}

export function validateTextTransformRuleDraft(rule: TextTransformRuleDraft): void {
  if (!rule.name.trim()) throw new Error('Text Transform Rule name cannot be empty')
  if (!Number.isInteger(rule.orderIndex)) throw new Error('Text Transform Rule orderIndex must be an integer')
  if (!rule.targets.length) throw new Error('Text Transform Rule must select at least one target')
  if (!rule.phases.length) throw new Error('Text Transform Rule must select at least one phase')
  if (rule.matcher.kind !== 'regex') throw new Error('Unsupported Text Transform Rule matcher')
  assertSafeFlags(rule.matcher.flags)
  try {
    new RegExp(rule.matcher.pattern, rule.matcher.flags)
  } catch (error) {
    throw new Error(`Invalid Text Transform Rule regex: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  const minDepth = rule.range?.minDepth ?? 0
  const maxDepth = rule.range?.maxDepth
  if (!Number.isInteger(minDepth) || minDepth < 0) throw new Error('Text Transform Rule minDepth must be a non-negative integer')
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < minDepth)) {
    throw new Error('Text Transform Rule maxDepth must be an integer greater than or equal to minDepth')
  }
}

export function projectHistoryEntries(input: {
  source: HistorySource
  phase: TextTransformPhase
  entries: HistoryTextEntry[]
  rules: TextTransformRuleEntry[]
  preserveRuleOrder?: boolean
  traceEntryId?: string
  budget?: Partial<HistoryProjectionBudget>
}): HistoryProjectionSnapshot {
  const budget = { ...defaultHistoryProjectionBudget, ...input.budget }
  const diagnostics: TextTransformDiagnostic[] = []
  const active = input.entries
    .filter(entry => !entry.archived)
    .sort((left, right) => left.sequence - right.sequence)
  if (active.length > budget.maxEntries) throw new Error(`History projection entry budget exceeded: ${active.length}`)
  const inputCharacters = active.reduce((total, entry) => total + entry.text.length, 0)
  if (inputCharacters > budget.maxInputCharacters) throw new Error(`History projection input budget exceeded: ${inputCharacters}`)

  const selectedRules = input.rules
    .filter(rule => rule.enabled && rule.targets.includes(input.source.kind) && rule.phases.includes(input.phase))
  if (!input.preserveRuleOrder) selectedRules.sort(compareRules)
  const applicableRules = selectedRules.filter(rule => {
    try {
      validateTextTransformRuleDraft(rule)
      return true
    } catch (error) {
      diagnostics.push({
        code: 'text.rule.invalid',
        message: error instanceof Error ? error.message : String(error),
        ruleId: rule.id,
      })
      return false
    }
  })
  const newestSequence = [...active].sort((left, right) => right.sequence - left.sequence)
  const depthById = new Map(newestSequence.map((entry, depth) => [entry.id, depth]))
  const matches: TextMatchRecord[] = []
  let trace: TextPipelineEntryTrace | undefined

  const entries = active.map(entry => {
    const depth = depthById.get(entry.id) ?? 0
    let text = entry.text
    const entryMatches: TextMatchRecord[] = []
    const appliedRuleIds: string[] = []
    const promotedReasoning: PromotedReasoningPart[] = []
    const traceSteps: TextPipelineTraceStep[] = []
    for (const [stepIndex, rule] of applicableRules.entries()) {
      if (!isDepthSelected(depth, rule.range)) continue
      const regex = createGlobalRegex(rule.matcher.pattern, rule.matcher.flags)
      const result = applyRule({
        source: input.source,
        phase: input.phase,
        rule,
        regex,
        entryId: entry.id,
        depth,
        stepIndex,
        text,
        maxMatches: budget.maxMatchesPerRulePerEntry,
      })
      if (result.edits.length) updateDisplayRanges(entryMatches, result.edits)
      entryMatches.push(...result.matches)
      if (entry.id === input.traceEntryId) {
        traceSteps.push({
          ruleId: rule.id,
          ruleVersion: rule.version,
          stepIndex,
          effect: rule.effect.kind,
          matched: result.matched,
          inputText: text,
          outputText: result.text,
          matchIds: result.matches.map(match => match.matchId),
        })
      }
      if (!result.matched) continue
      text = result.text
      appliedRuleIds.push(rule.id)
      promotedReasoning.push(...result.promotedReasoning)
    }
    matches.push(...entryMatches)
    if (entry.id === input.traceEntryId) {
      trace = {
        entryId: entry.id,
        canonicalText: entry.text,
        finalText: text,
        steps: traceSteps,
      }
    }
    return {
      ...entry,
      text,
      depth,
      originalText: entry.text,
      appliedRuleIds,
      promotedReasoning,
    }
  })
  const outputCharacters = entries.reduce((total, entry) => total + entry.text.length, 0)
  if (outputCharacters > budget.maxOutputCharacters) throw new Error(`History projection output budget exceeded: ${outputCharacters}`)
  return structuredClone({
    source: input.source,
    phase: input.phase,
    entries,
    matches,
    diagnostics,
    ruleIds: applicableRules.map(rule => rule.id),
    ...(trace ? { trace } : {}),
  })
}

type TextEdit = { start: number; end: number; replacementLength: number }

function applyRule(input: {
  source: HistorySource
  phase: TextTransformPhase
  rule: TextTransformRuleEntry
  regex: RegExp
  entryId: string
  depth: number
  stepIndex: number
  text: string
  maxMatches: number
}) {
  const found: RegExpExecArray[] = []
  let match: RegExpExecArray | null
  while ((match = input.regex.exec(input.text)) !== null) {
    found.push(match)
    if (found.length > input.maxMatches) throw new Error(`Text Transform Rule match budget exceeded: ${input.rule.id}`)
    if (match[0].length === 0) input.regex.lastIndex += 1
  }
  if (!found.length) {
    return {
      matched: false,
      text: input.text,
      matches: [] as TextMatchRecord[],
      promotedReasoning: [] as PromotedReasoningPart[],
      edits: [] as TextEdit[],
    }
  }
  const records = found.map((match, occurrenceIndex): TextMatchRecord => {
    const inputRange = { start: match.index, end: match.index + match[0].length }
    return {
      matchId: createMatchId({
        source: input.source,
        phase: input.phase,
        entryId: input.entryId,
        ruleId: input.rule.id,
        ruleVersion: input.rule.version,
        stepIndex: input.stepIndex,
        occurrenceIndex,
        inputText: input.text,
      }),
      ruleId: input.rule.id,
      ruleVersion: input.rule.version,
      entryId: input.entryId,
      depth: input.depth,
      stepIndex: input.stepIndex,
      occurrenceIndex,
      inputRange,
      ...(input.rule.effect.kind === 'mark' ? { displayRange: inputRange } : {}),
      match: match[0],
      captures: match.slice(1),
      namedCaptures: { ...(match.groups ?? {}) },
    }
  })
  if (input.rule.effect.kind === 'mark') {
    return {
      matched: true,
      text: input.text,
      matches: records,
      promotedReasoning: [] as PromotedReasoningPart[],
      edits: [] as TextEdit[],
    }
  }
  const replacement = input.rule.effect.kind === 'replace' ? input.rule.effect.replacement : ''
  const replaced = replaceMatches(input.text, found, replacement)
  if (input.rule.effect.kind === 'replace') {
    return {
      matched: true,
      text: replaced.text,
      matches: records,
      promotedReasoning: [] as PromotedReasoningPart[],
      edits: replaced.edits,
    }
  }
  const effect = input.rule.effect
  const promotedReasoning = found.map(match => ({
    ruleId: input.rule.id,
    entryId: input.entryId,
    content: readCapture(match, effect.contentGroup),
    visibility: effect.visibility,
    replay: effect.replay,
    ...(effect.dialect ? { dialect: effect.dialect } : {}),
  }))
  return { matched: true, text: replaced.text, matches: records, promotedReasoning, edits: replaced.edits }
}

function createMatchId(input: {
  source: HistorySource
  phase: TextTransformPhase
  entryId: string
  ruleId: string
  ruleVersion: number
  stepIndex: number
  occurrenceIndex: number
  inputText: string
}): string {
  const source = input.source.kind === 'narrative'
    ? ['narrative', input.source.timelineId, input.source.branchId]
    : ['agent-session', input.source.sessionId, input.source.headEntryId ?? '']
  const inputDigest = createHash('sha256').update(input.inputText).digest('hex')
  return `match:${createHash('sha256').update(JSON.stringify([
    source,
    input.phase,
    input.entryId,
    input.ruleId,
    input.ruleVersion,
    input.stepIndex,
    input.occurrenceIndex,
    inputDigest,
  ])).digest('hex')}`
}

function replaceMatches(text: string, matches: RegExpExecArray[], replacement: string): { text: string; edits: TextEdit[] } {
  let cursor = 0
  let output = ''
  const edits: TextEdit[] = []
  for (const match of matches) {
    const expanded = expandReplacement(replacement, match, text)
    output += text.slice(cursor, match.index) + expanded
    edits.push({ start: match.index, end: match.index + match[0].length, replacementLength: expanded.length })
    cursor = match.index + match[0].length
  }
  return { text: output + text.slice(cursor), edits }
}

function expandReplacement(replacement: string, match: RegExpExecArray, input: string): string {
  return replacement.replace(/\$([$&'`]|\d{1,2}|<[^>]*>)/g, (token, reference: string) => {
    if (reference === '$') return '$'
    if (reference === '&') return match[0]
    if (reference === '`') return input.slice(0, match.index)
    if (reference === "'") return input.slice(match.index + match[0].length)
    if (reference.startsWith('<')) {
      if (!match.groups) return token
      return match.groups[reference.slice(1, -1)] ?? ''
    }
    const captureCount = match.length - 1
    let captureIndex = Number(reference)
    let suffix = ''
    if (captureIndex > captureCount && reference.length === 2) {
      captureIndex = Number(reference[0])
      suffix = reference[1] ?? ''
    }
    if (captureIndex < 1 || captureIndex > captureCount) return token
    return (match[captureIndex] ?? '') + suffix
  })
}

function updateDisplayRanges(matches: TextMatchRecord[], edits: TextEdit[]): void {
  for (const match of matches) {
    if (!match.displayRange) continue
    let shift = 0
    let overlaps = false
    for (const edit of edits) {
      if (edit.end <= match.displayRange.start) {
        shift += edit.replacementLength - (edit.end - edit.start)
      } else if (match.displayRange.end > edit.start) {
        overlaps = true
        break
      }
    }
    if (overlaps) {
      delete match.displayRange
    } else if (shift !== 0) {
      match.displayRange = {
        start: match.displayRange.start + shift,
        end: match.displayRange.end + shift,
      }
    }
  }
}

function readCapture(match: RegExpExecArray, group: number | string | undefined): string {
  if (group === undefined) return match[0]
  const value = typeof group === 'number' ? match[group] : match.groups?.[group]
  return value ?? ''
}

function createGlobalRegex(pattern: string, flags: string): RegExp {
  return new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`)
}

function assertSafeFlags(flags: string): void {
  if (/[^dgimsuvy]/.test(flags)) throw new Error(`Unsupported regex flags: ${flags}`)
  if (new Set(flags).size !== flags.length) throw new Error(`Duplicate regex flags: ${flags}`)
}

function isDepthSelected(depth: number, range: TextTransformRuleDraft['range']): boolean {
  return depth >= (range?.minDepth ?? 0) && (range?.maxDepth === undefined || depth <= range.maxDepth)
}

function compareRules(left: TextTransformRuleEntry, right: TextTransformRuleEntry): number {
  return left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
}

export type TextExtractorStrategy = 'latest-valid' | 'all-matches'
export type TextExtractorParser = 'text' | 'key-value-lines'

export type TextExtractorDraft = {
  name: string
  owner: TextRuleOwner
  enabled: boolean
  orderIndex: number
  targets: HistoryTarget[]
  matcher: { kind: 'regex'; pattern: string; flags: string; contentGroup?: number | string }
  strategy: TextExtractorStrategy
  parser: TextExtractorParser
  artifactType?: string
  outputSchema?: JsonObject
}

export type TextExtractorContent = TextExtractorDraft & {
  origin?: {
    kind: 'extension-package'
    packageId: string
    packageVersion: string
    contributionId: string
  }
  createdAt: string
  updatedAt: string
}
export type TextExtractorEntry = TextExtractorContent & { id: string; version: number }

export type TextPipelineInspection = {
  source: HistorySource
  phase: TextTransformPhase
  consumer?: TextPipelineConsumer
  rules: TextTransformRuleEntry[]
  extractors: TextExtractorEntry[]
  artifacts: TextExtractionArtifact[]
  snapshot: HistoryProjectionSnapshot
}

export function validateTextExtractorDraft(extractor: TextExtractorDraft): void {
  if (!extractor.name.trim()) throw new Error('Text Extractor name cannot be empty')
  if (extractor.artifactType !== undefined && !extractor.artifactType.trim()) throw new Error('Text Extractor artifactType cannot be empty')
  if (!Number.isInteger(extractor.orderIndex)) throw new Error('Text Extractor orderIndex must be an integer')
  if (!extractor.targets.length) throw new Error('Text Extractor must select at least one target')
  assertSafeFlags(extractor.matcher.flags)
  try {
    new RegExp(extractor.matcher.pattern, extractor.matcher.flags)
  } catch (error) {
    throw new Error(`Invalid Text Extractor regex: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

export type TextExtractionResult = {
  extractorId: string
  values: JsonValue[]
  sourceEntryIds: string[]
  stale: boolean
  diagnostics: TextTransformDiagnostic[]
}

export type TextExtractionArtifactValue = {
  value: JsonValue
  sourceEntryId: string
}

export type TextExtractionArtifact = {
  artifactId: string
  artifactType: string
  extractorId: string
  extractorVersion: number
  source: HistorySource
  phase: TextTransformPhase
  values: TextExtractionArtifactValue[]
  stale: boolean
  diagnostics: TextTransformDiagnostic[]
}

export function createTextExtractionArtifact(input: {
  source: HistorySource
  phase: TextTransformPhase
  extractor: TextExtractorEntry
  extraction: TextExtractionResult
}): TextExtractionArtifact {
  if (!input.extractor.artifactType) throw new Error(`Text Extractor does not declare artifactType: ${input.extractor.id}`)
  const values = input.extraction.values.map((value, index) => {
    const sourceEntryId = input.extraction.sourceEntryIds[index]
    if (!sourceEntryId) throw new Error(`Text Extractor result is missing sourceEntryId: ${input.extractor.id}`)
    return { value, sourceEntryId }
  })
  const source = input.source.kind === 'narrative'
    ? ['narrative', input.source.timelineId, input.source.branchId]
    : ['agent-session', input.source.sessionId, input.source.headEntryId ?? '']
  const artifactId = `text-artifact:${createHash('sha256').update(JSON.stringify([
    source,
    input.phase,
    input.extractor.id,
    input.extractor.version,
    values,
    input.extraction.stale,
  ])).digest('hex')}`
  return {
    artifactId,
    artifactType: input.extractor.artifactType,
    extractorId: input.extractor.id,
    extractorVersion: input.extractor.version,
    source: structuredClone(input.source),
    phase: input.phase,
    values,
    stale: input.extraction.stale,
    diagnostics: structuredClone(input.extraction.diagnostics),
  }
}

export function extractHistory(input: { snapshot: HistoryProjectionSnapshot; extractor: TextExtractorEntry }): TextExtractionResult {
  const diagnostics: TextTransformDiagnostic[] = []
  if (!input.extractor.enabled || !input.extractor.targets.includes(input.snapshot.source.kind)) {
    return { extractorId: input.extractor.id, values: [], sourceEntryIds: [], stale: false, diagnostics }
  }
  assertSafeFlags(input.extractor.matcher.flags)
  const entries = [...input.snapshot.entries].sort((left, right) => right.depth - left.depth)
  const candidates: Array<{ value: JsonValue; entryId: string; depth: number }> = []
  const invalidDepths: number[] = []
  for (const entry of entries) {
    const regex = createGlobalRegex(input.extractor.matcher.pattern, input.extractor.matcher.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(entry.text)) !== null) {
      const raw = readCapture(match, input.extractor.matcher.contentGroup)
      try {
        const value = parseExtractedValue(raw, input.extractor.parser)
        if (input.extractor.outputSchema) validateBasicOutputSchema(value, input.extractor.outputSchema)
        candidates.push({ value, entryId: entry.id, depth: entry.depth })
      } catch (error) {
        invalidDepths.push(entry.depth)
        diagnostics.push({ code: 'text.extractor.parse_failed', message: error instanceof Error ? error.message : String(error), entryId: entry.id })
      }
      if (match[0].length === 0) regex.lastIndex += 1
    }
  }
  candidates.sort((left, right) => left.depth - right.depth)
  const selected = input.extractor.strategy === 'latest-valid' ? candidates.slice(0, 1) : candidates
  return {
    extractorId: input.extractor.id,
    values: selected.map(item => item.value),
    sourceEntryIds: selected.map(item => item.entryId),
    stale: selected.length > 0 && invalidDepths.some(depth => depth < selected[0]!.depth),
    diagnostics,
  }
}

function parseExtractedValue(raw: string, parser: TextExtractorParser): JsonValue {
  if (parser === 'text') return raw
  const value: JsonObject = {}
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    value[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  if (!Object.keys(value).length) throw new Error('Extractor did not produce any key-value pairs')
  return value
}

function validateBasicOutputSchema(value: JsonValue, schema: JsonObject): void {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Extractor output must be an object')
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (typeof key === 'string' && !(key in value)) throw new Error(`Extractor output is missing required property: ${key}`)
    }
  } else if (schema.type === 'string' && typeof value !== 'string') {
    throw new Error('Extractor output must be a string')
  }
}

export type DisplayPart =
  | { type: 'text'; text: string }
  | { type: 'artifact'; artifactType: string; content: JsonValue; renderMode: 'inline' | 'panel' | 'iframe' }

export type RendererDefinition = RendererContributionDefinition
