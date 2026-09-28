import { useMemo } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { MarkdownCodeBlockLabels } from '../../../shared/ui/markdown-content/markdown-code-block.js'
import { ConversationMarkdown } from '../../../shared/ui/conversation-markdown/conversation-markdown.js'
import { renderTemplateMacros, type MacroRenderContext } from '../../state-variables/model/macro-renderer.js'
import { parseMessageSegments } from '../model/message-segments.js'
import { HtmlPreview } from './html-preview.js'
import styles from './message-content.module.scss'

export function MessageContent(props: {
  className?: string
  codeBlockLabels: MarkdownCodeBlockLabels
  role: 'user' | 'assistant'
  value: string
  streaming?: boolean
  macroContext?: MacroRenderContext
}) {
  const segments = useMemo(() => parseMessageSegments(props.value, props.streaming), [props.value, props.streaming])
  return <div className={`${styles.content} ${props.className ?? ''}`} data-loom-message-content="">
    {segments.map(segment => segment.kind === 'document'
      ? <HtmlPreview key={segment.start} value={segment.value} />
      : segment.kind === 'pending'
      ? <div key={segment.start} className={styles.pending} role="status" aria-label="HTML 正在生成" data-loom-html-pending="">
          <LoaderCircle size={16} aria-hidden="true" /> <span>生成中</span>
        </div>
      : <ConversationMarkdown
        key={segment.start}
        codeBlockLabels={props.codeBlockLabels}
        role={props.role}
        safeHtml={segment.kind === 'fragment'}
        value={segment.kind === 'markdown' && props.macroContext
          ? renderTemplateMacros(segment.value, props.macroContext)
          : segment.value}
      />)}
  </div>
}
