import { Check, Copy, WrapText, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { highlightCode } from './code-highlight.js'
import styles from './markdown-content.module.scss'

export type MarkdownCodeBlockLabels = {
  copied: string
  copy: string
  copyFailed: string
  disableWrap: string
  enableWrap: string
}

export function MarkdownCodeBlock(props: {
  code: string
  labels: MarkdownCodeBlockLabels
  language?: string
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [wrapped, setWrapped] = useState(false)
  const content = useMemo(() => highlightCode(props.code, props.language), [props.code, props.language])

  useEffect(() => {
    if (copyState === 'idle') return
    const timeout = window.setTimeout(() => setCopyState('idle'), 1600)
    return () => window.clearTimeout(timeout)
  }, [copyState])

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(props.code)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const copyLabel = copyState === 'copied'
    ? props.labels.copied
    : copyState === 'failed'
      ? props.labels.copyFailed
      : props.labels.copy

  return (
    <div className={styles.codeBlock} data-wrap={wrapped ? 'true' : 'false'}>
      <div className={styles.codeActions}>
        <button
          aria-label={wrapped ? props.labels.disableWrap : props.labels.enableWrap}
          className={styles.codeAction}
          title={wrapped ? props.labels.disableWrap : props.labels.enableWrap}
          type="button"
          onClick={() => setWrapped(value => !value)}
        >
          <WrapText aria-hidden="true" />
        </button>
        <button
          aria-label={copyLabel}
          className={styles.codeAction}
          title={copyLabel}
          type="button"
          onClick={() => void copyCode()}
        >
          {copyState === 'copied' ? <Check aria-hidden="true" /> : copyState === 'failed' ? <X aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
      <pre><code data-language={props.language}>{content}</code></pre>
    </div>
  )
}
