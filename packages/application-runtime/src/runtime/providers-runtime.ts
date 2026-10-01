import type { DocumentRecord } from '@loom-studio/document-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { assertNonEmpty, assertProviderModelExists } from '../agents/agent.js'
import type {
  AiCapabilityProfileContent,
  AiCapabilityProfileView,
  CreateAiCapabilityProfileInput,
  CreateAiCapabilityProfileResult,
  CreateProviderProfileInput,
  CreateProviderProfileResult,
  DeleteAiCapabilityProfileInput,
  DeleteAiCapabilityProfileResult,
  DeleteProviderProfileInput,
  DeleteProviderProfileResult,
  GetAiCapabilityProfileInput,
  GetAiCapabilityProfileResult,
  GetProviderProfileInput,
  GetProviderProfileResult,
  ListAiCapabilityProfilesInput,
  ListAiCapabilityProfilesResult,
  ListProviderModelsInput,
  ListProviderModelsResult,
  ListProviderProfilesInput,
  ListProviderProfilesResult,
  PingProviderModelInput,
  PingProviderModelResult,
  ProviderProfileContent,
  ProviderProfileView,
  ReplaceProviderCredentialInput,
  ReplaceProviderCredentialResult,
  RuntimeRequestContext,
  UpdateAiCapabilityProfileInput,
  UpdateAiCapabilityProfileResult,
  UpdateProviderProfileInput,
  UpdateProviderProfileResult,
} from '../types.js'
import {
  promptResourceWriteContext,
  requireAiCapabilities,
  requireSecrets,
  secretWriteContext,
} from './context.js'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
export { officialFakeModelId } from '@loom-studio/ai-gateway'

type ProvidersRuntimeContext = Pick<ApplicationRuntimeContext,
  'aiCapabilities' | 'createId' | 'documents' | 'gateway' | 'now' | 'providerAdapters' | 'secrets'
>

export function createProvidersRuntimeMethods(ctx: ProvidersRuntimeContext) {
  return {
    createProviderProfile: async (input: CreateProviderProfileInput, requestContext?: RuntimeRequestContext): Promise<CreateProviderProfileResult> => {
      assertNonEmpty(input.providerExtensionId, 'providerExtensionId')
      assertNonEmpty(input.displayName, 'displayName')
      const providerConfig = ctx.providerAdapters.validateAccountConfig(input.providerExtensionId, input.config ?? {})
      const providerCredential = input.credential
        ? ctx.providerAdapters.validateCredential(input.providerExtensionId, input.credential)
        : undefined
      const id = ctx.createId('provider-profile')
      const timestamp = ctx.now()
      const enabledModelIds = normalizeProviderModelIds(input.providerExtensionId, input.enabledModelIds)
      const secret = providerCredential
        ? await requireSecrets(ctx).create({
            ...secretWriteContext(requestContext, 'application.createProviderProfile.credential'),
            owner: { type: 'provider-profile', id },
            purpose: 'provider.credentials',
            label: input.displayName,
            plaintext: { values: providerCredential },
          })
        : undefined
      let providerProfile
      try {
        providerProfile = await writeDocument<ProviderProfileContent>(ctx.documents, {
          ...promptResourceWriteContext(requestContext),
          reason: 'application.createProviderProfile',
          id,
          type: applicationDocumentTypes.providerProfile,
          content: {
            providerExtensionId: input.providerExtensionId,
            displayName: input.displayName,
            config: providerConfig,
            enabledModelIds,
            ...(secret ? { secretRef: secret.metadata.ref } : {}),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })
      } catch (error) {
        if (secret) {
          await requireSecrets(ctx).delete({
            ...secretWriteContext(requestContext, 'application.createProviderProfile.rollback'),
            ref: secret.metadata.ref,
            owner: { type: 'provider-profile', id },
          })
        }
        throw error
      }

      return { providerProfile: await toProviderProfileView(ctx, providerProfile) }
    },

    getProviderProfile: async (input: GetProviderProfileInput): Promise<GetProviderProfileResult> => {
      const profile = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      return { providerProfile: await toProviderProfileView(ctx, profile) }
    },

    listProviderProfiles: async (input?: ListProviderProfilesInput): Promise<ListProviderProfilesResult> => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.providerProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        providerProfiles: await Promise.all(result.items.map(profile => toProviderProfileView(ctx, profile as never))),
        nextCursor: result.nextCursor,
      }
    },

    updateProviderProfile: async (input: UpdateProviderProfileInput, requestContext?: RuntimeRequestContext): Promise<UpdateProviderProfileResult> => {
      if (input.tokenMultipliers !== undefined) {
        if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion! < 1) {
          throw new Error('Token multiplier updates require expectedVersion')
        }
        for (const [modelId, multiplier] of Object.entries(input.tokenMultipliers)) {
          if (!modelId.trim() || typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
            throw new Error('Token multipliers must be finite positive numbers keyed by model ID')
          }
        }
      }
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      if (input.displayName !== undefined) assertNonEmpty(input.displayName, 'displayName')
      const providerConfig = input.config === undefined
        ? existing.content.config
        : ctx.providerAdapters.validateAccountConfig(existing.content.providerExtensionId, input.config)
      const timestamp = ctx.now()
      const updated = await writeDocument<ProviderProfileContent>(ctx.documents, {
        ...promptResourceWriteContext(requestContext),
        reason: 'application.updateProviderProfile',
        id: existing.id,
        type: applicationDocumentTypes.providerProfile,
        content: {
          ...existing.content,
          ...(input.tokenMultipliers !== undefined ? { tokenMultipliers: input.tokenMultipliers } : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          config: providerConfig,
          ...(input.enabledModelIds !== undefined
            ? { enabledModelIds: normalizeProviderModelIds(existing.content.providerExtensionId, input.enabledModelIds) }
            : {}),
          updatedAt: timestamp,
        },
        expectedVersion: input.tokenMultipliers !== undefined ? input.expectedVersion! : existing.version,
      })
      return { providerProfile: await toProviderProfileView(ctx, updated) }
    },

    replaceProviderCredential: async (input: ReplaceProviderCredentialInput, requestContext?: RuntimeRequestContext): Promise<ReplaceProviderCredentialResult> => {
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      const providerCredential = ctx.providerAdapters.validateCredential(existing.content.providerExtensionId, input.credential)
      const secrets = requireSecrets(ctx)
      const owner = { type: 'provider-profile', id: existing.id }
      if (existing.content.secretRef) {
        const result = await secrets.replace({
          ...secretWriteContext(requestContext, 'application.replaceProviderCredential'),
          ref: existing.content.secretRef,
          owner,
          plaintext: { values: providerCredential },
        })
        return { credential: { configured: true, updatedAt: result.metadata.updatedAt } }
      }
      const created = await secrets.create({
        ...secretWriteContext(requestContext, 'application.replaceProviderCredential'),
        owner,
        purpose: 'provider.credentials',
        label: existing.content.displayName,
        plaintext: { values: providerCredential },
      })
      try {
        await writeDocument<ProviderProfileContent>(ctx.documents, {
          ...promptResourceWriteContext(requestContext),
          reason: 'application.replaceProviderCredential',
          id: existing.id,
          type: applicationDocumentTypes.providerProfile,
          content: { ...existing.content, secretRef: created.metadata.ref, updatedAt: ctx.now() },
          expectedVersion: existing.version,
        })
      } catch (error) {
        await secrets.delete({
          ...secretWriteContext(requestContext, 'application.replaceProviderCredential.rollback'),
          ref: created.metadata.ref,
          owner,
        })
        throw error
      }
      return { credential: { configured: true, updatedAt: created.metadata.updatedAt } }
    },

    deleteProviderProfile: async (input: DeleteProviderProfileInput, requestContext?: RuntimeRequestContext): Promise<DeleteProviderProfileResult> => {
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      await ctx.documents.delete({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.deleteProviderProfile',
        id: existing.id, expectedVersion: existing.version,
      })
      let credentialCleanupPending = false
      if (existing.content.secretRef) {
        const deleted = await requireSecrets(ctx).delete({
          ...secretWriteContext(requestContext, 'application.deleteProviderProfile.credential'),
          ref: existing.content.secretRef,
          owner: { type: 'provider-profile', id: existing.id },
        })
        credentialCleanupPending = deleted.cleanupPending
      }
      return { deleted: true as const, credentialCleanupPending }
    },

    createAiCapabilityProfile: async (input: CreateAiCapabilityProfileInput, requestContext?: RuntimeRequestContext): Promise<CreateAiCapabilityProfileResult> => {
      assertNonEmpty(input.providerProfileId, 'providerProfileId')
      assertNonEmpty(input.capabilityId, 'capabilityId')
      assertNonEmpty(input.displayName, 'displayName')
      const providerProfile = await readDocument<ProviderProfileContent>(
        ctx.documents,
        input.providerProfileId,
        applicationDocumentTypes.providerProfile,
      )
      const config = requireAiCapabilities(ctx).validateProfileConfig(
        providerProfile.content.providerExtensionId,
        input.capabilityId,
        input.config ?? {},
      )
      const timestamp = ctx.now()
      const profile = await writeDocument<AiCapabilityProfileContent>(ctx.documents, {
        ...promptResourceWriteContext(requestContext),
        reason: 'application.createAiCapabilityProfile',
        id: ctx.createId('ai-capability-profile'),
        type: applicationDocumentTypes.aiCapabilityProfile,
        content: {
          providerProfileId: providerProfile.id,
          capabilityId: input.capabilityId,
          displayName: input.displayName,
          config,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })
      return { profile: await toAiCapabilityProfileView(ctx, profile) }
    },

    getAiCapabilityProfile: async (input: GetAiCapabilityProfileInput): Promise<GetAiCapabilityProfileResult> => {
      const profile = await readDocument<AiCapabilityProfileContent>(
        ctx.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      return { profile: await toAiCapabilityProfileView(ctx, profile) }
    },

    listAiCapabilityProfiles: async (input?: ListAiCapabilityProfilesInput): Promise<ListAiCapabilityProfilesResult> => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.aiCapabilityProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })
      const profiles = result.items as DocumentRecord<AiCapabilityProfileContent>[]
      const filtered = profiles.filter(profile => (
        (!input?.providerProfileId || profile.content.providerProfileId === input.providerProfileId)
        && (!input?.capabilityId || profile.content.capabilityId === input.capabilityId)
      ))
      return {
        profiles: await Promise.all(filtered.map(profile => toAiCapabilityProfileView(ctx, profile))),
        nextCursor: result.nextCursor,
      }
    },

    updateAiCapabilityProfile: async (input: UpdateAiCapabilityProfileInput, requestContext?: RuntimeRequestContext): Promise<UpdateAiCapabilityProfileResult> => {
      const existing = await readDocument<AiCapabilityProfileContent>(
        ctx.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      if (input.displayName !== undefined) assertNonEmpty(input.displayName, 'displayName')
      if (input.providerProfileId !== undefined) assertNonEmpty(input.providerProfileId, 'providerProfileId')
      const providerProfileId = input.providerProfileId ?? existing.content.providerProfileId
      let config = existing.content.config
      if (input.config !== undefined || input.providerProfileId !== undefined) {
        const providerProfile = await readDocument<ProviderProfileContent>(
          ctx.documents,
          providerProfileId,
          applicationDocumentTypes.providerProfile,
        )
        config = requireAiCapabilities(ctx).validateProfileConfig(
          providerProfile.content.providerExtensionId,
          existing.content.capabilityId,
          input.config ?? existing.content.config,
        )
      }
      const updated = await writeDocument<AiCapabilityProfileContent>(ctx.documents, {
        ...promptResourceWriteContext(requestContext),
        reason: 'application.updateAiCapabilityProfile',
        id: existing.id,
        type: applicationDocumentTypes.aiCapabilityProfile,
        content: {
          ...existing.content,
          providerProfileId,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          config,
          updatedAt: ctx.now(),
        },
        expectedVersion: existing.version,
      })
      return { profile: await toAiCapabilityProfileView(ctx, updated) }
    },

    deleteAiCapabilityProfile: async (input: DeleteAiCapabilityProfileInput, requestContext?: RuntimeRequestContext): Promise<DeleteAiCapabilityProfileResult> => {
      const existing = await readDocument<AiCapabilityProfileContent>(
        ctx.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      await ctx.documents.delete({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.deleteAiCapabilityProfile',
        id: existing.id, expectedVersion: existing.version,
      })
      return { deleted: true as const }
    },

    listProviderModels: async (input: ListProviderModelsInput, requestContext?: RuntimeRequestContext): Promise<ListProviderModelsResult> => {
      if (!ctx.gateway.listModels) throw new Error('AI Gateway does not support model discovery')
      return await ctx.gateway.listModels({
        providerProfileId: input.providerProfileId,
        ...(requestContext ? { context: requestContext } : {}),
      })
    },

    pingProviderModel: async (input: PingProviderModelInput, requestContext?: RuntimeRequestContext): Promise<PingProviderModelResult> => {
      await assertProviderModelExists(ctx.documents, input)
      const result = await ctx.gateway.invokeChat({
        request: {
          messages: [{ role: 'user', content: input.text ?? 'hi' }],
        },
        model: { providerProfileId: input.providerProfileId, modelId: input.modelId },
        runId: ctx.createId('run'),
        sessionId: ctx.createId('session'),
        branchId: ctx.createId('branch'),
        ...(requestContext ? { context: requestContext } : {}),
      })

      return {
        text: result.text,
        provider: result.provider,
        model: result.model,
        raw: result.raw,
      }
    },
  }
}

function normalizeModelIds(modelIds: string[] | undefined): string[] {
  const normalized = [...new Set((modelIds ?? []).map(modelId => modelId.trim()).filter(Boolean))]
  if (normalized.length > 500) throw new Error('Provider Profile enabledModelIds exceeds 500 entries')
  return normalized
}

function normalizeProviderModelIds(providerExtensionId: string, modelIds: string[] | undefined): string[] {
  return isOfficialFakeProvider(providerExtensionId)
    ? [officialFakeModelId]
    : normalizeModelIds(modelIds)
}

function isOfficialFakeProvider(providerExtensionId: string): boolean {
  return providerExtensionId === 'official.fake' || providerExtensionId === 'fake'
}

async function toProviderProfileView(
  ctx: Pick<ApplicationRuntimeContext, 'secrets'>,
  profile: DocumentRecord<ProviderProfileContent>,
): Promise<ProviderProfileView> {
  const metadata = profile.content.secretRef && ctx.secrets
    ? await ctx.secrets.getMetadata(profile.content.secretRef)
    : undefined
  return {
    id: profile.id,
    version: profile.version,
    providerExtensionId: profile.content.providerExtensionId,
    displayName: profile.content.displayName,
    config: profile.content.config,
    enabledModelIds: [...profile.content.enabledModelIds],
    ...(profile.content.tokenMultipliers ? { tokenMultipliers: { ...profile.content.tokenMultipliers } } : {}),
    credential: {
      configured: metadata?.state === 'active',
      ...(metadata?.updatedAt ? { updatedAt: metadata.updatedAt } : {}),
    },
    createdAt: profile.content.createdAt,
    updatedAt: profile.content.updatedAt,
  }
}

async function toAiCapabilityProfileView(
  ctx: Pick<ApplicationRuntimeContext, 'aiCapabilities' | 'documents'>,
  profile: DocumentRecord<AiCapabilityProfileContent>,
): Promise<AiCapabilityProfileView> {
  const document = await ctx.documents.get(profile.content.providerProfileId, { includeTombstone: true })
  if (document && document.type !== applicationDocumentTypes.providerProfile) {
    throw new Error(`Document type mismatch for Provider Profile: ${document.id}`)
  }
  const providerProfile = document as DocumentRecord<ProviderProfileContent> | null
  const providerExtensionId = providerProfile?.content.providerExtensionId
  const provider = providerExtensionId ? ctx.aiCapabilities?.get(providerExtensionId) : undefined
  const unavailableReason = !providerProfile || providerProfile.meta.tombstone
    ? 'provider-profile-missing' as const
    : !provider ? 'provider-unavailable' as const
      : !provider.capabilities.some(capability => capability.id === profile.content.capabilityId)
        ? 'capability-unavailable' as const : undefined
  return {
    id: profile.id,
    version: profile.version,
    providerProfileId: profile.content.providerProfileId,
    ...(providerExtensionId ? { providerExtensionId } : {}),
    capabilityId: profile.content.capabilityId,
    displayName: profile.content.displayName,
    config: profile.content.config,
    available: unavailableReason === undefined,
    ...(unavailableReason ? { unavailableReason } : {}),
    createdAt: profile.content.createdAt,
    updatedAt: profile.content.updatedAt,
  }
}

export async function initializeOfficialFakeProviderProfiles(
  ctx: Pick<ApplicationRuntimeContext, 'createId' | 'documents' | 'now' | 'providerAdapters'>,
): Promise<void> {
  const profiles = await listDocuments<ProviderProfileContent>(ctx.documents, applicationDocumentTypes.providerProfile)
  const providerProfileIds = new Set<string>()
  for (const profile of profiles) {
    if (!isOfficialFakeProvider(profile.content.providerExtensionId)) continue
    providerProfileIds.add(profile.id)
    const config = ctx.providerAdapters.validateAccountConfig(profile.content.providerExtensionId, profile.content.config)
    const enabledModelIds = [officialFakeModelId]
    if (
      JSON.stringify(config) === JSON.stringify(profile.content.config)
      && enabledModelIds.length === profile.content.enabledModelIds.length
    ) continue
    await writeDocument<ProviderProfileContent>(ctx.documents, {
      id: profile.id,
      type: applicationDocumentTypes.providerProfile,
      content: {
        ...profile.content,
        config,
        enabledModelIds,
        updatedAt: ctx.now(),
      },
      expectedVersion: profile.version,
    })
  }

  if (providerProfileIds.size === 0) {
    const timestamp = ctx.now()
    const providerProfileId = ctx.createId('provider-profile')
    await writeDocument<ProviderProfileContent>(ctx.documents, {
      id: providerProfileId,
      type: applicationDocumentTypes.providerProfile,
      content: {
        providerExtensionId: 'official.fake',
        displayName: 'Fake AI',
        config: {},
        enabledModelIds: [officialFakeModelId],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      expectedVersion: 'new',
    })
    providerProfileIds.add(providerProfileId)
  }

  const capabilityProfiles = await listDocuments<AiCapabilityProfileContent>(
    ctx.documents,
    applicationDocumentTypes.aiCapabilityProfile,
  )
  for (const profile of capabilityProfiles) {
    if (!providerProfileIds.has(profile.content.providerProfileId)) continue
    const capabilityId = profile.content.capabilityId === 'text.generate'
      ? 'chat.completions'
      : profile.content.capabilityId
    if (capabilityId === profile.content.capabilityId && Object.keys(profile.content.config).length === 0) continue
    await writeDocument<AiCapabilityProfileContent>(ctx.documents, {
      id: profile.id,
      type: applicationDocumentTypes.aiCapabilityProfile,
      content: {
        ...profile.content,
        capabilityId,
        config: {},
        updatedAt: ctx.now(),
      },
      expectedVersion: profile.version,
    })
  }
}
