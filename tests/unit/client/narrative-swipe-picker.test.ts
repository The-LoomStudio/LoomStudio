import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@loom-studio/ui'
import { SwipeControl } from '../../../apps/studio-client/src/shared/ui/swipe-control/swipe-control.js'
import { NarrativeSwipePicker } from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-swipe-picker.js'
import { NarrativeInputSwipePicker } from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-input-swipe-picker.js'
import { ConversationMessageChrome } from '../../../apps/studio-client/src/shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => 'swipe-options',
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value }]
  },
}))
beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
function props(): Parameters<typeof NarrativeSwipePicker>[0] {
  return {
    swipe: {
      id: 'group', timelineId: 'timeline', branchId: 'branch', revision: 4,
      inputNodeId: 'input', sourceAgentSessionId: 'session', selectedCandidateId: 'a',
      requiresRegeneration: true, active: false, suspended: false, canSelect: true, canGenerate: true,
      candidates: [{ id: 'a', nodeId: 'node', preview: 'A', status: 'completed' }],
    },
    busy: false, primarySessionId: 'session', onSelect: vi.fn(), onGenerate: vi.fn(), t: createTranslator('en-US'),
  }
}

describe('Swipe regeneration confirmation and footer order', () => {
  it('keeps reply counts local to an input and selects the remembered reply when changing inputs', () => {
    const p = props()
    p.swipe.requiresRegeneration = false
    p.swipe.inputNodeId = 'input-a'
    p.swipe.inputs = [{ nodeId: 'input-a', input: 'A', selectedCandidateId: 'a' },
      { nodeId: 'input-b', input: 'B', selectedCandidateId: 'b2' }]
    p.swipe.candidates = [
      { id: 'a', inputNodeId: 'input-a', preview: 'A', status: 'completed' },
      { id: 'b1', inputNodeId: 'input-b', preview: 'B1', status: 'completed' },
      { id: 'b2', inputNodeId: 'input-b', preview: 'B2', status: 'completed' },
    ]
    const replies = elements(NarrativeSwipePicker(p)).find(item => item.type === SwipeControl)!
    expect(replies.props).toMatchObject({ count: 1, index: 0 })
    const onEdit = vi.fn()
    const renderInput = () => {
      hooks.cursor = 0
      return elements(NarrativeInputSwipePicker({ swipe: p.swipe, disabled: false, onEdit, onSelect: p.onSelect, t: p.t }))
        .find(item => item.type === SwipeControl)!
    }
    let control = renderInput()
    expect(control.props).toMatchObject({ count: 2, index: 0 })
    ;(control.props.onNext as () => void)()
    expect(p.onSelect).toHaveBeenCalledWith('b2')
    p.swipe.inputNodeId = 'input-b'
    control = renderInput()
    const right = elements(SwipeControl(control.props as Parameters<typeof SwipeControl>[0])).filter(item => item.type === 'button')[2]
    ;(right.props.onClick as () => void)()
    expect(onEdit).toHaveBeenCalledOnce()
    p.swipe.suspended = true
    expect(renderInput().props.disabled).toBe(true)
  })
  it('shows one retry action for an empty candidate without a legacy Session shortcut', () => {
    const p = props()
    p.swipe.requiresRegeneration = false
    p.swipe.candidates.push({ id: 'b', preview: 'B', status: 'completed' },
      { id: 'c', preview: '', status: 'failed' }, { id: 'old', preview: '', status: 'discarded' })
    p.swipe.selectedCandidateId = 'c'
    const tree = elements(NarrativeSwipePicker(p))
    const control = tree.find(item => item.type === SwipeControl)!
    expect(control.props).toMatchObject({ index: 2, count: 3, disabled: false })
    expect(tree.some(item => item.props.role === 'status' && item.props.children === p.t('swipe.noBody'))).toBe(true)
    expect(tree.some(item => item.props.label === p.t('swipe.viewRun'))).toBe(false)
    expect(tree.some(item => item.props.label === p.t('swipe.regenerate'))).toBe(false)
    const commands = tree.filter(item => item.props.label === p.t('swipe.retry'))
    expect(commands).toHaveLength(1)
    ;(commands[0].props.onClick as () => void)()
    expect(p.onGenerate).toHaveBeenCalledExactlyOnceWith('retry')
  })
  it('generates from the last right arrow, switches existing candidates, and respects locks', () => {
    const p = props()
    p.swipe.requiresRegeneration = false
    const arrows = () => {
      hooks.cursor = 0
      const control = elements(NarrativeSwipePicker(p)).find(item => item.type === SwipeControl)!
      return elements(SwipeControl(control.props as Parameters<typeof SwipeControl>[0])).filter(item => item.type === 'button')
    }
    let buttons = arrows()
    expect(buttons[0].props.disabled).toBe(true)
    expect(buttons[2].props.disabled).toBe(false)
    ;(buttons[2].props.onClick as () => void)()
    expect(p.onGenerate).toHaveBeenCalledExactlyOnceWith('swipe')
    p.swipe.candidates.push({ id: 'b', preview: 'B', status: 'completed' })
    buttons = arrows()
    ;(buttons[2].props.onClick as () => void)()
    expect(p.onSelect).toHaveBeenCalledExactlyOnceWith('b')
    expect(p.onGenerate).toHaveBeenCalledOnce()
    p.swipe.selectedCandidateId = 'b'
    for (const id of ['c', 'd', 'e']) {
      buttons = arrows()
      expect(buttons[2].props.disabled).toBe(false)
      ;(buttons[2].props.onClick as () => void)()
      expect(p.onGenerate).toHaveBeenLastCalledWith('swipe')
      p.swipe.candidates.push({ id, preview: id, status: 'completed' })
      p.swipe.selectedCandidateId = id
    }
    expect(p.onGenerate).toHaveBeenCalledTimes(4)
    p.swipe.suspended = true
    expect(arrows()[2].props.disabled).toBe(true)
    const opening = elements(SwipeControl({ index: 0, count: 1, previousLabel: 'Previous', nextLabel: 'Next', chooseLabel: 'Choose', onPrevious() {}, onNext() {}, onChoose() {} })).filter(item => item.type === 'button')
    expect(opening[2].props.disabled).toBe(true)
  })

  it.each(['swipe.generate', 'swipe.regenerate', 'swipe.retry'] as const)('confirms %s for a retired context in the same Session', key => {
    const p = props()
    if (key === 'swipe.retry') { p.swipe.selectedCandidateId = undefined; p.swipe.candidates = [] }
    const render = () => { hooks.cursor = 0; return NarrativeSwipePicker(p) }
    const tree = elements(render())
    if (key === 'swipe.generate') {
      const control = tree.find(item => item.type === SwipeControl)!
      ;(control.props.onGenerateNext as () => void)()
    } else {
      const command = tree.find(item => item.props.label === p.t(key))!
      ;(command.props.onClick as () => void)()
    }
    expect(p.onGenerate).not.toHaveBeenCalled()
    const dialog = elements(render()).find(item => item.type === Dialog && item.props.open === true)!
    expect(dialog).toBeDefined()
    const confirm = dialog.props.actions as ReactElement<{ onClick(): void }>
    confirm.props.onClick()
    expect(p.onGenerate).toHaveBeenCalledExactlyOnceWith('regenerate', true)
  })

  it('places Swipe after the footer tools and status', () => {
    const p = props()
    p.swipe.reason = 'Writing unavailable'
    const markup = renderToStaticMarkup(createElement(ConversationMessageChrome, {
      actions: createElement('button', null, 'Existing tool'),
      trailing: createElement(NarrativeSwipePicker, p),
    }))
    expect(markup).not.toContain('lucide-plus')
    const position = markup.indexOf('Choose a candidate')
    for (const label of ['Existing tool', 'Writing unavailable', 'Regenerate'])
      expect(markup.indexOf(label)).toBeLessThan(position)
  })
})
