import Markdown, { type Options } from 'react-markdown'
import { safeHtmlPlugins } from './safe-html.js'

export default function SafeHtmlMarkdown(props: { options: Options; value: string }) {
  return <Markdown {...props.options} rehypePlugins={safeHtmlPlugins}>{props.value}</Markdown>
}
