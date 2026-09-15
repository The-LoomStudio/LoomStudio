const LOOM_TOKEN_PATTERN = /(\{\{[^\n{}]+\}\}|\{%[^\n%]+%\}|@(?:\/(?:[\p{L}\p{N}_.-]+\/?)*|[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_.-]+)+))/gu

export function prepareLoomMarkdown(value: string): string {
  let fence: string | undefined

  const processedLines = value.split('\n').map(line => {
    const fenceMatch = line.match(/^\s{0,3}(```|~~~)/)
    if (fenceMatch) {
      fence = fence === fenceMatch[1] ? undefined : fence ?? fenceMatch[1]
      return line
    }
    if (fence) return line

    return line.split(/(`+[^`]*`+)/g).map(part => (
      part.startsWith('`') ? part : replaceLoomTokens(part)
    )).join('')
  })

  let inCode = false
  const output: string[] = []
  for (let i = 0; i < processedLines.length; i++) {
    const line = processedLines[i]!
    const fenceMatch = line.match(/^\s{0,3}(```|~~~)/)
    if (fenceMatch) {
      inCode = !inCode
      output.push(line)
      continue
    }
    if (inCode) {
      output.push(line)
      continue
    }

    output.push(line)
    const nextLine = processedLines[i + 1]
    const isList = /^\s*([-*+]|\d+\.)\s/.test(line)
    const nextIsList = nextLine !== undefined && /^\s*([-*+]|\d+\.)\s/.test(nextLine)
    if (
      line.trim() !== '' &&
      nextLine !== undefined &&
      nextLine.trim() !== '' &&
      !nextLine.match(/^\s{0,3}(```|~~~)/) &&
      !(isList && nextIsList)
    ) {
      output.push('')
    }
  }

  return output.join('\n')
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
