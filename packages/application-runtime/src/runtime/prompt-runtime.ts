import { loomScriptMediaType } from '@loom-studio/shared/loom-scripts'
import type { PromptResourceMutation, PromptResourceMutationResult } from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, writeDocument } from '../foundation/document-store.js'
import {
  fromStoredResource,
  normalizeAuthorCapabilities,
  listResourceCatalog,
  readMappedResource,
  toStoredNodeDraft,
  toStoredResourceInput,
} from '../prompt/prompt-resource-mapper.js'
import { applyDefaultPromptProjection, normalizePromptResourceArtifact } from '../cards/workspace-codec.js'
import defaultPresetTemplate from '../prompt/default-preset.json' with { type: 'json' }
import type { PromptResourceNode } from '../cards/workspace-types.js'
import type { TextTransformRuleDraft } from '../transforms/history-text.js'
import { revertApplicationStateChangeset, revertApplicationStateDefinitionChangeset } from '../state/state.js'
import type {
  GetPromptResourceBindingsResult,
  CreatePromptResourceAssetInput,
  CreatePromptResourceInput,
  CreatePromptResourceResult,
  DeletePromptResourceAssetInput,
  DeletePromptResourceInput,
  DeletePromptResourceResult,
  DuplicatePromptResourceInput,
  ExportPromptResourceInput,
  ExportPromptResourceResult,
  GetPromptResourceInput,
  GetPromptResourceResult,
  ImportPromptResourceInput,
  ListPromptResourcesInput,
  ListPromptResourcesResult,
  ListLoreMountsInput,
  ListLoreMountsResult,
  MovePromptResourceAssetInput,
  MutationReceipt,
  PromptResourceContent,
  ReplaceLoreMountsInput,
  ReplaceLoreMountsResult,
  RevertPromptResourceChangesetInput,
  RevertPromptResourceChangesetResult,
  RuntimeRequestContext,
  UpdatePromptResourceAssetInput,
  UpdatePromptResourceAssetsInput,
  UpdatePromptResourceMacrosInput,
  UpdatePromptResourceMacrosResult,
  UpdatePromptResourceResult,
} from '../types.js'
import {
  applicationActor,
  promptResourceWriteContext,
  requireDocumentParticipant,
} from './context.js'
import { normalizeMacros } from '../cards/card.js'
import { normalizeMacroOptions, canPlacePromptNode, promptAnchorOutput } from '@loom-studio/shared'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import type { LoomScriptAttachmentArtifact, LoomScriptContent, LoomScriptMountContent } from '../scripts/loom-script-contracts.js'
import { allocateImportedTextResourceIds, exportScriptTextResourceIds, importedTextResourceReferences, prepareTextTransformScript, rebaseScriptTextResourceReferences, remapImportedTextUses, writePreparedTextTransformScript } from '../scripts/loom-script-text-migration.js'

type PromptRuntimeContext = Pick<ApplicationRuntimeContext,
  | 'agentTools'
  | 'blobs'
  | 'createId'
  | 'dataEngine'
  | 'documents'
  | 'narratives'
  | 'now'
  | 'promptResources'
  | 'states'
>

export function createPromptRuntimeMethods(ctx: PromptRuntimeContext) {
  return {
    getPromptResource: async (input: GetPromptResourceInput): Promise<GetPromptResourceResult> => ({
      resource: await readMappedResource(ctx.promptResources, input.resourceId),
    }),

    listPromptResources: (input?: ListPromptResourcesInput): Promise<ListPromptResourcesResult> => listResourceCatalog(ctx.promptResources, input?.resourceKind),

    getPromptResourceBindings: async (input: GetPromptResourceInput): Promise<GetPromptResourceBindingsResult> => {
      if (!await ctx.promptResources.hasResource(input.resourceId)) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const [cards, mounts] = await Promise.all([
        ctx.documents.listCardBindings({ type: applicationDocumentTypes.cardSource, resourceId: input.resourceId }),
        ctx.promptResources.listLoreMounts({ loreResourceId: input.resourceId }),
      ])
      return {
        resourceId: input.resourceId,
        cards,
        loreMounts: mounts,
      }
    },

    createPromptResource: async (input: CreatePromptResourceInput, requestContext?: RuntimeRequestContext): Promise<CreatePromptResourceResult> => {
      const content = createEmptyPromptResourceContent(ctx.createId, input.name, input.resourceKind, ctx.now())
      const result = await ctx.promptResources.createResource({
        ...toStoredResourceInput({ content }),
        ...promptResourceWriteContext(requestContext),
        reason: 'application.createPromptResource',
      })
      if (content.resourceKind === 'preset') {
        const availableTools = ctx.agentTools.list()
        for (const [orderIndex, definition] of availableTools.entries()) {
          await ctx.promptResources.addPresetToolMount({
            actor: applicationActor,
            reason: 'application.createPromptResource',
            presetResourceId: result.resource.id,
            toolId: definition.id,
            orderIndex,
            defaultEnabled: false,
            ...(definition.prompt?.activation ? { activation: structuredClone(definition.prompt.activation) } : {}),
            ...(definition.prompt?.provider ? { provider: { ...definition.prompt.provider } } : {}),
            ...(definition.prompt?.content ? { content: { ...definition.prompt.content } } : {}),
            origin: { kind: 'manual' },
          })
        }
      }
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    duplicatePromptResource: async (input: DuplicatePromptResourceInput, requestContext?: RuntimeRequestContext): Promise<CreatePromptResourceResult> => {
      const source = await ctx.promptResources.getResource(input.resourceId)
      if (!source) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const sourceContent = fromStoredResource(source)
      const duplicateContent = clonePromptResourceContent(sourceContent, ctx.createId, input.name?.trim() || `${sourceContent.rootNode.label} Copy`)
      const sourceMounts = source.resourceKind === 'preset'
        ? await ctx.promptResources.listLoreMounts({ source: { kind: 'preset', id: source.id } })
        : []
      const sourceToolMounts = source.resourceKind === 'preset'
        ? await ctx.promptResources.listPresetToolMounts({ presetResourceId: source.id })
        : []
      const transaction = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.duplicatePromptResource',
      }, async dataTx => {
        const resourceTx = ctx.promptResources.transaction(dataTx)
        const created = resourceTx.createResource(toStoredResourceInput({ content: duplicateContent }))
        const mounts = sourceMounts.map(mount => resourceTx.addLoreMount({
          source: { kind: 'preset', id: created.id },
          loreResourceId: mount.resolvedLoreResourceId === null ? null : mount.resolvedLoreResourceId ?? mount.loreResourceId,
          ...(mount.reference ? { reference: mount.reference } : {}),
          orderIndex: mount.orderIndex,
          origin: mount.origin,
        }))
        const toolMounts = sourceToolMounts.map(mount => resourceTx.addPresetToolMount({
          presetResourceId: created.id,
          toolId: mount.toolId,
          orderIndex: mount.orderIndex,
          defaultEnabled: mount.defaultEnabled,
          ...(mount.activation ? { activation: mount.activation } : {}),
          ...(mount.provider ? { provider: mount.provider } : {}),
          ...(mount.content ? { content: mount.content } : {}),
          origin: mount.origin,
        }))
        return { resource: created, mounts, toolMounts }
      })
      return {
        resource: fromStoredResource(transaction.value.resource),
        mutation: { changesetId: transaction.commit.changesetId },
      }
    },

    deletePromptResource: async (input: DeletePromptResourceInput, requestContext?: RuntimeRequestContext): Promise<DeletePromptResourceResult> => {
      const resource = await readMappedResource(ctx.promptResources, input.resourceId)
      if (resource.resourceKind === 'lore') {
        const result = await ctx.promptResources.deleteResource({
          ...promptResourceWriteContext(requestContext),
          reason: 'application.deletePromptResource',
          resourceId: resource.id,
          expectedVersion: resource.version,
        })
        return {
          deleted: true as const,
          detachedReferences: { presets: 0, cards: 0, timelines: 0 },
          mutation: { changesetId: result.commit.changesetId },
        }
      }
      const ownedScripts = resource.resourceKind === 'preset'
        ? (await listDocuments<LoomScriptContent>(ctx.documents, applicationDocumentTypes.loomScript))
          .filter(script => script.content.owner.kind === 'preset' && script.content.owner.presetId === input.resourceId)
        : []
      const adoptedScripts = resource.resourceKind === 'preset'
        ? (await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount))
          .filter(mount => mount.content.target.kind === 'preset' && mount.content.target.presetId === input.resourceId)
        : []
      const documentParticipant = requireDocumentParticipant(ctx)
      const transaction = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.deletePromptResource',
      }, async dataTx => {
        const resourceTx = ctx.promptResources.transaction(dataTx)
        return await documentParticipant.participateTransaction(dataTx, async documents => {
          for (const mount of adoptedScripts) await documents.delete({ id: mount.id, expectedVersion: mount.version })
          for (const script of ownedScripts) await documents.delete({ id: script.id, expectedVersion: script.version })
          return { deleted: resourceTx.deleteResource({ resourceId: input.resourceId, expectedVersion: resource.version }) }
        }, { allowEmpty: true })
      })
      return {
        deleted: true as const,
        detachedReferences: {
          presets: 0,
          cards: 0,
          timelines: 0,
        },
        mutation: { changesetId: transaction.commit.changesetId },
      }
    },

    revertPromptResourceChangeset: async (input: RevertPromptResourceChangesetInput, requestContext?: RuntimeRequestContext): Promise<RevertPromptResourceChangesetResult> => {
      const result = await ctx.promptResources.revertChangeset({
        changesetId: input.changesetId,
        expectedVersion: input.expectedVersion,
        ...promptResourceWriteContext(requestContext),
        reason: 'application.revertPromptResourceChangeset',
      })
      return { mutation: { changesetId: result.commit.changesetId } }
    },

    importPromptResource: async (input: ImportPromptResourceInput, requestContext?: RuntimeRequestContext): Promise<CreatePromptResourceResult> => {
      const artifact = normalizePromptResourceArtifact(input.artifact)
      if (artifact.scriptAttachments?.length && artifact.resourceKind !== 'preset') {
        throw new Error('Only Preset Prompt Resources can import Loom Script attachments')
      }
      const content: PromptResourceContent = {
        ...(artifact.metadata ? { metadata: structuredClone(artifact.metadata) } : {}),
        resourceKind: artifact.resourceKind,
        rootNode: clonePromptResourceNode(artifact.rootNode, ctx.createId),
        ...(artifact.resourceKind === 'preset' ? { historyPolicy: 'persistent' as const } : {}),
        ...(artifact.macros !== undefined ? { macros: normalizeMacros(artifact.macros, 'Preset') } : {}),
        ...(artifact.macroOptions !== undefined ? { macroOptions: normalizeMacroOptions(artifact.macroOptions) } : {}),
        ...(artifact.useCardLore !== undefined ? { useCardLore: artifact.useCardLore } : {}),
        ...(artifact.useGlobalLore !== undefined ? { useGlobalLore: artifact.useGlobalLore } : {}),
        ...(artifact.textUses !== undefined ? { textUses: structuredClone(artifact.textUses) } : {}),
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
      }
      const result = await importPromptResourceContent(ctx, content, artifact.scriptAttachments ?? [], requestContext, artifact.textTransformRules, artifact.loreMounts)
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    exportPromptResource: async (input: ExportPromptResourceInput): Promise<ExportPromptResourceResult> => {
      const resource = await readMappedResource(ctx.promptResources, input.resourceId)
      const mounts = resource.resourceKind === 'preset'
        ? await ctx.promptResources.listLoreMounts({ source: { kind: 'preset', id: resource.id } })
        : []
      const scriptMounts = resource.resourceKind === 'preset'
        ? (await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount))
          .filter(mount => mount.content.target.kind === 'preset' && mount.content.target.presetId === resource.id)
        : []
      const scriptAttachments = await Promise.all(scriptMounts.map(async (mount): Promise<LoomScriptAttachmentArtifact> => {
        if (!ctx.blobs) throw new Error('Blob Store is required to export Script attachments')
        const document = await ctx.documents.get(mount.content.scriptDocumentId)
        if (!document || document.type !== applicationDocumentTypes.loomScript) throw new Error(`Script not found: ${mount.content.scriptDocumentId}`)
        const script = document.content as LoomScriptContent
        return { orderIndex: mount.content.orderIndex,
      ...(typeof mount.content.origin.groupOrder === 'number' ? { groupOrder: mount.content.origin.groupOrder } : {}),
          ...(mount.content.settings ? { settings: mount.content.settings } : {}),
          textResourceIds: exportScriptTextResourceIds(document.id, script),
          ...(script.textResourceReferences ? { textResourceReferences: script.textResourceReferences } : {}),
          script: { format: 'loom.script', schemaVersion: 1, fileName: script.source.fileName,
            source: new TextDecoder('utf-8', { fatal: true }).decode(await ctx.blobs.read(script.source.blobId)) },
        }
      }))
      return {
        artifact: {
          format: 'loom.promptResource' as const,
          schemaVersion: 2 as const,
          resourceKind: resource.resourceKind,
          rootNode: resource.rootNode,
          ...(resource.metadata ? { metadata: structuredClone(resource.metadata) } : {}),
          ...(scriptAttachments.length ? { scriptAttachments } : {}),
          ...(resource.macros !== undefined ? { macros: structuredClone(resource.macros) } : {}),
          ...(resource.macroOptions !== undefined ? { macroOptions: structuredClone(resource.macroOptions) } : {}),
          ...(resource.useCardLore !== undefined ? { useCardLore: resource.useCardLore } : {}),
          ...(resource.useGlobalLore !== undefined ? { useGlobalLore: resource.useGlobalLore } : {}),
          ...(resource.textUses !== undefined ? { textUses: resource.textUses.map(use => ({
            ...structuredClone(use),
            reference: use.reference ?? { kind: 'external' as const, resourceId: use.id },
          })) } : {}),
          ...(mounts.length ? { loreMounts: mounts.map(mount =>
            structuredClone(mount.reference ?? { kind: 'external' as const, resourceId: mount.loreResourceId })) } : {}),
        },
      }
    },

    listLoreMounts: async (input?: ListLoreMountsInput): Promise<ListLoreMountsResult> => ({
      mounts: await ctx.promptResources.listLoreMounts({ source: input?.source }),
    }),

    replaceLoreMounts: async (input: ReplaceLoreMountsInput, requestContext?: RuntimeRequestContext): Promise<ReplaceLoreMountsResult> => {
      if ((input.mounts === undefined) === (input.loreResourceIds === undefined)) throw new Error('Specify exactly one Lore mount list')
      const existing = input.mounts ? await ctx.promptResources.listLoreMounts({ source: input.source }) : []
      const mounts = await Promise.all((input.mounts ?? input.loreResourceIds?.map(loreResourceId => ({ loreResourceId })) ?? [])
        .map(async (mount, orderIndex) => {
          if ('id' in mount) {
            const previous = existing.find(item => item.id === mount.id)
            if (!previous) throw new Error(`Lore mount not found in this source: ${mount.id}`)
            const resourceId = previous.resolvedLoreResourceId === null ? null : previous.resolvedLoreResourceId ?? previous.loreResourceId
            const available = resourceId ? await ctx.promptResources.getResource(resourceId) : null
            return { loreResourceId: available ? resourceId : null,
              reference: previous.reference ?? { kind: 'external' as const, resourceId: previous.loreResourceId },
              orderIndex, origin: previous.origin }
          }
          return { loreResourceId: mount.loreResourceId, orderIndex }
        }))
      for (const loreId of mounts.flatMap(mount => mount.loreResourceId ? [mount.loreResourceId] : [])) {
        const lore = await ctx.promptResources.getResource(loreId)
        if (!lore) throw new Error(`Prompt resource not found: ${loreId}`)
        if (lore.resourceKind !== 'lore') throw new Error(`Prompt resource ${loreId} can only link Lore resources`)
      }
      const result = await ctx.promptResources.replaceLoreMounts({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.replaceLoreMounts',
        source: input.source,
        mounts,
      })
      return { mounts: result.mounts, mutation: { changesetId: result.commit.changesetId } }
    },

    createPromptResourceAsset: async (input: CreatePromptResourceAssetInput, requestContext?: RuntimeRequestContext): Promise<UpdatePromptResourceResult> => {
      const current = await ctx.promptResources.getResource(input.resourceId)
      if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const mapped = fromStoredResource(current)
      const placement = resolveAssetPlacement(mapped.rootNode, input.targetAssetId, input.position)
      const asset = applyDefaultPromptProjection(input.asset, mapped)
      assertPromptAssetPlacement(mapped.rootNode, placement.parentId, asset)
      assertTextContributionTarget(asset)
      const mutation: PromptResourceMutation = { kind: 'node.create', parentId: placement.parentId, node: toStoredNodeDraft(asset) }
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext), reason: 'application.createPromptResourceAsset',
        resourceId: input.resourceId, expectedVersion: current.version,
        mutations: [{ ...mutation, node: { ...mutation.node, orderIndex: placement.orderIndex } }, ...buildInsertionReorderMutations(mapped.rootNode, placement.parentId, placement.orderIndex)],
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    updatePromptResourceAsset: async (input: UpdatePromptResourceAssetInput, requestContext?: RuntimeRequestContext): Promise<UpdatePromptResourceResult> => {
      return updatePromptResourceAssets({ resourceId: input.resourceId, expectedVersion: input.expectedVersion, updates: [{ ...input, assetId: input.assetId }], requestContext, ctx })
    },

    updatePromptResourceAssets: async (input: UpdatePromptResourceAssetsInput, requestContext?: RuntimeRequestContext): Promise<UpdatePromptResourceResult> => {
      return updatePromptResourceAssets({ resourceId: input.resourceId, expectedVersion: input.expectedVersion, updates: input.updates, requestContext, ctx })
    },

    movePromptResourceAsset: async (input: MovePromptResourceAssetInput, requestContext?: RuntimeRequestContext): Promise<UpdatePromptResourceResult> => {
      const current = await ctx.promptResources.getResource(input.resourceId)
      if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const mapped = fromStoredResource(current)
      const placement = resolveAssetPlacement(mapped.rootNode, input.targetAssetId, input.position)
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext), reason: 'application.movePromptResourceAsset',
        resourceId: input.resourceId, expectedVersion: current.version,
        mutations: buildMoveMutations(mapped.rootNode, input.assetId, placement),
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    deletePromptResourceAsset: async (input: DeletePromptResourceAssetInput, requestContext?: RuntimeRequestContext): Promise<UpdatePromptResourceResult> => {
      const current = await ctx.promptResources.getResource(input.resourceId)
      if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext), reason: 'application.deletePromptResourceAsset',
        resourceId: input.resourceId, expectedVersion: current.version,
        mutations: [{ kind: 'node.delete', nodeId: input.assetId }],
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    updatePromptResourceMacros: async (
      input: UpdatePromptResourceMacrosInput,
      requestContext?: RuntimeRequestContext,
    ): Promise<UpdatePromptResourceMacrosResult> => {
      const current = await ctx.promptResources.getResource(input.resourceId)
      if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      if (current.resourceKind !== 'preset') throw new Error(`Macro configuration requires a Preset resource: ${input.resourceId}`)
      const macros = normalizeMacros(input.macros, 'Preset')
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.updatePromptResourceMacros',
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        mutations: [{
          kind: 'resource.update',
          patch: {
            metadata: {
              ...current.metadata,
              macros,
              ...(input.macroOptions !== undefined ? { macroOptions: normalizeMacroOptions(input.macroOptions) } : {}),
            },
          },
        }],
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    revertChangeset: async (input: { changesetId: string }, requestContext?: RuntimeRequestContext): Promise<{ mutation: MutationReceipt }> => {
      const stateRevision = await ctx.states?.getRevisionByChangesetId(input.changesetId)
      const documentChangeset = await ctx.documents.getChangeset(input.changesetId)
      if (stateRevision) {
        const result = await revertApplicationStateChangeset(
          ctx,
          input.changesetId,
          requestContext,
          documentChangeset?.operations.length
            ? { participant: requireDocumentParticipant(ctx), changeset: documentChangeset }
            : undefined,
        )
        return { mutation: result }
      }
      if (documentChangeset?.operations.some(operation => operation.type === applicationDocumentTypes.stateDefinition)) {
        return { mutation: await revertApplicationStateDefinitionChangeset(ctx, documentChangeset, requestContext) }
      }
      const result = await ctx.documents.revertChangeset({
        changesetId: input.changesetId,
        actor: requestContext?.actor ?? (requestContext?.clientId
          ? { kind: 'client' as const, id: requestContext.clientId }
          : applicationActor),
        reason: 'application.revertChangeset',
        correlationId: requestContext?.correlationId,
        callId: requestContext?.callId,
        parentCallId: requestContext?.parentCallId,
      })
      return { mutation: { changesetId: result.commit.changesetId } }
    },
  }
}

async function importPromptResourceContent(
  ctx: PromptRuntimeContext,
  content: PromptResourceContent,
  attachments: LoomScriptAttachmentArtifact[],
  requestContext?: RuntimeRequestContext,
  textTransformRules?: Array<Omit<TextTransformRuleDraft, 'owner'>>,
  loreMounts?: NonNullable<import('../cards/workspace-types.js').PromptResourceArtifact['loreMounts']>,
): Promise<PromptResourceMutationResult> {
  if ((attachments.length > 0 || textTransformRules?.length) && !ctx.blobs) throw new Error('Blob Store is required to import Loom Script attachments')
  const preparedResults = await Promise.allSettled(attachments.map(async attachment => {
    const metadata = parseLoomScriptSource(attachment.script.source)
    return { attachment, metadata, textResourceIds: allocateImportedTextResourceIds(metadata, attachment, ctx.createId),
      blob: await ctx.blobs!.prepareWrite({
      source: new TextEncoder().encode(attachment.script.source),
      mediaType: loomScriptMediaType(attachment.script.fileName),
    }) }
  }))
  const prepared = preparedResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failedPreparation = preparedResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failedPreparation) {
    throw failedPreparation.reason
  }
  const references = importedTextResourceReferences(prepared)
  const preparedRules = await Promise.all((textTransformRules ?? []).map(async rule => ({ rule,
    ...await prepareTextTransformScript(ctx.blobs!, { ...rule, owner: { kind: 'workspace' }, createdAt: content.createdAt, updatedAt: content.updatedAt }),
  })))
  const transaction = await ctx.dataEngine.transact({
    ...promptResourceWriteContext(requestContext),
    reason: 'application.importPromptResource',
  }, async dataTx => {
    const resourceTx = ctx.promptResources.transaction(dataTx)
    const resource = resourceTx.createResource(toStoredResourceInput({ content: { ...content,
      ...(content.textUses ? { textUses: remapImportedTextUses(content.textUses, references) } : {}),
    } }))
    for (const [orderIndex, reference] of (loreMounts ?? []).entries()) {
      resourceTx.addLoreMount({
        source: { kind: 'preset', id: resource.id },
        loreResourceId: null,
        reference, orderIndex,
      })
    }
    if (content.resourceKind === 'preset' && (prepared.length > 0 || textTransformRules?.length)) await requireDocumentParticipant(ctx).participateTransaction(dataTx, async documentTx => {
      for (const item of preparedRules) {
        await writePreparedTextTransformScript(documentTx, {
          scriptId: ctx.createId('loom-script'), mountId: ctx.createId('loom-script-mount'), ruleId: ctx.createId('text-transform-rule'),
          rule: { ...structuredClone(item.rule), owner: { kind: 'preset', presetId: resource.id }, createdAt: content.createdAt, updatedAt: content.updatedAt },
          blob: ctx.blobs!.participateWrite(dataTx, item.prepared).blob, metadata: item.metadata,
        })
      }
      for (const item of prepared) {
        const blob = ctx.blobs!.participateWrite(dataTx, item.blob).blob
        const script = await writeDocument<LoomScriptContent>(documentTx, {
          id: ctx.createId('loom-script'),
          type: applicationDocumentTypes.loomScript,
          content: {
            owner: { kind: 'preset', presetId: resource.id },
            ...item.metadata,
            source: {
              blobId: blob.id,
              mediaType: loomScriptMediaType(item.attachment.script.fileName),
              fileName: item.attachment.script.fileName,
            },
            sourceDigest: blob.sha256,
            textResourceIds: item.textResourceIds,
            textResourceReferences: rebaseScriptTextResourceReferences(item.attachment, references),
            createdAt: content.createdAt,
            updatedAt: content.updatedAt,
          },
          expectedVersion: 'new',
        })
        await writeDocument<LoomScriptMountContent>(documentTx, {
          id: ctx.createId('loom-script-mount'),
          type: applicationDocumentTypes.loomScriptMount,
          content: {
            target: { kind: 'preset', presetId: resource.id },
            scriptDocumentId: script.id,
            enabled: false,
            orderIndex: item.attachment.orderIndex,
            grantedCapabilities: [],
            ...(item.attachment.settings ? { settings: item.attachment.settings } : {}),
            origin: { kind: 'prompt-resource-import', orderOverride: true, ...(item.attachment.groupOrder !== undefined ? { groupOrder: item.attachment.groupOrder } : {}) },
            createdAt: content.createdAt,
            updatedAt: content.updatedAt,
          },
          expectedVersion: 'new',
        })
      }
    })
    if (content.resourceKind === 'preset') {
      for (const [orderIndex, definition] of ctx.agentTools.list().entries()) {
        resourceTx.addPresetToolMount({
          presetResourceId: resource.id, toolId: definition.id, orderIndex, defaultEnabled: false,
          ...(definition.prompt?.activation ? { activation: structuredClone(definition.prompt.activation) } : {}),
          ...(definition.prompt?.provider ? { provider: { ...definition.prompt.provider } } : {}),
          ...(definition.prompt?.content ? { content: { ...definition.prompt.content } } : {}),
          origin: { kind: 'manual' },
        })
      }
    }
    return resource
  })
  return { resource: transaction.value, commit: transaction.commit }
}

export function createEmptyPromptResourceContent(
  createId: (prefix: string) => string,
  name: string,
  resourceKind: PromptResourceContent['resourceKind'],
  timestamp: string,
): PromptResourceContent {
  if (resourceKind === 'preset') {
    const template = normalizePromptResourceArtifact(defaultPresetTemplate)
    const rootNode = clonePromptResourceNode(template.rootNode, createId)
    rootNode.label = name.trim()
    return {
      resourceKind,
      rootNode,
      macros: template.macros,
      historyPolicy: 'persistent',
      delivery: 'stream',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }
  const rootNode: PromptResourceContent['rootNode'] = {
    id: createId('prompt-node'),
    label: name.trim(),
    meta: resourceKind === 'lore' ? 'Lore' : 'Prompt Resource',
    category: resourceKind === 'history' || resourceKind === 'runtime' || resourceKind === 'prompt' ? undefined : resourceKind,
    kind: 'module',
    body: '',
  }
  return {
    resourceKind,
    rootNode,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function clonePromptResourceContent(
  source: PromptResourceContent & { id: string; version: number },
  createId: (prefix: string) => string,
  name?: string,
): PromptResourceContent {
  const rootNode = clonePromptResourceNode(source.rootNode, createId)
  if (name?.trim()) rootNode.label = name.trim()
  return {
    ...source,
    rootNode,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}

function clonePromptResourceNode(
  node: PromptResourceContent['rootNode'],
  createId: (prefix: string) => string,
): PromptResourceContent['rootNode'] {
  const ids = new Map<string, string>()
  const collect = (current: PromptResourceNode): void => {
    ids.set(current.id, createId('prompt-node'))
    current.children?.forEach(collect)
  }
  collect(node)
  const clone = (current: PromptResourceNode): PromptResourceNode => ({
    ...current,
    id: ids.get(current.id)!,
    ...(current.orderList ? { orderList: current.orderList.map(id => ids.get(id) ?? id) } : {}),
    ...(current.children ? { children: current.children.map(clone) } : {}),
  })
  return clone(node)
}

function findPromptNode<T extends { id: string; children?: T[] }>(
  root: T,
  id: string,
  parentId?: string,
): { node: T; parentId?: string; index: number } | undefined {
  if (root.id === id) return { node: root, parentId, index: 0 }
  for (const [index, child] of (root.children ?? []).entries()) {
    if (child.id === id) return { node: child, parentId: root.id, index }
    const found = findPromptNode(child, id, root.id)
    if (found) return found
  }
  return undefined
}

function resolveAssetPlacement(
  root: PromptResourceContent['rootNode'],
  targetId: string,
  position: 'before' | 'inside' | 'after',
): { parentId: string; orderIndex: number } {
  const target = findPromptNode(root, targetId)
  if (!target) throw new Error(`Prompt asset target not found: ${targetId}`)
  if (position === 'inside') {
    if (!['module', 'folder', 'message'].includes(target.node.kind)) throw new Error(`Prompt asset target cannot contain children: ${targetId}`)
    return { parentId: target.node.id, orderIndex: target.node.children?.length ?? 0 }
  }
  if (!target.parentId) throw new Error(`Prompt asset cannot be placed beside the root: ${targetId}`)
  return { parentId: target.parentId, orderIndex: target.index + (position === 'after' ? 1 : 0) }
}

function buildInsertionReorderMutations(
  root: PromptResourceContent['rootNode'],
  parentId: string,
  insertedIndex: number,
): PromptResourceMutation[] {
  const parent = findPromptNode(root, parentId)?.node
  if (!parent) return []
  return ((parent.children ?? []) as PromptResourceNode[])
    .filter((_: PromptResourceNode, index: number) => index >= insertedIndex)
    .map((node: PromptResourceNode, offset: number) => ({
      kind: 'node.move' as const,
      nodeId: node.id,
      parentId,
      orderIndex: insertedIndex + offset + 1,
    }))
}

function buildMoveMutations(
  root: PromptResourceContent['rootNode'],
  nodeId: string,
  placement: { parentId: string; orderIndex: number },
): PromptResourceMutation[] {
  const source = findPromptNode(root, nodeId)
  if (!source) throw new Error(`Prompt asset not found: ${nodeId}`)
  if (!source.parentId) throw new Error(`Prompt asset cannot be moved: ${nodeId}`)
  if (source.node.kind === 'module') throw new Error(`Prompt asset cannot be moved: ${nodeId}`)
  assertPromptAssetPlacement(root, placement.parentId, source.node)
  if (findPromptNode(source.node, placement.parentId)) throw new Error('Cannot move prompt asset inside its own subtree')

  const sourceSiblings = (findPromptNode(root, source.parentId)!.node.children ?? []).map(child => child.id)
  const destinationSiblings = placement.parentId === source.parentId
    ? sourceSiblings
    : (findPromptNode(root, placement.parentId)!.node.children ?? []).map(child => child.id)
  const nextSource = sourceSiblings.filter(id => id !== nodeId)
  const nextDestination = placement.parentId === source.parentId ? nextSource : destinationSiblings.filter(id => id !== nodeId)
  const insertAt = Math.max(0, Math.min(placement.orderIndex, nextDestination.length))
  nextDestination.splice(insertAt, 0, nodeId)
  const siblingLists = placement.parentId === source.parentId
    ? [{ parentId: source.parentId, current: sourceSiblings, desired: nextDestination }]
    : [
      { parentId: source.parentId, current: sourceSiblings, desired: nextSource },
      { parentId: placement.parentId, current: destinationSiblings, desired: nextDestination },
    ]

  const mutations: PromptResourceMutation[] = []
  for (const { parentId, current, desired } of siblingLists) {
    for (const [orderIndex, childId] of desired.entries()) {
      if (current[orderIndex] === childId && childId !== nodeId) continue
      if (childId === nodeId || current[orderIndex] !== childId) {
        mutations.push({ kind: 'node.move', nodeId: childId, parentId, orderIndex })
      }
    }
  }
  return mutations
}

async function updatePromptResourceAssets(input: {
  ctx: Pick<ApplicationRuntimeContext, 'promptResources'>
  requestContext?: RuntimeRequestContext
  resourceId: string
  expectedVersion?: number
  updates: Array<{
    assetId: string
    body?: string
    capabilities?: PromptResourceContent['rootNode']['capabilities']
    enabled?: boolean
    label?: string
    meta?: string
    orderList?: string[]
  }>
}): Promise<UpdatePromptResourceResult> {
  const current = await input.ctx.promptResources.getResource(input.resourceId)
  if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
  const mapped = fromStoredResource(current)
  const patches = new Map(input.updates.map(update => [update.assetId, update]))
  function applyUpdates(node: PromptResourceNode): PromptResourceNode {
    const update = patches.get(node.id)
    return { ...node, ...(update ?? {}), ...(node.children ? { children: node.children.map(applyUpdates) } : {}) }
  }
  const nextRoot = applyUpdates(mapped.rootNode)
  for (const update of input.updates) {
    const target = findPromptNode(nextRoot, update.assetId)
    const previous = findPromptNode(mapped.rootNode, update.assetId)?.node
    if (target?.parentId && update.capabilities?.targetAnchorId !== undefined
      && update.capabilities.targetAnchorId !== previous?.capabilities?.targetAnchorId) {
      assertPromptAssetPlacement(nextRoot, target.parentId, target.node)
    }
    if (target) assertTextContributionTarget(target.node)
  }
  const mutations: PromptResourceMutation[] = input.updates.map(update => {
    let extra: PromptResourceNode['extra']
    if (update.orderList !== undefined || update.capabilities?.projection !== undefined) {
      extra = { ...(findPromptNode(current.rootNode, update.assetId)?.node.extra ?? {}) }
      if (update.orderList !== undefined) extra.orderList = update.orderList
      if (update.capabilities?.projection !== undefined) delete extra.projection
    }
    return {
      kind: 'node.update',
      nodeId: update.assetId,
      patch: {
        ...(update.label === undefined ? {} : { label: update.label }),
        ...(update.body === undefined ? {} : { body: update.body }),
        ...(update.capabilities === undefined ? {} : { capabilities: normalizeAuthorCapabilities(update.capabilities) }),
        ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
        ...(update.meta === undefined ? {} : { meta: update.meta }),
        ...(extra === undefined ? {} : { extra }),
      },
    }
  })
  const result = await input.ctx.promptResources.mutateResource({
    ...promptResourceWriteContext(input.requestContext),
    reason: 'application.updatePromptResourceAssets',
    resourceId: input.resourceId,
    expectedVersion: input.expectedVersion ?? current.version,
    mutations,
  })
  return {
    resource: fromStoredResource(result.resource),
    mutation: { changesetId: result.commit.changesetId },
  }
}

function assertPromptAssetPlacement(root: PromptResourceNode, parentId: string, asset: PromptResourceNode): void {
  if (!canPlacePromptNode(root, parentId, asset)) throw new Error('Invalid Prompt placement: Message blocks and message sequences must remain outside other Message blocks; inlets cannot contain children')
}

function assertTextContributionTarget(node: PromptResourceNode): void {
  if (node.kind !== 'virtual' && node.capabilities?.targetAnchorId
    && promptAnchorOutput(node.capabilities.targetAnchorId) === 'messages') {
    throw new Error('Text contributions cannot target a message sequence')
  }
  for (const child of node.children ?? []) assertTextContributionTarget(child)
}
