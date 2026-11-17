// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { ReadOnlyDiff } from '../../../apps/studio-client/src/shared/ui/read-only-diff/read-only-diff.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('Read-only resource diff', () => {
  it('shows actual insertions/deletions and line numbers, with expandable unchanged context', () => {
    const before = Array.from({ length: 45 }, (_, index) => `original line ${index + 1}`).join('\n')
    const after = before.replace('original line 3', 'new line 3').replace('original line 43', 'new line 43')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      act(() => root.render(createElement(ReadOnlyDiff, { before, after, t: createTranslator('en-US') })))
      expect(container.querySelectorAll('.cm-editor')).toHaveLength(1)
      expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
      expect(container.querySelector('.cm-lineNumbers')).not.toBeNull()
      expect(container.querySelector('.cm-changedLine')?.textContent).toContain('new line 3')
      expect(container.querySelector('.cm-deletedChunk')?.textContent).toContain('original line 3')
      expect(container.querySelector('.cm-chunkButtons')).toBeNull()
      expect(container.querySelector('.cm-collapsedLines')).not.toBeNull()
      act(() => container.querySelector<HTMLButtonElement>('button')!.click())
      expect(container.querySelector('.cm-collapsedLines')).toBeNull()
      expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Collapse unchanged lines')
      act(() => container.querySelector<HTMLButtonElement>('button')!.click())
      expect(container.querySelector('.cm-collapsedLines')).not.toBeNull()
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
