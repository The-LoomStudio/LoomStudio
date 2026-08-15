import type { MarkdownCodeBlockLabels } from '../markdown-content/markdown-code-block.js'
import { MarkdownContent } from '../markdown-content/markdown-content.js'
import styles from './conversation-markdown.module.scss'

export function ConversationMarkdown(props: {
  className?: string
  codeBlockLabels: MarkdownCodeBlockLabels
  role: 'user' | 'assistant'
  value: string
}) {
  return (
    <MarkdownContent
      className={`${styles.content} ${styles[props.role]} ${props.className ?? ''}`}
      codeBlockLabels={props.codeBlockLabels}
      value={props.value}
    />
  )
}
