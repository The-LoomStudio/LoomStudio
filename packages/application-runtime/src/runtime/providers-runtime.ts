import type { DocumentRecord } from '@loom-studio/document-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { assertNonEmpty, assertProviderModelExists } from '../agents/agent.js'
import type {
  AgentProfileContent,
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
  requireAiCapabilities,
  requireSecrets,
  secretWriteContext,
} from './context.js'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
export { officialFakeModelId } from '@loom-studio/ai-gateway'

export function createProvidersRuntimeMethods(ctx: ApplicationRuntimeContext) {
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

    updateProviderProfile: async (input: UpdateProviderProfileInput): Promise<UpdateProviderProfileResult> => {
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      if (input.displayName !== undefined) assertNonEmpty(input.displayName, 'displayName')
      const providerConfig = input.config === undefined
        ? existing.content.config
        : ctx.providerAdapters.validateAccountConfig(existing.content.providerExtensionId, input.config)
      const timestamp = ctx.now()
      const updated = await writeDocument<ProviderProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.providerProfile,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          config: providerConfig,
          ...(input.enabledModelIds !== undefined
            ? { enabledModelIds: normalizeProviderModelIds(existing.content.providerExtensionId, input.enabledModelIds) }
            : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
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
      const profiles = await listDocuments<AgentProfileContent>(ctx.documents, applicationDocumentTypes.agentProfile)
      if (profiles.some(profile => profile.content.model.providerProfileId === existing.id)) {
        throw new Error(`Provider Profile is still referenced by an Agent Profile: ${existing.id}`)
      }
      const capabilityProfiles = await listDocuments<AiCapabilityProfileContent>(
        ctx.documents,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      if (capabilityProfiles.some(profile => profile.content.providerProfileId === existing.id)) {
        throw new Error(`Provider Profile is still referenced by an AI Capability Profile: ${existing.id}`)
      }
      await ctx.documents.delete({ id: existing.id, expectedVersion: existing.version })
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

    createAiCapabilityProfile: async (input: CreateAiCapabilityProfileInput): Promise<CreateAiCapabilityProfileResult> => {
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

    updateAiCapabilityProfile: async (input: UpdateAiCapabilityProfileInput): Promise<UpdateAiCapabilityProfileResult> => {
      const existing = await readDocument<AiCapabilityProfileContent>(
        ctx.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      if (input.displayName !== undefined) assertNonEmpty(input.displayName, 'displayName')
      let config = existing.content.config
      if (input.config !== undefined) {
        const providerProfile = await readDocument<ProviderProfileContent>(
          ctx.documents,
          existing.content.providerProfileId,
          applicationDocumentTypes.providerProfile,
        )
        config = requireAiCapabilities(ctx).validateProfileConfig(
          providerProfile.content.providerExtensionId,
          existing.content.capabilityId,
          input.config,
        )
      }
      const updated = await writeDocument<AiCapabilityProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.aiCapabilityProfile,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          config,
          updatedAt: ctx.now(),
        },
        expectedVersion: existing.version,
      })
      return { profile: await toAiCapabilityProfileView(ctx, updated) }
    },

    deleteAiCapabilityProfile: async (input: DeleteAiCapabilityProfileInput): Promise<DeleteAiCapabilityProfileResult> => {
      const existing = await readDocument<AiCapabilityProfileContent>(
        ctx.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      await ctx.documents.delete({ id: existing.id, expectedVersion: existing.version })
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

export function normalizeModelIds(modelIds: string[] | undefined): string[] {
  const normalized = [...new Set((modelIds ?? []).map(modelId => modelId.trim()).filter(Boolean))]
  if (normalized.length > 500) throw new Error('Provider Profile enabledModelIds exceeds 500 entries')
  return normalized
}

export function normalizeProviderModelIds(providerExtensionId: string, modelIds: string[] | undefined): string[] {
  return isOfficialFakeProvider(providerExtensionId)
    ? [officialFakeModelId]
    : normalizeModelIds(modelIds)
}

export function isOfficialFakeProvider(providerExtensionId: string): boolean {
  return providerExtensionId === 'official.fake' || providerExtensionId === 'fake'
}

export async function toProviderProfileView(
  ctx: ApplicationRuntimeContext,
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
    credential: {
      configured: metadata?.state === 'active',
      ...(metadata?.updatedAt ? { updatedAt: metadata.updatedAt } : {}),
    },
    createdAt: profile.content.createdAt,
    updatedAt: profile.content.updatedAt,
  }
}

export async function toAiCapabilityProfileView(
  ctx: ApplicationRuntimeContext,
  profile: DocumentRecord<AiCapabilityProfileContent>,
): Promise<AiCapabilityProfileView> {
  const providerProfile = await readDocument<ProviderProfileContent>(
    ctx.documents,
    profile.content.providerProfileId,
    applicationDocumentTypes.providerProfile,
  )
  const provider = ctx.aiCapabilities?.get(providerProfile.content.providerExtensionId)
  return {
    id: profile.id,
    version: profile.version,
    providerProfileId: providerProfile.id,
    providerExtensionId: providerProfile.content.providerExtensionId,
    capabilityId: profile.content.capabilityId,
    displayName: profile.content.displayName,
    config: profile.content.config,
    available: provider?.capabilities.some(capability => capability.id === profile.content.capabilityId) ?? false,
    createdAt: profile.content.createdAt,
    updatedAt: profile.content.updatedAt,
  }
}

export async function initializeOfficialFakeProviderProfiles(ctx: ApplicationRuntimeContext): Promise<void> {
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
