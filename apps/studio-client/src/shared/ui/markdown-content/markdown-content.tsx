import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import { createContext, useContext, useMemo } from 'react'
import { Bot, BookOpen, Cpu, Database, FileCode2, FileText, Link2, Puzzle, UserRound } from 'lucide-react'
import remarkGfm from 'remark-gfm'
import { parseResourceLink } from '@loom-studio/shared'
export { highlightCode } from './code-highlight.js'
import { remarkLoomDialogue } from './dialogue-markdown.js'
import { MarkdownCodeBlock, type MarkdownCodeBlockLabels } from './markdown-code-block.js'
import { prepareLoomMarkdown, readLoomToken } from './markdown-content-model.js'
import styles from './markdown-content.module.scss'
import { safeHtmlPlugins } from './safe-html.js'

const CodeBlockLabelsContext = createContext<MarkdownCodeBlockLabels | null>(null)
const markdownComponents: Components = {
  a: ({ children, href, title }) => {
    if (href?.startsWith('loom-resource:')) {
      const reference = parseResourceLink(href)
      if (!reference) return <span title="无效的资源引用">{children}</span>
      const Icon = reference.kind === 'state' ? Database
        : reference.kind === 'script' ? FileCode2
        : reference.kind === 'prompt-resource' || reference.type === 'resource' ? FileText
        : reference.type === 'timeline' ? BookOpen
        : reference.type === 'card' ? UserRound
        : reference.type === 'session' || reference.type === 'run' ? Bot
        : reference.type === 'provider' ? Cpu
        : reference.type === 'extension' ? Puzzle : Link2
      return <button type="button" className={styles.resourceReference}
        title={href} onClick={() => window.dispatchEvent(new CustomEvent('loom:open-reference', { detail: { uri: href } }))}>
        <Icon aria-hidden="true" />
        {children}
      </button>
    }
    const dialogue = readLoomToken(href ?? '', 'loom-dialogue:')
    if (dialogue) return <span className={styles.dialogueToken} data-loom-token="dialogue">{children}</span>
    const macro = readLoomToken(href ?? '', 'loom-macro:')
    if (macro) return <span className={`${styles.semanticToken} ${styles.macroToken}`} title={macro}>{children}</span>
    const asset = readLoomToken(href ?? '', 'loom-asset:')
    if (asset) {
      return (
        <button
          className={`${styles.semanticToken} ${styles.assetToken}`}
          title={asset}
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            window.dispatchEvent(new CustomEvent('loom:navigate', { detail: { path: asset } }))
          }}
        >
          {children}
        </button>
      )
    }
    return <a href={href} rel="noreferrer noopener" target="_blank" title={title}>{children}</a>
  },
  code: function Code({ children, className, node }) {
    const labels = useContext(CodeBlockLabelsContext)!
    const value = String(children).replace(/\n$/, '')
    const language = /language-([\w-]+)/.exec(className ?? '')?.[1]
    const fenced = node?.position?.start.line !== node?.position?.end.line
    return fenced ? <MarkdownCodeBlock code={value} labels={labels} language={language} /> : <code>{children}</code>
  },
  img: ({ alt, src }) => (
    <span className={`${styles.semanticToken} ${styles.assetToken}`} title={src}>
      {alt || src}
    </span>
  ),
  pre: ({ children }) => <>{children}</>,
}

export function MarkdownContent(props: { className?: string; codeBlockLabels: MarkdownCodeBlockLabels; value: string; safeHtml?: boolean }) {
  const body = useMemo(() => (
    <Markdown
      remarkPlugins={[remarkGfm, remarkLoomDialogue]}
      rehypePlugins={props.safeHtml ? safeHtmlPlugins : undefined}
      urlTransform={url => url.startsWith('loom-') ? url : defaultUrlTransform(url)}
      components={markdownComponents}
    >
      {props.safeHtml ? props.value : prepareLoomMarkdown(props.value)}
    </Markdown>
  ), [props.value, props.safeHtml])
  return (
    <CodeBlockLabelsContext.Provider value={props.codeBlockLabels}>
      <div className={`${styles.content} ${props.className ?? ''}`} data-loom-component="markdown-content" data-loom-safe-html={props.safeHtml ? '' : undefined}>
        {body}
      </div>
    </CodeBlockLabelsContext.Provider>
  )
}
