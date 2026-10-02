import type { PromptResourceMutation, PromptResourceMutationResult } from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, writeDocument } from '../foundation/document-store.js'
import {
  fromStoredResource,
  listMappedResources,
  readMappedResource,
  toStoredNodeDraft,
  toStoredResourceInput,
} from '../prompt/prompt-resource-mapper.js'
import { applyDefaultPromptProjection, isPromptResourceArtifact, normalizePromptResourceArtifact } from '../cards/workspace-codec.js'
import defaultPresetTemplate from '../prompt/default-preset.json' with { type: 'json' }
import type { PromptResourceNode } from '../cards/workspace-types.js'
import { validateTextTransformRuleDraft, type TextTransformRuleDraft } from '../transforms/history-text.js'
import { revertApplicationStateChangeset } from '../state/state.js'
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
  ListSettingMountsInput,
  ListSettingMountsResult,
  MovePromptResourceAssetInput,
  MutationReceipt,
  PromptResourceContent,
  ReplaceSettingMountsInput,
  ReplaceSettingMountsResult,
  RevertPromptResourceChangesetInput,
  RevertPromptResourceChangesetResult,
  RuntimeRequestContext,
  TextTransformRuleContent,
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
import { normalizeMacroOptions } from '@loom-studio/shared'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import type { LoomScriptAttachmentArtifact, LoomScriptContent, LoomScriptMountContent } from '../scripts/loom-script-contracts.js'

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

    listPromptResources: async (input?: ListPromptResourcesInput): Promise<ListPromptResourcesResult> => ({
      resources: await listMappedResources(ctx.promptResources, input?.resourceKind),
    }),

    getPromptResourceBindings: async (input: GetPromptResourceInput): Promise<GetPromptResourceBindingsResult> => {
      if (!await ctx.promptResources.hasResource(input.resourceId)) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const [cards, mounts] = await Promise.all([
        ctx.documents.listCardBindings({ type: applicationDocumentTypes.cardSource, resourceId: input.resourceId }),
        ctx.promptResources.listSettingMounts({ settingResourceId: input.resourceId }),
      ])
      return {
        resourceId: input.resourceId,
        cards,
        settingMounts: mounts,
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
      const sourceContent = await readMappedResource(ctx.promptResources, input.resourceId)
      const duplicateContent = clonePromptResourceContent(sourceContent, ctx.createId, input.name?.trim() || `${sourceContent.rootNode.label} Copy`)
      const sourceMounts = source.resourceKind === 'preset'
        ? await ctx.promptResources.listSettingMounts({ source: { kind: 'preset', id: source.id } })
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
        const mounts = sourceMounts.map(mount => resourceTx.addSettingMount({
          source: { kind: 'preset', id: created.id },
          settingResourceId: mount.resolvedSettingResourceId === null ? null : mount.resolvedSettingResourceId ?? mount.settingResourceId,
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
      if (resource.resourceKind === 'setting') {
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
      const ownedRules = resource.resourceKind === 'preset'
        ? (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
          .filter(rule => rule.content.owner.kind === 'preset' && rule.content.owner.presetId === input.resourceId)
        : []
      const documentParticipant = requireDocumentParticipant(ctx)
      const transaction = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.deletePromptResource',
      }, async dataTx => {
        const resourceTx = ctx.promptResources.transaction(dataTx)
        return await documentParticipant.participateTransaction(dataTx, async documents => {
          for (const rule of ownedRules) await documents.delete({ id: rule.id, expectedVersion: rule.version })
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
        resourceKind: artifact.resourceKind,
        rootNode: clonePromptResourceNode(artifact.rootNode, ctx.createId),
        ...(artifact.resourceKind === 'preset' ? { historyPolicy: 'persistent' as const } : {}),
        ...(artifact.macros !== undefined ? { macros: normalizeMacros(artifact.macros, 'Preset') } : {}),
        ...(artifact.macroOptions !== undefined ? { macroOptions: normalizeMacroOptions(artifact.macroOptions) } : {}),
        ...(artifact.useCardSettings !== undefined ? { useCardSettings: artifact.useCardSettings } : {}),
        ...(artifact.textUses !== undefined ? { textUses: structuredClone(artifact.textUses) } : {}),
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
      }
      const result = await importPromptResourceContent(ctx, content, artifact.scriptAttachments ?? [], requestContext, artifact.textTransformRules, artifact.settingMounts)
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    exportPromptResource: async (input: ExportPromptResourceInput): Promise<ExportPromptResourceResult> => {
      const resource = await readMappedResource(ctx.promptResources, input.resourceId)
      const mounts = resource.resourceKind === 'preset'
        ? await ctx.promptResources.listSettingMounts({ source: { kind: 'preset', id: resource.id } })
        : []
      return {
        artifact: {
          format: 'loom.promptResource' as const,
          schemaVersion: 2 as const,
          resourceKind: resource.resourceKind,
          rootNode: resource.rootNode,
          ...(resource.macros !== undefined ? { macros: structuredClone(resource.macros) } : {}),
          ...(resource.macroOptions !== undefined ? { macroOptions: structuredClone(resource.macroOptions) } : {}),
          ...(resource.useCardSettings !== undefined ? { useCardSettings: resource.useCardSettings } : {}),
          ...(resource.textUses !== undefined ? { textUses: resource.textUses.map(use => ({
            ...structuredClone(use),
            reference: use.reference ?? { kind: 'external' as const, resourceId: use.id },
          })) } : {}),
          ...(mounts.length ? { settingMounts: mounts.map(mount =>
            structuredClone(mount.reference ?? { kind: 'external' as const, resourceId: mount.settingResourceId })) } : {}),
        },
      }
    },

    listSettingMounts: async (input?: ListSettingMountsInput): Promise<ListSettingMountsResult> => ({
      mounts: await ctx.promptResources.listSettingMounts({ source: input?.source }),
    }),

    replaceSettingMounts: async (input: ReplaceSettingMountsInput, requestContext?: RuntimeRequestContext): Promise<ReplaceSettingMountsResult> => {
      if ((input.mounts === undefined) === (input.settingResourceIds === undefined)) throw new Error('Specify exactly one Setting mount list')
      const existing = input.mounts ? await ctx.promptResources.listSettingMounts({ source: input.source }) : []
      const mounts = await Promise.all((input.mounts ?? input.settingResourceIds?.map(settingResourceId => ({ settingResourceId })) ?? [])
        .map(async (mount, orderIndex) => {
          if ('id' in mount) {
            const previous = existing.find(item => item.id === mount.id)
            if (!previous) throw new Error(`Setting mount not found in this source: ${mount.id}`)
            const resourceId = previous.resolvedSettingResourceId === null ? null : previous.resolvedSettingResourceId ?? previous.settingResourceId
            const available = resourceId ? await ctx.promptResources.getResource(resourceId) : null
            return { settingResourceId: available ? resourceId : null,
              reference: previous.reference ?? { kind: 'external' as const, resourceId: previous.settingResourceId },
              orderIndex, origin: previous.origin }
          }
          return { settingResourceId: mount.settingResourceId, orderIndex }
        }))
      for (const settingId of mounts.flatMap(mount => mount.settingResourceId ? [mount.settingResourceId] : [])) {
        const setting = await ctx.promptResources.getResource(settingId)
        if (!setting) throw new Error(`Prompt resource not found: ${settingId}`)
        if (setting.resourceKind !== 'setting') throw new Error(`Prompt resource ${settingId} can only link Setting resources`)
      }
      const result = await ctx.promptResources.replaceSettingMounts({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.replaceSettingMounts',
        source: input.source,
        mounts,
      })
      return { mounts: result.mounts, mutation: { changesetId: result.commit.changesetId } }
    },

    createPromptResourceAsset: async (input: CreatePromptResourceAssetInput, requestContext?: RuntimeRequestContext): Promise<UpdatePromptResourceResult> => {
      const current = await ctx.promptResources.getResource(input.resourceId)
      if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const placement = resolveAssetPlacement(fromStoredResource(current).rootNode, input.targetAssetId, input.position)
      const asset = applyDefaultPromptProjection(input.asset, fromStoredResource(current))
      const mutation: PromptResourceMutation = { kind: 'node.create', parentId: placement.parentId, node: toStoredNodeDraft(asset) }
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext), reason: 'application.createPromptResourceAsset',
        resourceId: input.resourceId, expectedVersion: current.version,
        mutations: [{ ...mutation, node: { ...mutation.node, orderIndex: placement.orderIndex } }, ...buildInsertionReorderMutations(fromStoredResource(current).rootNode, placement.parentId, placement.orderIndex)],
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
      const placement = resolveAssetPlacement(fromStoredResource(current).rootNode, input.targetAssetId, input.position)
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext), reason: 'application.movePromptResourceAsset',
        resourceId: input.resourceId, expectedVersion: current.version,
        mutations: buildMoveMutations(fromStoredResource(current).rootNode, input.assetId, placement),
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
      const current = await readMappedResource(ctx.promptResources, input.resourceId)
      if (current.resourceKind !== 'preset') throw new Error(`Macro configuration requires a Preset resource: ${input.resourceId}`)
      const macros = normalizeMacros(input.macros, 'Preset')
      const stored = await ctx.promptResources.getResource(input.resourceId)
      if (!stored) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.updatePromptResourceMacros',
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        mutations: [{
          kind: 'resource.update',
          patch: {
            metadata: {
              ...stored.metadata,
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
      if (stateRevision) {
        const documentChangeset = await ctx.documents.getChangeset(input.changesetId)
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
  settingMounts?: NonNullable<import('../cards/workspace-types.js').PromptResourceArtifact['settingMounts']>,
): Promise<PromptResourceMutationResult> {
  if (attachments.length > 0 && !ctx.blobs) throw new Error('Blob Store is required to import Loom Script attachments')
  const preparedResults = await Promise.allSettled(attachments.map(async attachment => ({
    attachment,
    metadata: parseLoomScriptSource(attachment.script.source),
    blob: await ctx.blobs!.prepareWrite({
      source: new TextEncoder().encode(attachment.script.source),
      mediaType: 'text/javascript',
    }),
  })))
  const prepared = preparedResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failedPreparation = preparedResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failedPreparation) {
    await Promise.all(prepared.map(item => ctx.blobs!.discardPreparedWrite(item.blob)))
    throw failedPreparation.reason
  }
  try {
    const transaction = await ctx.dataEngine.transact({
      ...promptResourceWriteContext(requestContext),
      reason: 'application.importPromptResource',
    }, async dataTx => {
    const resourceTx = ctx.promptResources.transaction(dataTx)
    const resource = resourceTx.createResource(toStoredResourceInput({ content }))
    for (const [orderIndex, reference] of (settingMounts ?? []).entries()) {
      resourceTx.addSettingMount({
        source: { kind: 'preset', id: resource.id },
        settingResourceId: null,
        reference, orderIndex,
      })
    }
    if (content.resourceKind === 'preset' && (prepared.length > 0 || textTransformRules?.length)) await requireDocumentParticipant(ctx).participateTransaction(dataTx, async documentTx => {
      for (const [index, rule] of (textTransformRules ?? []).entries()) {
        validateTextTransformRuleDraft({ ...rule, owner: { kind: 'preset', presetId: resource.id } })
        await writeDocument<TextTransformRuleContent>(documentTx, {
          id: `${resource.id}.rule.${String(index).padStart(6, '0')}`,
          type: applicationDocumentTypes.textTransformRule,
          content: {
            ...structuredClone(rule),
            owner: { kind: 'preset', presetId: resource.id },
            createdAt: content.createdAt,
            updatedAt: content.updatedAt,
          },
          expectedVersion: 'new',
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
              mediaType: 'text/javascript',
              fileName: item.attachment.script.fileName,
            },
            sourceDigest: blob.sha256,
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
            origin: { kind: 'prompt-resource-import' },
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
  } catch (error) {
    await Promise.all(prepared.map(item => ctx.blobs!.discardPreparedWrite(item.blob)))
    throw error
  }
}

export function createEmptyPromptResourceContent(
  createId: (prefix: string) => string,
  name: string,
  resourceKind: PromptResourceContent['resourceKind'],
  timestamp: string,
): PromptResourceContent {
  if (resourceKind === 'preset') {
    if (!isPromptResourceArtifact(defaultPresetTemplate)) throw new Error('Invalid bundled default preset')
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
    meta: resourceKind === 'setting' ? 'Setting Layer' : 'Prompt Resource',
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

function findPromptNode(
  root: PromptResourceContent['rootNode'],
  id: string,
  parentId?: string,
): { node: PromptResourceContent['rootNode']; parentId?: string; index: number } | undefined {
  if (root.id === id) return { node: root, parentId, index: 0 }
  for (const [index, child] of ((root.children ?? []) as PromptResourceNode[]).entries()) {
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
    if (target.node.kind === 'entry' || target.node.kind === 'script') throw new Error(`Prompt asset target cannot contain children: ${targetId}`)
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
  if (findPromptNode(source.node, placement.parentId)) throw new Error('Cannot move prompt asset inside its own subtree')

  const siblingLists = new Map<string, string[]>()
  const visit = (parent: PromptResourceContent['rootNode']): void => {
    siblingLists.set(parent.id, ((parent.children ?? []) as PromptResourceNode[]).map((child: PromptResourceNode) => child.id))
    parent.children?.forEach(visit)
  }
  visit(root)
  const sourceSiblings = siblingLists.get(source.parentId) ?? []
  const destinationSiblings = siblingLists.get(placement.parentId) ?? []
  const nextSource = sourceSiblings.filter(id => id !== nodeId)
  const nextDestination = placement.parentId === source.parentId ? nextSource : destinationSiblings.filter(id => id !== nodeId)
  const insertAt = Math.max(0, Math.min(placement.orderIndex, nextDestination.length))
  nextDestination.splice(insertAt, 0, nodeId)
  siblingLists.set(source.parentId, nextSource)
  siblingLists.set(placement.parentId, nextDestination)

  const mutations: PromptResourceMutation[] = []
  for (const [parentId, desired] of siblingLists) {
    const currentParent = findPromptNode(root, parentId)?.node
    const current = ((currentParent?.children ?? []) as PromptResourceNode[]).map((child: PromptResourceNode) => child.id)
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
  const currentTree = fromStoredResource(current).rootNode
  const mutations: PromptResourceMutation[] = input.updates.map(update => ({
    kind: 'node.update',
    nodeId: update.assetId,
    patch: {
      ...(update.label === undefined ? {} : { label: update.label }),
      ...(update.body === undefined ? {} : { body: update.body }),
      ...(update.capabilities === undefined ? {} : { capabilities: update.capabilities }),
      ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
      ...(update.meta === undefined ? {} : { meta: update.meta }),
      ...(update.orderList === undefined ? {} : {
        extra: {
          ...(findPromptNode(currentTree, update.assetId) ? (toStoredNodeDraft(findPromptNode(currentTree, update.assetId)!.node).extra ?? {}) : {}),
          ...(update.orderList === undefined ? {} : { orderList: update.orderList }),
        },
      }),
    },
  }))
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
