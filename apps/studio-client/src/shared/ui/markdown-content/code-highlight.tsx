import { javascriptLanguage } from '@codemirror/lang-javascript'
import { xmlLanguage } from '@codemirror/lang-xml'
import { yamlLanguage } from '@codemirror/lang-yaml'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import type { ReactNode } from 'react'
import { readYamlScalarTokenClass } from '../yaml-scalar-highlight.js'

export function highlightCode(code: string, language?: string): ReactNode[] {
  const normalizedLanguage = language?.toLowerCase()
  const parser = readLanguageParser(normalizedLanguage)
  if (!parser) return [code]

  const tree = parser.parse(code)
  const highlights: CodeHighlight[] = []
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    highlights.push({
      from,
      to,
      classes: normalizedLanguage === 'json' || normalizedLanguage === 'jsonc'
        ? readJsonTokenClass(code, to, classes)
        : classes,
    })
  })
  if (normalizedLanguage === 'yaml' || normalizedLanguage === 'yml') {
    collectYamlValueHighlights(code, tree.cursor(), highlights)
  }

  highlights.sort((left, right) => left.from - right.from)
  const parts: ReactNode[] = []
  let cursor = 0
  for (const highlight of highlights) {
    if (highlight.from > cursor) parts.push(code.slice(cursor, highlight.from))
    parts.push(
      <span className={highlight.classes} key={`${highlight.from}-${highlight.to}`}>
        {code.slice(highlight.from, highlight.to)}
      </span>,
    )
    cursor = highlight.to
  }
  if (cursor < code.length) parts.push(code.slice(cursor))
  return parts
}

interface CodeHighlight {
  from: number
  to: number
  classes: string
}

interface TreeCursor {
  name: string
  from: number
  to: number
  firstChild(): boolean
  nextSibling(): boolean
  parent(): boolean
}

function collectYamlValueHighlights(code: string, cursor: TreeCursor, highlights: CodeHighlight[], parentName?: string) {
  do {
    if (cursor.name === 'Literal' && parentName !== 'Key') {
      const value = code.slice(cursor.from, cursor.to)
      highlights.push({ from: cursor.from, to: cursor.to, classes: `tok-${readYamlScalarTokenClass(value)}` })
    }
    const currentName = cursor.name
    if (cursor.firstChild()) {
      collectYamlValueHighlights(code, cursor, highlights, currentName)
      cursor.parent()
    }
  } while (cursor.nextSibling())
}

function readJsonTokenClass(code: string, tokenEnd: number, classes: string) {
  if (classes !== 'tok-string') return classes
  return code.slice(tokenEnd).match(/^\s*:/) ? 'tok-propertyName' : classes
}

function readLanguageParser(normalized?: string) {
  if (normalized === 'js' || normalized === 'jsx' || normalized === 'javascript') return javascriptLanguage.parser
  if (normalized === 'ts' || normalized === 'tsx' || normalized === 'typescript') return javascriptLanguage.parser
  if (normalized === 'yaml' || normalized === 'yml') return yamlLanguage.parser
  if (normalized === 'xml' || normalized === 'html') return xmlLanguage.parser
  if (normalized === 'json' || normalized === 'jsonc') return javascriptLanguage.parser
  return undefined
}
