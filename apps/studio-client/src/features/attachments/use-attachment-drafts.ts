import { useEffect, useRef, useState } from 'react'
import { chatAttachmentSchema, type ChatAttachment } from '@loom-studio/shared'
import { safeLocalStorage } from '../../shared/browser/safe-local-storage.js'

export type AttachmentDraft = { id: string; name: string; attachment?: ChatAttachment; error?: string; previewUrl?: string; retryable?: boolean }
export type AttachmentComposerProps = {
  attachments?: AttachmentDraft[]
  onAddAttachments?(files: File[]): void
  attachmentNotice?: string
  onRetryAttachment?(id: string, file?: File): void
  onRemoveAttachment?(id: string): void
}

export function useAttachmentDrafts(scope: string, initial: ChatAttachment[] = []) {
  const drafts = useRef(new Map<string, AttachmentDraft[]>())
  const uploads = useRef(new Map<string, { file: File; controller?: AbortController; url?: string }>())
  const [notices, setNotices] = useState<Record<string, string>>({})
  useEffect(() => () => {
    for (const upload of uploads.current.values()) {
      upload.controller?.abort()
      if (upload.url) URL.revokeObjectURL(upload.url)
    }
  }, [])
  const [, refresh] = useState(0)
  function read(key: string): AttachmentDraft[] {
    const cached = drafts.current.get(key)
    if (cached) return cached
    const stored = safeLocalStorage.getItem(`loom:attachment-draft:v1:${key}`)
    let restored: AttachmentDraft[] = initial.map(attachment => ({ id: attachment.assetId, name: attachment.name, attachment }))
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored)
        if (Array.isArray(parsed)) restored = parsed.flatMap(item => {
          if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') return []
          const attachment = chatAttachmentSchema.safeParse(item.attachment)
          return [{ id: item.id, name: item.name, ...(attachment.success
            ? { attachment: attachment.data }
            : { error: typeof item.error === 'string' ? item.error : '上传已中断，请重新选择文件' }) }]
        })
      } catch {
        safeLocalStorage.removeItem(`loom:attachment-draft:v1:${key}`)
      }
    }
    drafts.current.set(key, restored)
    return restored
  }
  const items = read(scope)
  function update(key: string, fn: (items: AttachmentDraft[]) => AttachmentDraft[]) {
    const next = fn(read(key))
    drafts.current.set(key, next)
    const storageKey = `loom:attachment-draft:v1:${key}`
    if (next.length) safeLocalStorage.setItem(storageKey, JSON.stringify(next.map(({ previewUrl: _previewUrl, retryable: _retryable, ...item }) => item)))
    else safeLocalStorage.removeItem(storageKey)
    refresh(value => value + 1)
  }
  function fileInfo(file: File) {
    const kind = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ? 'image' : /\.(md|markdown|txt)$/i.test(file.name) ? 'text' : undefined
    if (!kind) throw new Error('支持 PNG、JPEG、WebP、GIF、MD 和 TXT 文件')
    if (file.size > 32 * 1024 * 1024) throw new Error('每个附件不能超过 32 MiB')
    return { kind, mediaType: kind === 'image' ? file.type : /\.(md|markdown)$/i.test(file.name) ? 'text/markdown' : 'text/plain' } as const
  }
  function release(id: string) {
    const upload = uploads.current.get(id)
    upload?.controller?.abort()
    if (upload?.url) URL.revokeObjectURL(upload.url)
    uploads.current.delete(id)
  }
  function updateUpload(id: string, fn: (item: AttachmentDraft) => AttachmentDraft) {
    for (const [key, list] of drafts.current) {
      if (list.some(item => item.id === id)) update(key, current => current.map(item => item.id === id ? fn(item) : item))
    }
  }
  async function upload(key: string, id: string, file: File) {
    const info = fileInfo(file)
    release(id)
    const controller = new AbortController()
    const url = info.kind === 'image' ? URL.createObjectURL(file) : undefined
    uploads.current.set(id, { file, controller, url })
    update(key, list => list.map(item => item.id === id ? { id, name: file.name, previewUrl: url, retryable: true } : item))
    try {
      const response = await fetch('/assets', { method: 'POST', signal: controller.signal, headers: {
        'content-type': info.mediaType, 'x-loom-asset-kind': 'session-attachment', 'x-loom-asset-label': encodeURIComponent(file.name),
      }, body: file })
      const body = await response.json() as { asset?: { id?: string }; error?: { message?: string } }
      if (!response.ok || !body.asset?.id) throw new Error(body.error?.message ?? '附件上传失败')
      if (controller.signal.aborted) return
      const attachment: ChatAttachment = { assetId: body.asset.id, name: file.name, ...info, sizeBytes: file.size }
      updateUpload(id, () => ({ id, name: file.name, attachment }))
      release(id)
    } catch (error) {
      if (controller.signal.aborted) return
      updateUpload(id, item => ({ ...item, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  async function add(files: File[]) {
    const key = scope
    const rejected: string[] = []
    const tasks: Promise<void>[] = []
    for (const file of files) {
      try {
        fileInfo(file)
        if (read(key).length >= 20) throw new Error('每条消息最多 20 个附件')
        const id = crypto.randomUUID()
        update(key, list => [...list, { id, name: file.name }])
        tasks.push(upload(key, id, file))
      } catch (error) { rejected.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`) }
    }
    setNotices(current => ({ ...current, [key]: rejected.length ? `未加入 ${rejected.length} 个文件：${rejected.join('；')}` : '' }))
    await Promise.all(tasks)
  }
  async function retry(id: string, replacement?: File) {
    const file = replacement ?? uploads.current.get(id)?.file
    if (!file) return
    try { fileInfo(file) } catch (error) {
      setNotices(current => ({ ...current, [scope]: error instanceof Error ? error.message : String(error) }))
      return
    }
    await upload(scope, id, file)
  }
  return {
    items, ready: items.every(item => item.attachment), values: items.flatMap(item => item.attachment ? [item.attachment] : []),
    add, retry, notice: notices[scope], remove: (id: string) => { release(id); update(scope, items => items.filter(item => item.id !== id)) },
    moveTo: (key: string) => { if (key === scope) return; update(key, () => read(scope)); update(scope, () => []) },
    clear: () => { const sent = new Set(items.map(item => item.id)); for (const key of drafts.current.keys()) update(key, current => current.filter(item => !sent.has(item.id))) },
  }
}
