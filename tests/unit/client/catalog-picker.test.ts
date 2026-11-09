// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  CatalogPicker,
  type CatalogCategory,
  type CatalogItem,
} from '../../../apps/studio-client/src/shared/ui/catalog-picker/catalog-picker.js'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const CATEGORIES: CatalogCategory[] = [
  { id: 'all', label: '全部' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
]

const ITEMS: CatalogItem<{ modelDesc: string }>[] = [
  {
    id: 'gpt-6',
    categoryId: 'openai',
    title: 'GPT-6 Sol',
    subtitle: '旗舰模型',
    pinned: true,
    data: { modelDesc: 'Next-gen frontier reasoning' },
  },
  {
    id: 'claude-5',
    categoryId: 'anthropic',
    title: 'Claude Opus 5',
    subtitle: '逻辑与文学',
    data: { modelDesc: 'Advanced literature and thought' },
  },
]

it('renders categories, master items and detail content in desktop mode', async () => {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  await act(async () => {
    root.render(
      createElement(CatalogPicker, {
        title: '选择模型',
        onClose,
        categories: CATEGORIES,
        items: ITEMS,
        onSelect,
        renderDetail: item =>
          createElement('div', { 'data-testid': 'detail-box' }, (item.data as { modelDesc: string }).modelDesc),
      }),
    )
  })

  // 验证 Dialog Header
  expect(container.textContent).toContain('选择模型')
  const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')
  expect(closeButton).toBeTruthy()
  await act(async () => {
    closeButton!.click()
  })
  expect(onClose).toHaveBeenCalledTimes(1)

  // 验证渲染的项
  const items = container.querySelectorAll('[role="option"]')
  expect(items.length).toBe(2)
  expect(items[0].textContent).toContain('GPT-6 Sol')
  expect(items[1].textContent).toContain('Claude Opus 5')

  // 验证默认 Detail 联动聚焦在第一项
  const detailBox = container.querySelector('[data-testid="detail-box"]')
  expect(detailBox?.textContent).toBe('Next-gen frontier reasoning')
})

it('filters items correctly via search input', async () => {
  const onSelect = vi.fn()
  await act(async () => {
    root.render(
      createElement(CatalogPicker, {
        categories: CATEGORIES,
        items: ITEMS,
        onSelect,
      }),
    )
  })

  const searchInput = container.querySelector('input')
  expect(searchInput).toBeTruthy()

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(searchInput, 'Claude')
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }))
    searchInput!.dispatchEvent(new Event('change', { bubbles: true }))
  })

  const items = container.querySelectorAll('[role="option"]')
  expect(items.length).toBe(1)
  expect(items[0].textContent).toContain('Claude Opus 5')
})

it('supports mobile drilldown: master list -> click item -> detail page -> go back & confirm', async () => {
  const onSelect = vi.fn()
  await act(async () => {
    root.render(
      createElement(CatalogPicker, {
        mobileMode: true,
        categories: CATEGORIES,
        items: ITEMS,
        onSelect,
        renderDetail: item =>
          createElement('div', { 'data-testid': 'mobile-detail-box' }, (item.data as { modelDesc: string }).modelDesc),
      }),
    )
  })

  // 移动端初始阶段为 master
  expect(container.querySelector('[data-mobile-stage="master"]')).toBeTruthy()
  expect(container.querySelector('[data-testid="mobile-detail-box"]')).toBeNull()

  // 点击第一项进入下钻详情
  const firstItem = container.querySelector<HTMLButtonElement>('[role="option"]')!
  await act(async () => {
    firstItem.click()
  })

  // 当前进入 detail 阶段
  expect(container.querySelector('[data-mobile-stage="detail"]')).toBeTruthy()
  const detailBox = container.querySelector('[data-testid="mobile-detail-box"]')
  expect(detailBox?.textContent).toBe('Next-gen frontier reasoning')

  // 测试返回列表
  const backButton = container.querySelector<HTMLButtonElement>('button')!
  expect(backButton.textContent).toContain('返回列表')
  await act(async () => {
    backButton.click()
  })
  expect(container.querySelector('[data-mobile-stage="master"]')).toBeTruthy()

  // 再次进入并测试确认选用
  const secondItem = container.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]
  await act(async () => {
    secondItem.click()
  })
  expect(container.querySelector('[data-mobile-stage="detail"]')).toBeTruthy()

  const confirmBtn = container.querySelector<HTMLButtonElement>('button[class*="mobileConfirmButton"]')!
  expect(confirmBtn.textContent).toContain('确认选用 Claude Opus 5')
  await act(async () => {
    confirmBtn.click()
  })

  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect.mock.calls[0][0].id).toBe('claude-5')
})
