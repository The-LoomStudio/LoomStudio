import { parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent } from 'mdast'
import { mapOutsideMarkdownCode } from '../../../shared/ui/markdown-content/markdown-content-model.js'

export type MessageSegment = { kind: 'markdown' | 'fragment' | 'document' | 'pending'; value: string; start: number }
const markdownParser = unified().use(remarkParse).use(remarkGfm)
const htmlTags = new Set('html head body div span p details summary small b strong i em u s del ins sub sup br hr pre code blockquote ul ol li dl dt dd table thead tbody tfoot tr td th caption section article header footer main aside nav h1 h2 h3 h4 h5 h6 a img button input label select option textarea form script style link meta title svg figure figcaption audio video canvas'.split(' '))
type HtmlNode = DefaultTreeAdapterMap['node']

function normalizeWrappedFences(source: string, tree: Root): string {
  if (!source.includes('<')) return source
  return mapOutsideMarkdownCode(source, (text, start) => {
    // A slice after inline code must not turn the middle of a line into /^/.
    const prefix = start > 0 && source[start - 1] !== '\n' ? '\u0000' : ''
    return normalizeWrappedText(prefix + text).slice(prefix.length)
  }, tree)
}

function normalizeWrappedText(source: string): string {
  // 1. Separate inline custom tags that immediately touch a code fence: e.g. <opening> ```html or ``` </opening>
  let res = source.replace(/(<([a-zA-Z][\w-]*)\b[^>]*>)[ \t]*(`{3,}|~{3,})html/gi, (match, openTag, tagName, fence) => {
    if (!htmlTags.has(tagName.toLowerCase())) {
      return `\n\n${openTag}\n\n${fence}html`
    }
    return match
  })
  res = res.replace(/(`{3,}|~{3,})[ \t]*(<\/([a-zA-Z][\w-]*)\b[^>]*>)/gi, (match, fence, closeTag, tagName) => {
    if (!htmlTags.has(tagName.toLowerCase())) {
      return `${fence}\n\n${closeTag}\n\n`
    }
    return match
  })

  // 2. Separate custom tags on their own lines from adjacent lines with blank lines so CommonMark does not merge code blocks into HTML blocks
  res = res.replace(/(^|\n)[ \t]*(<\/?[a-zA-Z][\w-]*\b[^>]*>)[ \t]*(\r?\n|$)/g, (match, prefix, tag) => {
    const tagName = /^<\/?([a-zA-Z][\w-]*)/i.exec(tag)?.[1]?.toLowerCase()
    if (tagName && !htmlTags.has(tagName)) {
      return `${prefix}\n${tag}\n\n`
    }
    return match
  })

  return res
}

export function parseMessageSegments(source: string, streaming = false): MessageSegment[] {
  const originalTree = markdownParser.parse(source)
  const normalized = normalizeWrappedFences(source, originalTree)
  const tree = normalized === source ? originalTree : markdownParser.parse(normalized)
  const parts: MessageSegment[] = []
  let cursor = 0
  function append(kind: MessageSegment['kind'], start: number, end: number, value = normalized.slice(start, end)) {
    if (start > cursor) {
      const raw = normalized.slice(cursor, start)
      if (raw.trim()) parts.push({ kind: 'markdown', value: raw, start: cursor })
    }
    parts.push({ kind, value, start })
    cursor = end
  }
  // ponytail: Automatic documents are top-level blocks; nested list/quote HTML
  // remains sanitized Markdown until a source-mapped nested renderer is needed.
  for (const node of tree.children) {
    const start = node.position?.start.offset ?? 0
    const end = node.position?.end.offset ?? start
    if (start < cursor) continue
    if (node.type === 'code' && node.lang?.toLowerCase() === 'html') {
      // CommonMark accepts an unclosed fence; an executable preview must not.
      const original = normalized.slice(start, end)
      const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(original)
      const lastLine = original.trimEnd().split('\n').at(-1) ?? ''
      const closing = opening && new RegExp(`^ {0,3}${opening[1]![0]}{${opening[1]!.length},}[ \\t]*$`).test(lastLine)
      // Some imported replacements put HTML on the fence's info line.
      // Recover only markup after the explicit html language, not arbitrary metadata.
      const sameLineHtml = /^ {0,3}(?:`{3,}|~{3,})html[ \t]+(<[^\n]*)\r?\n/i.exec(original)?.[1]
      if (opening && closing && original.includes('\n')) append('document', start, end,
        sameLineHtml ? `${sameLineHtml}\n${node.value}` : node.value)
      else if (streaming) append('pending', start, end)
      continue
    }
    if (node.type === 'html') {
      const rest = normalized.slice(start)
      const opening = /^\s*<(?:!doctype\s+html\b|([a-z][\w-]*)\b)/i.exec(rest)
      if (!opening || (opening[1] && !htmlTags.has(opening[1].toLowerCase()))) continue
      const isDocument = !opening[1] || opening[1].toLowerCase() === 'html'
      const parsed = isDocument ? parse(rest, { sourceCodeLocationInfo: true }) : parseFragment(rest, { sourceCodeLocationInfo: true })
      const first = parsed.childNodes.find(child => 'tagName' in child)
      if (!first || !('tagName' in first)) {
        if (streaming) append('pending', start, normalized.length)
        continue
      }
      let htmlEnd = first.sourceCodeLocation?.endTag?.endOffset
      let executable = isDocument || hasExecutableHtml(first)
      // Keep adjacent style / markup / script siblings in one document, but stop
      // at ordinary Markdown text. Source locations retain nested blank lines.
      if (!isDocument && htmlEnd) {
        for (const child of parsed.childNodes) {
          if (child.nodeName === '#text' && 'value' in child && !child.value.trim()) continue
          if (!('tagName' in child) || !htmlTags.has(child.tagName) || !child.sourceCodeLocation?.endTag) break
          if (child.sourceCodeLocation.startOffset >= end - start
            && !['style', 'script'].includes(first.tagName)
            && !['style', 'script'].includes(child.tagName)) break
          htmlEnd = child.sourceCodeLocation.endTag.endOffset
          executable ||= hasExecutableHtml(child)
        }
      }
      if (htmlEnd) {
        const value = rest.slice(0, htmlEnd)
        // Unwrapped sibling scripts/styles have no final boundary until the
        // stream ends. An explicitly closed document or container does.
        const unbounded = ['style', 'script', 'link'].includes(first.tagName)
        append(executable ? (streaming && unbounded ? 'pending' : 'document') : 'fragment', start, start + htmlEnd, value)
        if (streaming && unbounded) {
          parts[parts.length - 1]!.value = normalized.slice(start)
          cursor = normalized.length
        }
      } else if (streaming) {
        append('pending', start, normalized.length)
      } else if (!streaming && !isDocument && !hasExecutableHtml(first)) {
        append('fragment', start, end)
      }
      continue
    }
    if (containsHtml(node)) append('fragment', start, end)
  }
  if (cursor < normalized.length) {
    const raw = normalized.slice(cursor)
    // Unknown business tags are authored text; only explicit transforms remove them.
    if (raw.trim()) parts.push({ kind: 'markdown', value: raw, start: cursor })
  }
  return parts
}

function containsHtml(node: RootContent): boolean {
  if (node.type === 'html') return /^<\/?([a-z][\w-]*)\b/i.test(node.value) && htmlTags.has(/^<\/?([a-z][\w-]*)/i.exec(node.value)![1]!.toLowerCase())
  return 'children' in node && node.children.some(child => containsHtml(child as RootContent))
}

function hasExecutableHtml(node: HtmlNode): boolean {
  if ('tagName' in node && (
    ['script', 'style', 'link', 'iframe', 'canvas', 'svg'].includes(node.tagName)
    || node.attrs.some(attribute => attribute.name.startsWith('on'))
  )) return true
  return 'childNodes' in node && node.childNodes.some(hasExecutableHtml)
}
