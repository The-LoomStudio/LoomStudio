import { defaultUrlTransform } from 'react-markdown'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { prepareLoomMarkdown, readLoomToken } from './markdown-preview-model.js'
import styles from './long-text-editor.module.scss'

type MarkdownPreviewProps = {
  emptyLabel: string
  value: string
}

export function MarkdownPreview(props: MarkdownPreviewProps) {
  if (!props.value.trim()) return <p className={styles.previewEmpty}>{props.emptyLabel}</p>

  return (
    <div className={styles.preview} data-loom-component="markdown-preview">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={url => url.startsWith('loom-') ? url : defaultUrlTransform(url)}
        components={{
          a: ({ children, href, title }) => {
            const macro = readLoomToken(href ?? '', 'loom-macro:')
            if (macro) return <span className={`${styles.semanticToken} ${styles.macroToken}`} title={macro}>{children}</span>
            const asset = readLoomToken(href ?? '', 'loom-asset:')
            if (asset) return <span className={`${styles.semanticToken} ${styles.assetToken}`} title={asset}>{children}</span>
            return <a href={href} rel="noreferrer noopener" target="_blank" title={title}>{children}</a>
          },
          img: ({ alt, src }) => (
            <span className={`${styles.semanticToken} ${styles.assetToken}`} title={src}>
              {alt || src}
            </span>
          ),
        }}
      >
        {prepareLoomMarkdown(props.value)}
      </Markdown>
    </div>
  )
}
