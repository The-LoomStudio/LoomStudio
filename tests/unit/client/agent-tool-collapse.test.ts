import { describe, expect, it, vi } from 'vitest'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { isValidElement, type ReactElement } from 'react'
import { AgentChatPanel, type AgentChatPanelProps } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-chat-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
}))
type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
function render(element: Element): Element {
  return (element.type as (props: Record<string, unknown>) => Element)(element.props)
}
function panelElements(count: number, reply: boolean) {
  const messages: AgentChatPanelProps['messages'] = Array.from({ length: count }, (_, i) => ({
    id: `tool-${i}`, agentSessionId: 'session', sequence: i, createdAt: '',
    entry: { kind: 'tool-invocation', toolId: 'read', invocationId: `call-${i}`, exposedName: 'read', arguments: {} },
  }))
  const props: AgentChatPanelProps = {
    runRecoveryBusy: false, canRestoreRunInput: false, reconnectAgentRun: vi.fn(async () => {}), restoreRunInput: vi.fn(),
    busy: false, input: '', profiles: [], providerAccounts: [],
    messages: [...messages, ...(reply ? [{
      id: 'answer', agentSessionId: 'session', sequence: count, createdAt: '',
      entry: { kind: 'message', role: 'assistant' as const, content: 'Done' },
    }] : [])],
    t: createTranslator('en-US'), onChangeInput: vi.fn(), onSelectProfile: vi.fn(), onSubmit: vi.fn(),
  }
  return elements(AgentChatPanel(props))
}
const panel = (count: number, reply: boolean) => panelElements(count, reply).find(element => Array.isArray(element.props.tools))!

describe('Agent tool group identity and collapse', () => {
  it('renders text and JSON tool result parts without losing falsy or Unicode values', () => {
    const content: ClientJsonValue[] = [{ text: 'result😀' }, { text: '' }, { text: 0 }, null, false, 0, 'plain', ['nested'], { value: 1 }]
    const tree = elements(AgentChatPanel({
      runRecoveryBusy: false, canRestoreRunInput: false, reconnectAgentRun: vi.fn(async () => {}), restoreRunInput: vi.fn(),
      busy: false, input: '', profiles: [], providerAccounts: [],
      messages: [
        { id: 'call', agentSessionId: 'session', sequence: 0, createdAt: '', entry: { kind: 'tool-invocation', toolId: 'read', invocationId: 'call-1' } },
        { id: 'result', agentSessionId: 'session', sequence: 1, createdAt: '', entry: { kind: 'tool-result', invocationId: 'call-1', content } },
      ],
      t: createTranslator('en-US'), onChangeInput: vi.fn(), onSelectProfile: vi.fn(), onSubmit: vi.fn(),
    }))
    const group = tree.find(element => Array.isArray(element.props.tools))!
    expect(group.props.tools).toMatchObject([{
      detailContent: 'result😀\n{"text":""}\n{"text":0}\nnull\nfalse\n0\n"plain"\n["nested"]\n{"value":1}',
    }])
  })

  it('shows a real empty session without fabricated tools or messages', () => {
    const tree = panelElements(0, false)
    expect(tree.some(element => Array.isArray(element.props.tools))).toBe(false)
    expect(tree.some(element => element.props.message)).toBe(false)
    expect(tree.some(element => element.type === 'p' && element.props.children === createTranslator('en-US')('agent.sessionEmpty'))).toBe(true)
  })

  it('keeps group identity as tools and the following reply arrive', () => {
    const one = panel(1, false)
    const many = panel(2, false)
    const answered = panel(2, true)
    expect(one.key).toBe(many.key)
    expect(many.key).toBe(answered.key)
    const singleCollapse = elements(render(one)).find(element => typeof element.props.open === 'boolean')!
    const groupCollapse = elements(render(many)).find(element => typeof element.props.open === 'boolean')!
    expect(singleCollapse.type).toBe(groupCollapse.type)
    const singleTool = elements(singleCollapse.props.children).find(element => element.key === 'tool-0')!
    const groupTool = elements(groupCollapse.props.children).find(element => element.key === 'tool-0')!
    expect(singleTool.type).toBe(groupTool.type)
    expect(singleCollapse.props.open).toBe(true)
    expect(groupCollapse.props.open).toBe(false)
    const closed = render(groupCollapse)
    expect(closed.props).toMatchObject({ inert: true, 'aria-hidden': true, 'data-open': false })
    expect(elements(closed).some(element => element.key === 'tool-0')).toBe(true)
  })
})
