import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import type { DocumentTransaction } from '@loom-studio/document-store'
import type { ExtensionStorageScope, ScriptConfigEntry } from '@loom-studio/extension-sdk'
import { extensionStorageScopeKey, extensionStorageTokenPattern } from '@loom-studio/extension-sdk'
import type { JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import type { LoomScriptMountContent } from './loom-script-contracts.js'
import { readLoomScriptRevision, readLoomScriptInstallation } from './loom-script-resolution.js'
import { validateApplicationExtensionStorageScope } from '../extensions/storage-scope.js'

export type ScriptConfigQuery = { mountId: string; runtimeRevision: number; scope: ExtensionStorageScope }
export type ScriptConfigWrite = ScriptConfigQuery & { key: string; value: JsonValue; expectedVersion?: number }
type Content = Omit<ScriptConfigEntry, 'id' | 'version'>
type Context = Pick<ApplicationRuntimeContext, 'documents' | 'narratives' | 'agents' | 'now'>

async function owner(ctx: Context, documents: DocumentTransaction, input: ScriptConfigQuery, write = false, dataTx?: SqliteDataTransaction) {
  const mount = await readDocument<LoomScriptMountContent>(documents, input.mountId, applicationDocumentTypes.loomScriptMount)
  if (!mount.content.enabled || mount.content.runtimeRevision !== input.runtimeRevision) throw new Error('Script instance is no longer active at this revision')
  const script = await readLoomScriptRevision(documents, mount.content.scriptDocumentId, mount.content.adoptedDocumentVersion)
  if (!script) throw new Error('Adopted Script revision unavailable')
  const capability = write ? 'configs.write' : 'configs.read'
  if (!script.content.requestedCapabilities.includes(capability) || !mount.content.grantedCapabilities.includes(capability)) throw new Error(`Script capability not granted: ${capability}`)
  const installation = script.content.owner.kind === 'extension' ? await readLoomScriptInstallation(documents, script.content.owner) : undefined
  const cardId = installation?.kind === 'card' ? installation.cardId : mount.content.target.kind === 'card' ? mount.content.target.cardId : script.content.owner.kind === 'card' ? script.content.owner.cardId : undefined
  await validateApplicationExtensionStorageScope(ctx, input.scope, cardId ? { kind: 'card', cardId } : undefined, dataTx, documents)
  return script.id
}
export async function listScriptConfigs(ctx: Context, input: ScriptConfigQuery): Promise<ScriptConfigEntry[]> {
  const scriptDocumentId = await owner(ctx, ctx.documents, input)
  return (await listDocuments<Content>(ctx.documents, applicationDocumentTypes.extensionConfig))
    .filter(document => document.content.scriptDocumentId === scriptDocumentId && extensionStorageScopeKey(document.content.scope) === extensionStorageScopeKey(input.scope))
    .map(document => ({ ...document.content, id: document.id, version: document.version }))
}
export async function writeScriptConfig(ctx: Context, documents: DocumentTransaction, input: ScriptConfigWrite, dataTx: SqliteDataTransaction): Promise<ScriptConfigEntry> {
  if (!extensionStorageTokenPattern.test(input.key)) throw new Error('Config key must be a stable token')
  const scriptDocumentId = await owner(ctx, documents, input, true, dataTx)
  const id = `script-config:${encodeURIComponent(JSON.stringify([scriptDocumentId, extensionStorageScopeKey(input.scope), input.key]))}`
  const existing = await documents.get(id)
  if (!existing && input.expectedVersion !== undefined) throw new Error('Script Config no longer exists at expectedVersion')
  if (existing && input.expectedVersion === undefined) throw new Error('expectedVersion is required when updating Script Config')
  const timestamp = ctx.now()
  // Same Config document store and optimistic concurrency; Script identity never impersonates an installation.
  const content: Content = { scriptDocumentId, scope: structuredClone(input.scope), key: input.key, value: structuredClone(input.value),
    createdAt: existing ? (existing.content as unknown as Content).createdAt : timestamp, updatedAt: timestamp }
  const result = await writeDocument<Content>(documents, { id, type: applicationDocumentTypes.extensionConfig,
    content, expectedVersion: existing ? input.expectedVersion! : 'new' })
  return { ...result.content, id: result.id, version: result.version }
}
