import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, FileText } from 'lucide-react'
import { Dialog } from '@loom-studio/ui'
import type { ChatAttachment } from '@loom-studio/shared'
import styles from './attachment-cards.module.scss'

const previewLimit = 200_000

export function TextAttachmentViewer({ attachment, onClose, navigation, onPrevious, onNext }: { attachment: ChatAttachment; onClose(): void; navigation?: ReactNode; onPrevious?(): void; onNext?(): void }) {
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined)
  const [result, setResult] = useState<{ text: string; truncated: boolean }>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const url = `/assets/${encodeURIComponent(attachment.assetId)}`
  useEffect(() => {
    const controller = new AbortController()
    setResult(undefined)
    setError(undefined)
    void fetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`读取文件失败（HTTP ${response.status}）`)
      const text = await response.text()
      if (!controller.signal.aborted) setResult({ text: text.slice(0, previewLimit), truncated: text.length > previewLimit })
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => controller.abort()
  }, [url, attempt])

  return <Dialog open layout="media" title={attachment.name} titleIcon={<FileText size={18} />} closeLabel="关闭预览" onClose={onClose}
    headerActions={<a className={styles.download} href={url} download={attachment.name} aria-label={`下载 ${attachment.name}`}><Download size={16} />下载</a>}>
    <div className={styles.textViewer}
      onTouchStart={event => { const touch = event.touches[0]; swipe.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : undefined }}
      onTouchEnd={event => { const start = swipe.current; swipe.current = undefined; const end = event.changedTouches[0]; if (start && end && Math.abs(end.clientX - start.x) > 60 && Math.abs(end.clientX - start.x) > Math.abs(end.clientY - start.y) * 2) { if (end.clientX < start.x) onNext?.(); else onPrevious?.() } }}
      onTouchCancel={() => { swipe.current = undefined }}>
      {error ? <div className={styles.textNotice} role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>
        : !result ? <p className={styles.textNotice} role="status">正在读取文件…</p>
          : <>
            {result.truncated ? <p className={styles.textNotice}>仅预览前 {previewLimit.toLocaleString()} 个字符，可下载查看完整文件。</p> : null}
            {result.text ? <pre className={styles.textContent} tabIndex={0} aria-label={`${attachment.name} 内容`}>{result.text}</pre>
              : <p className={styles.textNotice}>文件内容为空</p>}
          </>}
    </div>
    {navigation}
  </Dialog>
}
