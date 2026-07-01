import type { Translator } from '../shared/i18n/index.js'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { Branch, JsonObject, PromptProjection, ProviderMessage, RunDetails, Session } from '../entities/index.js'

function shortId(id: string): string {
  return id.slice(0, 13)
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isProviderMessages(value: ClientJsonValue | undefined): value is ProviderMessage[] {
  return Array.isArray(value)
    && value.every(item => isObject(item)
      && (item.role === 'system' || item.role === 'assistant' || item.role === 'user')
      && typeof item.content === 'string')
}

export function readComposerHint(input: { session?: Session; branch?: Branch; busy: boolean; input: string }, t: Translator): string {
  if (input.busy) return t('composer.hint.busy')
  if (!input.session) return t('composer.hint.noSession')
  if (!input.branch) return t('composer.hint.noBranch')
  if (input.input.trim().length === 0) return t('composer.hint.emptyInput')
  return input.branch.headEntryId
    ? t('composer.hint.afterHead', { branchId: shortId(input.branch.id), headId: shortId(input.branch.headEntryId) })
    : t('composer.hint.emptyBranch', { branchId: shortId(input.branch.id) })
}

export function readEmptyTimelineText(input: { session?: Session; branch?: Branch }, t: Translator): string {
  if (!input.session) return t('timeline.empty.noSession')
  if (!input.branch) return t('timeline.empty.noBranch')
  return t('timeline.empty.ready')
}

export function readStoredPrompt(runDetails: RunDetails | undefined): ProviderMessage[] | undefined {
  const promptEntry = runDetails?.runtimeEntries.find(entry => entry.kind === 'prompt')
  if (!isObject(promptEntry?.content)) return undefined
  return isProviderMessages(promptEntry.content.messages) ? promptEntry.content.messages : undefined
}

export function readStoredPromptProjection(runDetails: RunDetails | undefined): PromptProjection | undefined {
  const promptEntry = runDetails?.runtimeEntries.find(entry => entry.kind === 'prompt')
  if (!isObject(promptEntry?.content)) return undefined
  return isPromptProjection(promptEntry.content.projection) ? promptEntry.content.projection : undefined
}

export function readStoredProviderPayloadPreview(runDetails: RunDetails | undefined): ClientJsonValue | undefined {
  const promptEntry = runDetails?.runtimeEntries.find(entry => entry.kind === 'prompt')
  if (!isObject(promptEntry?.content)) return undefined
  return promptEntry.content.providerPayloadPreview
}

export function readStoredPromptBuildTrace(runDetails: RunDetails | undefined): ClientJsonValue | undefined {
  const promptEntry = runDetails?.runtimeEntries.find(entry => entry.kind === 'prompt')
  if (!isObject(promptEntry?.content)) return undefined
  return promptEntry.content.promptBuildTrace
}

function isPromptProjection(value: ClientJsonValue | undefined): value is PromptProjection {
  return isObject(value)
    && Array.isArray(value.zones)
    && isObject(value.editorProjection)
    && Array.isArray(value.editorProjection.sourceRows)
    && Array.isArray(value.editorProjection.promptRows)
}
