import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatEntityReference, formatResourceReference } from '@loom-studio/shared'
import { ResourceReferenceDialog } from '../../../apps/studio-client/src/features/resource-references/resource-reference-dialog.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value }]
  },
  useRef: (current: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current }
    return hooks.values[index]
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
    const entry = { deps, cleanup: undefined as (() => void) | undefined }
    hooks.values[index] = entry
    hooks.effects.push(() => { previous?.cleanup?.(); entry.cleanup = effect() || undefined })
  },
}))

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const resourceUri = formatResourceReference({
  kind: 'prompt-resource', resourceId: 'r', nodeId: 'n', version: 1, startLine: 1, endLine: 1,
})
const cardUri = formatEntityReference({ kind: 'entity', type: 'card', id: 'card/1' })

function fixture(uri?: string) {
  const getResource = vi.fn().mockResolvedValue({ resource: {
    id: 'r', version: 1, resourceKind: 'setting',
    rootNode: { id: 'n', label: 'User text', kind: 'entry', body: 'First\nSecond' },
  } })
  const getCard = vi.fn().mockResolvedValue({ card: { id: 'card/1', name: 'User card', version: 1 } })
  const props: ComponentProps<typeof ResourceReferenceDialog> = {
    api: { promptResources: { get: getResource }, cards: { get: getCard } } as unknown as StudioApi,
    uri, onClose: vi.fn(), onOpenEditor: vi.fn(), onNavigate: vi.fn(),
  }
  function render() {
    hooks.cursor = 0
    const tree = ResourceReferenceDialog(props)
    for (const effect of hooks.effects.splice(0)) effect()
    return tree
  }
  async function settle() {
    for (let i = 0; i < 5; i++) await Promise.resolve()
    return render()
  }
  return { props, getResource, getCard, render, settle }
}

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('controlled resource reference dialog', () => {
  it('renders nothing without a URI and does not need router or window event wiring', () => {
    const f = fixture()
    expect(f.render()).toBeNull()
    expect(f.getResource).not.toHaveBeenCalled()
    expect(f.getCard).not.toHaveBeenCalled()
    expect(f.props.onClose).not.toHaveBeenCalled()
  })

  it('delegates Close and Escape but editor navigation calls only onOpenEditor', async () => {
    const f = fixture(resourceUri)
    expect(elements(f.render()).find(item => item.props.role === 'status')?.props.children).toBe('正在读取…')
    const tree = await f.settle()
    const editor = elements(tree).find(item => item.props['aria-label'] === '打开编辑器')!
    ;(editor.props.onClick as () => void)()
    expect(f.props.onOpenEditor).toHaveBeenCalledExactlyOnceWith({ panel: 'resource', resourceId: 'r', nodeId: 'n' })
    expect(f.props.onClose).not.toHaveBeenCalled()
    expect(f.props.onNavigate).not.toHaveBeenCalled()
    const close = elements(tree).find(item => item.props['aria-label'] === '关闭')!
    ;(close.props.onClick as () => void)()
    expect(f.props.onClose).toHaveBeenCalledTimes(1)
    const preventDefault = vi.fn()
    ;(tree!.props.onCancel as (event: unknown) => void)({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(f.props.onClose).toHaveBeenCalledTimes(2)
    f.props.uri = undefined
    expect(f.render()).toBeNull()
  })

  it('delegates an entity URI without closing or issuing an editor navigation', async () => {
    const f = fixture(cardUri)
    f.render()
    const tree = await f.settle()
    const open = elements(tree).find(item => item.type === 'button'
      && Array.isArray(item.props.children) && item.props.children.includes('打开'))!
    ;(open.props.onClick as () => void)()
    expect(f.props.onNavigate).toHaveBeenCalledExactlyOnceWith(cardUri)
    expect(f.props.onOpenEditor).not.toHaveBeenCalled()
    expect(f.props.onClose).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('ignores stale entity %s after changing to a resource URI', async outcome => {
    const f = fixture(cardUri)
    const pending = deferred<{ card: { id: string; name: string; version: number } }>()
    f.getCard.mockReturnValueOnce(pending.promise)
    f.render()
    f.props.uri = resourceUri
    f.render()
    await f.settle()
    if (outcome === 'resolve') pending.resolve({ card: { id: 'card/1', name: 'Stale card', version: 1 } })
    else pending.reject(new Error('Stale error'))
    const tree = await f.settle()
    expect(elements(tree).find(item => item.type === 'strong')?.props.children).toBe('User text')
    expect(elements(tree).some(item => item.props.role === 'alert')).toBe(false)
    expect(elements(tree).some(item => item.props['aria-label'] === '打开编辑器')).toBe(true)
  })

  it('shows a current read error without navigation and ignores responses after close', async () => {
    const f = fixture(resourceUri)
    f.getResource.mockRejectedValueOnce(new Error('Access denied'))
    f.render()
    expect(elements(await f.settle()).find(item => item.props.role === 'alert')?.props.children).toBe('Access denied')
    const pending = deferred<{ card: { id: string; name: string; version: number } }>()
    f.getCard.mockReturnValueOnce(pending.promise)
    f.props.uri = cardUri
    f.render()
    f.props.uri = undefined
    expect(f.render()).toBeNull()
    pending.resolve({ card: { id: 'card/1', name: 'Late card', version: 1 } })
    expect(await f.settle()).toBeNull()
    expect(f.props.onNavigate).not.toHaveBeenCalled()
  })
})
