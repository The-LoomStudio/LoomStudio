import { Check, Copy, WrapText, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { IconButton } from '@loom-studio/ui'
import { useCopyFeedback } from '../../hooks/use-copy-feedback.js'
import styles from './markdown-content.module.scss'
import { ContentErrorBoundary } from '../content-error-boundary.js'
import { readCodeHighlightLanguage } from './code-highlight-language.js'

const CodeHighlight = lazy(() => import('./code-highlight.js'))

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
  const { feedback, copy } = useCopyFeedback()
  const copyState = feedback?.status ?? 'idle'
  const [wrapped, setWrapped] = useState(false)

  const copyLabel = copyState === 'copied'
    ? props.labels.copied
    : copyState === 'failed'
      ? props.labels.copyFailed
      : props.labels.copy

  return (
    <div className={styles.codeBlock} data-wrap={wrapped ? 'true' : 'false'}>
      {props.language ? <span className={styles.codeLanguage}>{props.language}</span> : null}
      <div className={styles.codeActions}>
        <IconButton
          aria-label={wrapped ? props.labels.disableWrap : props.labels.enableWrap}
          className={styles.codeAction}
          onClick={() => setWrapped(value => !value)}
        >
          <WrapText aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={copyLabel}
          className={styles.codeAction}
          onClick={() => void copy(props.code)}
        >
          {copyState === 'copied' ? <Check aria-hidden="true" /> : copyState === 'failed' ? <X aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </IconButton>
      </div>
      <pre><code data-language={props.language}>{readCodeHighlightLanguage(props.language)
        ? <ContentErrorBoundary fallback={props.code} resetKey={props.code}><Suspense fallback={props.code}><CodeHighlight code={props.code} language={props.language} /></Suspense></ContentErrorBoundary>
        : props.code}</code></pre>
    </div>
  )
}
