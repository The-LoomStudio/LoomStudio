import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { Button } from '@loom-studio/ui'
import { StateVariablesPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { StateTarget } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((item, i) => Object.is(item, previous.deps[i]))) return
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
function snapshot(target: StateTarget, count: number) {
  return { snapshot: { target, scopeId: 'scope', revisionId: `rev-${count}`, value: { count }, createdAt: '2026-09-23' } }
}
const a = { scope: 'timeline', timelineId: 'a', branchId: 'branch' } as const
const b = { scope: 'timeline', timelineId: 'b', branchId: 'branch' } as const
const t = createTranslator('en-US')
function fixture() {
  const apply = vi.fn<ComponentProps<typeof StateVariablesPanel>['api']['apply']>()
    .mockResolvedValue({ ...snapshot(a, 1), mutation: { changesetId: 'change' } })
  const get = vi.fn(async (target: StateTarget) => snapshot(target, 1))
  const props: ComponentProps<typeof StateVariablesPanel> = {
    api: {
      get, apply,
      listDefinitions: async () => ({ definitions: [] }),
      getDefinition: async () => { throw new Error('Unexpected definition read') },
      upsertDefinition: async () => { throw new Error('Unexpected definition write') },
      deleteDefinition: async () => { throw new Error('Unexpected definition deletion') },
    },
    timelineTarget: a, t, onStateMutated: vi.fn(),
  }
  function render() {
    hooks.cursor = 0
    const tree = StateVariablesPanel(props)
    for (const effect of hooks.effects.splice(0)) effect()
    return tree
  }
  async function settle() {
    for (let i = 0; i < 4; i++) await Promise.resolve()
    render()
    return render()
  }
  function controls() {
    const tree = render()
    const all = elements(tree)
    const fileTree = all.find(item => item.props.renderTrailing)!
    const node = (fileTree.props.nodes as { capabilities?: { path: string } }[]).find(item => item.capabilities?.path === '/count')!
    const trailing = (fileTree.props.renderTrailing as (node: unknown) => unknown)(node)
    const input = elements(trailing).find(item => item.type === 'input')!
    const save = all.find(item => item.type === Button && elements(item.props.children).some(child =>
      child.type === 'span' && Array.isArray(child.props.children) && child.props.children[0] === t('stateVariables.saveChanges')))!
    return {
      input, save,
      edit: (value: number) => (input.props.onChange as (event: unknown) => void)({ target: { value: String(value) } }),
      submit: () => (save.props.onClick as () => void)(),
    }
  }
  return { props, apply, get, render, settle, controls }
}
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('State panel source isolation', () => {
  it('does not show or save an old Timeline snapshot after switching target', async () => {
    const f = fixture()
    const old = deferred<ReturnType<typeof snapshot>>()
    f.get.mockImplementation(target => target.scope === 'timeline' && target.timelineId === 'a'
      ? old.promise : Promise.resolve(snapshot(target, 2)))
    f.render()
    f.props.timelineTarget = b
    expect(elements(f.render()).some(item => item.props.renderTrailing)).toBe(false)
    await f.settle()
    f.controls().edit(3)
    old.resolve(snapshot(a, 1))
    await f.settle()
    expect(f.controls().input.props.value).toBe(3)
    f.controls().submit()
    expect(f.apply).toHaveBeenCalledWith(expect.objectContaining({ target: b, expectedRevisionId: 'rev-2' }))
    await f.settle()
  })

  it('ignores a previous API save completion without clearing the new API draft', async () => {
    const f = fixture()
    f.render()
    await f.settle()
    f.controls().edit(4)
    const oldControls = f.controls()
    const pending = deferred<Awaited<ReturnType<typeof f.apply>>>()
    f.apply.mockReturnValueOnce(pending.promise)
    oldControls.submit()
    oldControls.submit()
    expect(f.apply).toHaveBeenCalledTimes(1)
    oldControls.edit(99)
    expect(f.controls().input.props.value).toBe(4)
    const applyNew = vi.fn()
    f.props.api = { ...f.props.api, get: async target => snapshot(target, 8), apply: applyNew }
    expect(elements(f.render()).some(item => item.props.renderTrailing)).toBe(false)
    await f.settle()
    oldControls.submit()
    expect(f.apply).toHaveBeenCalledTimes(1)
    f.controls().edit(9)
    pending.resolve({ ...snapshot(a, 4), mutation: { changesetId: 'old-change' } })
    await f.settle()
    expect(f.controls().input.props.value).toBe(9)
    expect(f.controls().save.props.disabled).toBe(false)
    expect(f.props.onStateMutated).not.toHaveBeenCalled()
    expect(applyNew).not.toHaveBeenCalled()
  })

  it('retains a failed save and permits retry with the original revision', async () => {
    const f = fixture()
    f.render()
    await f.settle()
    expect(f.controls().save.props).toMatchObject({ type: 'button', disabled: true })
    f.controls().edit(5)
    f.apply.mockRejectedValueOnce(new Error('Revision conflict'))
    f.controls().submit()
    await f.settle()
    expect(f.controls().input.props.value).toBe(5)
    expect(f.controls().save.props.disabled).toBe(false)
    f.controls().submit()
    expect(f.apply.mock.calls[1]?.[0]).toMatchObject({ target: a, expectedRevisionId: 'rev-1' })
    await f.settle()
  })

  it('rejects a snapshot whose target disagrees with the current panel', async () => {
    const f = fixture()
    f.get.mockImplementation(async target => snapshot(target.scope === 'global' ? target : b, 1))
    f.render()
    await f.settle()
    f.controls().edit(6)
    f.controls().submit()
    expect(f.apply).not.toHaveBeenCalled()
    expect(elements(f.render()).find(item => item.props.role === 'alert')?.props.children).toBe(t('stateVariables.targetMismatch'))
  })
})
