import { isDeepStrictEqual } from 'node:util'
import { isRecord, type JsonObject, type JsonValue, type StateContribution } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument, writeDocument } from '../foundation/document-store.js'
import { timelineRuntimeContextId } from '../narrative/timeline-runtime-context.js'
import { narrativeWriteContext, requireDocumentParticipant, requireNarratives } from '../runtime/context.js'
import { readAgentTurnVariables, readStateInitializationResources } from '../runtime/narrative-runtime.js'
import { hasPlayerProfile } from '../profiles/player-state.js'
import { readAvailableExtensionInstallations } from '../runtime/extension-resource-access.js'
import { composeStateContributions, materializeStateContribution } from '../state/state-contribution.js'
import { applyStateOperations, getApplicationStateSnapshot, notifyStateChange, validateSnapshotAgainstDefinitions } from '../state/state.js'
import { readTimelineExtensionParticipation, requireTimelineExtensionInstallation, timelineExtensionParticipationId } from './timeline-participation.js'
import type {
  AdoptTimelineExtensionInput,
  PreviewTimelineExtensionAdoptionInput,
  RuntimeRequestContext,
  StateMutationOperation,
  TimelineExtensionAdoptionPreview,
  TimelineExtensionParticipationContent,
  TimelineRuntimeContextContent,
} from '../types.js'

type Context = Pick<ApplicationRuntimeContext,
  'dataEngine' | 'documents' | 'narratives' | 'states' | 'stateContributions' | 'promptResources' | 'createId' | 'now' | 'onStateChanged' | 'logger'
>

function readPath(root: JsonObject, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = root
  for (const key of path.split('.')) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined
    value = value[key] as JsonValue
  }
  return value
}

function assertNewPath(root: JsonObject, path: string): void {
  let value: JsonValue = root
  for (const key of path.split('.')) {
    if (!isRecord(value)) throw new Error(`State adoption path has an occupied parent: ${path}`)
    if (!Object.hasOwn(value, key)) return
    value = value[key] as JsonValue
  }
  throw new Error(`State adoption would overwrite existing data: ${path}`)
}

function materializeAddition(
  runtime: TimelineRuntimeContextContent,
  snapshot: JsonObject,
  contributions: StateContribution[],
) {
  const composed = composeStateContributions('timeline.extension-adoption', [{
    id: 'timeline.existing-entities',
    entityTypes: runtime.stateEntityTypes, entities: runtime.stateEntities,
    templates: [], componentMounts: [], bindings: [],
  }, ...contributions])
  const materialized = materializeStateContribution(composed)
  const entityPaths = contributions.flatMap(contribution => contribution.entities.map(entity => {
    const type = composed.entityTypes.find(candidate => candidate.id === entity.typeId)!
    return `${type.collectionPath}.${entity.entityId}`
  }))
  const paths = [...entityPaths, ...materialized.bindings.map(binding => binding.path)
    .filter(path => !entityPaths.some(entityPath => path === entityPath || path.startsWith(`${entityPath}.`)))]
  const operations: StateMutationOperation[] = []
  for (const path of paths) {
    if (runtime.stateBindings.some(binding => path === binding.path || path.startsWith(`${binding.path}.`) || binding.path.startsWith(`${path}.`))) {
      throw new Error(`State adoption overlaps an existing binding: ${path}`)
    }
    assertNewPath(snapshot, path)
    const value = readPath(materialized.snapshot, path)
    if (value === undefined) throw new Error(`State contribution did not materialize its declared path: ${path}`)
    operations.push({ op: 'set', path: `/${path.split('.').map(key => key.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`, value })
  }
  return { materialized, composed, operations, snapshot: applyStateOperations(snapshot, operations) }
}

async function prepareAdoption(ctx: Context, input: PreviewTimelineExtensionAdoptionInput) {
  const installation = await requireTimelineExtensionInstallation(ctx, ctx.documents, input.timelineId, input.installationId)
  if (installation.content.participation !== 'timeline') throw new Error('Extension does not declare Timeline participation')
  if (!installation.content.source) throw new Error('Extension adoption requires an installation source')
  const config = await readTimelineExtensionParticipation(ctx.documents, input.timelineId)
  if (config.entries.some(entry => entry.installationId === input.installationId)) {
    throw new Error('Extension has already been adopted; use resume or recovery')
  }
  const runtime = await readDocument<TimelineRuntimeContextContent>(
    ctx.documents, timelineRuntimeContextId(input.timelineId), applicationDocumentTypes.timelineRuntimeContext,
  )
  const target = { scope: 'timeline' as const, timelineId: input.timelineId, branchId: input.branchId }
  const state = await getApplicationStateSnapshot(ctx, target)
  const sources = ctx.stateContributions.list().filter(source => source.installationId === input.installationId)
    .sort((left, right) => left.contributionId.localeCompare(right.contributionId))
  for (const source of sources) {
    if (source.packageVersion !== installation.content.packageVersion) throw new Error('Registered State contribution version does not match installation')
  }
  const addition = materializeAddition(runtime.content, state.value, sources.map(source => source.contribution))
  await validateSnapshotAgainstDefinitions(ctx, target, state.value, addition.snapshot)
  const preview: TimelineExtensionAdoptionPreview = {
    ...input,
    packageId: installation.content.packageId,
    packageVersion: installation.content.packageVersion,
    source: structuredClone(installation.content.source),
    expectedVersion: config.version,
    expectedInstallationVersion: installation.version,
    expectedStateRevisionId: state.revisionId,
    expectedRuntimeContextVersion: runtime.version,
    contributionInstances: sources.map(source => ({ contributionId: source.contributionId, instanceId: source.instanceId })),
    paths: addition.operations.map(operation => operation.path),
  }
  return { installation, config, runtime, target, state, sources, preview }
}

export function createTimelineExtensionAdoptionMethods(ctx: Context) {
  return {
    previewTimelineExtensionAdoption: async (input: PreviewTimelineExtensionAdoptionInput) =>
      (await prepareAdoption(ctx, input)).preview,

    adoptTimelineExtension: async (input: AdoptTimelineExtensionInput, requestContext?: RuntimeRequestContext) => {
      const prepared = await prepareAdoption(ctx, input)
      const { installation, config, runtime, target, state, sources, preview } = prepared
      if (preview.expectedVersion !== input.expectedVersion || preview.expectedInstallationVersion !== input.expectedInstallationVersion
        || preview.expectedStateRevisionId !== input.expectedStateRevisionId || preview.expectedRuntimeContextVersion !== input.expectedRuntimeContextVersion
        || !isDeepStrictEqual(preview.contributionInstances, input.contributionInstances)) {
        throw new Error('Extension adoption preview is stale')
      }
      const signal = requestContext?.abortSignal ?? new AbortController().signal
      signal.throwIfAborted()
      const timeline = (await requireNarratives(ctx).getTimeline(input.timelineId))!
      const installations = new Map(await readAvailableExtensionInstallations(ctx.documents, runtime.content.sourceCardId, input.timelineId))
      installations.set(installation.id, installation.content.packageId)
      const variables = await readAgentTurnVariables(ctx, state.value, runtime.content.cardName, hasPlayerProfile(runtime.content))
      const resources = sources.length
        ? await readStateInitializationResources(ctx, installations, timeline.promptResourceIds, variables) : []
      const contributions: StateContribution[] = []
      for (const source of sources) {
        contributions.push(await ctx.stateContributions.initialize(source.contributionId, {
          cardId: runtime.content.sourceCardId, characterName: runtime.content.cardName ?? '',
          opening: '', openingId: timeline.opening?.id, resources, signal,
        }))
      }
      const addition = materializeAddition(runtime.content, state.value, contributions)
      await validateSnapshotAgainstDefinitions(ctx, target, state.value, addition.snapshot)
      signal.throwIfAborted()
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.adoptTimelineExtension'),
        dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
          signal.throwIfAborted()
          const narrativeTx = requireNarratives(ctx).transaction(dataTx)
          const currentInstallation = await requireTimelineExtensionInstallation(
            { narratives: narrativeTx }, documents, input.timelineId, input.installationId,
          )
          const currentConfig = await readTimelineExtensionParticipation(documents, input.timelineId)
          const currentRuntime = await documents.get(runtime.id)
          if (currentInstallation.version !== installation.version || currentConfig.version !== config.version
            || currentRuntime?.version !== runtime.version) throw new Error('Extension adoption changed during initialization')
          const currentSources = ctx.stateContributions.list().filter(source => source.installationId === input.installationId)
            .sort((left, right) => left.contributionId.localeCompare(right.contributionId))
            .map(source => ({ contributionId: source.contributionId, instanceId: source.instanceId }))
          if (!isDeepStrictEqual(currentSources, preview.contributionInstances)) throw new Error('State contributions changed during initialization')
          signal.throwIfAborted()
          const revision = ctx.states.transaction(dataTx).createRevision({
            scopeId: state.scopeId, parentRevisionId: state.revisionId,
            snapshot: addition.snapshot, operations: addition.operations as JsonObject[],
          }).revision
          narrativeTx.setBranchStateHead({
            timelineId: target.timelineId, branchId: target.branchId,
            expectedStateHeadRevisionId: state.revisionId, stateRevisionId: revision.id,
          })
          const templates = new Map(addition.composed.templates.map(template => [template.id, template]))
          await writeDocument<TimelineRuntimeContextContent>(documents, {
            id: runtime.id, type: runtime.type, expectedVersion: runtime.version,
            content: {
              ...runtime.content,
              stateEntityTypes: addition.materialized.entityTypes,
              stateEntities: addition.materialized.entities,
              stateComponents: [...runtime.content.stateComponents, ...addition.materialized.components],
              stateReferences: [...runtime.content.stateReferences, ...addition.materialized.references],
              stateBindings: [...runtime.content.stateBindings, ...addition.materialized.bindings.map(binding => ({
                path: binding.path, schema: templates.get(binding.templateId)!.schema, installationId: input.installationId,
              }))],
              stateContributionSources: [...runtime.content.stateContributionSources, ...sources.map(source => ({
                contributionId: source.contributionId, packageId: source.packageId, moduleId: source.moduleId,
                packageVersion: source.packageVersion, installationId: source.installationId,
                declaration: structuredClone(source.contribution),
              }))],
            },
          })
          const participation = await writeDocument<TimelineExtensionParticipationContent>(documents, {
            id: timelineExtensionParticipationId(input.timelineId),
            type: applicationDocumentTypes.timelineExtensionParticipation,
            expectedVersion: config.version || 'new',
            content: {
              timelineId: input.timelineId,
              entries: [...config.entries, {
                installationId: installation.id, installationVersion: installation.version,
                packageId: installation.content.packageId, packageVersion: installation.content.packageVersion,
                source: installation.content.source!, enabled: true, generation: ctx.createId('extension-participation'),
              }],
            },
          })
          return { participation: { ...participation.content, version: participation.version }, revisionId: revision.id }
        }),
      )
      notifyStateChange(ctx, {
        target, revisionId: result.value.value.revisionId, changesetId: result.commit.changesetId,
        paths: addition.operations.map(operation => operation.path),
      })
      return { ...result.value.value, mutation: { changesetId: result.commit.changesetId } }
    },
  }
}
