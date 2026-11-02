// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MarkdownCodeBlock } from '../../../apps/studio-client/src/shared/ui/markdown-content/markdown-code-block.js'

const highlighter = vi.hoisted(() => ({ loads: 0 }))
vi.mock('../../../apps/studio-client/src/shared/ui/markdown-content/code-highlight.js', () => {
  highlighter.loads++
  return { default: ({ code }: { code: string }) => createElement('mark', null, code) }
})

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const labels = { copy: 'Copy', copied: 'Copied', copyFailed: 'Failed', enableWrap: 'Wrap', disableWrap: 'Unwrap' }

it('requests the highlighter only for supported code blocks', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    for (const language of [undefined, 'text', 'python']) {
      await act(async () => root.render(createElement(MarkdownCodeBlock, { code: '<plain>', language, labels })))
      expect(container.querySelector('code')?.textContent).toBe('<plain>')
      expect(container.querySelector('plain')).toBeNull()
      expect(highlighter.loads).toBe(0)
    }
    await act(async () => root.render(createElement(MarkdownCodeBlock, { code: 'const n = 1', language: 'JS', labels })))
    expect(highlighter.loads).toBe(1)
    expect(container.querySelector('code mark')?.textContent).toBe('const n = 1')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
