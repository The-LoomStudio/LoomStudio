import { isDeepStrictEqual } from 'node:util'
import { isRecord, type JsonObject, type JsonValue, type StateContribution } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument } from '../foundation/document-store.js'
import { timelineRuntimeContextId } from '../narrative/timeline-runtime-context.js'
import { narrativeWriteContext, requireDocumentParticipant, requireNarratives } from '../runtime/context.js'
import { readAgentTurnVariables, readStateInitializationResources } from '../runtime/narrative-runtime.js'
import { readAvailableExtensionInstallations } from '../runtime/extension-resource-access.js'
import { composeStateContributions, materializeStateContribution } from '../state/state-contribution.js'
import { applyStateOperations, getApplicationStateSnapshot, notifyStateChange, validateSnapshotAgainstDefinitions } from '../state/state.js'
import {
  assertTimelineExtensionLease, beginTimelineExtensionWork, captureTimelineExtensionLease,
  readTimelineExtensionParticipation, requireTimelineExtensionInstallation,
} from './timeline-participation.js'
import type {
  AdoptTimelineExtensionInput, PreviewTimelineExtensionAdoptionInput, RuntimeRequestContext,
  StateMutationOperation, TimelineExtensionAdoptionPreview, TimelineRuntimeContextContent,
} from '../types.js'

type Context = Pick<ApplicationRuntimeContext,
  'dataEngine' | 'documents' | 'narratives' | 'states' | 'stateContributions' | 'promptResources' | 'createId' | 'now' | 'onStateChanged' | 'logger'
>

function readPath(root: JsonObject, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = root
  for (const key of path.split('.')) {
    if (!isRecord(value)) {
      if (value !== undefined) throw new Error(`State initialization path has an occupied parent: ${path}`)
      return undefined
    }
    value = Object.hasOwn(value, key) ? value[key] as JsonValue : undefined
  }
  return value
}

function missingState(
  runtime: TimelineRuntimeContextContent, snapshot: JsonObject,
  installationId: string, contributions: StateContribution[],
) {
  // Entity declarations already belong to the Timeline; only re-materialize this owner's values.
  const materialized = materializeStateContribution(composeStateContributions('timeline.extension-initialization', [{
    id: 'timeline.existing-entities', entityTypes: runtime.stateEntityTypes, entities: runtime.stateEntities,
    templates: [], componentMounts: [], bindings: [],
  }, ...contributions.map(contribution => ({ ...contribution, entityTypes: [], entities: [] }))]))
  const entityPaths = contributions.flatMap(contribution => contribution.entities.map(entity => {
    const type = runtime.stateEntityTypes.find(candidate => candidate.id === entity.typeId)!
    return `${type.collectionPath}.${entity.entityId}`
  })).filter(path => readPath(snapshot, path) === undefined)
  const bindings = runtime.stateBindings.filter(binding => binding.installationId === installationId)
  const paths = [...entityPaths, ...materialized.bindings.map(binding => binding.path).filter(path => {
    if (!bindings.some(binding => binding.path === path)) throw new Error(`State initialization binding was not accepted: ${path}`)
    return readPath(snapshot, path) === undefined && !entityPaths.some(parent => path.startsWith(`${parent}.`))
  })]
  const operations: StateMutationOperation[] = paths.map(path => {
    const value = readPath(materialized.snapshot, path)
    if (value === undefined) throw new Error(`State initialization did not materialize its declared path: ${path}`)
    return { op: 'set', path: `/${path.split('.').map(key => key.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`, value }
  })
  return { operations, snapshot: applyStateOperations(snapshot, operations) }
}

async function prepare(ctx: Context, input: PreviewTimelineExtensionAdoptionInput) {
  const lease = await captureTimelineExtensionLease(ctx, input.timelineId, input.installationId)
  const installation = await requireTimelineExtensionInstallation(ctx, ctx.documents, input.timelineId, input.installationId)
  if (!installation.content.source) throw new Error('Extension initialization requires an installation source')
  const config = await readTimelineExtensionParticipation(ctx.documents, input.timelineId)
  const runtime = await readDocument<TimelineRuntimeContextContent>(
    ctx.documents, timelineRuntimeContextId(input.timelineId), applicationDocumentTypes.timelineRuntimeContext,
  )
  const sources = ctx.stateContributions.list().filter(source => source.installationId === input.installationId)
    .sort((a, b) => a.contributionId.localeCompare(b.contributionId))
  const accepted = runtime.content.stateContributionSources.filter(source => source.installationId === input.installationId)
    .sort((a, b) => a.contributionId.localeCompare(b.contributionId))
  const registered = sources.map(source => ({
    contributionId: source.contributionId, packageId: source.packageId, moduleId: source.moduleId,
    packageVersion: source.packageVersion, installationId: source.installationId, declaration: source.contribution,
  }))
  if (!isDeepStrictEqual(accepted, JSON.parse(JSON.stringify(registered)))) {
    throw new Error('Extension State declarations changed or are unavailable; compatibility review or migration is required')
  }
  const target = { scope: 'timeline' as const, timelineId: input.timelineId, branchId: input.branchId }
  const state = await getApplicationStateSnapshot(ctx, target)
  const addition = missingState(runtime.content, state.value, input.installationId, sources.map(source => source.contribution))
  await validateSnapshotAgainstDefinitions(ctx, target, state.value, addition.snapshot)
  const preview: TimelineExtensionAdoptionPreview = {
    ...input, packageId: installation.content.packageId, packageVersion: installation.content.packageVersion,
    source: structuredClone(installation.content.source), expectedVersion: config.version,
    expectedInstallationVersion: installation.version, expectedStateRevisionId: state.revisionId,
    expectedRuntimeContextVersion: runtime.version,
    contributionInstances: sources.map(source => ({ contributionId: source.contributionId, instanceId: source.instanceId })),
    paths: addition.operations.map(operation => operation.path),
  }
  await assertTimelineExtensionLease(ctx, ctx.documents, lease)
  return { lease, preview, runtime, state, target, sources }
}

export function createTimelineExtensionStateInitializationMethods(ctx: Context) {
  return {
    previewTimelineExtensionStateInitialization: async (input: PreviewTimelineExtensionAdoptionInput) =>
      (await prepare(ctx, input)).preview,

    initializeTimelineExtensionState: async (input: AdoptTimelineExtensionInput, requestContext?: RuntimeRequestContext) => {
      const { preview, runtime, state, target, sources, lease } = await prepare(ctx, input)
      if (preview.expectedVersion !== input.expectedVersion || preview.expectedInstallationVersion !== input.expectedInstallationVersion
        || preview.expectedStateRevisionId !== input.expectedStateRevisionId || preview.expectedRuntimeContextVersion !== input.expectedRuntimeContextVersion
        || !isDeepStrictEqual(preview.contributionInstances, input.contributionInstances)) throw new Error('Extension initialization preview is stale')
      if (!preview.paths.length) throw new Error('Extension State has no missing data to initialize')
      const work = await beginTimelineExtensionWork(ctx, {
        timelineId: input.timelineId, installationId: input.installationId, signal: requestContext?.abortSignal,
      })
      try {
        await assertTimelineExtensionLease(ctx, ctx.documents, lease)
        const timeline = (await requireNarratives(ctx).getTimeline(input.timelineId))!
        const installations = await readAvailableExtensionInstallations(ctx.documents, runtime.content.sourceCardId, input.timelineId)
        const variables = await readAgentTurnVariables(ctx, state.value, runtime.content.cardName)
        const resources = await readStateInitializationResources(ctx, installations, timeline.promptResourceIds, variables)
        const contributions: StateContribution[] = []
        for (const source of sources) {
          contributions.push(await ctx.stateContributions.initialize(source.contributionId, {
            cardId: runtime.content.sourceCardId, characterName: runtime.content.cardName ?? '',
            opening: '', openingId: timeline.opening?.id, resources, signal: work.signal,
          }))
        }
        const addition = missingState(runtime.content, state.value, input.installationId, contributions)
        await validateSnapshotAgainstDefinitions(ctx, target, state.value, addition.snapshot)
        work.signal.throwIfAborted()
        const result = await ctx.dataEngine.transact(
          narrativeWriteContext(requestContext, 'application.initializeTimelineExtensionState'),
          dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
            work.signal.throwIfAborted()
            const narrativeTx = requireNarratives(ctx).transaction(dataTx)
            await assertTimelineExtensionLease({ narratives: narrativeTx }, documents, lease)
            const config = await readTimelineExtensionParticipation(documents, input.timelineId)
            if (config.version !== input.expectedVersion || (await documents.get(runtime.id))?.version !== runtime.version) {
              throw new Error('Extension initialization changed before commit')
            }
            const instances = ctx.stateContributions.list().filter(source => source.installationId === input.installationId)
              .sort((a, b) => a.contributionId.localeCompare(b.contributionId))
              .map(source => ({ contributionId: source.contributionId, instanceId: source.instanceId }))
            if (!isDeepStrictEqual(instances, input.contributionInstances)) throw new Error('State contributions changed during initialization')
            const revision = ctx.states.transaction(dataTx).createRevision({
              scopeId: state.scopeId, parentRevisionId: state.revisionId, snapshot: addition.snapshot,
              operations: addition.operations as JsonObject[],
            }).revision
            narrativeTx.setBranchStateHead({
              timelineId: target.timelineId, branchId: target.branchId,
              expectedStateHeadRevisionId: state.revisionId, stateRevisionId: revision.id,
            })
            return { revisionId: revision.id }
          }, { allowEmpty: true }),
        )
        notifyStateChange(ctx, { target, revisionId: result.value.value.revisionId,
          changesetId: result.commit.changesetId, paths: addition.operations.map(operation => operation.path) })
        return { ...result.value.value, mutation: { changesetId: result.commit.changesetId } }
      } finally { work.dispose() }
    },
  }
}
