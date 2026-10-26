// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StudioTimelineActions } from '../../../apps/studio-client/src/app/studio-timeline-actions.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  queryClient.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setup(overrides: Record<string, unknown> = {}, busy = false) {
  const state = {
    t: createTranslator('zh-CN'), endpoint: 'test', cards: [{ id: 'source', name: '来源角色' }, { id: 'browsed', name: '浏览角色' }],
    allTimelines: [], selectedCardId: 'browsed', narrativeTimeline: { id: 'story', title: '当前故事', createdAt: '2026-10-14T06:30:00Z', createdFrom: { cardId: 'source' } },
    branch: { id: 'main', headNodeId: 'tail' }, branches: [{ id: 'main', title: '主线' }],
    narrativeNodes: [{ id: 'older' }, { id: 'tail' }],
    createTimelineFromCard: vi.fn(async () => ({ timelineId: 'new', branchId: 'new-branch' })),
    forkFromNode: vi.fn(async () => ({ timelineId: 'story', branchId: 'fork' })),
    deleteTimeline: vi.fn(async () => true), renameTimeline: vi.fn(async () => undefined),
    previewCardDeletion: vi.fn(async () => ({ timelines: [{ id: 'story' }] })),
    deleteCards: vi.fn(async () => {}), resetToDraftTimeline: vi.fn(), refreshAllTimelines: vi.fn(async () => {}),
    ...overrides,
  }
  const navigation = { isCurrent: () => true, openPanel: vi.fn(), openNarrative: vi.fn(), clearDeletedTimeline: vi.fn(), clearDeletedCard: vi.fn() }
  await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient },
    createElement(StudioTimelineActions, { state, navigation, cardId: 'source', busy } as unknown as ComponentProps<typeof StudioTimelineActions>))))
  return { state, navigation }
}
async function click(label: string) {
  const scope = container.querySelector('dialog[open]') ?? container
  const button = [...scope.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)
  expect(button).toBeDefined()
  await act(async () => button!.click())
}

it('targets the displayed source character and forks from the branch head', async () => {
  const { state, navigation } = await setup()
  await click('来源角色 · 角色')
  expect(navigation.openPanel).toHaveBeenCalledWith('character', { cardId: 'source' })
  await click('新开故事')
  expect(state.createTimelineFromCard).toHaveBeenCalledWith('source')
  expect(navigation.openNarrative).toHaveBeenCalledWith('new', 'new-branch')
  await click('从当前进度分支')
  expect(state.forkFromNode).toHaveBeenCalledWith({ id: 'tail' })
})

it('keeps a failed story deletion dialog and does not navigate', async () => {
  const { navigation } = await setup({ deleteTimeline: vi.fn(async () => false) })
  await click('删除当前故事')
  await click('确认删除')
  expect(container.querySelector('dialog[open]')).not.toBeNull()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('操作未完成')
  expect(navigation.clearDeletedTimeline).not.toHaveBeenCalled()
})

it('uses deletion preview and passes explicit deletion options for the displayed character', async () => {
  const { state, navigation } = await setup()
  await click('删除角色')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(state.previewCardDeletion).toHaveBeenCalledWith('source')
  expect(container.querySelector('dialog[open]')?.textContent).toContain('来源角色')
  await click('确认删除')
  expect(state.deleteCards).toHaveBeenCalledWith(['source'], { includePlayData: true, includePromptResources: true })
  expect(navigation.clearDeletedCard).toHaveBeenCalledWith('source', ['story'])
})

it('offers character deletion before a story exists, and disables mutations while busy', async () => {
  const { state } = await setup({ narrativeTimeline: undefined, branch: undefined }, true)
  const buttons = [...container.querySelectorAll('button')]
  expect(buttons.find(button => button.textContent === '删除当前故事')?.disabled).toBe(true)
  expect(buttons.find(button => button.textContent === '删除角色')?.disabled).toBe(true)
  await click('新开故事')
  expect(state.createTimelineFromCard).not.toHaveBeenCalled()
})

it('focuses rename input, cancels without saving, and saves only on confirmation', async () => {
  const rename = vi.fn(async () => ({ id: 'story', title: '当前故事' }))
  await setup({ renameTimeline: rename })
  await click('重命名')
  expect(document.activeElement).toBe(container.querySelector('dialog[open] input'))
  await click('取消')
  expect(rename).not.toHaveBeenCalled()
  expect(container.querySelector('dialog[open]')).toBeNull()
  await click('重命名')
  await click('保存')
  expect(rename).toHaveBeenCalledWith('story', '当前故事')
  expect(container.querySelector('dialog[open]')).toBeNull()
})

it('keeps story actions when the timeline exists but its branch is not loaded', async () => {
  await setup({ branch: undefined })
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === '删除当前故事')
  expect(button?.disabled).toBe(false)
  expect(container.textContent).not.toContain('尚未开始故事')
})

it('lists only the displayed character timelines and navigates after activation', async () => {
  const activateTimeline = vi.fn(async () => 'other-branch')
  const { navigation } = await setup({
    activateTimeline,
    allTimelines: [
      { id: 'story', title: '当前故事', createdAt: '2026-10-14T06:30:00Z', createdFrom: { cardId: 'source' } },
      { id: 'other', title: '另一个故事', createdAt: '2026-10-14T06:35:00Z', createdFrom: { cardId: 'source' } },
      { id: 'unrelated', title: '其他角色故事', createdFrom: { cardId: 'browsed' } },
    ],
  })
  await click('展开故事快捷操作')
  const trigger = container.querySelector('[aria-label="切换故事"]')!
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  expect(items.map(item => item.querySelector('[title]')?.textContent)).toEqual(['当前故事', '另一个故事'])
  expect(items.every(item => item.textContent?.includes('2026'))).toBe(true)
  await act(async () => items[1].click())
  expect(activateTimeline).toHaveBeenCalledWith('other')
  expect(navigation.openNarrative).toHaveBeenCalledWith('other', 'other-branch')
})

 it('uses mobile tap for the character and long press for story actions', async () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
  const { navigation } = await setup()
  const avatar = container.querySelector<HTMLButtonElement>('[aria-label="来源角色 · 角色"]')!
  const pointer = (type: string, x = 0) => avatar.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x,
  }))
  vi.useFakeTimers()
  try {
    await act(async () => { pointer('pointerdown'); pointer('pointerup'); avatar.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    expect(navigation.openPanel).toHaveBeenCalledTimes(1)
    navigation.openPanel.mockClear()
    await act(async () => { pointer('pointerdown'); vi.advanceTimersByTime(500) })
    await act(async () => { pointer('pointerup'); avatar.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    expect(container.querySelector('section')?.getAttribute('data-expanded')).toBe('true')
    expect(navigation.openPanel).not.toHaveBeenCalled()
    await act(async () => { pointer('pointerdown'); pointer('pointermove', 20); vi.advanceTimersByTime(500); pointer('pointerup') })
    expect(container.querySelector('section')?.getAttribute('data-expanded')).toBe('true')
  } finally {
    vi.useRealTimers()
  }
})
