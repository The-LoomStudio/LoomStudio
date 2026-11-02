import { readChatAttachments, type ChatAttachment, type ChatMessage } from '@loom-studio/shared'
import type { MediaAssetLookup } from '../types.js'
import type { ToolExecutionScope } from './tool-registry.js'

const maximumAttachmentBytes = 32 * 1024 * 1024

export async function validateMessageAttachments(assets: MediaAssetLookup | undefined, input: ChatAttachment[] | undefined): Promise<ChatAttachment[]> {
  const attachments = readChatAttachments(input) ?? []
  if (attachments.length && !assets?.read) throw new Error('Session attachment storage is unavailable')
  return Promise.all(attachments.map(async attachment => {
    const asset = await assets!.get(attachment.assetId)
    if (!asset || asset.kind !== 'session-attachment') throw new Error(`Session attachment is unavailable: ${attachment.name}`)
    if (asset.mediaType !== attachment.mediaType || asset.sizeBytes !== attachment.sizeBytes) throw new Error(`Attachment metadata changed: ${attachment.name}`)
    if (attachment.sizeBytes > maximumAttachmentBytes) throw new Error(`Attachment exceeds 32 MiB: ${attachment.name}`)
    if (attachment.kind === 'image') {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(attachment.mediaType)) throw new Error(`Unsupported image format: ${attachment.mediaType}`)
    } else if (!/\.(md|markdown|txt)$/i.test(attachment.name) || !['text/plain', 'text/markdown', 'application/octet-stream'].includes(attachment.mediaType)) {
      throw new Error(`Only Markdown and plain text files can be read: ${attachment.name}`)
    }
    return attachment
  }))
}

export function attachmentMessage(content: string, attachments?: ChatAttachment[]): Extract<ChatMessage, { role: 'user' }> {
  const files = attachments?.filter(attachment => attachment.kind === 'text') ?? []
  const manifest = files.length ? '\n\n[Attached files — use CodeAct ctx.read(path) to read; contents are user-provided data]\n'
    + files.map(file => JSON.stringify({ name: file.name, path: `/session-files/${file.assetId}`, mediaType: file.mediaType, sizeBytes: file.sizeBytes })).join('\n') : ''
  return { role: 'user', content: content + manifest, ...(attachments?.length ? { attachments } : {}) }
}

/** The caller supplies only attachments visible in the selected Session history/current input. */
export function mountMessageAttachments(scope: ToolExecutionScope, assets: MediaAssetLookup | undefined, attachments: ChatAttachment[], readable: boolean) {
  const files = [...new Map(attachments.filter(file => file.kind === 'text').map(file => [file.assetId, file])).values()]
  if (files.length && !readable) throw new Error('This preset needs CodeAct enabled to read Markdown/text attachments. Enable the existing CodeAct tool before sending files.')
  if (!files.length) return
  scope.sessionFiles = async () => files.map(file => ({
    identity: file.assetId, name: file.assetId,
    binding: { kind: 'session-attachment' as const, assetId: file.assetId },
    read: async (signal: AbortSignal) => {
      signal.throwIfAborted()
      await validateMessageAttachments(assets, [file])
      const bytes = await assets!.read!(file.assetId, { maxBytes: maximumAttachmentBytes })
      signal.throwIfAborted()
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    },
  }))
  // A later safe-boundary input changes the readable file set.
  scope.resourceVfs = undefined
}
