import { isValidElement, type FunctionComponent, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionPicker } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-session-picker.js'
import type { AgentPreset, AgentSession } from '../../../apps/studio-client/src/entities/index.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

// Pointer animation is outside this component's session-selection contract.
vi.mock('../../../apps/studio-client/src/shared/hooks/use-sliding-hover.js', () => ({
  useSlidingHover: () => ({ containerRef: { current: null }, indicatorStyle: {}, onPointerOver: () => {}, onPointerLeave: () => {} }),
}))

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
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

type Element = ReactElement<Record<string, any>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement(value)) return []
  const element = value as Element
  if (typeof element.type === 'function' && element.type.name === 'SessionTitleInput') {
    return elements((element.type as FunctionComponent<Record<string, unknown>>)(element.props))
  }
  return [element, ...elements(element.props.children), ...elements(element.props.actions), ...elements(element.props.headerActions)]
}

beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

function fixture() {
  const session = (id: string, title: string, agentPresetId: string, timelineId = 'timeline'): AgentSession => ({ kind: 'agent' as const,
    id, title, agentPresetId, timelineId, entryCount: 0, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
  })
  const sessions = [session('a', 'Story', 'writer'), session('b', 'Notes', 'summary'), session('c', 'Other', 'writer', 'other-timeline')]
  const props = {
    session: sessions[0], sessions, primarySessionId: 'a', disabled: false,
    presets: [{ id: 'writer', rootNode: { label: 'Writing' } }, { id: 'summary', rootNode: { label: 'Memory Summary' } }] as AgentPreset[],
    t: createTranslator('zh-CN'), onSelect: vi.fn(), onRename: vi.fn(async () => sessions[0]),
  } as Parameters<typeof AgentSessionPicker>[0]
  const render = () => { hooks.cursor = 0; return elements(AgentSessionPicker(props)) }
  const control = (label: string) => render().find(element => element.props['aria-label'] === label)!
  const open = () => control('选择会话').props.onClick()
  return { props, sessions, render, control, open }
}

describe('Agent session picker', () => {
  it.each([{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }])('does not commit composition Enter: %j', nativeEvent => {
    const f = fixture()
    f.control('会话名称').props.onChange({ target: { value: 'Draft' } })
    const blur = vi.fn()
    f.control('会话名称').props.onKeyDown({ key: 'Enter', nativeEvent, currentTarget: { blur } })
    expect(blur).not.toHaveBeenCalled()
    expect(f.props.onRename).not.toHaveBeenCalled()
    expect(f.control('会话名称').props.value).toBe('Draft')
  })
  it('searches by preset and opens a session without changing the primary receiver', () => {
    const f = fixture()
    f.open()
    f.control('搜索会话').props.onChange({ target: { value: 'Memory' } })
    expect(f.render().filter(element => String(element.props['aria-label']).startsWith('打开会话：'))
      .map(element => element.props['aria-label'])).toEqual(['打开会话：Notes'])
    f.control('打开会话：Notes').props.onClick()
    expect(f.props.onSelect).toHaveBeenCalledWith('b')
    expect(f.render().some(element => element.props.title === 'Agent 会话')).toBe(false)
  })

  it('shows and searches the live character and story metadata', () => {
    const f = fixture()
    f.props.cards = [{ id: 'card', name: 'Long character name' }] as NonNullable<typeof f.props.cards>
    f.props.timelines = [{ id: 'timeline', title: 'Evening story', createdFrom: { cardId: 'card' } }] as NonNullable<typeof f.props.timelines>
    f.open()
    f.control('搜索会话').props.onChange({ target: { value: 'Long character' } })
    expect(f.render().filter(element => String(element.props['aria-label']).startsWith('打开会话：'))
      .map(element => element.props['aria-label'])).toEqual(['打开会话：Story', '打开会话：Notes'])
    expect(f.render().some(element => element.props.title === 'Long character name · Evening story')).toBe(true)
    f.props.cards[0].name = 'Renamed character'
    f.control('搜索会话').props.onChange({ target: { value: 'Renamed' } })
    expect(f.render().some(element => element.props.title === 'Renamed character · Evening story')).toBe(true)
    expect(f.sessions[0].title).toBe('Story')
  })

  it('keeps the primary identity visible without offering reassignment controls', () => {
    const f = fixture()
    expect(f.render().some(element => element.props['aria-label'] === '主写作对话')).toBe(true)
    f.open()
    expect(f.render().some(element => String(element.props['aria-label']).startsWith('设为主写作对话'))).toBe(false)
  })

  it('renames the original session and retains the input after a failed save', async () => {
    const f = fixture()
    ;(f.props.onRename as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Title save failed'))
    f.control('会话名称').props.onChange({ target: { value: 'New story name' } })
    f.control('会话名称').props.onBlur()
    await vi.waitFor(() => expect(f.render().some(element => element.props.role === 'alert'
      && element.props.children === 'Title save failed')).toBe(true))
    expect(f.props.onRename).toHaveBeenCalledWith('a', 'New story name')
    expect(f.control('会话名称').props.value).toBe('New story name')
    expect(f.props.onSelect).not.toHaveBeenCalled()
  })
})
