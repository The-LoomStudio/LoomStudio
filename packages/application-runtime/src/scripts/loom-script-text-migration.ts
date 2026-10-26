import type { DocumentRecord, DocumentTransaction } from '@loom-studio/document-store'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { resolveLoomScriptSettings, resolveTextTransformContributionRule, type LoomScriptSettings } from '@loom-studio/shared/loom-scripts'
import type { JsonValue } from '@loom-studio/shared'
import { isObject } from '../foundation/json.js'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, toVersioned, writeDocument } from '../foundation/document-store.js'
import { executeBlobDocumentMutation, executeDocumentMutation } from '../foundation/mutation.js'
import { collectPages } from '../foundation/pagination.js'
import { validateTextTransformRuleDraft, type TextRuleOwner, type TextTransformRuleContent, type TextTransformRuleDraft, type TextTransformRuleEntry } from '../transforms/history-text.js'
import type { BlobStorage, ExtensionInstallationContent, RuntimeRequestContext } from '../types.js'
import type { PromptResourceContent } from '../cards/workspace-types.js'
import { parseLoomScriptSource, serializeLoomScriptMetadata } from './loom-script-codec.js'
import type { LoomScriptAttachmentArtifact, LoomScriptContent, LoomScriptMountContent, LoomScriptMountTarget, LoomScriptOwner } from './loom-script-contracts.js'

type Context = Pick<ApplicationRuntimeContext, 'documents' | 'blobs' | 'dataEngine' | 'now' | 'createId'>
type StoredBlob = Pick<Awaited<ReturnType<BlobStorage['prepareWrite']>>['blob'], 'id' | 'sha256'>
type Metadata = ReturnType<typeof parseLoomScriptSource>

/** Existing transformRules package slots may carry a complete Script without changing their reference address. */
export function readPackagedTextRuleScript(value: JsonValue) {
  if (!isObject(value) || value.format !== 'loom.script') return undefined
  const allowed = new Set(['format', 'schemaVersion', 'fileName', 'source', 'primaryContributionId', 'settings', 'enabled', 'orderIndex'])
  if (Object.keys(value).some(key => !allowed.has(key)) || value.schemaVersion !== 1
    || typeof value.fileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.loom\.js$/.test(value.fileName)
    || typeof value.source !== 'string' || typeof value.primaryContributionId !== 'string'
    || (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    || (value.orderIndex !== undefined && !Number.isSafeInteger(value.orderIndex))) throw new Error('Invalid packaged text-rule Script artifact')
  const metadata = parseLoomScriptSource(value.source)
  const contribution = metadata.contributions.find(item => item.kind === 'text-transform' && item.id === value.primaryContributionId)
  if (!contribution || contribution.kind !== 'text-transform') throw new Error(`Packaged Script primary text rule is missing: ${value.primaryContributionId}`)
  if (value.settings !== undefined && (!isObject(value.settings) || Object.values(value.settings).some(item =>
    typeof item !== 'string' && typeof item !== 'boolean' && (typeof item !== 'number' || !Number.isFinite(item))))) throw new Error('Invalid packaged Script settings')
  const settings = value.settings as LoomScriptSettings | undefined
  const resolved = resolveLoomScriptSettings(metadata.settings, settings)
  return { source: value.source, fileName: value.fileName, primaryContributionId: value.primaryContributionId, metadata, settings,
    rule: { ...resolveTextTransformContributionRule(contribution, resolved),
      ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
      ...(typeof value.orderIndex === 'number' ? { orderIndex: value.orderIndex } : {}),
    },
  }
}

export function scriptTextResourceOrigin(script: LoomScriptContent, localId: string): TextTransformRuleContent['origin'] {
  const origin = script.textResourceOrigin
  if (!origin) return undefined
  return script.textResourceIds?.[localId] ? origin : { ...origin, contributionId: `${origin.contributionId}/${localId}` }
}

export function exportScriptTextResourceIds(scriptId: string, script: LoomScriptContent): Record<string, string> {
  return Object.fromEntries(script.contributions.flatMap(contribution => contribution.kind === 'renderer' ? []
    : [[contribution.id, script.textResourceIds?.[contribution.id] ?? `${scriptId}:${contribution.id}`]]))
}

export function allocateImportedTextResourceIds(metadata: Metadata, attachment: LoomScriptAttachmentArtifact, createId: (prefix: string) => string): Record<string, string> {
  const definitions = new Set(metadata.contributions.flatMap(contribution => contribution.kind === 'renderer' ? [] : [contribution.id]))
  for (const id of Object.keys(attachment.textResourceIds ?? {})) {
    if (!definitions.has(id)) throw new Error(`Script attachment references an unknown text contribution: ${id}`)
  }
  return Object.fromEntries([...definitions].map(id => [id, createId('text-resource')]))
}

export function importedTextResourceReferences(items: Array<{ attachment: LoomScriptAttachmentArtifact; textResourceIds: Record<string, string> }>): Record<string, string> {
  const entries = items.flatMap(item => Object.entries(item.attachment.textResourceIds ?? {}).map(([id, oldId]) => [oldId, item.textResourceIds[id]!] as const))
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('Duplicate text resource address in Script attachments')
  return Object.fromEntries(entries)
}

export function rebaseScriptTextResourceReferences(attachment: LoomScriptAttachmentArtifact, references: Record<string, string>): Record<string, string> {
  return { ...references, ...Object.fromEntries(Object.entries(attachment.textResourceReferences ?? {})
    .map(([sourceId, address]) => [sourceId, references[address] ?? address])) }
}

export function remapImportedTextUses(uses: PromptResourceContent['textUses'], references: Record<string, string>): PromptResourceContent['textUses'] {
  return uses?.map(use => references[use.id]
    ? { ...use, id: references[use.id]!, reference: { kind: 'external', resourceId: references[use.id]! } }
    : use)
}

/** Legacy import formats are converted at the boundary; their Rule IDs remain reference addresses. */
export function textTransformScriptSource(rule: TextTransformRuleContent): string {
  const { owner: _owner, origin: _origin, createdAt: _created, updatedAt: _updated, ...definition } = rule
  return `${serializeLoomScriptMetadata({
    formatVersion: 1, metadataId: 'imported.text-rule', scriptVersion: '1.0.0',
    name: rule.name.replace(/[\r\n]+/g, ' '), runtime: 'declarative', requestedCapabilities: [],
    contributions: [{ kind: 'text-transform', id: 'rule', rule: { ...definition, enabled: true } }],
  })}\n`
}

export async function prepareTextTransformScript(blobs: BlobStorage, rule: TextTransformRuleContent) {
  validateTextTransformRuleDraft(rule)
  const source = textTransformScriptSource(rule)
  return { metadata: parseLoomScriptSource(source), prepared: await blobs.prepareWrite({
    source: new TextEncoder().encode(source), mediaType: 'text/javascript',
  }) }
}

export async function writePreparedTextTransformScript(documents: DocumentTransaction, input: {
  scriptId: string; ruleId: string; rule: TextTransformRuleContent; blob: StoredBlob; metadata: Metadata
  expectedVersion?: number; mountId: string; mountTarget?: LoomScriptMountTarget
  fileName?: string; primaryContributionId?: string; settings?: LoomScriptSettings
}) {
  const owner = scriptOwner(input.rule)
  const target = input.mountTarget ?? await ruleTarget(documents, input.rule)
  const previous = await documents.get(input.scriptId, { includeTombstone: true })
  const script = await writeDocument<LoomScriptContent>(documents, {
    id: input.scriptId, type: applicationDocumentTypes.loomScript, expectedVersion: input.expectedVersion ?? 'new',
    content: {
      owner, ...input.metadata,
      source: { blobId: input.blob.id, mediaType: 'text/javascript', fileName: input.fileName ?? 'text-rule.loom.js' },
      sourceDigest: input.blob.sha256, textResourceIds: { [input.primaryContributionId ?? 'rule']: input.ruleId }, textResourceOwner: input.rule.owner,
      ...(input.rule.origin ? { textResourceOrigin: input.rule.origin } : {}),
      createdAt: previous ? (previous.content as LoomScriptContent).createdAt : input.rule.createdAt,
      updatedAt: input.rule.updatedAt,
    },
  })
  const existingMount = await documents.get(input.mountId, { includeTombstone: true })
  if (!existingMount || existingMount.meta.tombstone) {
    await writeDocument<LoomScriptMountContent>(documents, {
      id: input.mountId, type: applicationDocumentTypes.loomScriptMount, expectedVersion: existingMount?.version ?? 'new',
      content: { target, scriptDocumentId: script.id, enabled: input.rule.enabled, orderIndex: input.rule.orderIndex,
        adoptedDocumentVersion: script.version,
        ...(input.settings ? { settings: input.settings, adoptedSettings: resolveLoomScriptSettings(input.metadata.settings, input.settings) } : {}),
        grantedCapabilities: [], origin: { ...(input.rule.origin ?? {}), legacyRuleId: input.ruleId, legacyPresetInheritance: true },
        createdAt: input.rule.createdAt, updatedAt: input.rule.updatedAt },
    })
  }
  return script
}

/** One transaction per rule: source Blob, Script, Mount and legacy deletion commit together. */
export async function migrateLegacyTextTransformRules(ctx: Context): Promise<void> {
  const rules = await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)
  for (const rule of rules) {
    const source = textTransformScriptSource(rule.content)
    const metadata = parseLoomScriptSource(source)
    await executeBlobDocumentMutation(ctx, undefined, 'application.migrateTextRuleToScript', {
      bytes: new TextEncoder().encode(source), mediaType: 'text/javascript',
    }, async (documents, blob) => {
      const current = await documents.get(rule.id)
      if (!current) return
      if (current.version !== rule.version) throw new Error(`Text rule changed during migration: ${rule.id}`)
      await writePreparedTextTransformScript(documents, {
        scriptId: ctx.createId('loom-script'), mountId: ctx.createId('loom-script-mount'),
        ruleId: rule.id, rule: rule.content, blob, metadata,
      })
      await documents.delete({ id: rule.id, expectedVersion: rule.version })
    })
  }
}

export async function listScriptTextTransformRuleDocuments(documents: DocumentTransaction, includeTombstone = false): Promise<Array<DocumentRecord<TextTransformRuleContent> & { scriptDocumentId: string; contributionId: string }>> {
  const scripts = await collectPages(cursor => documents.list({ type: applicationDocumentTypes.loomScript, includeTombstone, cursor, limit: 100 })) as DocumentRecord<LoomScriptContent>[]
  const mounts = await listDocuments<LoomScriptMountContent>(documents, applicationDocumentTypes.loomScriptMount)
  return scripts.flatMap(script => {
    const settings = resolveLoomScriptSettings(script.content.settings ?? [], {})
    return script.content.contributions.flatMap(contribution => {
      if (contribution.kind !== 'text-transform') return []
      const rule = resolveTextTransformContributionRule(contribution, settings)
      const originalMount = mounts.find(mount => mount.content.scriptDocumentId === script.id
        && mount.content.origin.legacyRuleId === script.content.textResourceIds?.[contribution.id])
      return [{ ...script, id: script.content.textResourceIds?.[contribution.id] ?? `${script.id}:${contribution.id}`,
        scriptDocumentId: script.id, contributionId: contribution.id,
        content: { ...rule,
          ...(originalMount ? { enabled: rule.enabled && originalMount.content.enabled, orderIndex: originalMount.content.orderIndex } : {}),
          owner: script.content.textResourceOwner ?? textRuleOwner(script.content.owner),
          ...(script.content.textResourceOrigin ? { origin: scriptTextResourceOrigin(script.content, contribution.id) } : {}),
          createdAt: script.content.createdAt, updatedAt: script.content.updatedAt },
      }]
    })
  })
}

export async function listScriptTextTransformRules(documents: DocumentTransaction): Promise<TextTransformRuleEntry[]> {
  return (await listScriptTextTransformRuleDocuments(documents)).map(document => ({
    ...toVersioned(document), scriptDocumentId: document.scriptDocumentId, contributionId: document.contributionId,
  }))
}

export async function getTextTransformRuleScript(ctx: Pick<Context, 'documents'>, input: { ruleId: string }) {
  const rule = (await listScriptTextTransformRules(ctx.documents)).find(rule => rule.id === input.ruleId)
  if (!rule) throw new Error(`Text Transform Rule not found: ${input.ruleId}`)
  return { rule }
}

/** Compatibility import API. Existing definitions are edited as complete Scripts, not rebuilt from forms. */
export async function upsertTextTransformRuleScript(ctx: Context, input: {
  ruleId: string; expectedVersion?: number; rule: TextTransformRuleDraft
}, requestContext?: RuntimeRequestContext) {
  validateTextTransformRuleDraft(input.rule)
  if ((await listScriptTextTransformRules(ctx.documents)).some(rule => rule.id === input.ruleId)) {
    throw new Error('Text rules are Script contributions; edit the complete Script source and refresh its adoption')
  }
  if (input.expectedVersion !== undefined) throw new Error(`Text Transform Rule not found: ${input.ruleId}`)
  const timestamp = ctx.now()
  const rule = { ...input.rule, createdAt: timestamp, updatedAt: timestamp }
  const source = textTransformScriptSource(rule)
  const metadata = parseLoomScriptSource(source)
  const result = await executeBlobDocumentMutation(ctx, requestContext, 'application.importTextRuleScript', {
    bytes: new TextEncoder().encode(source), mediaType: 'text/javascript',
  }, async (documents, blob) => {
    if ((await listScriptTextTransformRules(documents)).some(rule => rule.id === input.ruleId)) throw new Error(`Text Transform Rule already exists: ${input.ruleId}`)
    const existing = await documents.get(input.ruleId)
    if (existing) throw new Error(`Text Transform Rule ID is already in use: ${input.ruleId}`)
    return await writePreparedTextTransformScript(documents, {
      scriptId: ctx.createId('loom-script'), mountId: ctx.createId('loom-script-mount'), ruleId: input.ruleId,
      rule, blob, metadata,
    })
  })
  return { ...(await getTextTransformRuleScript(ctx, input)), mutation: result.mutation }
}

export async function deleteTextTransformRuleScript(ctx: Pick<Context, 'documents'>, input: {
  ruleId: string; expectedVersion?: number
}, requestContext?: RuntimeRequestContext) {
  const projection = (await listScriptTextTransformRuleDocuments(ctx.documents)).find(rule => rule.id === input.ruleId)
  if (!projection) throw new Error(`Text Transform Rule not found: ${input.ruleId}`)
  const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteTextRuleScript', async documents => {
    const script = await documents.get(projection.scriptDocumentId)
    if (!script || (input.expectedVersion !== undefined && script.version !== input.expectedVersion)) throw new Error(`Text Transform Rule version conflict: ${input.ruleId}`)
    if ((script.content as LoomScriptContent).contributions.length !== 1 || (script.content as LoomScriptContent).runtime !== 'declarative') {
      throw new Error('Remove this rule from the complete Script source; the Script also contains other contributions or code')
    }
    const mounts = await listDocuments<LoomScriptMountContent>(documents, applicationDocumentTypes.loomScriptMount)
    for (const mount of mounts.filter(mount => mount.content.scriptDocumentId === script.id)) await documents.delete({ id: mount.id, expectedVersion: mount.version })
    await documents.delete({ id: script.id, expectedVersion: script.version })
  })
  return { deleted: true as const, mutation: result.mutation }
}

function scriptOwner(rule: TextTransformRuleContent): LoomScriptOwner {
  const owner = rule.owner
  if (owner.kind === 'card' || owner.kind === 'preset') return owner
  if (owner.kind === 'extension') return { kind: 'extension', packageId: owner.packageId,
    installationId: rule.origin?.installationId ?? extensionInstallationId(owner.packageId, { kind: 'global' }) }
  return { kind: 'user' }
}

function textRuleOwner(owner: LoomScriptOwner): TextRuleOwner {
  if (owner.kind === 'user') return { kind: 'user-override' }
  if (owner.kind === 'workspace') return { kind: 'workspace' }
  if (owner.kind === 'extension') return { kind: 'extension', packageId: owner.packageId }
  return owner
}

async function ruleTarget(documents: DocumentTransaction, rule: TextTransformRuleContent): Promise<LoomScriptMountTarget> {
  const owner = scriptOwner(rule)
  if (owner.kind !== 'extension') return owner
  const installation = await documents.get(owner.installationId)
  if (!installation) return { kind: 'user' }
  if (installation.type !== applicationDocumentTypes.extensionInstallation) throw new Error(`Unexpected installation document: ${owner.installationId}`)
  const target = (installation.content as ExtensionInstallationContent).target
  return target?.kind === 'card' ? target : { kind: 'user' }
}
