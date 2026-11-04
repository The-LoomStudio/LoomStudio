import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ComponentProps, type ReactElement } from 'react'
import { projectTimelineRounds } from '../../../apps/studio-client/src/features/narrative-runtime/model/timeline-execution-projection.js'
import { NarrativeCommunication } from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-communication.js'
import { NarrativeTimeline } from '../../../apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
const liveCounter = vi.hoisted(() => ({ useTokenCounts: vi.fn() }))
vi.mock('../../../apps/studio-client/src/shared/tokenizer/use-token-counts.js', () => liveCounter)
vi.mock('../../../apps/studio-client/src/shared/tokenizer/settings.js', () => ({
  useTokenDisplaySettings: (selector: (state: { multiplier: number }) => unknown) => selector({ multiplier: 0.6 }),
}))
vi.mock('../../../apps/studio-client/src/shared/studio-shell/appearance-store.js', () => ({
  useAppearanceStore: (selector: (state: { narrativeOverscan: number }) => unknown) => selector({ narrativeOverscan: 5 }),
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => undefined, useLayoutEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
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
vi.mock('../../../apps/studio-client/node_modules/@tanstack/react-virtual/dist/esm/index.js', () => ({
  defaultRangeExtractor: () => [0],
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0 }],
    getTotalSize: () => 280,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}))
beforeEach(() => {
  hooks.cursor = 0
  hooks.values = []
  liveCounter.useTokenCounts.mockReset().mockReturnValue({ counts: [9, 3], currentCounts: [9, 3], pending: false })
})
type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  const renderNarrative = value.props.renderNarrative as ((step: unknown) => unknown) | undefined
  const execution = value.props.execution as { steps: { kind: string }[] } | undefined
  return [value, ...Object.values(value.props).flatMap(elements),
    ...(renderNarrative && execution ? execution.steps.filter(step => step.kind === 'narrative').flatMap(step => elements(renderNarrative(step))) : [])]
}

describe('Narrative正文保存', () => {
  it('shows an explicit start action only in preview, including an empty opening', () => {
    const start = vi.fn()
    const t = createTranslator('zh-CN')
    const props: ComponentProps<typeof NarrativeTimeline> = {
      rounds: [],
      busy: false, emptyTimelineText: '', hasOlder: false,
      getNodeLink: () => '', onEditNode: vi.fn(), onForkNode: vi.fn(), onLoadOlder: vi.fn(),
      onNodeAnchorChange: vi.fn(), t, timeline: [], onStartStory: start,
      openingDraft: { content: '', isPlaceholder: true },
    }
    const render = () => {
      hooks.cursor = 0
      props.rounds = projectTimelineRounds(props.workEntries ?? [], props.timeline, '尚未选择预设', props.activeRun)
      return elements(NarrativeTimeline(props))
    }
    const button = () => render().find(element => element.type === 'button' && element.props.onClick === start)
    expect(button()?.props.disabled).toBe(false)
    expect(button()?.props.children).toContain('开始一个新故事')
    ;(button()!.props.onClick as () => void)()
    expect(start).toHaveBeenCalledOnce()
    props.busy = true
    expect(button()?.props.disabled).toBe(true)
    props.timelineId = 'started'
    expect(button()).toBeUndefined()
  })

  it('automatically supplies node raw text and updated drafts to live counting without a refresh button', () => {
    const t = createTranslator('en-US')
    const props: ComponentProps<typeof NarrativeTimeline> = {
      rounds: [],
      busy: false, emptyTimelineText: '', hasOlder: true,
      getNodeLink: () => '', onEditNode: vi.fn(), onForkNode: vi.fn(), onLoadOlder: vi.fn(),
      onNodeAnchorChange: vi.fn(), t, timelineId: 'timeline',
      timeline: [{
        id: 'node', timelineId: 'timeline', kind: 'narrative', floor: 1,
        body: { format: 'loom-markdown.v1', raw: '**Original** {{macro}}' }, createdAt: '2026-09-23T00:00:00Z',
      }],
    }
    const render = () => {
      hooks.cursor = 0
      props.rounds = projectTimelineRounds(props.workEntries ?? [], props.timeline, '尚未选择预设', props.activeRun)
      return elements(NarrativeTimeline(props))
    }
    expect(render().some(element => element.props['aria-label'] === t('tokens.refresh'))).toBe(false)
    expect(liveCounter.useTokenCounts).toHaveBeenLastCalledWith(['**Original** {{macro}}'], JSON.stringify(['timeline', 'node']))
    expect(elements(render().find(element => element.props.createdAt)?.props.metadata).find(element => 'textTokens' in element.props)?.props.textTokens)
      .toBe(6)
    props.timeline = [{ ...props.timeline[0], body: { format: 'loom-markdown.v1', raw: 'Changed' } }, {
      id: 'older', timelineId: 'timeline', kind: 'narrative', floor: 2, body: { format: 'loom-markdown.v1', raw: 'Older' }, createdAt: '2026-09-22T00:00:00Z',
    }]
    render()
    expect(liveCounter.useTokenCounts).toHaveBeenLastCalledWith(['Changed', 'Older'], JSON.stringify(['timeline', 'node', 'older']))
    ;(render().find(element => element.props.label === t('timeline.editLocal') && element.props.onClick)!.props.onClick as () => void)()
    const editor = render().find(element => element.props.sourceOnly)!
    expect(elements(editor.props.headerExtra)[0]?.props.text).toBe('Changed')
    ;(editor.props.onChange as (value: string) => void)('Draft')
    expect(elements(render().find(element => element.props.sourceOnly)!.props.headerExtra)[0]?.props.text).toBe('Draft')
    props.timelineId = 'other-timeline'
    ;(render().find(element => element.props.label === t('timeline.cancelEdit') && element.props.onClick)!.props.onClick as () => void)()
    render()
    expect(liveCounter.useTokenCounts).toHaveBeenLastCalledWith(['Changed', 'Older'], JSON.stringify(['other-timeline', 'node', 'older']))
  })
  it.each([false, true])('keeps communication independent of swipe, including an empty connecting conversation (%s)', hasReply => {
    let mode = 'roleplay'
    const swipe = createElement('button', { 'aria-label': 'Swipe candidates' }, '1 / 1')
    const props: ComponentProps<typeof NarrativeTimeline> = {
      rounds: [],
      busy: false, emptyTimelineText: '', hasOlder: false,
      getNodeLink: () => '', onEditNode: vi.fn(), onForkNode: vi.fn(), onLoadOlder: vi.fn(),
      onNodeAnchorChange: vi.fn(), t: createTranslator('zh-CN'), timelineId: 'timeline',
      timeline: [{ id: 'node', entryId: 'story', kind: 'narrative', floor: 1, timelineId: 'timeline',
        body: { format: 'loom-markdown.v1', raw: 'Story' }, createdAt: '2026-10-24T10:20:00Z' }],
      workEntries: [
        { id: 'story', roundId: 'round', agentSessionId: 'timeline', sequence: 1, runId: 'run', createdAt: '',
          entry: { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Story' } },
        { id: 'reply', timelinePosition: { anchorNodeId: 'node' }, roundId: 'round', agentSessionId: 'timeline', sequence: 2, runId: 'run', createdAt: '',
          entry: { kind: 'message', role: 'assistant', purpose: 'discussion', content: 'Done' } },
      ],
      connecting: !hasReply,
      swipeControls: { nodeId: 'node', content: swipe },
      onDiscuss: () => { mode = 'discussion' },
    }
    if (!hasReply) props.workEntries!.pop()
    const render = () => {
      hooks.cursor = 0
      props.rounds = projectTimelineRounds(props.workEntries ?? [], props.timeline, '尚未选择预设', props.activeRun)
      return elements(NarrativeTimeline(props))
    }
    const tree = render()
    const footer = tree.find(element => element.props.createdAt && element.props.actions)!
    expect(elements(footer.props.trailing)).toContain(swipe)
    expect(elements(footer.props.trailing).some(element => element.props['aria-controls'] === 'communication-round:node')).toBe(false)
    expect(tree.some(element => element.props['aria-controls'] === 'communication-round:node')).toBe(true)
    expect(tree.filter(element => element === swipe)).toHaveLength(1)
    const toggle = () => render().find(element => element.props['aria-controls'] === 'communication-round:node')!
    expect(toggle().props['aria-expanded']).toBe(false)
    expect(elements(toggle().props.children).some(element => element.props.children === 'Agent 对话')).toBe(true)
    expect(tree.some(element => element.props.children === '正文与过程' || element.props.children === '只看正文')).toBe(false)
    ;(toggle().props.onClick as () => void)()
    expect(toggle().props['aria-expanded']).toBe(true)
    expect(mode).toBe('roleplay')
    const communication = render().find(element => element.type === NarrativeCommunication)!
    expect(communication).toBeDefined()
    ;(communication.props.onReply as () => void)()
    expect(mode).toBe('discussion')
    expect(toggle().props['aria-expanded']).toBe(true)
    ;(toggle().props.onClick as () => void)()
    expect(toggle().props['aria-expanded']).toBe(false)
    expect(mode).toBe('discussion')
  })

  it.each([true, false])('waits for persistence and retains failed text (success: %s)', async success => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const save = vi.fn(() => new Promise<void>((accept, fail) => { resolve = accept; reject = fail }))
    const t = createTranslator('en-US')
    const props: ComponentProps<typeof NarrativeTimeline> = {
      rounds: [],
      busy: false, emptyTimelineText: '', hasOlder: false,
      getNodeLink: () => '', onEditNode: save, onForkNode: vi.fn(), onLoadOlder: vi.fn(),
      onNodeAnchorChange: vi.fn(), t, timelineId: 'timeline',
      timeline: [{
        id: 'node', timelineId: 'timeline', kind: 'narrative', floor: 1,
        body: { format: 'loom-markdown.v1', raw: 'Original' }, createdAt: '2026-09-23T00:00:00Z',
      }],
    }
    const render = () => {
      hooks.cursor = 0
      props.rounds = projectTimelineRounds(props.workEntries ?? [], props.timeline, '尚未选择预设', props.activeRun)
      return elements(NarrativeTimeline(props))
    }
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
      expect(tree.some(element => element.props.role === 'alert' && element.props.children === 'Version conflict')).toBe(true)
    }
  })
})
