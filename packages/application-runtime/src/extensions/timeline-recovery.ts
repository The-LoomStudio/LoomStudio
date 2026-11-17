import { isDeepStrictEqual } from 'node:util'
import type { DocumentTransaction } from '@loom-studio/kernel/document-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { readDocument, writeDocument } from '../foundation/document-store.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { timelineRuntimeContextId } from '../narrative/timeline-runtime-context.js'
import { narrativeWriteContext, requireDocumentParticipant } from '../runtime/context.js'
import {
  readTimelineExtensionParticipation,
  requireTimelineExtensionInstallation,
  timelineExtensionParticipationId,
} from './timeline-participation.js'
import type {
  RecoverTimelineExtensionInput,
  RuntimeRequestContext,
  TimelineExtensionRecoveryPreview,
  TimelineExtensionParticipationContent,
  TimelineRuntimeContextContent,
} from '../types.js'

type Context = Pick<ApplicationRuntimeContext, 'dataEngine' | 'documents' | 'narratives' | 'createId' | 'stateContributions'>
type Target = { timelineId: string; installationId: string }

async function readRecovery(
  ctx: Parameters<typeof requireTimelineExtensionInstallation>[0] & Pick<Context, 'stateContributions'>,
  documents: DocumentTransaction,
  input: Target,
) {
  const installation = await requireTimelineExtensionInstallation(ctx, documents, input.timelineId, input.installationId)
  if (installation.content.participation !== 'timeline') throw new Error('Extension no longer declares Timeline participation')
  const config = await readTimelineExtensionParticipation(documents, input.timelineId)
  const entry = config.entries.find(candidate => candidate.installationId === input.installationId)
  if (!entry) throw new Error('Extension has not been adopted by this Timeline')
  if (entry.packageId !== installation.content.packageId) throw new Error('Extension recovery identity mismatch')
  if (!entry.source || !installation.content.source) throw new Error('Extension recovery requires an accepted installation source')
  // ponytail: recovery accepts the same declared package version; cross-version data migration needs an explicit extension migration contract.
  if (entry.packageVersion !== installation.content.packageVersion) {
    throw new Error('Extension package version changed; data compatibility review or migration is required')
  }
  if (entry.installationVersion === installation.version) throw new Error('Installation has not changed; use pause or resume')
  const runtime = await readDocument<TimelineRuntimeContextContent>(
    documents, timelineRuntimeContextId(input.timelineId), applicationDocumentTypes.timelineRuntimeContext,
  )
  const accepted = runtime.content.stateContributionSources
    .filter(source => source.installationId === input.installationId)
    .sort((left, right) => left.contributionId.localeCompare(right.contributionId))
  const registered = ctx.stateContributions.list().filter(source => source.installationId === input.installationId)
    .sort((left, right) => left.contributionId.localeCompare(right.contributionId))
    .map(source => ({
      installationId: source.installationId, contributionId: source.contributionId,
      packageId: source.packageId, packageVersion: source.packageVersion, moduleId: source.moduleId,
      declaration: source.contribution,
    }))
  // Match the persisted JSON representation; optional JS properties may be explicitly undefined.
  if (!isDeepStrictEqual(accepted, JSON.parse(JSON.stringify(registered)))) {
    throw new Error('Extension State declarations changed or are unavailable; compatibility review or migration is required')
  }
  const preview: TimelineExtensionRecoveryPreview = {
    ...input,
    expectedVersion: config.version,
    expectedInstallationVersion: installation.version,
    packageId: entry.packageId,
    packageVersion: entry.packageVersion,
    previousSource: structuredClone(entry.source),
    source: structuredClone(installation.content.source),
    sourceChanged: !isDeepStrictEqual(entry.source, installation.content.source),
  }
  return { config, entry, installation, preview }
}

export function createTimelineExtensionRecoveryMethods(ctx: Context) {
  return {
    previewTimelineExtensionRecovery: async (input: Target): Promise<TimelineExtensionRecoveryPreview> =>
      (await readRecovery(ctx, ctx.documents, input)).preview,

    recoverTimelineExtension: async (input: RecoverTimelineExtensionInput, requestContext?: RuntimeRequestContext) => {
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.recoverTimelineExtension'),
        dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
          if (!ctx.narratives) throw new Error('Narrative Store is not configured')
          const { config, entry, installation, preview } = await readRecovery(
            { narratives: ctx.narratives.transaction(dataTx), stateContributions: ctx.stateContributions }, documents, input,
          )
          if (config.version !== input.expectedVersion || installation.version !== input.expectedInstallationVersion) {
            throw new Error('Extension recovery preview is stale')
          }
          if (preview.sourceChanged && input.acceptSourceChange !== true) {
            throw new Error('Extension source changed; explicit source replacement confirmation is required')
          }
          entry.source = preview.source
          entry.installationVersion = installation.version
          entry.enabled = true
          entry.generation = ctx.createId('extension-participation')
          const written = await writeDocument<TimelineExtensionParticipationContent>(documents, {
            id: timelineExtensionParticipationId(input.timelineId),
            type: applicationDocumentTypes.timelineExtensionParticipation,
            content: { timelineId: config.timelineId, entries: config.entries },
            expectedVersion: config.version,
          })
          return { ...written.content, version: written.version }
        }),
      )
      return { participation: result.value.value, mutation: { changesetId: result.commit.changesetId } }
    },
  }
}
