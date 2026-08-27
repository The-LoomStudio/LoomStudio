import type { Translator } from '../../../shared/i18n/index.js'
import type { Card, JsonObject, NarrativeBranch, NarrativeNode, NarrativeTimeline, PromptProjection, ProviderMessage } from '../../../entities/index.js'
import type { ActivationFacts } from './activation-control.js'

export type PromptBuildStep = {
  title: string
  rows: Array<{
    label: string
    value: string
  }>
}

export function buildPromptBuildSteps(input: {
  card?: Card
  timeline?: NarrativeTimeline
  branch?: NarrativeBranch
  nodes?: NarrativeNode[]
  input: string
  messages?: ProviderMessage[]
  projection?: PromptProjection
  activationFacts?: ActivationFacts
  promptBuildTrace?: unknown
  session?: { cardSnapshot?: Card }
}, t: Translator): PromptBuildStep[] {
  const card = input.card ?? input.session?.cardSnapshot
  const settingEntries = card?.settingLayer?.entries ?? []
  const activeSettings = input.projection
    ? input.projection.editorProjection.sourceRows.filter(row => row.active && row.zoneId.startsWith('setting.'))
    : settingEntries.filter(entry => settingEntryMatches(entry, input.input))
  const inactiveSettings = input.projection
    ? input.projection.editorProjection.sourceRows.filter(row => !row.active && row.zoneId.startsWith('setting.')).length
    : settingEntries.length - activeSettings.length
  const projectionSteps = input.projection ? buildProjectionSteps(input.projection) : []

  return [
    {
      title: t('prompt.step.sourceSet'),
      rows: [
        { label: t('prompt.label.cardSnapshot'), value: card?.name ?? t('prompt.value.none') },
        { label: t('prompt.label.userMacro'), value: card?.userName?.trim() || t('prompt.value.userFallback') },
        { label: t('prompt.label.preset'), value: card?.preset?.system?.trim() ? t('prompt.value.system') : t('prompt.value.none') },
        { label: t('prompt.label.branch'), value: input.branch ? shortId(input.branch.id) : t('prompt.value.none') },
        { label: t('prompt.label.narrativeChat'), value: t('prompt.value.acceptedEntries', { count: input.nodes?.length ?? 0 }) },
        { label: t('prompt.label.currentInput'), value: input.input.trim() || t('prompt.value.empty') },
      ],
    },
    {
      title: t('prompt.step.activationPass'),
      rows: [
        { label: t('prompt.label.settingLayer'), value: t('prompt.value.activeInactive', { active: activeSettings.length, inactive: inactiveSettings }) },
        { label: t('prompt.label.runtimeFacts'), value: readActivationFacts(input.activationFacts, t) },
        { label: t('prompt.label.activeEntries'), value: readActiveEntryLabels(activeSettings, t) },
        { label: t('prompt.label.inactiveReasons'), value: readInactiveReasons(input.projection, t) },
        { label: t('prompt.label.macroPass'), value: t('prompt.value.macroExpanded') },
      ],
    },
    {
      title: t('prompt.step.zoneProjection'),
      rows: [
        { label: t('prompt.label.stablePrefix'), value: input.messages?.some(message => message.role === 'system') ? t('prompt.value.systemPrefix') : t('prompt.value.notPreviewed') },
        { label: t('prompt.label.narrativeContext'), value: input.nodes && input.nodes.length > 0 ? t('prompt.value.branchPath') : t('prompt.value.noAcceptedEntries') },
        { label: t('prompt.label.currentTurn'), value: input.input.trim().length > 0 ? t('prompt.value.currentInputAppended') : t('prompt.value.noInput') },
        { label: 'Compiled zones', value: input.projection ? String(input.projection.zones.length) : t('prompt.value.notPreviewed') },
      ],
    },
    ...projectionSteps,
    {
      title: t('prompt.step.finalPayload'),
      rows: [
        { label: t('prompt.label.providerShape'), value: t('prompt.value.providerShape') },
        { label: t('prompt.label.messages'), value: input.messages ? input.messages.map(message => message.role).join(' -> ') : t('prompt.value.clickPreviewOrSend') },
        { label: 'Core status', value: readCoreTraceStatus(input.promptBuildTrace, t) },
        { label: 'Core passes', value: readCoreTracePasses(input.promptBuildTrace, t) },
        { label: 'Trace rows', value: input.projection ? String(input.projection.editorProjection.promptRows.length) : t('prompt.value.notPreviewed') },
      ],
    },
  ]
}

function buildProjectionSteps(projection: PromptProjection): PromptBuildStep[] {
  return projection.zones.map(zone => ({
    title: `Zone: ${zone.displayName}`,
    rows: zone.slots.map(slot => ({
      label: slot.orderSource,
      value: `${slot.slotKey} -> ${slot.fragments.map(fragment => fragment.id).join(' -> ')}`,
    })),
  }))
}

function readActiveEntryLabels(entries: Array<JsonObject | PromptProjection['editorProjection']['sourceRows'][number]>, t: Translator): string {
  const labels = entries.map(entry => {
    if ('sourcePath' in entry) return entry.sourcePath
    return entry.title ?? entry.path ?? entry.id ?? t('prompt.value.untitled')
  })

  return labels.join(', ') || t('prompt.value.activeEntryListEmpty')
}

function readInactiveReasons(projection: PromptProjection | undefined, t: Translator): string {
  const rows = projection?.editorProjection.sourceRows
    .filter(row => !row.active)
    .map(row => `${row.sourcePath}: ${row.activationReason ?? t('prompt.value.noActivationReason')}`) ?? []

  return rows.join(', ') || t('prompt.value.none')
}

function readActivationFacts(facts: ActivationFacts | undefined, t: Translator): string {
  if (!facts) return t('prompt.value.none')

  return facts.tags.length > 0
    ? t('prompt.value.runtimeFactsWithTags', { mode: facts['agent.mode'], tags: facts.tags.join(', ') })
    : t('prompt.value.runtimeFacts', { mode: facts['agent.mode'] })
}

function settingEntryMatches(entry: JsonObject, input: string): boolean {
  if (entry.enabled === false) return false
  const activation = entry.activation
  if (!isObject(activation)) return true
  if (activation.kind === 'manual') return false
  if (activation.kind === 'keyword') {
    return Array.isArray(activation.keywords) && activation.keywords.some(keyword => typeof keyword === 'string' && input.includes(keyword))
  }
  return true
}

function readCoreTraceStatus(trace: unknown, t: Translator): string {
  if (!isObject(trace)) return t('prompt.value.notPreviewed')
  return typeof trace.status === 'string' ? trace.status : t('prompt.value.notPreviewed')
}

function readCoreTracePasses(trace: unknown, t: Translator): string {
  if (!isObject(trace) || !Array.isArray(trace.executions)) return t('prompt.value.notPreviewed')
  const passNames = trace.executions
    .map(execution => isObject(execution) && typeof execution.passName === 'string' ? execution.passName : undefined)
    .filter((passName): passName is string => Boolean(passName))
  return passNames.join(' -> ') || t('prompt.value.notPreviewed')
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function shortId(value: string): string {
  return value.slice(0, 8)
}
