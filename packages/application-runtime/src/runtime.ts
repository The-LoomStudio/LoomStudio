import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import {
  assertModelProfileExists,
  assertNonEmpty,
  assertProviderAccountExists,
  readAgentBinding,
  readAgentTranscriptForNarrativePath,
  writeAgentTranscriptEntry,
} from './agent.js'
import {
  cardToSnapshot,
  normalizeCardContent,
  normalizeOpening,
  normalizeOptionalString,
  normalizePreset,
  normalizeSettingLayer,
  readOpeningEntries,
  toCardSource,
} from './card.js'
import { createApplicationRuntimeContext, type ApplicationRuntimeContext } from './application-context.js'
import { applicationDocumentTypes } from './document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from './document-store.js'
import { buildOpenAIChatPayload, type OpenAIChatPayload } from './provider-payload.js'
import { composePromptBuildForInput } from './prompt.js'
import { assertSameSession, findBranchContainingEntry, readBranchPath, readSessionBranch } from './timeline.js'
import {
  createPromptAsset,
  deletePromptAsset,
  exportWorkspaceArtifact,
  getPromptWorkspace,
  importWorkspaceArtifact,
  listPromptWorkspaces,
  movePromptAsset,
  updateProjectionOrderProfile,
  updatePromptAsset,
} from './workspace.js'
import type {
  AgentRuntimeProfileContent,
  ApplicationRuntime,
  ApplicationRuntimeOptions,
  BranchStateSnapshotContent,
  CardSourceContent,
  CommitCandidateContent,
  CreateSessionResult,
  ModelProfileContent,
  NarrativeBranchContent,
  NarrativeEntryContent,
  ProviderAccountContent,
  ProviderMessage,
  RunContent,
  RuntimeEntryContent,
  SessionContent,
} from './types.js'

export function createApplicationRuntime(options: ApplicationRuntimeOptions): ApplicationRuntime {
  const ctx = createApplicationRuntimeContext(options)

  return {
    createCard: async input => {
      if (input.name.trim().length === 0) {
        throw new Error('createCard name cannot be empty')
      }

      const timestamp = ctx.now()
      const card = await writeDocument<CardSourceContent>(ctx.documents, {
        id: ctx.createId('card'),
        type: applicationDocumentTypes.cardSource,
        content: {
          name: input.name,
          userName: normalizeOptionalString(input.userName),
          description: input.description,
          preset: normalizePreset(input.preset),
          opening: normalizeOpening(input.opening),
          settingLayer: normalizeSettingLayer(input.settingLayer, input.setting),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return {
        card: toCardSource(card),
      }
    },

    getCard: async input => {
      const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      return {
        card: toCardSource(card),
      }
    },

    listCards: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.cardSource,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        cards: result.items.map(card => toCardSource(card as never)),
        nextCursor: result.nextCursor,
      }
    },

    updateCard: async input => {
      const existing = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      if (input.name !== undefined && input.name.trim().length === 0) {
        throw new Error('updateCard name cannot be empty')
      }
      const timestamp = ctx.now()
      const updated = await writeDocument<CardSourceContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.cardSource,
        content: normalizeCardContent({
          ...existing.content,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.userName !== undefined ? { userName: normalizeOptionalString(input.userName) } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.preset !== undefined ? { preset: normalizePreset(input.preset) } : {}),
          ...(input.opening !== undefined ? { opening: normalizeOpening(input.opening) } : {}),
          ...(input.settingLayer !== undefined ? { settingLayer: normalizeSettingLayer(input.settingLayer, undefined) } : {}),
          updatedAt: timestamp,
        }),
        expectedVersion: existing.version,
      })

      return { card: toCardSource(updated) }
    },

    deleteCard: async input => {
      await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      await ctx.documents.delete({ id: input.cardId })
      return { deleted: true as const }
    },

    createProviderAccount: async input => {
      assertNonEmpty(input.providerExtensionId, 'providerExtensionId')
      assertNonEmpty(input.displayName, 'displayName')

      const timestamp = ctx.now()
      const providerAccount = await writeDocument<ProviderAccountContent>(ctx.documents, {
        id: ctx.createId('provider-account'),
        type: applicationDocumentTypes.providerAccount,
        content: {
          providerExtensionId: input.providerExtensionId,
          displayName: input.displayName,
          config: input.config ?? {},
          secretRefs: input.secretRefs ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { providerAccount: toVersioned(providerAccount) }
    },

    getProviderAccount: async input => {
      const providerAccount = await readDocument<ProviderAccountContent>(ctx.documents, input.providerAccountId, applicationDocumentTypes.providerAccount)
      return { providerAccount: redactProviderAccount(toVersioned(providerAccount)) }
    },

    listProviderAccounts: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.providerAccount,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        providerAccounts: result.items.map(providerAccount => redactProviderAccount(toVersioned(providerAccount as never))),
        nextCursor: result.nextCursor,
      }
    },

    createModelProfile: async input => {
      assertNonEmpty(input.providerAccountId, 'providerAccountId')
      assertNonEmpty(input.displayName, 'displayName')
      assertNonEmpty(input.providerModelId, 'providerModelId')
      await assertProviderAccountExists(ctx.documents, input.providerAccountId)

      const timestamp = ctx.now()
      const modelProfile = await writeDocument<ModelProfileContent>(ctx.documents, {
        id: ctx.createId('model-profile'),
        type: applicationDocumentTypes.modelProfile,
        content: {
          providerAccountId: input.providerAccountId,
          capability: input.capability ?? 'chat.completion',
          displayName: input.displayName,
          providerModelId: input.providerModelId,
          config: input.config ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { modelProfile: toVersioned(modelProfile) }
    },

    getModelProfile: async input => {
      const modelProfile = await readDocument<ModelProfileContent>(ctx.documents, input.modelProfileId, applicationDocumentTypes.modelProfile)
      return { modelProfile: toVersioned(modelProfile) }
    },

    listModelProfiles: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.modelProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })
      const modelProfiles = (result.items as Array<DocumentRecord<ModelProfileContent>>)
        .map(toVersioned)
        .filter(modelProfile => !input?.providerAccountId || modelProfile.providerAccountId === input.providerAccountId)

      return {
        modelProfiles,
        nextCursor: result.nextCursor,
      }
    },

    createAgentRuntimeProfile: async input => {
      assertNonEmpty(input.name, 'name')
      if (input.modelProfileId) {
        await assertModelProfileExists(ctx.documents, input.modelProfileId)
      }

      const timestamp = ctx.now()
      const agentRuntimeProfile = await writeDocument<AgentRuntimeProfileContent>(ctx.documents, {
        id: ctx.createId('agent-runtime-profile'),
        type: applicationDocumentTypes.agentRuntimeProfile,
        content: {
          name: input.name,
          purpose: input.purpose ?? 'narrative',
          presetId: input.presetId,
          modelProfileId: input.modelProfileId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { agentRuntimeProfile: toVersioned(agentRuntimeProfile) }
    },

    getAgentRuntimeProfile: async input => {
      const agentRuntimeProfile = await readDocument<AgentRuntimeProfileContent>(ctx.documents, input.agentRuntimeProfileId, applicationDocumentTypes.agentRuntimeProfile)
      return { agentRuntimeProfile: toVersioned(agentRuntimeProfile) }
    },

    listAgentRuntimeProfiles: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.agentRuntimeProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        agentRuntimeProfiles: result.items.map(agentRuntimeProfile => toVersioned(agentRuntimeProfile as never)),
        nextCursor: result.nextCursor,
      }
    },

    updateProviderAccount: async input => {
      const existing = await readDocument<ProviderAccountContent>(ctx.documents, input.providerAccountId, applicationDocumentTypes.providerAccount)
      const timestamp = ctx.now()
      const updated = await writeDocument<ProviderAccountContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.providerAccount,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          ...(input.secretRefs !== undefined ? { secretRefs: input.secretRefs } : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { providerAccount: redactProviderAccount(toVersioned(updated)) }
    },

    deleteProviderAccount: async input => {
      await readDocument<ProviderAccountContent>(ctx.documents, input.providerAccountId, applicationDocumentTypes.providerAccount)
      await ctx.documents.delete({ id: input.providerAccountId })
      return { deleted: true as const }
    },

    updateModelProfile: async input => {
      const existing = await readDocument<ModelProfileContent>(ctx.documents, input.modelProfileId, applicationDocumentTypes.modelProfile)
      const timestamp = ctx.now()
      const updated = await writeDocument<ModelProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.modelProfile,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.providerModelId !== undefined ? { providerModelId: input.providerModelId } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { modelProfile: toVersioned(updated) }
    },

    deleteModelProfile: async input => {
      await readDocument<ModelProfileContent>(ctx.documents, input.modelProfileId, applicationDocumentTypes.modelProfile)
      await ctx.documents.delete({ id: input.modelProfileId })
      return { deleted: true as const }
    },

    pingModelProfile: async input => {
      const result = await ctx.gateway.invokeChat({
        request: {
          messages: [{ role: 'user', content: input.text ?? 'hi' }],
        },
        modelProfileId: input.modelProfileId,
        runId: ctx.createId('run'),
        sessionId: ctx.createId('session'),
        branchId: ctx.createId('branch'),
      })

      return {
        text: result.text,
        provider: result.provider,
        model: result.model,
        raw: result.raw,
      }
    },

    updateAgentRuntimeProfile: async input => {
      const existing = await readDocument<AgentRuntimeProfileContent>(ctx.documents, input.agentRuntimeProfileId, applicationDocumentTypes.agentRuntimeProfile)
      if (input.modelProfileId) {
        await assertModelProfileExists(ctx.documents, input.modelProfileId)
      }
      const timestamp = ctx.now()
      const updated = await writeDocument<AgentRuntimeProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.agentRuntimeProfile,
        content: {
          ...existing.content,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
          ...(input.modelProfileId !== undefined ? { modelProfileId: input.modelProfileId } : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { agentRuntimeProfile: toVersioned(updated) }
    },

    deleteAgentRuntimeProfile: async input => {
      await readDocument<AgentRuntimeProfileContent>(ctx.documents, input.agentRuntimeProfileId, applicationDocumentTypes.agentRuntimeProfile)
      await ctx.documents.delete({ id: input.agentRuntimeProfileId })
      return { deleted: true as const }
    },

    createSession: async input => {
      await readAgentBinding({
        documents: ctx.documents,
        agentRuntimeProfileId: input.agentRuntimeProfileId,
      })

      return await createSessionDocuments({
        createId: ctx.createId,
        documents: ctx.documents,
        timestamp: ctx.now(),
        cardSourceVersionId: input.cardSourceVersionId,
        cardSnapshot: input.cardSnapshot ?? {},
        agentRuntimeProfileId: input.agentRuntimeProfileId,
        title: input.title,
        workspaceId: input.workspaceId,
      })
    },

    createSessionFromCard: async input => {
      await readAgentBinding({
        documents: ctx.documents,
        agentRuntimeProfileId: input.agentRuntimeProfileId,
      })

      const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      const cardContent = normalizeCardContent(card.content)

      return await createSessionDocuments({
        createId: ctx.createId,
        documents: ctx.documents,
        timestamp: ctx.now(),
        cardSourceVersionId: `${card.id}@${card.version}`,
        cardSnapshot: cardToSnapshot(card),
        agentRuntimeProfileId: input.agentRuntimeProfileId,
        title: input.title ?? cardContent.name,
        workspaceId: input.workspaceId,
      })
    },

    importWorkspaceArtifact: async input => {
      return await importWorkspaceArtifact({
        artifact: input.artifact,
        documents: ctx.documents,
        now: ctx.now(),
        workspaceId: input.workspaceId,
      })
    },

    getPromptWorkspace: async input => {
      return {
        workspace: await getPromptWorkspace({
          documents: ctx.documents,
          workspaceId: input.workspaceId,
        }),
      }
    },

    listPromptWorkspaces: async input => {
      return await listPromptWorkspaces({
        documents: ctx.documents,
        cardId: input?.cardId,
        cursor: input?.cursor,
        limit: input?.limit,
      })
    },

    createPromptAsset: async input => {
      return {
        workspace: await createPromptAsset({
          asset: input.asset,
          documents: ctx.documents,
          now: ctx.now(),
          position: input.position,
          targetAssetId: input.targetAssetId,
          workspaceId: input.workspaceId,
        }),
      }
    },

    updatePromptAsset: async input => {
      return {
        workspace: await updatePromptAsset({
          assetId: input.assetId,
          body: input.body,
          capabilities: input.capabilities,
          documents: ctx.documents,
          enabled: input.enabled,
          label: input.label,
          meta: input.meta,
          now: ctx.now(),
          workspaceId: input.workspaceId,
        }),
      }
    },

    movePromptAsset: async input => {
      return {
        workspace: await movePromptAsset({
          assetId: input.assetId,
          documents: ctx.documents,
          now: ctx.now(),
          position: input.position,
          targetAssetId: input.targetAssetId,
          workspaceId: input.workspaceId,
        }),
      }
    },

    deletePromptAsset: async input => {
      return {
        workspace: await deletePromptAsset({
          assetId: input.assetId,
          documents: ctx.documents,
          now: ctx.now(),
          workspaceId: input.workspaceId,
        }),
      }
    },

    updateProjectionOrderProfile: async input => {
      return {
        workspace: await updateProjectionOrderProfile({
          documents: ctx.documents,
          now: ctx.now(),
          orderList: input.orderList,
          orderNodeId: input.orderNodeId,
          projectionOrderProfile: input.projectionOrderProfile,
          workspaceId: input.workspaceId,
        }),
      }
    },

    exportWorkspaceArtifact: async input => {
      return {
        artifact: await exportWorkspaceArtifact({
          documents: ctx.documents,
          workspaceId: input.workspaceId,
        }),
      }
    },

    previewPrompt: async input => {
      if (input.input.trim().length === 0) {
        throw new Error('previewPrompt input cannot be empty')
      }

      const { session, branch } = await readSessionBranch(ctx.documents, input.sessionId, input.branchId)
      const agentBinding = await readAgentBinding({
        documents: ctx.documents,
        agentRuntimeProfileId: input.agentRuntimeProfileId ?? session.content.agentRuntimeProfileId,
      })

      const promptBuild = await composePromptBuildForInput(
        ctx.documents,
        session,
        branch,
        input.input,
        input.projectionOrderProfile,
        input.workspaceId ?? session.content.workspaceId,
        input.activationFacts,
      )

      return {
        session: toVersioned(session),
        branch: toVersioned(branch),
        messages: promptBuild.messages,
        promptBuildTrace: promptBuild.trace as unknown as JsonValue,
        providerPayloadPreview: await buildProviderPayloadPreview({
          documents: ctx.documents,
          messages: promptBuild.messages,
          modelProfile: agentBinding.modelProfile,
        }),
        projection: promptBuild.projection,
      }
    },

    submitTurn: async input => {
      if (input.input.trim().length === 0) {
        throw new Error('submitTurn input cannot be empty')
      }

      const { session, branch } = await readSessionBranch(ctx.documents, input.sessionId, input.branchId)
      const agentRuntimeProfileId = input.agentRuntimeProfileId ?? session.content.agentRuntimeProfileId
      const agentBinding = await readAgentBinding({
        documents: ctx.documents,
        agentRuntimeProfileId,
      })

      const timestamp = ctx.now()
      const runId = ctx.createId('run')
      const userEntryId = ctx.createId('entry')
      const assistantEntryId = ctx.createId('entry')
      const commitCandidateId = ctx.createId('commit')
      const stateSnapshotId = ctx.createId('snapshot')
      const promptBuild = await composePromptBuildForInput(
        ctx.documents,
        session,
        branch,
        input.input,
        input.projectionOrderProfile,
        input.workspaceId ?? session.content.workspaceId,
        input.activationFacts,
      )
      const prompt = promptBuild.messages
      const providerPayloadPreview = await buildProviderPayloadPreview({
        documents: ctx.documents,
        messages: prompt,
        modelProfile: agentBinding.modelProfile,
      })
      const providerResult = await ctx.gateway.invokeChat({
        request: {
          messages: prompt,
          metadata: {
            purpose: 'narrative',
            sessionId: session.id,
            branchId: branch.id,
            runId,
            ...(agentBinding.agentRuntimeProfile ? { agentRuntimeProfileId: agentBinding.agentRuntimeProfile.id } : {}),
            ...(agentBinding.modelProfile ? { modelProfileId: agentBinding.modelProfile.id } : {}),
          },
        },
        modelProfileId: agentBinding.modelProfile?.id,
        runId,
        sessionId: session.id,
        branchId: branch.id,
      })

      return await ctx.documents.transact(async tx => {
        const run = await writeDocument<RunContent>(tx, {
          id: runId,
          type: applicationDocumentTypes.run,
          content: {
            sessionId: session.id,
            branchId: branch.id,
            agentRuntimeProfileId: agentBinding.agentRuntimeProfile?.id,
            modelProfileId: agentBinding.modelProfile?.id,
            status: 'running',
            checkpointEntryId: branch.content.headEntryId,
            input: input.input,
            intent: input.intent ?? 'rp',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })
        const userEntry = await writeDocument<NarrativeEntryContent>(tx, {
          id: userEntryId,
          type: applicationDocumentTypes.narrativeEntry,
          content: {
            sessionId: session.id,
            branchId: branch.id,
            parentEntryId: branch.content.headEntryId,
            runId: run.id,
            role: 'user',
            content: input.input,
            status: 'accepted',
            intent: input.intent ?? 'rp',
            createdAt: timestamp,
          },
          expectedVersion: 'new',
        })
        const userTranscriptEntry = await writeAgentTranscriptEntry({
          documents: tx,
          timestamp,
          narrativeEntry: userEntry,
          parentNarrativeEntryId: branch.content.headEntryId,
        })
        await writeDocument<RuntimeEntryContent>(tx, {
          id: ctx.createId('rtentry'),
          type: applicationDocumentTypes.runtimeEntry,
          content: {
            sessionId: session.id,
            branchId: branch.id,
            runId: run.id,
            narrativeEntryId: userEntry.id,
            kind: 'user_input',
            content: { text: input.input, intent: input.intent ?? 'rp' },
            createdAt: timestamp,
          },
          expectedVersion: 'new',
        })
        await writeDocument<RuntimeEntryContent>(tx, {
          id: ctx.createId('rtentry'),
          type: applicationDocumentTypes.runtimeEntry,
          content: {
            sessionId: session.id,
            branchId: branch.id,
            runId: run.id,
            kind: 'prompt',
            content: {
              messages: prompt,
              promptBuildTrace: promptBuild.trace as unknown as JsonValue,
              ...(providerPayloadPreview ? { providerPayloadPreview: providerPayloadPreview as unknown as JsonValue } : {}),
              projection: promptBuild.projection as unknown as JsonValue,
            },
            createdAt: ctx.now(),
          },
          expectedVersion: 'new',
        })
        const providerResultEntry = await writeDocument<RuntimeEntryContent>(tx, {
          id: ctx.createId('rtentry'),
          type: applicationDocumentTypes.runtimeEntry,
          content: {
            sessionId: session.id,
            branchId: branch.id,
            runId: run.id,
            kind: 'provider_result',
            content: providerResult as unknown as JsonValue,
            createdAt: ctx.now(),
          },
          expectedVersion: 'new',
        })
        const commitCandidate = await writeDocument<CommitCandidateContent>(tx, {
          id: commitCandidateId,
          type: applicationDocumentTypes.commitCandidate,
          content: {
            sessionId: session.id,
            branchId: branch.id,
            runId: run.id,
            providerResultEntryId: providerResultEntry.id,
            content: providerResult.text,
            status: 'auto_accepted',
            createdAt: ctx.now(),
            updatedAt: ctx.now(),
          },
          expectedVersion: 'new',
        })
        const assistantEntry = await writeDocument<NarrativeEntryContent>(tx, {
          id: assistantEntryId,
          type: applicationDocumentTypes.narrativeEntry,
          content: {
            sessionId: session.id,
            branchId: branch.id,
            parentEntryId: userEntry.id,
            runId: run.id,
            role: 'assistant',
            content: providerResult.text,
            status: 'accepted',
            createdAt: ctx.now(),
          },
          expectedVersion: 'new',
        })
        await writeAgentTranscriptEntry({
          documents: tx,
          timestamp: ctx.now(),
          narrativeEntry: assistantEntry,
          parentTranscriptEntryId: userTranscriptEntry.id,
        })
        const acceptedCommitCandidate = await writeDocument<CommitCandidateContent>(tx, {
          id: commitCandidate.id,
          type: applicationDocumentTypes.commitCandidate,
          content: {
            ...commitCandidate.content,
            acceptedEntryId: assistantEntry.id,
            updatedAt: ctx.now(),
          },
          expectedVersion: commitCandidate.version,
        })
        const stateSnapshot = await writeDocument<BranchStateSnapshotContent>(tx, {
          id: stateSnapshotId,
          type: applicationDocumentTypes.branchStateSnapshot,
          content: {
            sessionId: session.id,
            branchId: branch.id,
            runId: run.id,
            fromEntryId: branch.content.headEntryId,
            headEntryId: assistantEntry.id,
            patch: {},
            createdAt: ctx.now(),
          },
          expectedVersion: 'new',
        })
        const updatedBranch = await writeDocument<NarrativeBranchContent>(tx, {
          id: branch.id,
          type: applicationDocumentTypes.narrativeBranch,
          content: {
            ...branch.content,
            headEntryId: assistantEntry.id,
            updatedAt: ctx.now(),
          },
          expectedVersion: branch.version,
        })
        const completedRun = await writeDocument<RunContent>(tx, {
          id: run.id,
          type: applicationDocumentTypes.run,
          content: {
            ...run.content,
            status: 'completed',
            provider: providerResult.provider,
            model: providerResult.model,
            acceptedEntryId: assistantEntry.id,
            commitCandidateId: acceptedCommitCandidate.id,
            stateSnapshotId: stateSnapshot.id,
            updatedAt: ctx.now(),
          },
          expectedVersion: run.version,
        })

        return {
          run: toVersioned(completedRun),
          branch: toVersioned(updatedBranch),
          entries: {
            user: toVersioned(userEntry),
            assistant: toVersioned(assistantEntry),
          },
          commitCandidate: toVersioned(acceptedCommitCandidate),
          stateSnapshot: toVersioned(stateSnapshot),
        }
      })
    },

    getSession: async input => {
      const session = await readDocument<SessionContent>(ctx.documents, input.sessionId, applicationDocumentTypes.session)
      const branches = await listDocuments<NarrativeBranchContent>(ctx.documents, applicationDocumentTypes.narrativeBranch)

      return {
        session: toVersioned(session),
        branches: branches.filter(branch => branch.content.sessionId === session.id).map(toVersioned),
      }
    },

    getTimeline: async input => {
      const session = await readDocument<SessionContent>(ctx.documents, input.sessionId, applicationDocumentTypes.session)
      const branch = await readDocument<NarrativeBranchContent>(ctx.documents, input.branchId ?? session.content.activeBranchId, applicationDocumentTypes.narrativeBranch)
      assertSameSession(session.id, branch.content.sessionId)

      return {
        session: toVersioned(session),
        branch: toVersioned(branch),
        entries: await readBranchPath(ctx.documents, session.id, branch.content.headEntryId),
      }
    },

    getAgentTranscript: async input => {
      const session = await readDocument<SessionContent>(ctx.documents, input.sessionId, applicationDocumentTypes.session)
      const branch = await readDocument<NarrativeBranchContent>(ctx.documents, input.branchId ?? session.content.activeBranchId, applicationDocumentTypes.narrativeBranch)
      assertSameSession(session.id, branch.content.sessionId)
      const narrativeEntries = await readBranchPath(ctx.documents, session.id, branch.content.headEntryId)

      return {
        session: toVersioned(session),
        branch: toVersioned(branch),
        entries: await readAgentTranscriptForNarrativePath({
          documents: ctx.documents,
          sessionId: session.id,
          narrativeEntries,
        }),
      }
    },

    getRun: async input => {
      const run = await readDocument<RunContent>(ctx.documents, input.runId, applicationDocumentTypes.run)
      const runtimeEntries = await listDocuments<RuntimeEntryContent>(ctx.documents, applicationDocumentTypes.runtimeEntry)
      const commitCandidates = await listDocuments<CommitCandidateContent>(ctx.documents, applicationDocumentTypes.commitCandidate)

      return {
        run: toVersioned(run),
        runtimeEntries: runtimeEntries.filter(entry => entry.content.runId === run.id).map(toVersioned),
        commitCandidates: commitCandidates.filter(candidate => candidate.content.runId === run.id).map(toVersioned),
      }
    },

    forkBranch: async input => {
      const session = await readDocument<SessionContent>(ctx.documents, input.sessionId, applicationDocumentTypes.session)
      const parentBranch = input.fromEntryId ? await findBranchContainingEntry(ctx.documents, session.id, input.fromEntryId) : undefined
      const timestamp = ctx.now()

      return await ctx.documents.transact(async tx => {
        const branch = await writeDocument<NarrativeBranchContent>(tx, {
          id: ctx.createId('branch'),
          type: applicationDocumentTypes.narrativeBranch,
          content: {
            sessionId: session.id,
            title: input.title,
            parentBranchId: parentBranch?.id,
            forkedFromEntryId: input.fromEntryId ?? undefined,
            headEntryId: input.fromEntryId ?? undefined,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })
        const updatedSession = await writeDocument<SessionContent>(tx, {
          id: session.id,
          type: applicationDocumentTypes.session,
          content: {
            ...session.content,
            activeBranchId: branch.id,
            updatedAt: timestamp,
          },
          expectedVersion: session.version,
        })

        return {
          branch: toVersioned(branch),
          session: toVersioned(updatedSession),
        }
      })
    },
  }
}

async function createSessionDocuments(input: {
  createId: ApplicationRuntimeContext['createId']
  documents: DocumentStore
  timestamp: string
  cardSourceVersionId: string
  cardSnapshot: JsonObject
  agentRuntimeProfileId?: string
  title?: string
  workspaceId?: string
}): Promise<CreateSessionResult> {
  const branchId = input.createId('branch')
  const openingEntries = readOpeningEntries(input.cardSnapshot)

  return await input.documents.transact(async tx => {
    const session = await writeDocument<SessionContent>(tx, {
      id: input.createId('session'),
      type: applicationDocumentTypes.session,
      content: {
        cardSourceVersionId: input.cardSourceVersionId,
        cardSnapshot: input.cardSnapshot,
        agentRuntimeProfileId: input.agentRuntimeProfileId,
        workspaceId: input.workspaceId,
        title: input.title,
        activeBranchId: branchId,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      },
      expectedVersion: 'new',
    })
    let headEntryId: string | undefined
    let headTranscriptEntryId: string | undefined

    for (const entry of openingEntries) {
      const narrativeEntry = await writeDocument<NarrativeEntryContent>(tx, {
        id: input.createId('entry'),
        type: applicationDocumentTypes.narrativeEntry,
        content: {
          sessionId: session.id,
          branchId,
          parentEntryId: headEntryId,
          role: entry.role,
          content: entry.content,
          status: 'accepted',
          intent: 'rp',
          createdAt: input.timestamp,
        },
        expectedVersion: 'new',
      })
      const transcriptEntry = await writeAgentTranscriptEntry({
        documents: tx,
        timestamp: input.timestamp,
        narrativeEntry,
        parentTranscriptEntryId: headTranscriptEntryId,
      })
      headEntryId = narrativeEntry.id
      headTranscriptEntryId = transcriptEntry.id
    }

    const branch = await writeDocument<NarrativeBranchContent>(tx, {
      id: branchId,
      type: applicationDocumentTypes.narrativeBranch,
      content: {
        sessionId: session.id,
        title: input.title ?? 'Main',
        headEntryId,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      },
      expectedVersion: 'new',
    })

    return {
      session: toVersioned(session),
      branch: toVersioned(branch),
    }
  })
}

function redactProviderAccount<T extends { secretRefs: Record<string, string> }>(account: T): T {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(account.secretRefs)) {
    if (value.startsWith('env:')) {
      redacted[key] = value
    } else {
      redacted[key] = value.startsWith('plain:') ? 'plain:***' : '***'
    }
  }
  return { ...account, secretRefs: redacted }
}

async function buildProviderPayloadPreview(input: {
  documents: DocumentStore
  messages: ProviderMessage[]
  modelProfile?: DocumentRecord<ModelProfileContent>
}): Promise<OpenAIChatPayload | undefined> {
  if (!input.modelProfile) return undefined

  const providerAccount = await readDocument<ProviderAccountContent>(
    input.documents,
    input.modelProfile.content.providerAccountId,
    applicationDocumentTypes.providerAccount,
  )
  const providerExtensionId = providerAccount.content.providerExtensionId
  if (providerExtensionId !== 'official.openai-compatible' && providerExtensionId !== 'openai-compatible') {
    return undefined
  }

  return buildOpenAIChatPayload({
    messages: input.messages,
    modelProfile: {
      id: input.modelProfile.id,
      providerAccountId: input.modelProfile.content.providerAccountId,
      capability: input.modelProfile.content.capability,
      displayName: input.modelProfile.content.displayName,
      providerModelId: input.modelProfile.content.providerModelId,
      config: input.modelProfile.content.config,
    },
  })
}
