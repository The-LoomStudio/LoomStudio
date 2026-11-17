// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { activate } from '../../../official/extensions/story-memory/ui/entry.js'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren() })

it('reviews a whole batch, preserves revision input during polling, escapes source text and releases polling on disposal', async () => {
  vi.useFakeTimers()
  const batch = { id: 'batch', version: 3, level: 1, fromFloor: 1, throughFloor: 32,
    text: '<img src=x onerror=alert(1)>事件', tokenCount: 20, budget: 100, status: 'draft',
    valid: true, resident: false, published: false, running: false }
  const policy = { enabled: true, batchFloors: 32, bufferFloors: 8, lv2Count: 12, lv2Tokens: 12000, lv1Budget: 2000, lv2Budget: 4000 }
  const call = vi.fn(async (method: string, args: Record<string, unknown>) => {
    if (method.endsWith('.status')) return { batches: [{ ...batch }], policy, policyVersion: 1, headFloor: 40 }
    if (method.endsWith('.source')) return { text: '<script>source</script>' }
    if (method.endsWith('.confirm')) { batch.status = 'confirmed'; batch.resident = true; batch.version++; return { id: batch.id } }
    if (method.endsWith('.configure')) { Object.assign(policy, args.value); return { version: 2 } }
    return { id: batch.id }
  })
  const root = document.createElement('div'); document.body.append(root)
  let mounted!: { dispose(): void }
  act(() => activate({ timeline: { target: { timelineId: 'timeline', branchId: 'branch' } }, rpc: { call },
    renderers: { register(_definition: unknown, renderer: { mount(root: HTMLElement): typeof mounted }) { mounted = renderer.mount(root) } } } as unknown as Parameters<typeof activate>[0]))
  const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
  const click = (text: string) => { const button = [...root.querySelectorAll('button')].find(el => el.textContent === text || el.getAttribute('aria-label') === text); expect(button).toBeDefined(); act(() => button!.click()) }
  await flush()
  click('查看数据'); await flush()
  expect(root.querySelector('article')!.textContent).toBe(batch.text)
  expect(root.querySelector('img')).toBeNull()
  const input = root.querySelector('textarea')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '保留约定'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(root.querySelector('textarea')).toBe(input)
  expect(input.value).toBe('保留约定')
  click('读取固定来源'); await flush()
  expect(root.querySelector('.source')!.textContent).toBe('<script>source</script>')
  expect(root.querySelector('script')).toBeNull()
  click('提交修订'); await flush()
  expect(call).toHaveBeenCalledWith('official.story-memory.revise', { timelineId: 'timeline', branchId: 'branch', id: 'batch', version: 3, input: '保留约定' })
  click('确认整批摘要'); await flush()
  expect(root.textContent).toContain('这份摘要已纳入当前剧情上下文')
  expect(root.querySelector('textarea')).toBeNull()
  click('调整'); await flush()
  const count = root.querySelector<HTMLInputElement>('[name=batchFloors]')!; act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(count, '24'); count.dispatchEvent(new Event('input', { bubbles: true })) })
  act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })) }); await flush()
  expect(call).toHaveBeenCalledWith('official.story-memory.configure', expect.objectContaining({ expectedVersion: 1, value: expect.objectContaining({ batchFloors: 24 }) }))
  act(() => mounted.dispose()); const calls = call.mock.calls.length
  await vi.advanceTimersByTimeAsync(9000)
  expect(call).toHaveBeenCalledTimes(calls)
  expect(root.childElementCount).toBe(0)
})
