import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownContent } from '../../../apps/studio-client/src/shared/ui/markdown-content/markdown-content.js'

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
const labels = {
  copy: 'Copy', copied: 'Copied', copyFailed: 'Failed', enableWrap: 'Wrap', disableWrap: 'Unwrap',
}

describe('Markdown renderer identity', () => {
  it('keeps renderer identities across body updates and new label objects', () => {
    const first = MarkdownContent({ value: '```js\nconst a = 1\n```', codeBlockLabels: labels })
    const second = MarkdownContent({ value: '```js\nconst a = 2\n```', codeBlockLabels: { ...labels, copy: '复制' } })
    const firstComponents = elements(first).find(element => element.props.components)!.props.components
    const secondComponents = elements(second).find(element => element.props.components)!.props.components
    expect(firstComponents).toBe(secondComponents)
    expect(renderToStaticMarkup(first)).toContain('Copy')
    const html = renderToStaticMarkup(second)
    expect(html).toContain('复制')
    expect(html).toContain('const')
  })
})
