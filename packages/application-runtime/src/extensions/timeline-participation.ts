import type { DocumentTransaction } from '@loom-studio/kernel/document-store'
import type { NarrativeTimeline } from '../data/index.js'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { narrativeWriteContext, requireDocumentParticipant } from '../runtime/context.js'
import type {
  ExtensionInstallationContent,
  RuntimeRequestContext,
  TimelineExtensionParticipation,
  TimelineExtensionParticipationContent,
  TimelineExtensionLease,
  UpdateTimelineExtensionParticipationInput,
} from '../types.js'
import { recordPromptExtensionDependency } from './prompt-dependencies.js'
import { captureNarrativeExecutionSource, assertNarrativeExecutionSource, guardNarrativeWrite } from '../runtime/swipe-runtime.js'

type Context = Pick<ApplicationRuntimeContext, 'documents' | 'narratives' | 'createId' | 'dataEngine'>
type TimelineReader = {
  narratives?: { getTimeline(id: string): NarrativeTimeline | null | Promise<NarrativeTimeline | null> }
}

export function timelineExtensionParticipationId(timelineId: string): string {
  return `timeline-extension-participation:${timelineId}`
}

export async function readTimelineExtensionParticipation(
  documents: DocumentTransaction,
  timelineId: string,
): Promise<TimelineExtensionParticipation> {
  const document = await documents.get(timelineExtensionParticipationId(timelineId))
  if (!document) return { timelineId, version: 0, entries: [] }
  if (document.type !== applicationDocumentTypes.timelineExtensionParticipation) {
    throw new Error('Unexpected Timeline extension participation document type')
  }
  return { ...structuredClone(document.content) as TimelineExtensionParticipationContent, version: document.version }
}

export async function requireTimelineExtensionInstallation(
  ctx: TimelineReader,
  documents: DocumentTransaction,
  timelineId: string,
  installationId: string,
) {
  const timeline = await ctx.narratives?.getTimeline(timelineId)
  if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${timelineId}`)
  const installation = await readDocument<ExtensionInstallationContent>(
    documents, installationId, applicationDocumentTypes.extensionInstallation,
  )
  const { packageId, target } = installation.content
  if (installation.id !== extensionInstallationId(packageId, target)) {
    throw new Error('Extension installation identity does not match its content')
  }
  if (target.kind === 'card' && target.cardId !== timeline.createdFrom?.cardId) {
    throw new Error('Extension installation is outside this Timeline Card')
  }
  return installation
}

export function createTimelineExtensionParticipationMethods(ctx: Context) {
  return {
    subscribeTimelineExtensionTargets: (input: { installationId: string }, listener: () => void) =>
      ctx.dataEngine.subscribeCommits(commit => {
        if (commit.operations.some(operation => operation.entityId === input.installationId
          || operation.entityType === applicationDocumentTypes.timelineExtensionParticipation
          || operation.entityType === 'narrative.timeline')) listener()
      }),

    isTimelineExtensionActive: (input: { timelineId: string; installationId: string }) =>
      isTimelineExtensionActive(ctx, input.timelineId, input.installationId),

    listTimelineExtensionTargets: async (input: { installationId: string }) => {
      const configs = await listDocuments<TimelineExtensionParticipationContent>(
        ctx.documents, applicationDocumentTypes.timelineExtensionParticipation,
      )
      const targets: Array<{ scope: 'timeline'; timelineId: string; branchId: string }> = []
      for (const config of configs) {
        if (!config.content.entries.some(entry => entry.installationId === input.installationId && entry.enabled)) continue
        if (!await isTimelineExtensionActive(ctx, config.content.timelineId, input.installationId)) continue
        const timeline = await ctx.narratives?.getTimeline(config.content.timelineId)
        if (timeline && !timeline.deletedAt) targets.push({
          scope: 'timeline', timelineId: timeline.id, branchId: timeline.activeBranchId,
        })
      }
      return targets
    },

    getTimelineExtensionParticipation: async (input: { timelineId: string }) => {
      const timeline = await ctx.narratives?.getTimeline(input.timelineId)
      if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${input.timelineId}`)
      return readTimelineExtensionParticipation(ctx.documents, input.timelineId)
    },

    updateTimelineExtensionParticipation: async (
      input: UpdateTimelineExtensionParticipationInput,
      requestContext?: RuntimeRequestContext,
    ) => {
      if (typeof input.enabled !== 'boolean') throw new Error('Extension participation enabled must be a boolean')
      const timeline = await ctx.narratives?.getTimeline(input.timelineId)
      if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${input.timelineId}`)
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.updateTimelineExtensionParticipation'),
        dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
          const narratives = ctx.narratives!.transaction(dataTx)
          const currentTimeline = narratives.getTimeline(input.timelineId)
          if (!currentTimeline || currentTimeline.deletedAt) throw new Error(`Narrative Timeline not found: ${input.timelineId}`)
          const current = await readTimelineExtensionParticipation(documents, input.timelineId)
          if (current.version !== input.expectedVersion) throw new Error('Timeline extension participation version conflict')
          const entry = current.entries.find(candidate => candidate.installationId === input.installationId)
          if (!entry) throw new Error('Extension has not been adopted by this Timeline')
          if (input.enabled) {
            const installation = await requireTimelineExtensionInstallation({ narratives }, documents, input.timelineId, input.installationId)
            if (installation.version !== entry.installationVersion || installation.content.packageVersion !== entry.packageVersion) {
              throw new Error('Extension installation changed; explicit recovery is required')
            }
          }
          if (entry.enabled === input.enabled) throw new Error('Extension participation is already in the requested state')
          entry.enabled = input.enabled
          entry.generation = ctx.createId('extension-participation')
          const written = await writeDocument<TimelineExtensionParticipationContent>(documents, {
            id: timelineExtensionParticipationId(input.timelineId),
            type: applicationDocumentTypes.timelineExtensionParticipation,
            content: { timelineId: input.timelineId, entries: current.entries },
            expectedVersion: current.version,
          })
          return { ...written.content, version: written.version }
        }),
      )
      return { participation: result.value.value, mutation: { changesetId: result.commit.changesetId } }
    },
  }
}

export async function isTimelineExtensionActive(
  ctx: Pick<Context, 'documents' | 'narratives'>,
  timelineId: string,
  installationId: string,
): Promise<boolean> {
  const config = await readTimelineExtensionParticipation(ctx.documents, timelineId)
  const entry = config.entries.find(candidate => candidate.installationId === installationId)
  if (!entry?.enabled) return false
  const timeline = await ctx.narratives?.getTimeline(timelineId)
  if (!timeline || timeline.deletedAt) return false
  const installation = await ctx.documents.get(installationId)
  if (!installation || installation.type !== applicationDocumentTypes.extensionInstallation) return false
  const content = installation.content as ExtensionInstallationContent
  return installation.version === entry.installationVersion && content.packageId === entry.packageId
    && content.packageVersion === entry.packageVersion
    && extensionInstallationId(content.packageId, content.target) === installationId
    && (content.target.kind === 'global' || content.target.cardId === timeline.createdFrom?.cardId)
}

export async function captureTimelineExtensionLease(
  ctx: Pick<Context, 'documents' | 'narratives'>,
  timelineId: string,
  installationId: string,
  packageVersion?: string,
): Promise<TimelineExtensionLease> {
  const current = await readTimelineExtensionParticipation(ctx.documents, timelineId)
  const entry = current.entries.find(candidate => candidate.installationId === installationId)
  if (!entry?.enabled) throw new Error('Extension is not active in this Timeline')
  if (packageVersion !== undefined && entry.packageVersion !== packageVersion) {
    throw new Error('Running extension version does not match the adopted package version')
  }
  const lease = {
    timelineId,
    installationId,
    generation: entry.generation,
    installationVersion: entry.installationVersion,
  }
  await assertTimelineExtensionLease(ctx, ctx.documents, lease)
  return lease
}

// Call again inside the write transaction: a successful start check is not a write grant.
export async function assertTimelineExtensionLease(
  ctx: TimelineReader,
  documents: DocumentTransaction,
  lease: TimelineExtensionLease,
): Promise<void> {
  const current = await readTimelineExtensionParticipation(documents, lease.timelineId)
  const entry = current.entries.find(candidate => candidate.installationId === lease.installationId)
  if (!entry?.enabled || entry.generation !== lease.generation || entry.installationVersion !== lease.installationVersion) {
    throw new Error('Timeline extension execution is no longer active')
  }
  const installation = await requireTimelineExtensionInstallation(ctx, documents, lease.timelineId, lease.installationId)
  if (installation.version !== lease.installationVersion || installation.content.packageId !== entry.packageId
    || installation.content.packageVersion !== entry.packageVersion) {
    throw new Error('Extension installation changed; explicit recovery is required')
  }
}

export async function beginTimelineExtensionWork(
  ctx: Pick<Context, 'documents' | 'narratives' | 'dataEngine'>,
  input: { timelineId: string; installationId: string; packageVersion?: string; signal?: AbortSignal; lease?: TimelineExtensionLease },
) {
  input.signal?.throwIfAborted()
  const lease = input.lease ?? await captureTimelineExtensionLease(ctx, input.timelineId, input.installationId, input.packageVersion)
  recordPromptExtensionDependency(lease.installationId, lease)
  const controller = new AbortController()
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal
  const subscription = ctx.dataEngine.subscribeCommits(commit => {
    if (!commit.operations.some(operation => operation.entityId === timelineExtensionParticipationId(lease.timelineId)
      || operation.entityId === lease.installationId || operation.entityId === lease.timelineId)) return
    void assertTimelineExtensionLease(ctx, ctx.documents, lease).catch(error => controller.abort(error))
  })
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', dispose)
    subscription.dispose()
    controller.abort(new Error('Timeline extension work has finished'))
  }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    // Close the gap between reading the lease and subscribing to changes.
    await assertTimelineExtensionLease(ctx, ctx.documents, lease)
    signal.throwIfAborted()
    return {
      lease: Object.freeze(lease), signal, dispose,
      run: <T>(work: () => T): T => ctx.dataEngine.withTransactionGuard(async tx => {
        signal.throwIfAborted()
        await requireDocumentParticipant(ctx).participateTransaction(tx, documents =>
          assertTimelineExtensionLease({ narratives: ctx.narratives?.transaction(tx) }, documents, lease),
        { allowEmpty: true })
      }, work),
    }
  } catch (error) {
    dispose()
    throw error
  }
}

export async function runTimelineExtensionWork<T>(
  ctx: Pick<ApplicationRuntimeContext, 'documents' | 'narratives' | 'dataEngine' | 'swipes'>,
  input: { timelineId: string; branchId?: string; installationId: string; packageVersion?: string; signal?: AbortSignal },
  work: (execution: { lease: TimelineExtensionLease; signal: AbortSignal;
    narrativeSource: NonNullable<import('@loom-studio/extension-sdk').ExtensionTimelineExecution['narrativeSource']>;
    assertNarrativeSource(): Promise<void>; withNarrativeWrite<TValue>(work: () => TValue): TValue }) => Promise<T>,
): Promise<T> {
  const branchId = input.branchId ?? (await ctx.narratives?.getTimeline(input.timelineId))?.activeBranchId
  if (!branchId) throw new Error('Timeline work requires an existing Narrative Branch')
  const source = await captureNarrativeExecutionSource(ctx, { timelineId: input.timelineId, branchId })
  const narrativeSource = Object.freeze({
    timelineId: source.timelineId, branchId: source.branchId, nodeId: source.nodeId,
    groupId: source.groupId, candidateId: source.candidateId, generation: source.generation,
  })
  const scope = await beginTimelineExtensionWork(ctx, input)
  try {
    const result = await scope.run(() => work({
      lease: scope.lease, signal: scope.signal, narrativeSource,
      assertNarrativeSource: () => assertNarrativeExecutionSource(ctx, source),
      withNarrativeWrite: callback => guardNarrativeWrite(ctx, source, callback),
    }))
    scope.signal.throwIfAborted()
    await assertTimelineExtensionLease(ctx, ctx.documents, scope.lease)
    return result
  } finally {
    scope.dispose()
  }
}
