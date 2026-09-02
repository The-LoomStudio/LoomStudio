const LOOM_TOKEN_PATTERN = /(\{\{[^\n{}]+\}\}|\{%[^\n%]+%\}|@(?:\/(?:[\p{L}\p{N}_.-]+\/?)*|[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_.-]+)+))/gu

export function prepareLoomMarkdown(value: string): string {
  let fence: string | undefined

  return value.split('\n').map(line => {
    const fenceMatch = line.match(/^\s{0,3}(```|~~~)/)
    if (fenceMatch) {
      fence = fence === fenceMatch[1] ? undefined : fence ?? fenceMatch[1]
      return line
    }
    if (fence) return line

    return line.split(/(`+[^`]*`+)/g).map(part => (
      part.startsWith('`') ? part : replaceLoomTokens(part)
    )).join('')
  }).join('\n')
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
