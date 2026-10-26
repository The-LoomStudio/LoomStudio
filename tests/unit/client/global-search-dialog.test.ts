// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GlobalSearchHit } from '@loom-studio/shared'
import { GlobalSearchDialog } from '../../../apps/studio-client/src/widgets/global-search/global-search-dialog.js'
import { findGlobalSearchNavigation, globalSearchResourceValue } from '../../../apps/studio-client/src/features/global-search/model/global-search-model.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

type DialogProps = ComponentProps<typeof GlobalSearchDialog>
type SearchState = DialogProps['search']
const t = createTranslator('zh-CN')
const mounts: Array<{ root: Root; container: HTMLDivElement }> = []
const domRestores: Array<() => void> = []

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // happy-dom has no layout or native modal top layer; these remain DOM boundaries.
  for (const [prototype, name, value] of [
    [HTMLElement.prototype, 'scrollIntoView', function () {}],
    [HTMLDialogElement.prototype, 'showModal', function (this: HTMLDialogElement) { this.open = true }],
    [HTMLDialogElement.prototype, 'close', function (this: HTMLDialogElement) { this.open = false }],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
    Object.defineProperty(prototype, name, { configurable: true, writable: true, value })
    domRestores.push(() => {
      if (descriptor) Object.defineProperty(prototype, name, descriptor)
      else Reflect.deleteProperty(prototype, name)
    })
  }
})

afterEach(async () => {
  for (const { root, container } of mounts.splice(0)) {
    await act(async () => root.unmount())
    container.remove()
  }
})

afterAll(() => {
  for (const restore of domRestores) restore()
  vi.unstubAllGlobals()
})

function resource(id: string): GlobalSearchHit {
  return {
    id, kind: 'lore', title: '同名条目', path: ['北境', '地理'], snippet: '王都在山脉以北',
    target: { type: 'resource', resourceId: 'north', nodeId: id, resourceKind: 'lore' },
  }
}

function searchState(overrides: Partial<SearchState> = {}): SearchState {
  return {
    mode: 'results', query: '王都', inputValue: '王都', scope: undefined, kind: undefined,
    navigation: [], results: [], scopes: [], types: [], loading: false, loadingMore: false,
    error: null, hasMore: false, diagnostics: [],
    setInputValue: vi.fn(), showScopes: vi.fn(), showTypes: vi.fn(), showResults: vi.fn(),
    selectScope: vi.fn(), selectKind: vi.fn(), removeScope: vi.fn(), removeKind: vi.fn(),
    clearFilters: vi.fn(), loadMore: vi.fn(), retry: vi.fn(),
    ...overrides,
  }
}

async function mount(search: SearchState) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounts.push({ root, container })
  const props: DialogProps = {
    open: true, search, recent: [], t,
    onClose: vi.fn(), onOpenPanel: vi.fn(), onOpenResult: vi.fn(),
  }
  const render = async (next: SearchState) => {
    props.search = next
    await act(async () => root.render(createElement(GlobalSearchDialog, props)))
  }
  await render(search)
  const input = () => container.querySelector<HTMLInputElement>('[role="combobox"]')!
  const selected = () => container.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.getAttribute('data-value')
  const press = async (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
    await act(async () => { input().dispatchEvent(event) })
    return event
  }
  return { container, props, render, input, selected, press }
}

describe('global search dialog keyboard interaction', () => {
  it('formats structured installation sources using the active language', async () => {
    const hit = { ...resource('lore:source'), source: { packageId: 'the-world', installationId: 'global' } }
    const f = await mount(searchState({ results: [hit] }))
    f.props.t = createTranslator('en-US')
    await f.render(f.props.search)
    expect(f.container.textContent).toContain('the-world · Global')
    f.props.t = t
    await f.render(f.props.search)
    expect(f.container.textContent).toContain('the-world · 全局')
    f.props.t = createTranslator('en-US')
    await f.render(searchState({ mode: 'scopes', scopes: [{ kind: 'extension', id: 'the-world', label: 'The World',
      sources: [{ ...hit.source, cardId: 'card', cardName: 'Alice' }] }] }))
    expect(f.container.textContent).toContain('the-world · Character card: Alice')
  })

  it('selects a valid initial item and opens it with Enter', async () => {
    const first = resource('lore:first')
    const f = await mount(searchState({ results: [first, resource('lore:second')] }))
    expect(f.selected()).toBe(globalSearchResourceValue(first))
    expect(document.activeElement).toBe(f.input())
    await f.press('Enter')
    expect(f.props.onOpenResult).toHaveBeenCalledExactlyOnceWith(first)
  })

  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ])('does not open a result while confirming Chinese composition: %j', async options => {
    const first = resource('lore:first')
    const f = await mount(searchState({ results: [first] }))
    await f.press('Enter', options)
    expect(f.props.onOpenResult).not.toHaveBeenCalled()
    expect(f.props.onOpenPanel).not.toHaveBeenCalled()
    await f.press('Enter')
    expect(f.props.onOpenResult).toHaveBeenCalledExactlyOnceWith(first)
  })

  it('keeps the selected navigation entry when asynchronous resource results arrive', async () => {
    const navigation = findGlobalSearchNavigation({ query: '', t }).slice(0, 2)
    const state = searchState({ navigation, loading: true })
    const f = await mount(state)
    await f.press('ArrowDown')
    expect(f.selected()).toBe(navigation[1]!.id)
    await f.render({ ...state, results: [resource('lore:arrived')], loading: false })
    expect(f.selected()).toBe(navigation[1]!.id)
    await f.press('Enter')
    expect(f.props.onOpenPanel).toHaveBeenCalledExactlyOnceWith(navigation[1]!.panel)
    expect(f.props.onOpenResult).not.toHaveBeenCalled()
  })

  it.each(['scopes', 'types'] as const)('returns from %s with Escape without closing the dialog', async mode => {
    const state = searchState({
      mode, inputValue: '',
      scopes: [{ id: 'north', kind: 'resource', label: '北境' }],
      types: [{ kind: 'lore', label: 'Lore' }],
    })
    const f = await mount(state)
    const event = await f.press('Escape')
    expect(event.defaultPrevented).toBe(true)
    expect(state.showResults).toHaveBeenCalledOnce()
    expect(f.props.onClose).not.toHaveBeenCalled()
    expect(f.container.querySelector('dialog')?.open).toBe(true)
  })

  it('keeps the selected resource identity when another page of same-name results is appended', async () => {
    const first = resource('lore:first')
    const second = resource('lore:second')
    const state = searchState({ results: [first, second], hasMore: true })
    const f = await mount(state)
    await f.press('ArrowDown')
    expect(f.selected()).toBe(globalSearchResourceValue(second))
    await f.render({ ...state, results: [first, second, resource('lore:third')], hasMore: false })
    expect(f.selected()).toBe(globalSearchResourceValue(second))
    await f.press('Enter')
    expect(f.props.onOpenResult).toHaveBeenCalledExactlyOnceWith(second)
  })
})
