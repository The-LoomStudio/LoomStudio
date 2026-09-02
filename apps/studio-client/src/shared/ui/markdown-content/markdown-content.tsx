import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
export { highlightCode } from './code-highlight.js'
import { remarkLoomDialogue } from './dialogue-markdown.js'
import { MarkdownCodeBlock, type MarkdownCodeBlockLabels } from './markdown-code-block.js'
import { prepareLoomMarkdown, readLoomToken } from './markdown-content-model.js'
import styles from './markdown-content.module.scss'

export function MarkdownContent(props: { className?: string; codeBlockLabels: MarkdownCodeBlockLabels; value: string }) {
  return (
    <div className={`${styles.content} ${props.className ?? ''}`} data-loom-component="markdown-content">
      <Markdown
        remarkPlugins={[remarkGfm, remarkLoomDialogue]}
        urlTransform={url => url.startsWith('loom-') ? url : defaultUrlTransform(url)}
        components={{
          a: ({ children, href, title }) => {
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
          code: ({ children, className, node }) => {
            const value = String(children).replace(/\n$/, '')
            const language = /language-([\w-]+)/.exec(className ?? '')?.[1]
            const fenced = node?.position?.start.line !== node?.position?.end.line
            return fenced ? <MarkdownCodeBlock code={value} labels={props.codeBlockLabels} language={language} /> : <code>{children}</code>
          },
          img: ({ alt, src }) => (
            <span className={`${styles.semanticToken} ${styles.assetToken}`} title={src}>
              {alt || src}
            </span>
          ),
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {prepareLoomMarkdown(props.value)}
      </Markdown>
    </div>
  )
}
