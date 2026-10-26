import { listScriptTextTransformRules } from '../scripts/loom-script-text-migration.js'
import { isRecord, type JsonObject } from '@loom-studio/shared'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'
import { listMappedResources } from '../prompt/prompt-resource-mapper.js'
import { readAvailableExtensionInstallations, isExtensionResourceAvailable } from '../runtime/extension-resource-access.js'
import type { TimelineExtensionResourceInspection } from '../types.js'

export async function inspectTimelineExtensionResources(
  ctx: Pick<ApplicationRuntimeContext, 'documents' | 'narratives' | 'promptResources'>,
  input: { timelineId: string; installationId: string },
): Promise<TimelineExtensionResourceInspection> {
  const timeline = await ctx.narratives?.getTimeline(input.timelineId)
  if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${input.timelineId}`)
  const available = await readAvailableExtensionInstallations(ctx.documents, timeline.createdFrom?.cardId, timeline.id)
  const resources: TimelineExtensionResourceInspection['resources'] = []
  function add(id: string, kind: string, label: string, origin: unknown) {
    if (!isRecord(origin) || origin.kind !== 'extension-package' || origin.installationId !== input.installationId
      || typeof origin.packageId !== 'string' || typeof origin.contributionId !== 'string') return
    const globalId = extensionInstallationId(origin.packageId, { kind: 'global' })
    const cardId = timeline!.createdFrom?.cardId
    if (input.installationId !== globalId && (!cardId
      || input.installationId !== extensionInstallationId(origin.packageId, { kind: 'card', cardId }))) {
      throw new Error('Resource installation is outside this Timeline Card')
    }
    resources.push({
      id, kind, label, contributionId: origin.contributionId,
      packageId: origin.packageId, eligible: isExtensionResourceAvailable(origin, available),
    })
  }
  for (const resource of await listMappedResources(ctx.promptResources)) {
    add(resource.id, resource.resourceKind, resource.rootNode.label, resource.origin)
  }
  for (const rule of await listScriptTextTransformRules(ctx.documents)) add(rule.id, 'text-rule', rule.name, rule.origin)
  for (const [kind, type] of [
    ['tool', applicationDocumentTypes.agentTool],
    ['text-extractor', applicationDocumentTypes.textExtractor],
    ['script', applicationDocumentTypes.loomScriptMount],
  ] as const) {
    for (const document of await listDocuments<JsonObject>(ctx.documents, type)) {
      const content = document.content
      add(document.id, kind, typeof content.name === 'string' ? content.name
        : typeof content.label === 'string' ? content.label : document.id, content.origin)
    }
  }
  return { ...input, resources: resources.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)) }
}
