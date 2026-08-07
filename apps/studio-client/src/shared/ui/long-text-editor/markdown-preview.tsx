import { MarkdownContent } from '../markdown-content/markdown-content.js'
import type { MarkdownCodeBlockLabels } from '../markdown-content/markdown-code-block.js'
import styles from './long-text-editor.module.scss'

type MarkdownPreviewProps = {
  codeBlockLabels: MarkdownCodeBlockLabels
  emptyLabel: string
  value: string
}

export function MarkdownPreview(props: MarkdownPreviewProps) {
  if (!props.value.trim()) return <p className={styles.previewEmpty}>{props.emptyLabel}</p>

  return (
    <MarkdownContent className={styles.preview} codeBlockLabels={props.codeBlockLabels} value={props.value} />
  )
}
