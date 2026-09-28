import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownContent } from '../../../apps/studio-client/src/shared/ui/markdown-content/markdown-content.js'

const memo = vi.hoisted(() => ({ deps: undefined as unknown[] | undefined, value: undefined as unknown }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useMemo: (compute: () => unknown, deps: unknown[]) => {
    if (!memo.deps || deps.some((value, index) => !Object.is(value, memo.deps![index]))) {
      memo.value = compute()
      memo.deps = deps
    }
    return memo.value
  },
}))
beforeEach(() => { memo.deps = undefined; memo.value = undefined })

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
  it('reuses unchanged Markdown while updating labels and reparses changed body text', () => {
    const value = '```js\nconst a = 1\n```'
    const first = MarkdownContent({ value, codeBlockLabels: labels })
    const translated = MarkdownContent({ value, className: 'updated', codeBlockLabels: { ...labels, copy: '复制' } })
    const markdown = (tree: unknown) => elements(tree).find(element => element.props.components)
    expect(markdown(translated)).toBe(markdown(first))
    expect(renderToStaticMarkup(translated)).toContain('复制')
    expect(renderToStaticMarkup(translated)).toContain('updated')
    const changed = MarkdownContent({ value: 'Changed body', codeBlockLabels: labels })
    expect(markdown(changed)).not.toBe(markdown(first))
    expect(renderToStaticMarkup(changed)).toContain('Changed body')
  })

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
