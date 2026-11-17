import { listStateDefinitionDocuments } from '../data/index.js'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'
import { isTimelineExtensionActive, readTimelineExtensionParticipation } from '../extensions/timeline-participation.js'
import { readTimelineRuntimeContext } from '../narrative/timeline-runtime-context.js'
import { requireNarratives } from '../runtime/context.js'
import { createCardStateContribution } from './state-contribution.js'
import { getApplicationStateSnapshot } from './state.js'
import type {
  CardSourceContent, ExtensionInstallationContent, InspectStateSourcesInput,
  StateDefinitionContent, StateSourcesInspection, TimelineStateTemplateDraft,
} from '../types.js'

type Context = Pick<ApplicationRuntimeContext,
  'dataEngine' | 'documents' | 'narratives' | 'states' | 'stateContributions'
>

export async function inspectStateSources(ctx: Context, input: InspectStateSourcesInput): Promise<StateSourcesInspection> {
  input = structuredClone(input)
  let cardId = input.cardId
  let timeline: StateSourcesInspection['timeline'] = null
  let adoptions: NonNullable<StateSourcesInspection['extensions'][number]['adoption']>[] = []
  if (input.target) {
    const story = await requireNarratives(ctx).getTimeline(input.target.timelineId)
    if (!story || story.deletedAt) throw new Error(`Narrative Timeline not found: ${input.target.timelineId}`)
    if (cardId !== undefined && cardId !== story.createdFrom?.cardId) {
      throw new Error('State inspection Card does not belong to this Timeline')
    }
    cardId = story.createdFrom?.cardId
    const snapshot = await getApplicationStateSnapshot(ctx, input.target)
    const context = await readTimelineRuntimeContext(ctx, input.target.timelineId) ?? null
    timeline = { target: input.target, revisionId: snapshot.revisionId, context, paths: [] }
    if (context) {
      timeline.paths = [
        ...context.stateEntities.map(entity => {
          const type = context.stateEntityTypes.find(candidate => candidate.id === entity.typeId)!
          const path = `${type.collectionPath}.${entity.entityId}`
          const owner = context.stateContributionSources.find(source => source.declaration.entities.some(
            candidate => candidate.typeId === entity.typeId && candidate.entityId === entity.entityId,
          ))
          return { path, kind: 'entity' as const, installationId: owner?.installationId, present: hasPath(snapshot.value, path) }
        }),
        ...context.stateBindings.map(binding => ({
          path: binding.path,
          kind: context.stateComponents.some(component => component.path === binding.path) ? 'component' as const : 'binding' as const,
          installationId: binding.installationId,
          present: hasPath(snapshot.value, binding.path),
        })),
      ]
    }
    adoptions = (await readTimelineExtensionParticipation(ctx.documents, input.target.timelineId)).entries
  }

  const cardDocument = cardId ? await ctx.documents.get(cardId) : null
  if (cardDocument && cardDocument.type !== applicationDocumentTypes.cardSource) {
    throw new Error(`Unexpected document type for ${cardId}: ${cardDocument.type}`)
  }
  if (cardId && !cardDocument && !timeline) throw new Error(`Card not found: ${cardId}`)
  const card = cardDocument?.content as CardSourceContent | undefined
  const definitions = await listStateDefinitionDocuments<StateDefinitionContent>(ctx.dataEngine, {})
  const installations = await listDocuments<ExtensionInstallationContent>(ctx.documents, applicationDocumentTypes.extensionInstallation)
  const sources = ctx.stateContributions.list().filter(source => source.target.kind === 'global' || source.target.cardId === cardId)
  const rows = new Map<string, StateSourcesInspection['extensions'][number]>()
  function row(installationId: string, packageId: string) {
    let value = rows.get(installationId)
    if (!value) {
      value = { installationId, packageId, target: null, installation: null,
        cardDefault: false, adoption: null, eligible: false, registered: [], accepted: [] }
      rows.set(installationId, value)
    }
    return value
  }
  for (const source of sources) {
    const item = row(source.installationId, source.packageId)
    item.target = source.target
    item.registered.push({
      installationId: source.installationId, contributionId: source.contributionId,
      packageId: source.packageId, packageVersion: source.packageVersion,
      moduleId: source.moduleId, declaration: source.contribution,
    })
  }
  for (const source of timeline?.context?.stateContributionSources ?? []) {
    row(source.installationId, source.packageId).accepted.push(source)
  }
  for (const adoption of adoptions) row(adoption.installationId, adoption.packageId).adoption = adoption
  for (const reference of card?.extensionAdoptions ?? []) {
    const target = reference.target === 'card' ? { kind: 'card' as const, cardId: cardId! } : { kind: 'global' as const }
    const item = row(extensionInstallationId(reference.packageId, target), reference.packageId)
    item.target = target
    item.cardDefault = true
  }
  for (const installation of installations) {
    const item = rows.get(installation.id)
    if (!item || (installation.content.target.kind === 'card' && installation.content.target.cardId !== cardId)) continue
    item.installation = { ...installation.content, version: installation.version }
    item.target = installation.content.target
  }
  for (const item of rows.values()) {
    // An uninstalled source still has a stable installation identity, not a guessed URL scope.
    if (!item.target) {
      if (item.installationId === extensionInstallationId(item.packageId, { kind: 'global' })) item.target = { kind: 'global' }
      else if (cardId && item.installationId === extensionInstallationId(item.packageId, { kind: 'card', cardId })) {
        item.target = { kind: 'card', cardId }
      }
    }
    if (timeline && item.adoption) item.eligible = await isTimelineExtensionActive(ctx, timeline.target.timelineId, item.installationId)
  }

  return {
    card: card && cardDocument ? {
      id: cardDocument.id, version: cardDocument.version, name: card.name,
      declaration: createCardStateContribution(cardDocument.id, card, new Map<string, TimelineStateTemplateDraft>(
        (card.stateTemplates ?? []).map(template => [template.id, { ...template, kind: 'timeline-template' }]),
      )),
      definitionIds: [...card.stateDefinitionIds ?? []],
      contributionIds: [...card.stateContributionIds ?? []],
    } : null,
    definitions: definitions.map(document => ({ ...document.content, id: document.id, version: document.version })),
    extensions: [...rows.values()].sort((a, b) => a.installationId.localeCompare(b.installationId)),
    timeline,
  }
}

function hasPath(root: JsonObject, path: string): boolean {
  let value: JsonValue = root
  for (const segment of path.split('.')) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, segment)) return false
    value = value[segment]!
  }
  return true
}
