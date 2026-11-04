// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ContextAssetDetail } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-detail/context-asset-detail.js'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { flushSync(() => root.unmount()); host.remove() })
function detail(keywords = 'rain'): ComponentProps<typeof ContextAssetDetail> {
  return {
    node: { id: 'entry', kind: 'entry', label: 'Entry', body: '', capabilities: { activation: { kind: 'keyword', keywords: [keywords] } } },
    editorMode: 'preview', metadataOpen: true, activationEditable: true,
    t: key => key, onChangeNode: vi.fn(), onCommitNode: vi.fn(), onEditorModeChange: vi.fn(), onMetadataOpenChange: vi.fn(),
  }
}
function render(props: ComponentProps<typeof ContextAssetDetail>) {
  flushSync(() => root.render(createElement(ContextAssetDetail, props)))
  return host.querySelector<HTMLInputElement>('[placeholder="context.activation.keywordsPlaceholder"]')!
}
function type(input: HTMLInputElement, value: string) {
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('synchronizes clean same-node replacements and cannot reapply a discarded keyword draft on blur', () => {
  const input = render(detail('rain'))
  input.focus()
  type(input, 'storm')
  flushSync(() => input.blur())
  render(detail('storm'))
  const restored = detail('rain')
  expect(render(restored).value).toBe('rain')
  input.focus()
  flushSync(() => input.blur())
  expect(restored.onCommitNode).toHaveBeenCalledWith(expect.objectContaining({ capabilities: expect.objectContaining({ activation: expect.objectContaining({ keywords: ['rain'] }) }) }))
})
it('preserves unfinished keyword text across upstream changes but resets for another node', () => {
  const input = render(detail())
  input.focus()
  type(input, 'new, ')
  expect(render(detail('remote')).value).toBe('new, ')
  const next = detail('other')
  next.node = { ...next.node, id: 'other' }
  expect(render(next).value).toBe('other')
})
it.each(['keyword', 'anchor'])('does not blur or commit %s while confirming an IME composition', kind => {
  const props = detail()
  if (kind === 'anchor') props.node = { id: 'anchor', kind: 'virtual', label: '@custom.anchor', capabilities: { targetAnchorId: '@custom.anchor' } }
  render(props)
  const input = host.querySelector<HTMLInputElement>(kind === 'keyword' ? '[placeholder="context.activation.keywordsPlaceholder"]' : 'input[list]')!
  input.focus()
  flushSync(() => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  flushSync(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
  expect(document.activeElement).toBe(input)
  expect(props.onCommitNode).not.toHaveBeenCalled()
  const fallback = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  Object.defineProperty(fallback, 'keyCode', { value: 229 })
  flushSync(() => input.dispatchEvent(fallback))
  expect(document.activeElement).toBe(input)
  expect(props.onCommitNode).not.toHaveBeenCalled()
  flushSync(() => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  flushSync(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(document.activeElement).not.toBe(input)
  expect(props.onCommitNode).toHaveBeenCalledOnce()
})
