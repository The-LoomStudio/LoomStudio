import { useEffect, useRef, useState } from 'react'
import { sameChatAttachments, type ChatAttachment } from '@loom-studio/shared'
import { ChatComposer } from '../../widgets/chat-composer/chat-composer.js'
import { useAttachmentDrafts } from './use-attachment-drafts.js'

export type ReviseUserInput = (entryId: string, expectedContent: string, expectedAttachments: ChatAttachment[], content: string, attachments: ChatAttachment[]) => Promise<boolean>

export function UserInputEditor(props: { entryId: string; content: string; attachments?: ChatAttachment[]; blocked?: boolean; pending?: boolean; onSave: ReviseUserInput; onClose(): void }) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const [original] = useState(() => ({ entryId: props.entryId, content: props.content, attachments: props.attachments ?? [] }))
  const [content, setContent] = useState(original.content)
  const files = useAttachmentDrafts(`edit:${original.entryId}`, original.attachments)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const changed = content !== original.content || !sameChatAttachments(files.values, original.attachments)
  const deleting = !content.trim() && files.items.length === 0
  function close() { files.clear(); props.onClose() }
  return <div style={{ width: '100%', minWidth: 0 }}>
    <ChatComposer inputRef={inputRef} input={content} onChangeInput={setContent} attachments={files.items} onAddAttachments={busy ? undefined : files.add}
      onRetryAttachment={busy ? undefined : files.retry} onRemoveAttachment={busy ? undefined : files.remove} attachmentNotice={files.notice}
      canSend={changed && files.ready && !busy && !props.blocked} canPreviewPrompt={false} textareaDisabled={busy}
      moreLabel="添加附件" previewLabel="" retryLabel="" sendLabel={deleting ? '删除这条输入' : props.pending ? '更新待接入输入' : '重新发送'} textareaLabel="编辑用户输入"
      sendLeadingAction={<button type="button" disabled={busy} onClick={close}>取消</button>}
      onSubmit={event => {
        event.preventDefault()
        if (!changed || !files.ready || busy || props.blocked) return
        setBusy(true); setError('')
        void props.onSave(props.entryId, original.content, original.attachments, content, files.values)
          .then(accepted => { if (accepted) close() })
          .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setBusy(false))
      }} />
    {deleting ? <p role="status">文字和附件均为空，提交将删除这条输入，不启动运行。</p> : null}
    {props.blocked ? <p role="status">暂不可提交：仅支持最新输入；正在执行时需等待结束或暂停。</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
