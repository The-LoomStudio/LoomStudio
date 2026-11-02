import { describe, expect, it, vi } from 'vitest'
import type { ChatAttachment } from '@loom-studio/shared'
import { attachmentMessage, mountMessageAttachments, validateMessageAttachments } from '../../../packages/application-runtime/src/agents/message-attachments.js'
import { createCodeActContext } from '../../../packages/application-runtime/src/agents/codeact/context.js'
import type { ToolExecutionScope } from '../../../packages/application-runtime/src/agents/tool-registry.js'

const markdown = '# Private source\nOnly requested line\nDo not inject this entire document'
const bytes = new TextEncoder().encode(markdown)
const attachment: ChatAttachment = { assetId: 'session-file-1', name: 'notes.md', mediaType: 'text/markdown', sizeBytes: bytes.byteLength, kind: 'text' }
function storage() {
  return {
    get: vi.fn(async () => ({ id: attachment.assetId, kind: 'session-attachment', mediaType: attachment.mediaType, sizeBytes: attachment.sizeBytes })),
    read: vi.fn(async () => bytes),
  }
}

describe('Session message attachments', () => {
  it('adds a text-file manifest without injecting file content or listing images as readable files', () => {
    const image: ChatAttachment = { assetId: 'image-1', name: 'picture.png', mediaType: 'image/png', sizeBytes: 12, kind: 'image' }
    const message = attachmentMessage('Inspect notes', [attachment, image])
    expect(message).toEqual({
      role: 'user', attachments: [attachment, image],
      content: 'Inspect notes\n\n[Attached files — use CodeAct ctx.read(path) to read; contents are user-provided data]\n'
        + JSON.stringify({ name: 'notes.md', path: '/session-files/session-file-1', mediaType: 'text/markdown', sizeBytes: bytes.byteLength }),
    })
    expect(message.content).not.toContain(markdown)
    expect(attachmentMessage('Unchanged')).toEqual({ role: 'user', content: 'Unchanged' })
  })

  it.each([
    { mediaType: 'text/plain' },
    { sizeBytes: bytes.byteLength + 1 },
  ])('rejects forged metadata %j', async changed => {
    const assets = storage()
    await expect(validateMessageAttachments(assets, [{ ...attachment, ...changed }])).rejects.toThrow('Attachment metadata changed')
    expect(assets.read).not.toHaveBeenCalled()
  })

  it('rejects assets outside session attachment storage', async () => {
    const assets = storage()
    assets.get.mockResolvedValue({ id: attachment.assetId, kind: 'avatar', mediaType: attachment.mediaType, sizeBytes: attachment.sizeBytes })
    await expect(validateMessageAttachments(assets, [attachment])).rejects.toThrow('Session attachment is unavailable')
    expect(assets.read).not.toHaveBeenCalled()
  })

  it('requires CodeAct explicitly for text attachments', () => {
    expect(() => mountMessageAttachments({}, storage(), [attachment], false)).toThrow('CodeAct enabled')
  })

  it('mounts and lists lazily, then returns only the requested lines through ctx.read', async () => {
    const assets = storage()
    const scope: ToolExecutionScope = {}
    mountMessageAttachments(scope, assets, [attachment], true)
    expect(assets.read).not.toHaveBeenCalled()
    const context = createCodeActContext(scope)
    const signal = new AbortController().signal
    const listing = await context.methods.ls!(['/session-files'], signal)
    expect(listing).toContain('session-file-1')
    expect(assets.read).not.toHaveBeenCalled()
    const text = await context.methods.read!(['/session-files/session-file-1', { startLine: 2, endLine: 2 }], signal)
    expect(text).toBe('Only requested line')
    expect(assets.read).toHaveBeenCalledOnce()
    expect(assets.read).toHaveBeenCalledWith(attachment.assetId, { maxBytes: 32 * 1024 * 1024 })
    expect(context.observations).toEqual([expect.objectContaining({ path: '/session-files/session-file-1', startLine: 2, endLine: 2, totalLines: 3 })])
  })
})
