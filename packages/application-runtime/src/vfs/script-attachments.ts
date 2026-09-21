import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { listDocuments } from '../foundation/document-store.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import type { LoomScriptContent, LoomScriptMountContent } from '../scripts/loom-script-contracts.js'
import { vfsError } from './read.js'
import type { VfsTextAttachment } from './resource-filesystem.js'

export async function listPresetScriptAttachments(
  ctx: Pick<ApplicationRuntimeContext, 'documents' | 'blobs'>,
  presetId: string,
): Promise<VfsTextAttachment[]> {
  const mounts = (await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount))
    .filter(mount => mount.content.target.kind === 'preset' && mount.content.target.presetId === presetId)
    .sort((a, b) => a.content.orderIndex - b.content.orderIndex || a.id.localeCompare(b.id))
  const files: VfsTextAttachment[] = []
  for (const mount of mounts) {
    const document = await ctx.documents.get(mount.content.scriptDocumentId,
      mount.content.pinnedDocumentVersion === undefined ? undefined : { version: mount.content.pinnedDocumentVersion })
    if (!document || document.type !== applicationDocumentTypes.loomScript) continue
    const content = document.content as LoomScriptContent
    // Match the existing preset export boundary; a mount cannot grant access to another owner's script.
    if (content.owner.kind !== 'preset' || content.owner.presetId !== presetId) continue
    files.push({
      identity: `script:${mount.id}:${document.id}`,
      name: content.source.fileName,
      binding: { kind: 'script', mountId: mount.id, documentId: document.id, version: document.version, blobId: content.source.blobId },
      read: async signal => {
        signal.throwIfAborted()
        if (!ctx.blobs) throw vfsError('vfs.blob_unavailable', 'Blob storage is unavailable for this attachment.')
        const bytes = await ctx.blobs.read(content.source.blobId, { maxBytes: 1024 * 1024 })
        signal.throwIfAborted()
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      },
    })
  }
  return files
}
