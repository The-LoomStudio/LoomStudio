import { javascriptLanguage } from '@codemirror/lang-javascript'
import { xmlLanguage } from '@codemirror/lang-xml'
import { yamlLanguage } from '@codemirror/lang-yaml'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import type { ReactNode } from 'react'

export function highlightCode(code: string, language?: string): ReactNode[] {
  const parser = readLanguageParser(language)
  if (!parser) return [code]

  const parts: ReactNode[] = []
  let cursor = 0
  highlightTree(parser.parse(code), classHighlighter, (from, to, classes) => {
    if (from > cursor) parts.push(code.slice(cursor, from))
    parts.push(<span className={classes} key={`${from}-${to}`}>{code.slice(from, to)}</span>)
    cursor = to
  })
  if (cursor < code.length) parts.push(code.slice(cursor))
  return parts
}

function readLanguageParser(language?: string) {
  const normalized = language?.toLowerCase()
  if (normalized === 'js' || normalized === 'jsx' || normalized === 'javascript') return javascriptLanguage.parser
  if (normalized === 'ts' || normalized === 'tsx' || normalized === 'typescript') return javascriptLanguage.parser
  if (normalized === 'yaml' || normalized === 'yml') return yamlLanguage.parser
  if (normalized === 'xml' || normalized === 'html') return xmlLanguage.parser
  if (normalized === 'json' || normalized === 'jsonc') return javascriptLanguage.parser
  return undefined
}
