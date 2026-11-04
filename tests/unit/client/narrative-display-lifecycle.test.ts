// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { projectTimelineRounds } from '../../../apps/studio-client/src/features/narrative-runtime/model/timeline-execution-projection.js'
import type { DisplayProjection } from '../../../apps/studio-client/src/features/message-content/model/use-display-projection.js'
import { DisplayProjectionStatus } from '../../../apps/studio-client/src/features/message-content/ui/display-projection-status.js'
import { notify } from '../../../apps/studio-client/src/shared/notifications/index.js'
import { NarrativeTimeline } from '../../../apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.js'
import communicationStyles from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-communication.module.scss'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const visibleRows = vi.hoisted(() => ({ shown: true }))

vi.mock('../../../apps/studio-client/src/shared/tokenizer/use-token-counts.js', () => ({ useTokenCounts: () => ({ currentCounts: [10], pending: false }) }))
vi.mock('../../../apps/studio-client/src/shared/tokenizer/settings.js', () => ({ useTokenDisplaySettings: (select: (state: { multiplier: number }) => unknown) => select({ multiplier: 1 }) }))
vi.mock('../../../apps/studio-client/src/shared/studio-shell/appearance-store.js', () => ({ useAppearanceStore: (select: (state: { narrativeOverscan: number }) => unknown) => select({ narrativeOverscan: 5 }) }))
// Keep the one loaded row visible; projection, React reconciliation, rich text and iframe lifecycle remain real.
vi.mock('../../../apps/studio-client/src/shared/ui/conversation-viewport/use-conversation-viewport.js', async () => {
  const { useRef } = await import('react')
  return { useConversationViewport: () => ({
    smooth: { following: false, pause() {}, resume() {} }, contentRef: useRef(null), scrollRef: useRef(null), listRef: useRef(null), headerRef: useRef(null), scrollMargin: 0,
    onScroll() {},
    virtualizer: { getVirtualItems: () => visibleRows.shown ? [{ index: 0, start: 0 }] : [], getTotalSize: () => 280, measureElement() {}, scrollToIndex() {}, scrollToEnd() {} },
  }) }
})

it('preserves the reading list, message, iframe and expanded work while a new preset display is pending', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const source = { kind: 'narrative', timelineId: 'story', branchId: 'branch' } as const
  const html = (label: string) => `<!DOCTYPE html><html><body><p>${label}</p></body></html>`
  const projection = (text: string): DisplayProjection => ({ pending: false, entries: new Map([['node', {
    source, id: 'node', sequence: 1, originalText: 'raw', text, depth: 0, appliedRuleIds: [], promotedReasoning: [],
  }]]) })
  let presetName = 'Preset A'
  const props: ComponentProps<typeof NarrativeTimeline> = {
    rounds: [],
    timelineId: 'story', busy: false, emptyTimelineText: '', hasOlder: false,
    t: createTranslator('zh-CN'),
    timeline: [{ id: 'node', entryId: 'body', kind: 'narrative', floor: 1, timelineId: 'story', body: { format: 'loom-markdown.v1', raw: 'raw' }, createdAt: '' }],
    workEntries: [
      { id: 'work', timelinePosition: { anchorNodeId: 'node' }, roundId: 'round', agentSessionId: 'story', runId: 'run', sequence: 1, createdAt: '', entry: { exposedName: 'read', transport: 'native-function' as const, status: 'proposed' as const, kind: 'tool-invocation' as const, invocationId: 'read', toolId: 'read' } },
      { id: 'body', roundId: 'round', agentSessionId: 'story', runId: 'run', sequence: 2, createdAt: '', entry: { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'raw' } },
      { id: 'guide', timelinePosition: { anchorNodeId: 'node', exchangeId: 'guide' }, roundId: 'round', agentSessionId: 'story', runId: 'discuss', sequence: 3, createdAt: '', entry: { kind: 'message', role: 'user', purpose: 'discussion', content: 'Test new prose' } },
    ],
    displayProjection: projection(html('Preset A display')),
    getNodeLink: () => '', onEditNode: async () => {}, onForkNode() {}, onLoadOlder: async () => {}, onNodeAnchorChange() {}, onDiscuss() {},
  }
  const render = async () => {
    props.rounds = projectTimelineRounds(props.workEntries ?? [], props.timeline, presetName, props.activeRun)
    await act(async () => root.render(createElement(NarrativeTimeline, props)))
  }
  const waitForFrame = async (label: string) => {
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(host.querySelector('iframe')?.srcdoc).toContain(label)
    })
  }
  const click = async (element: Element) => { await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
  try {
    await render()
    await waitForFrame('Preset A display')
    const canvas = host.querySelector<HTMLElement>('[data-loom-component="base-chat-canvas"]')!
    const message = host.querySelector('[data-loom-component="chat-message"]')!
    const list = message.closest('[data-index]')!.parentElement!
    const frame = host.querySelector('iframe')!
    await click(host.querySelector('[aria-controls="communication-round:node"]')!)
    await click(host.querySelector('[aria-label="查看工作过程"]')!)
    const communication = host.querySelector('[id="communication-round:node"]')!
    const userMessage = communication.querySelector('[data-communication-role="user"]')!
    expect(userMessage.classList.contains(communicationStyles.user)).toBe(true)
    expect(userMessage.querySelector(`.${communicationStyles.bubble}`)?.textContent).toBe('Test new prose')
    canvas.scrollTop = 150
    presetName = 'Preset B'
    props.displayProjection = { entries: new Map(), pending: true, refreshing: true }
    await render()
    expect(host.querySelector('[data-loom-component="base-chat-canvas"]')).toBe(canvas)
    expect(host.querySelector('[data-index]')?.parentElement).toBe(list)
    expect(host.querySelector('[data-loom-component="chat-message"]')).toBe(message)
    expect(host.querySelector('iframe')).toBe(frame)
    expect(frame.srcdoc).toContain('Preset A display')
    expect(canvas.scrollTop).toBe(150)
    expect(host.querySelector('[aria-label="查看工作过程"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('[aria-controls="communication-round:node"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('[id="communication-round:node"]')).not.toBeNull()

    props.displayProjection = projection(html('Preset B display'))
    await render()
    await waitForFrame('Preset B display')
    expect(host.querySelector('[data-index]')?.parentElement).toBe(list)
    expect(host.querySelector('[data-loom-component="chat-message"]')).toBe(message)
    expect(canvas.scrollTop).toBe(150)
    expect(host.querySelector('[id="communication-round:node"]')).not.toBeNull()

    props.timeline = [...props.timeline, { id: 'second', entryId: 'second-entry', kind: 'narrative', floor: 2,
      parentNodeId: 'node', timelineId: 'story', body: { format: 'loom-markdown.v1', raw: 'second prose' }, createdAt: '' }]
    props.workEntries = [...props.workEntries!,
      { id: 'second-entry', roundId: 'round', agentSessionId: 'story', runId: 'discuss', sequence: 4, createdAt: '', entry: { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'second prose' } },
      { id: 'report', timelinePosition: { anchorNodeId: 'second', exchangeId: 'guide' }, roundId: 'round', agentSessionId: 'story', runId: 'discuss', sequence: 5, createdAt: '', entry: { kind: 'message', role: 'assistant', purpose: 'discussion', content: 'Finished' } },
    ]
    props.displayProjection = undefined
    await render()
    const firstMessage = host.querySelector('[id="node-node"]')!
    const secondMessage = host.querySelector('[id="node-second"]')!
    expect(host.querySelector('[id="communication-round:node"]')).toBe(communication)
    expect(firstMessage.compareDocumentPosition(communication) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(communication.compareDocumentPosition(secondMessage) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(communication.querySelector('[data-communication-role="user"]')).toBe(userMessage)
    expect(communication.textContent).not.toContain('Finished')
    await click(host.querySelector('[aria-controls="communication-round:second"]')!)
    const secondCommunication = host.querySelector('[id="communication-round:second"]')!
    expect(secondCommunication.textContent).toContain('Finished')
    expect(secondCommunication.textContent).not.toContain('Test new prose')
    expect(secondCommunication.querySelector('[data-communication-role="user"]')).toBeNull()

    const firstToggle = () => host.querySelector('[aria-controls="communication-round:node"]')!
    await click(firstToggle())
    expect(firstToggle().getAttribute('aria-expanded')).toBe('false')
    await click(host.querySelector('[aria-controls="communication-round:second"]')!)
    props.inputMode = 'discussion'
    await render()
    expect(firstToggle().getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('[aria-controls="communication-round:second"]')?.getAttribute('aria-expanded')).toBe('false')
    await click(firstToggle())
    await render()
    expect(firstToggle().getAttribute('aria-expanded')).toBe('true')
    props.inputMode = 'roleplay'
    await render()
    expect(firstToggle().getAttribute('aria-expanded')).toBe('true')
    props.inputMode = 'discussion'
    await render()
    expect(firstToggle().getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('[aria-controls="communication-round:second"]')?.getAttribute('aria-expanded')).toBe('false')
    await click(firstToggle())
    await render()
    expect(firstToggle().getAttribute('aria-expanded')).toBe('false')
    const error = vi.spyOn(notify, 'error').mockImplementation((_title, options) => options!.id!)
    const dismiss = vi.spyOn(notify, 'dismiss').mockImplementation(() => {})
    try {
      props.communicationDisplay = { entries: new Map(), pending: false, error: 'Shared projection failure' }
      await render()
      expect(error).toHaveBeenCalledTimes(1)
      visibleRows.shown = false
      await render()
      expect(host.querySelector('[data-index]')).toBeNull()
      expect(dismiss).not.toHaveBeenCalled()
      visibleRows.shown = true
      await render()
      expect(error).toHaveBeenCalledTimes(1)
      props.communicationDisplay = undefined
      await render()
      expect(dismiss).toHaveBeenCalledWith(error.mock.calls[0]![1]!.id)
    } finally {
      visibleRows.shown = true
      error.mockRestore(); dismiss.mockRestore()
    }
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})

it('keeps independent projection notification owners isolated even for identical errors', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const error = vi.spyOn(notify, 'error').mockImplementation((_title, options) => options!.id!)
  const dismiss = vi.spyOn(notify, 'dismiss').mockImplementation(() => {})
  const host = document.createElement('div')
  const root = createRoot(host)
  const status = (key: string) => createElement(DisplayProjectionStatus, { key, projection: { error: 'same failure' }, retryLabel: 'Retry' })
  try {
    await act(async () => root.render([status('timeline'), status('sidebar')]))
    const ids = error.mock.calls.map(call => call[1]!.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    await act(async () => root.render([status('sidebar')]))
    expect(dismiss.mock.calls).toEqual([[ids[0]]])
    expect(error).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
    expect(dismiss.mock.calls).toEqual([[ids[0]], [ids[1]]])
  } finally {
    error.mockRestore(); dismiss.mockRestore(); vi.unstubAllGlobals()
  }
})
