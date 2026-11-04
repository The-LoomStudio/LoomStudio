import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Nodes } from 'mdast'

const LOOM_TOKEN_PATTERN = /(\{\{[^\n{}]+\}\}|\{%[^\n%]+%\}|@(?:\/(?:[\p{L}\p{N}_.-]+\/?)*|[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_.-]+)+))/gu
const markdownParser = unified().use(remarkParse).use(remarkGfm)

export function prepareLoomMarkdown(value: string): string {
  if (value.search(LOOM_TOKEN_PATTERN) === -1) return value
  return mapOutsideMarkdownCode(value, replaceLoomTokens)
}

/** Use Markdown's source offsets so fences and code-span delimiters stay literal. */
export function mapOutsideMarkdownCode(
  value: string,
  transform: (text: string, start: number) => string,
  tree: Nodes = markdownParser.parse(value),
): string {
  const ranges: Array<{ start: number; end: number }> = []
  function visit(node: Nodes) {
    if (node.type === 'code' || node.type === 'inlineCode') {
      ranges.push({ start: node.position!.start.offset!, end: node.position!.end.offset! })
    } else if ('children' in node) {
      node.children.forEach(visit)
    }
  }
  visit(tree)
  let cursor = 0
  let output = ''
  for (const range of ranges) {
    output += transform(value.slice(cursor, range.start), cursor)
    output += value.slice(range.start, range.end)
    cursor = range.end
  }
  return output + transform(value.slice(cursor), cursor)
}

function replaceLoomTokens(value: string): string {
  // ponytail: 首版只识别单行宏和包含斜杠的资源引用；复杂嵌套语法升级为正式 AST 插件。
  return value.replace(LOOM_TOKEN_PATTERN, token => {
    const type = token.startsWith('@') ? 'asset' : 'macro'
    return `[${escapeMarkdownLabel(token)}](loom-${type}:${encodeURIComponent(token)})`
  })
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\[\]]/g, character => `\\${character}`)
}

export function readLoomToken(value: string, prefix: 'loom-asset:' | 'loom-dialogue:' | 'loom-macro:'): string | undefined {
  if (!value.startsWith(prefix)) return undefined
  try {
    return decodeURIComponent(value.slice(prefix.length))
  } catch {
    return undefined
  }
}
