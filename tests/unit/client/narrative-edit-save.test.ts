import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { NarrativeTimeline } from '../../../apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => undefined, useLayoutEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
}))
beforeEach(() => { hooks.cursor = 0; hooks.values = [] })
type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}

describe('Narrative正文保存', () => {
  it.each([true, false])('waits for persistence and retains failed text (success: %s)', async success => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const save = vi.fn(() => new Promise<void>((accept, fail) => { resolve = accept; reject = fail }))
    const t = createTranslator('en-US')
    const props: ComponentProps<typeof NarrativeTimeline> = {
      busy: false, composerHeight: 0, emptyTimelineText: '', hasOlder: false,
      getNodeLink: () => '', onEditNode: save, onForkNode: vi.fn(), onLoadOlder: vi.fn(),
      onNodeAnchorChange: vi.fn(), t, timelineId: 'timeline',
      timeline: [{
        id: 'node', timelineId: 'timeline', stateRevisionId: 'state',
        body: { format: 'loom-markdown.v1', raw: 'Original' }, createdAt: '2026-09-23T00:00:00Z',
      }],
    }
    const render = () => { hooks.cursor = 0; return elements(NarrativeTimeline(props)) }
    const edit = render().find(element => element.props.label === t('timeline.editLocal') && element.props.onClick)!
    ;(edit.props.onClick as () => void)()
    let editor = render().find(element => element.props.sourceOnly)!
    ;(editor.props.onChange as (value: string) => void)('  User draft\n')
    const newerCallback = vi.fn().mockResolvedValue(undefined)
    props.onEditNode = newerCallback
    editor = render().find(element => element.props.sourceOnly)!
    const pending = (editor.props.onSubmit as (value: string) => Promise<void>)('  User draft\n')
    await (editor.props.onSubmit as (value: string) => Promise<void>)('Duplicate')
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('node', '  User draft\n')
    expect(newerCallback).not.toHaveBeenCalled()
    expect(render().find(element => element.props.sourceOnly)?.props.disabled).toBe(true)
    if (success) resolve()
    else reject(new Error('Version conflict'))
    await pending
    const tree = render()
    if (success) expect(tree.some(element => element.props.sourceOnly)).toBe(false)
    else {
      expect(tree.find(element => element.props.sourceOnly)?.props).toMatchObject({ value: '  User draft\n', disabled: false })
      expect(tree.find(element => element.props.role === 'alert')?.props.children).toBe('Version conflict')
    }
  })
})
