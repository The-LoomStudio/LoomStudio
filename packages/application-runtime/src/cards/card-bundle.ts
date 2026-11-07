import type { PortableExtensionPayloadArtifact, PortableExtensionPayloadContent } from '../extensions/portable-payload-types.js'
import type { PromptResourceContent, PromptResourceNode } from '../prompt/prompt-resource-types.js'
import { resolveTextTransformContributionRule, resolveLoomScriptSettings } from '@loom-studio/shared/loom-scripts'
import { parseCardFrameworkFields, withCardFramework } from './card-framework.js'
import { loomScriptMediaType } from '@loom-studio/shared/loom-scripts'
import type { DocumentRecord, DocumentStore, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { PromptResourceStore } from '@loom-studio/application-data'
import { createId, nowIso } from '@loom-studio/shared'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { normalizeCardEditableFields, readCardEditableFields } from './card-fields.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import type {
  ApplicationRuntimeOptions,
  CardMediaRefs,
  CardSourceContent,
  RuntimeRequestContext,
} from '../types.js'
import type {
  PromptContribution,
  SourceNode,
} from '../prompt/prompt-builder.js'
import { fromStoredResource } from '../prompt/prompt-resource-mapper.js'
import type { VariableRenderContext } from '../prompt/variables.js'
import { validateStateDefinitionDraft, validateTimelineStateBinding } from '../state/state-definition.js'
import { createStateArtifact } from '../state/state-contribution.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import { allocateImportedTextResourceIds, exportScriptTextResourceIds, importedTextResourceReferences, prepareTextTransformScript, rebaseScriptTextResourceReferences, remapImportedTextUses, writePreparedTextTransformScript } from '../scripts/script-text-resources.js'
import type {
  TextExtractorContent,
  TextTransformRuleContent,
} from '../transforms/history-text.js'
import type { LoomScriptAttachmentArtifact, LoomScriptContent, LoomScriptMountContent } from '../scripts/loom-script-contracts.js'
import type {
  BlobStorage,
  StateDefinitionContent,
} from '../types.js'
import type {
  CardBundleArtifact,
  CardBundleImportManifest,
  CardBundleSourceArtifactRef,
  ImportBundleContent,
} from './card-bundle-types.js'
import {
  collectPromptInputs,
  createSourceArtifactRef,
  findNodes,
  normalizeCardBundleArtifact,
  sameTimelineTemplate,
  toPortableExtensionPayloadArtifact,
} from './card-bundle-codec.js'

export {
  isPromptResourceArtifact,
  normalizePromptResourceArtifact,
} from './card-bundle-codec.js'

export type { CardBundleArtifact } from './card-bundle-types.js'

const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const

function requireSqliteDocumentParticipant(documents: DocumentStore): SqliteDocumentStore {
  const participant = documents as Partial<SqliteDocumentStore>
  if (typeof participant.participateTransaction !== 'function') {
    throw new Error('Shared Sqlite Document Store participant is required')
  }
  return documents as SqliteDocumentStore
}

export async function importCardBundle(input: {
  newCardId?: string
  artifact: CardBundleArtifact
  storedSourceArtifact?: Pick<
    CardBundleSourceArtifactRef,
    'sourceArtifactId' | 'blobId' | 'sha256' | 'sizeBytes' | 'originalFileName' | 'mediaType'
  >
  context?: RuntimeRequestContext
  documents: DocumentStore
  promptResources: PromptResourceStore
  dataEngine: import('@loom-studio/data-engine').SqliteDataEngine
  blobs?: BlobStorage
  now?: string
}): Promise<{
  card: CardSourceContent & { id: string; version: number }
  importBundle: ImportBundleContent & { id: string; version: number }
}> {
  const artifact = normalizeCardBundleArtifact(input.artifact)
  const stateContribution = artifact.state?.contribution
  const artifactStateTemplates = stateContribution?.templates ?? artifact.stateTemplates ?? []
  const artifactStateBindings = stateContribution?.bindings ?? artifact.timelineStateBindings ?? []
  const timestamp = input.now ?? nowIso()
  const sourceArtifactRef = createSourceArtifactRef(artifact, timestamp, input.storedSourceArtifact)
  const { nodes: contextAssets, idMap: importedNodeIds } = await cloneConflictingPromptNodes(input.promptResources, artifact.contextAssets)
  const scriptAttachments = artifact.scriptAttachments ?? []
  const documentParticipant = requireSqliteDocumentParticipant(input.documents)
  const extensionPackages = artifact.extensionPackages ?? []
  if ((scriptAttachments.length > 0 || extensionPackages.length > 0 || artifact.textTransformRules?.length) && !input.blobs) throw new Error('Blob Store is required to import Card attachments')
  const preparedRules = await Promise.all((artifact.textTransformRules ?? []).map(async rule => ({
    rule,
    ...await prepareTextTransformScript(input.blobs!, { ...rule, owner: { kind: 'workspace' }, createdAt: timestamp, updatedAt: timestamp }),
  })))
  const preparedScriptResults = await Promise.allSettled(scriptAttachments.map(async attachment => {
    const metadata = parseLoomScriptSource(attachment.script.source)
    return { attachment, metadata, textResourceIds: allocateImportedTextResourceIds(metadata, attachment, createId),
      prepared: await input.blobs!.prepareWrite({
      source: new TextEncoder().encode(attachment.script.source),
      mediaType: loomScriptMediaType(attachment.script.fileName),
    }) }
  }))
  const preparedScripts = preparedScriptResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failedPreparation = preparedScriptResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failedPreparation) {
    throw failedPreparation.reason
  }
  if (new Set(preparedScripts.map(item => item.metadata.metadataId)).size !== preparedScripts.length) throw new Error('Card Script metadataId must be unique within its package')
  const textResourceReferences = importedTextResourceReferences(preparedScripts)
  const preparedPackageResults = await Promise.allSettled(extensionPackages.map(async archive => ({
    archive,
    prepared: await input.blobs!.prepareWrite({
      source: Buffer.from(archive.archiveBase64, 'base64'), mediaType: 'application/zip',
    }),
  })))
  const preparedPackages = preparedPackageResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failedPackagePreparation = preparedPackageResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failedPackagePreparation) {
    throw failedPackagePreparation.reason
  }

  const transaction = await withCardFramework(input, artifact.card, () => input.dataEngine.transact({
      actor: input.context?.actor
        ?? (input.context?.clientId ? { kind: 'client', id: input.context.clientId } : applicationActor),
      reason: 'application.importCardBundle',
      correlationId: input.context?.correlationId,
      callId: input.context?.callId,
      parentCallId: input.context?.parentCallId,
    }, async dataTx => {
    const resourceTx = input.promptResources.transaction(dataTx)
    return documentParticipant.participateTransaction(dataTx, async tx => {
      const cardId = input.newCardId ?? createId('card')
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(cardId)) throw new Error('Invalid new Card ID')
      const importBundleId = createId('import-bundle')
      const textPipelineDocumentIds: string[] = []
      const scriptDocumentIds: string[] = []
      const scriptMappings: Record<string, string> = {}
      const scriptMountIds: string[] = []
      for (const item of preparedRules) {
        const mountId = createId('loom-script-mount')
        const script = await writePreparedTextTransformScript(tx, {
          scriptId: createId('loom-script'), mountId, ruleId: createId('text-transform-rule'),
          rule: { ...structuredClone(item.rule), owner: { kind: 'card', cardId }, createdAt: timestamp, updatedAt: timestamp },
          metadata: item.metadata, blob: input.blobs!.participateWrite(dataTx, item.prepared).blob,
        })
        scriptDocumentIds.push(script.id)
        scriptMountIds.push(mountId)
      }
      for (const extractor of artifact.textExtractors ?? []) {
        const document = await writeDocument<TextExtractorContent>(tx, {
          id: createId('text-extractor'),
          type: applicationDocumentTypes.textExtractor,
          content: { ...structuredClone(extractor), owner: { kind: 'card', cardId }, createdAt: timestamp, updatedAt: timestamp },
          expectedVersion: 'new',
        })
        textPipelineDocumentIds.push(document.id)
      }
      const storedResources = contextAssets.map((node, index) => resourceTx.createResource({
        id: createId('prompt-resource'),
        resourceKind: node.category ?? 'prompt',
        label: node.label,
        metadata: { ...artifact.contextAssetSettings?.[artifact.contextAssets[index]!.id], sourceArtifactRef,
          ...(artifact.contextAssetSettings?.[artifact.contextAssets[index]!.id]?.textUses ? {
            textUses: remapImportedTextUses(artifact.contextAssetSettings[artifact.contextAssets[index]!.id]!.textUses, textResourceReferences),
          } : {}),
        },
        rootNode: node,
      }))
      const resourceIds = storedResources.map(resource => resource.id)
      const portablePayloadDocuments: DocumentRecord<PortableExtensionPayloadContent>[] = []
      for (const payload of artifact.extensionPayloads ?? []) {
        const { id: artifactPayloadId, ...portablePayload } = payload
        portablePayloadDocuments.push(await writeDocument<PortableExtensionPayloadContent>(tx, {
          id: createId('portable-payload'),
          type: applicationDocumentTypes.portableExtensionPayload,
          content: {
            ...structuredClone(portablePayload),
            ownerInstallationId: extensionInstallationId(portablePayload.packageId, { kind: 'card', cardId }),
            artifactPayloadId,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        }))
      }
      const portableExtensionPayloadIds = portablePayloadDocuments.map(document => document.id)
      for (const item of preparedScripts) {
        const blob = input.blobs!.participateWrite(dataTx, item.prepared).blob
        const script = await writeDocument<LoomScriptContent>(tx, {
          id: createId('loom-script'),
          type: applicationDocumentTypes.loomScript,
          content: {
            owner: { kind: 'card', cardId },
            ...item.metadata,
            source: {
              blobId: blob.id,
              mediaType: loomScriptMediaType(item.attachment.script.fileName),
              fileName: item.attachment.script.fileName,
            },
            sourceDigest: blob.sha256,
            loreNodeReferences: { ...Object.fromEntries(importedNodeIds), ...Object.fromEntries(Object.entries(item.attachment.loreNodeReferences ?? {}).map(([original, nodeId]) => [original, importedNodeIds.get(nodeId) ?? nodeId])) },
            loreResourceReferences: Object.fromEntries(Object.entries(item.attachment.loreResourceReferences ?? {}).map(([original, resourceId]) => [original,
              storedResources.find((_, index) => artifact.contextAssets[index]!.id === resourceId)?.id ?? resourceId])),
            textResourceIds: item.textResourceIds,
            textResourceReferences: rebaseScriptTextResourceReferences(item.attachment, textResourceReferences),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })
        const mount = await writeDocument<LoomScriptMountContent>(tx, {
          id: createId('loom-script-mount'),
          type: applicationDocumentTypes.loomScriptMount,
          content: {
            target: { kind: 'card', cardId },
            scriptDocumentId: script.id,
            enabled: false,
            runtimeRevision: 0,
            orderIndex: item.attachment.orderIndex,
            grantedCapabilities: [],
            ...(item.attachment.settings ? { settings: item.attachment.settings } : {}),
            ...(item.attachment.ruleUsage ? { ruleUsage: item.attachment.ruleUsage } : {}),
            origin: {
              kind: 'card-bundle-import', artifactId: artifact.artifactId,
              orderOverride: true, ...(item.attachment.groupOrder !== undefined ? { groupOrder: item.attachment.groupOrder } : {}),
              ...(item.attachment.resourceOrigin !== undefined ? { resourceOrigin: item.attachment.resourceOrigin } : {}),
            },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })
        Object.defineProperty(scriptMappings, item.metadata.metadataId, { value: script.id, enumerable: true })
        scriptDocumentIds.push(script.id)
        scriptMountIds.push(mount.id)
      }
      const stateDefinitionIds: string[] = []
      for (const template of artifactStateTemplates) {
        const definition = {
          kind: 'timeline-template' as const,
          templateVersion: template.templateVersion,
          schema: template.schema,
          initial: template.initial,
          ...(template.componentKey !== undefined ? { componentKey: template.componentKey } : {}),
          ...(template.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...template.targetEntityTypeIds] } : {}),
          ...(template.label !== undefined ? { label: template.label } : {}),
        }
        validateStateDefinitionDraft(definition)
        const existing = await tx.get(template.id)
        if (existing) {
          if (existing.type !== applicationDocumentTypes.stateDefinition
            || !sameTimelineTemplate(existing.content, definition)) {
            throw new Error(`State template identity conflict: ${template.id}`)
          }
        } else {
          await writeDocument<StateDefinitionContent>(tx, {
            id: template.id,
            type: applicationDocumentTypes.stateDefinition,
            content: { ...definition, createdAt: timestamp, updatedAt: timestamp },
            expectedVersion: 'new',
          })
        }
        stateDefinitionIds.push(template.id)
      }
      const artifactTemplates = new Map(artifactStateTemplates.map(template => [template.id, template]))
      for (const binding of artifactStateBindings) {
        validateTimelineStateBinding(binding)
        const template = artifactTemplates.get(binding.templateId)
        if (!template) throw new Error(`Timeline State Binding template is missing from Card Bundle: ${binding.templateId}`)
        if (template.templateVersion !== binding.templateVersion) {
          throw new Error(`Timeline State Binding template version mismatch: ${binding.templateId}`)
        }
      }
      const card = await writeDocument<CardSourceContent>(tx, {
        id: cardId,
        type: applicationDocumentTypes.cardSource,
        content: {
          artifactId: artifact.artifactId,
          ...(artifact.derivedFrom ? { derivedFrom: structuredClone(artifact.derivedFrom) } : {}),
          ...normalizeCardEditableFields(artifact.card),
          ...parseCardFrameworkFields(artifact.card),
          media: artifact.card.media,
          importBundleId,
          portableExtensionPayloadIds,
          extensionPackages: preparedPackages.map(item => ({
            packageId: item.archive.packageId,
            version: item.archive.version,
            blobId: input.blobs!.participateWrite(dataTx, item.prepared).blob.id,
          })),
          promptResourceIds: resourceIds,
          ...(artifact.externalContextAssetIds !== undefined ? {
            externalPromptResourceIds: resourceIds.filter((_, index) =>
              artifact.externalContextAssetIds!.includes(artifact.contextAssets[index]!.id)),
          } : {}),
          stateDefinitionIds,
          ...(stateContribution ? { stateEntityTypes: structuredClone(stateContribution.entityTypes) } : {}),
          ...(stateContribution ? { timelineStateEntities: structuredClone(stateContribution.entities) } : {}),
          ...(stateContribution ? { timelineComponentMounts: structuredClone(stateContribution.componentMounts) } : {}),
          timelineStateBindings: structuredClone(artifactStateBindings),
          ...(artifact.card.stateContributionIds !== undefined ? { stateContributionIds: [...artifact.card.stateContributionIds] } : {}),
          ...(artifact.card.extensionAdoptions !== undefined ? { extensionAdoptions: structuredClone(artifact.card.extensionAdoptions) } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })
      const bindings = storedResources.filter(resource => resource.rootNode.kind === 'module' && (resource.rootNode.category === 'lore' || resource.rootNode.category === 'preset')).map(resource => ({
        id: createId('binding'),
        relationship: 'recommends' as const,
        createdAt: timestamp,
        from: { documentId: card.id, documentType: applicationDocumentTypes.cardSource },
        to: { resourceId: resource.id, resourceKind: resource.resourceKind, nodeId: resource.rootNode.id },
      }))
      const importBundle = await writeDocument<ImportBundleContent>(tx, {
        id: importBundleId,
        type: applicationDocumentTypes.importBundle,
        content: {
          cardId: card.id,
          documentIds: [card.id, importBundleId, ...stateDefinitionIds, ...portableExtensionPayloadIds, ...scriptDocumentIds, ...scriptMountIds, ...textPipelineDocumentIds],
          promptResourceIds: resourceIds,
          assetIds: readCardAssetIds(artifact.card.media),
          sourceArtifact: artifact,
          resourceMappings: {
            scripts: scriptMappings,
            extensions: Object.fromEntries(preparedPackages.map(item => [item.archive.packageId, item.prepared.blob.id])),
            resources: Object.fromEntries(artifact.contextAssets.map((root, index) => [root.id, resourceIds[index]!])),
            nodes: Object.fromEntries(findNodes(artifact.contextAssets, () => true).map(node => [node.id, importedNodeIds.get(node.id) ?? node.id])),
          },
          sourceArtifactRef,
          bindings,
          importedAt: timestamp,
        },
        expectedVersion: 'new',
      })
      return { card, importBundle }
    })
    }))

  return {
    card: toVersioned(transaction.value.value.card),
    importBundle: toVersioned(transaction.value.value.importBundle),
  }
}

export async function exportCardArtifact(input: {
  cardId: string
  documents: DocumentStore
  promptResources: PromptResourceStore
  blobs?: BlobStorage
  exportExtensionArchive?: ApplicationRuntimeOptions['exportExtensionArchive']
}): Promise<CardBundleArtifact> {
  const card = await readDocument<CardSourceContent>(input.documents, input.cardId, applicationDocumentTypes.cardSource)
  const importBundle = await readOptionalCardImportBundle(input.documents, card)
  const resources = await Promise.all((card.content.promptResourceIds ?? []).map(async resourceId => {
        const resource = await input.promptResources.getResource(resourceId)
        if (!resource) throw new Error(`Prompt resource not found: ${resourceId}`)
        return fromStoredResource(resource)
      }))
  const contextAssets = resources.map(resource => resource.rootNode)
  const contextAssetSettings = Object.fromEntries(resources.map(resource => [resource.rootNode.id, {
    ...(resource.metadata ? { metadata: resource.metadata } : {}),
    ...(resource.macros !== undefined ? { macros: resource.macros } : {}),
    ...(resource.macroOptions !== undefined ? { macroOptions: resource.macroOptions } : {}),
    ...(resource.useCardLore !== undefined ? { useCardLore: resource.useCardLore } : {}),
    ...(resource.useCardText !== undefined ? { useCardText: resource.useCardText } : {}),
    ...(resource.useGlobalLore !== undefined ? { useGlobalLore: resource.useGlobalLore } : {}),
    ...(resource.useGlobalText !== undefined ? { useGlobalText: resource.useGlobalText } : {}),
    ...(resource.historyPolicy !== undefined ? { historyPolicy: resource.historyPolicy } : {}),
    ...(resource.textUses !== undefined ? { textUses: resource.textUses } : {}),
  }]))
  const inlineTemplates = structuredClone(card.content.stateTemplates ?? [])
  const inlineTemplateIds = new Set(inlineTemplates.map(template => template.id))
  const sharedTemplates = await Promise.all((card.content.stateDefinitionIds ?? [])
    .filter(definitionId => !inlineTemplateIds.has(definitionId))
    .map(async definitionId => {
      const definition = await readDocument<StateDefinitionContent>(input.documents, definitionId, applicationDocumentTypes.stateDefinition)
      if (definition.content.kind !== 'timeline-template') throw new Error(`Card State Definition is not a timeline template: ${definitionId}`)
      return {
        id: definition.id,
        templateVersion: definition.content.templateVersion,
        schema: definition.content.schema,
        initial: definition.content.initial,
        ...(definition.content.componentKey !== undefined ? { componentKey: definition.content.componentKey } : {}),
        ...(definition.content.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...definition.content.targetEntityTypeIds] } : {}),
        ...(definition.content.label !== undefined ? { label: definition.content.label } : {}),
      }
    }))
  const stateTemplates = [...inlineTemplates, ...sharedTemplates]
  const extensionPayloads = await Promise.all((card.content.portableExtensionPayloadIds ?? []).map(async payloadId => {
    const payload = await readDocument<PortableExtensionPayloadContent>(
      input.documents,
      payloadId,
      applicationDocumentTypes.portableExtensionPayload,
    )
    return toPortableExtensionPayloadArtifact(payload.content)
  }))
  const mounts = (await listDocuments<LoomScriptMountContent>(input.documents, applicationDocumentTypes.loomScriptMount))
    .filter(mount => mount.content.target.kind === 'card' && mount.content.target.cardId === input.cardId)
    .sort((left, right) => left.content.orderIndex - right.content.orderIndex || left.id.localeCompare(right.id))
  if (mounts.length > 0 && !input.blobs) throw new Error('Blob Store is required to export Loom Script attachments')
  const scriptAttachments = await Promise.all(mounts.map(async (mount): Promise<LoomScriptAttachmentArtifact> => {
    const script = await readLoomScriptRevision(input.documents, mount.content.scriptDocumentId, mount.content.pinnedDocumentVersion)
    // A Card adoption exports a portable snapshot; importing it creates a new Card-owned copy.
    // Exporting never changes the active Script's owner or uses Metadata to resolve its identity.
    // ponytail: retaining a package contribution binding after import needs an explicit reference attachment protocol.
    const bytes = await input.blobs!.read(script.content.source.blobId)
    return {
      script: {
        format: 'loom.script' as const,
        schemaVersion: 1 as const,
        fileName: script.content.source.fileName,
        source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      },
      orderIndex: mount.content.orderIndex,
      ...(typeof mount.content.origin.groupOrder === 'number' ? { groupOrder: mount.content.origin.groupOrder } : {}),
      ...(mount.content.settings ? { settings: mount.content.settings } : {}),
      ...(mount.content.ruleUsage ? { ruleUsage: mount.content.ruleUsage } : {}),
      ...(script.content.loreNodeReferences ? { loreNodeReferences: script.content.loreNodeReferences } : {}),
      loreResourceReferences: Object.fromEntries(script.content.contributions.flatMap(contribution => contribution.kind === 'text-transform'
        ? resolveTextTransformContributionRule(contribution, resolveLoomScriptSettings(script.content.settings ?? [], mount.content.adoptedSettings ?? {})).loreRefs?.map(ref => {
          const current = script.content.loreResourceReferences?.[ref.resourceId] ?? ref.resourceId
          return [ref.resourceId, resources.find(resource => resource.id === current)?.rootNode.id ?? current]
        }) ?? [] : [])),
      textResourceIds: exportScriptTextResourceIds(script.id, script.content),
      ...(script.content.textResourceReferences ? { textResourceReferences: script.content.textResourceReferences } : {}),
      ...(mount.content.origin.resourceOrigin === 'card' || mount.content.origin.resourceOrigin === 'external'
        ? { resourceOrigin: mount.content.origin.resourceOrigin } : {}),
    }
  }))

  const textTransformRules = (await listDocuments<TextTransformRuleContent>(input.documents, applicationDocumentTypes.textTransformRule))
    .filter(document => document.content.owner.kind === 'card' && document.content.owner.cardId === input.cardId)
    .sort((a, b) => a.content.orderIndex - b.content.orderIndex || a.id.localeCompare(b.id))
    .map(document => stripDocumentMetadata(document.content))
  const textExtractors = (await listDocuments<TextExtractorContent>(input.documents, applicationDocumentTypes.textExtractor))
    .filter(document => document.content.owner.kind === 'card' && document.content.owner.cardId === input.cardId)
    .sort((a, b) => a.content.orderIndex - b.content.orderIndex || a.id.localeCompare(b.id))
    .map(document => stripDocumentMetadata(document.content))
  return {
    ...buildExportArtifact({ card, contextAssets, stateTemplates, extensionPayloads, scriptAttachments, importBundle }),
    contextAssetSettings,
    extensionPackages: await Promise.all((card.content.extensionPackages ?? []).map(async archive => {
      if (!input.blobs) throw new Error('Blob Store is required to export embedded extension packages')
      const storedBytes = await input.blobs.read(archive.blobId)
      const bytes = input.exportExtensionArchive ? await input.exportExtensionArchive({
        archive: storedBytes,
        packageId: archive.packageId,
        version: archive.version,
        installationId: extensionInstallationId(archive.packageId, { kind: 'card', cardId: input.cardId }),
      }) : storedBytes
      return {
        packageId: archive.packageId, version: archive.version,
        archiveBase64: Buffer.from(bytes).toString('base64'),
      }
    })),
    ...(card.content.externalPromptResourceIds !== undefined ? {
      externalContextAssetIds: contextAssets.filter((_, index) =>
        card.content.externalPromptResourceIds!.includes(card.content.promptResourceIds![index]!)).map(node => node.id),
    } : {}),
    textTransformRules,
    textExtractors,
  }
}

async function readLoomScriptRevision(
  documents: DocumentStore,
  scriptDocumentId: string,
  version?: number,
): Promise<DocumentRecord<LoomScriptContent>> {
  const script = await documents.get(scriptDocumentId, version === undefined ? undefined : { version })
  if (!script) throw new Error(`Loom Script revision not found: ${scriptDocumentId}${version === undefined ? '' : `@${version}`}`)
  if (script.type !== applicationDocumentTypes.loomScript) throw new Error(`Unexpected document type for ${scriptDocumentId}: ${script.type}`)
  return script as DocumentRecord<LoomScriptContent>
}

function buildExportArtifact(input: {
  card: DocumentRecord<CardSourceContent>
  contextAssets: PromptResourceNode[]
  stateTemplates: NonNullable<CardBundleArtifact['stateTemplates']>
  extensionPayloads: PortableExtensionPayloadArtifact[]
  scriptAttachments: LoomScriptAttachmentArtifact[]
  importBundle?: DocumentRecord<ImportBundleContent>
}): CardBundleArtifact {
  const cardContent = input.card.content
  if (typeof cardContent.artifactId !== 'string' || !cardContent.artifactId.trim()) throw new Error('Card source artifactId is missing')
  const importBundleContent = input.importBundle?.content
  const sourceArtifact = importBundleContent?.sourceArtifact
  const sourceArtifactRef = importBundleContent?.sourceArtifactRef
  const bindings = importBundleContent?.bindings
  const importBundle = input.importBundle ? toCardBundleImportManifest(input.importBundle) : undefined

  return {
    ...sourceArtifact,
    schemaVersion: 4,
    artifactId: cardContent.artifactId,
    ...(cardContent.derivedFrom ? { derivedFrom: structuredClone(cardContent.derivedFrom) } : {}),
    displayName: sourceArtifact?.displayName ?? cardContent.name,
    description: sourceArtifact?.description ?? cardContent.description,
    card: {
      ...sourceArtifact?.card,
      ...readCardEditableFields(cardContent),
      extensionDependencies: cardContent.extensionDependencies,
      defaultPreset: cardContent.defaultPreset,
      catalogSource: cardContent.catalogSource,
      media: cardContent.media,
      stateContributionIds: cardContent.stateContributionIds,
      ...(cardContent.extensionAdoptions !== undefined ? { extensionAdoptions: structuredClone(cardContent.extensionAdoptions) } : {}),
    },
    contextAssets: input.contextAssets,
    // Current Card bindings, not the import snapshot, own resource provenance.
    externalContextAssetIds: undefined,
    state: createStateArtifact({
      id: `card:${input.card.id}`,
      entityTypes: structuredClone(cardContent.stateEntityTypes ?? []),
      templates: structuredClone(input.stateTemplates),
      entities: structuredClone(cardContent.timelineStateEntities ?? []),
      componentMounts: structuredClone(cardContent.timelineComponentMounts ?? []),
      bindings: structuredClone(cardContent.timelineStateBindings ?? []),
    }),
    stateTemplates: input.stateTemplates,
    timelineStateBindings: structuredClone(cardContent.timelineStateBindings ?? []),
    extensionPayloads: input.extensionPayloads.map(payload => structuredClone(payload)),
    scriptAttachments: input.scriptAttachments.map(attachment => structuredClone(attachment)),
    metadata: {
      ...(sourceArtifact?.metadata ?? {}),
      ...(sourceArtifactRef ? { sourceArtifactRef } : {}),
      ...(importBundle ? { importBundle } : {}),
      ...(bindings ? { bindings } : {}),
      exportedFromCardId: input.card.id,
      exportedAt: nowIso(),
    },
  }
}

function toCardBundleImportManifest(importBundle: DocumentRecord<ImportBundleContent>): CardBundleImportManifest {
  return {
    id: importBundle.id,
    artifactId: importBundle.content.sourceArtifactRef.artifactId,
    importedAt: importBundle.content.importedAt,
    sourceArtifactRef: importBundle.content.sourceArtifactRef,
    documentIds: importBundle.content.documentIds,
    promptResourceIds: importBundle.content.promptResourceIds,
    assetIds: importBundle.content.assetIds ?? [],
    bindingIds: importBundle.content.bindings.map(binding => binding.id),
  }
}

function readCardAssetIds(media: CardMediaRefs | undefined): string[] {
  return [...new Set([media?.avatarAssetId, media?.coverAssetId].filter((value): value is string => Boolean(value)))]
}

async function cloneConflictingPromptNodes(
  store: PromptResourceStore,
  nodes: PromptResourceNode[],
): Promise<{ nodes: PromptResourceNode[]; idMap: Map<string, string> }> {
  const existingNodeIds = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await store.listResources({ cursor, limit: 500, order: 'id' })
    for (const resource of page.resources) {
      for (const node of findNodes([fromStoredResource(resource).rootNode], () => true)) existingNodeIds.add(node.id)
    }
    cursor = page.nextCursor
  } while (cursor)

  const idMap = new Map<string, string>()
  for (const root of nodes) {
    const descendants = findNodes([root], () => true)
    if (descendants.some(node => existingNodeIds.has(node.id))) {
      for (const node of descendants) idMap.set(node.id, createId('prompt-node'))
    }
  }
  // Only implicit virtual anchors use node identity; explicit/public anchor names stay stable.
  const anchorIds = new Set(findNodes(nodes, node => node.kind === 'virtual' && !node.capabilities?.targetAnchorId)
    .map(node => node.id))
  const replaceId = (value: string): string => idMap.get(value) ?? value
  const clone = (node: PromptResourceNode): PromptResourceNode => ({
    ...node,
    id: replaceId(node.id),
    ...(node.capabilities?.targetAnchorId && anchorIds.has(node.capabilities.targetAnchorId) ? {
      capabilities: { ...node.capabilities, targetAnchorId: replaceId(node.capabilities.targetAnchorId) },
    } : {}),
    ...(node.children ? { children: node.children.map(clone) } : {}),
  })
  return { nodes: nodes.map(clone), idMap }
}

async function readOptionalCardImportBundle(
  documents: DocumentTransaction,
  card: DocumentRecord<CardSourceContent>,
): Promise<DocumentRecord<ImportBundleContent> | undefined> {
  if (!card.content.importBundleId) return undefined
  return await readDocument<ImportBundleContent>(documents, card.content.importBundleId, applicationDocumentTypes.importBundle)
}

export async function readPromptResourceInputs(input: {
  promptResources: PromptResourceStore
  resourceIds: string[]
  variables: VariableRenderContext
  onMissingResource?: (resourceId: string) => void
  canReadResource?: (resource: PromptResourceContent & { id: string; version: number }) => boolean
}): Promise<{
  sourceNodes: SourceNode[]
  contributions: PromptContribution[]
}> {
  if (!input.promptResources) throw new Error('Prompt Resource Store is required')
  if (new Set(input.resourceIds).size !== input.resourceIds.length) throw new Error('Duplicate prompt resource id')
  const resources = []
  for (const resourceId of input.resourceIds) {
    const resource = await input.promptResources.getResource(resourceId)
    if (!resource) {
      if (!input.onMissingResource) throw new Error(`Prompt resource not found: ${resourceId}`)
      input.onMissingResource(resourceId)
      continue
    }
    const mapped = fromStoredResource(resource)
    if (input.canReadResource && !input.canReadResource(mapped)) continue
    resources.push(mapped)
  }
  const sourceNodes: SourceNode[] = []
  const contributions: PromptContribution[] = []
  for (const [index, resource] of resources.entries()) {
    const rootIndex = sourceNodes.length
    collectPromptInputs({
      parentActivationGates: [], parentEnabled: true, contributions, variables: input.variables,
      nodes: [resource.rootNode], parentId: null, inheritedCategory: undefined,
      inheritedSourceId: undefined, sourceNodes, resource,
    })
    sourceNodes[rootIndex]!.orderIndex = index + 1
  }
  return { sourceNodes, contributions }
}

function stripDocumentMetadata<T extends Record<string, unknown>>(content: T): Omit<T, 'owner' | 'origin' | 'createdAt' | 'updatedAt'> {
  return Object.fromEntries(Object.entries(content).filter(([key]) => !['owner', 'origin', 'createdAt', 'updatedAt'].includes(key))) as Omit<T, 'owner' | 'origin' | 'createdAt' | 'updatedAt'>
}
