import { AgentMutationApprovalDialog } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-mutation-approval-dialog.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import { isValidElement, type ReactElement } from 'react'
import { AgentChatPanel, type AgentChatPanelProps } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-chat-panel.js'
import { AgentToolActionItem } from '../../../apps/studio-client/src/features/sessions/ui/agent-tool-blocks.js'
import { buildRenderItems } from '../../../apps/studio-client/src/features/sessions/model/transcript-render-items.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  memo: (component: unknown) => component,
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
}))
vi.mock('../../../apps/studio-client/src/shared/ui/conversation-viewport/use-conversation-viewport.js', () => ({
  useConversationViewport: ({ items }: { items: { id: string }[] }) => ({
    smooth: { following: true, pause: vi.fn(), resume: vi.fn() },
    scrollRef: { current: null }, listRef: { current: null }, headerRef: { current: null },
    scrollMargin: 0, onScroll: vi.fn(),
    virtualizer: {
      getTotalSize: () => items.length * 280,
      getVirtualItems: () => items.map((item, index) => ({ key: item.id, index, start: index * 280 })),
      measureElement: vi.fn(),
    },
  }),
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
function panelElements(count: number, reply: boolean, completed = false) {
  hooks.cursor = 0
  const messages: AgentChatPanelProps['messages'] = Array.from({ length: count }, (_, i) => ({
    id: `tool-${i}`, agentSessionId: 'session', sequence: i, createdAt: '',
    entry: { kind: 'tool-invocation', toolId: 'read', invocationId: `call-${i}`, exposedName: 'read', arguments: {} },
  }))
  const props: AgentChatPanelProps = {
    runRecoveryBusy: false, canRestoreRunInput: false, reconnectAgentRun: vi.fn(async () => {}), restoreRunInput: vi.fn(),
    busy: false, input: '', profiles: [], providerAccounts: [],
    messages: [...messages, ...(completed ? messages.map((message, i) => ({
      id: `result-${i}`, agentSessionId: 'session', sequence: count + i, createdAt: '',
      entry: { kind: 'tool-result' as const, invocationId: `call-${i}`, content: 'Done' },
    })) : []), ...(reply ? [{
      id: 'answer', agentSessionId: 'session', sequence: count, createdAt: '',
      entry: { kind: 'message', role: 'assistant' as const, content: 'Done' },
    }] : [])],
    t: createTranslator('en-US'), onChangeInput: vi.fn(), onSelectProfile: vi.fn(), onSubmit: vi.fn(),
  }
  return elements(AgentChatPanel(props))
}
const panel = (count: number, reply: boolean) => panelElements(count, reply).find(element => Array.isArray(element.props.tools))!
it('can close and reopen a pending approval from the Session without denying it', () => {
  const props: AgentChatPanelProps = {
    runRecoveryBusy: false, canRestoreRunInput: false, reconnectAgentRun: vi.fn(async () => {}), restoreRunInput: vi.fn(),
    busy: true, input: '', profiles: [], providerAccounts: [], messages: [], selectedProfileId: 'preset',
    activeRun: { runId: 'run', status: 'running', approval: { requestId: 'request',
      preview: { kind: 'workspace', action: 'patch', path: '/workspace/probe.md', before: 'a', after: 'b' } } },
    t: createTranslator('en-US'), onChangeInput: vi.fn(), onSelectProfile: vi.fn(), onSubmit: vi.fn(), onApproveMutation: vi.fn(),
  }
  const render = () => { hooks.cursor = 0; return elements(AgentChatPanel(props)) }
  const dialog = render().find(element => element.type === AgentMutationApprovalDialog)!
  ;(dialog.props.onClose as () => void)()
  expect(render().some(element => element.type === AgentMutationApprovalDialog)).toBe(false)
  const reopen = render().find(element => element.type === 'button' && JSON.stringify(element.props.children).includes('Review request'))!
  ;(reopen.props.onClick as () => void)()
  expect(render().some(element => element.type === AgentMutationApprovalDialog)).toBe(true)
  expect(props.onApproveMutation).not.toHaveBeenCalled()
})

beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

describe('Agent tool group identity and collapse', () => {
  it('retains group and tool expansion by stable ID while their virtual rows are unmounted', () => {
    const first = panel(2, false)
    const expansion = first.props.expansion as { toggle(id: string): void; isOpen(id: string): boolean }
    expansion.toggle(first.props.id as string)
    expansion.toggle('tool-1')
    panelElements(0, false)
    const returned = panel(2, true)
    const retained = returned.props.expansion as typeof expansion
    expect(retained.isOpen(returned.props.id as string)).toBe(true)
    expect(retained.isOpen('tool-1')).toBe(true)
    expect(retained.isOpen('tool-0')).toBe(false)
    const collapse = elements(render(returned)).find(element => typeof element.props.open === 'boolean')!
    expect(collapse.props.open).toBe(true)
  })

  it.each([
    { result: 'ERR_SQLITE_ERROR: no such table', expected: 1 },
    { result: 'Additional diagnostic output', expected: 2 },
  ])('deduplicates identical tool errors without hiding distinct output: $expected blocks', ({ result, expected }) => {
    const tree = elements(AgentToolActionItem({
      id: 'failed', iconType: 'terminal', label: 'Tool', inputs: [], defaultOpen: true,
      status: 'error', errorContent: 'ERR_SQLITE_ERROR: no such table', resultContent: result,
      t: createTranslator('en-US'),
    }))
    const outputs = tree.filter(element => element.type === 'pre')
    expect(outputs).toHaveLength(expected)
    expect(outputs[0]?.props.children).toBe('ERR_SQLITE_ERROR: no such table')
    if (expected === 2) expect(outputs[1]?.props.children).toBe(result)
  })

  it.each(['discarded', 'aborted', 'suspended', 'failed', 'completed'] as const)('stops the spinner for an unresolved tool after %s', state => {
    const invocation = {
      id: 'tool', runId: 'old-run', agentSessionId: 'session', sequence: 1, createdAt: '',
      entry: { kind: 'tool-invocation' as const, toolId: 'codeact', invocationId: 'call', exposedName: 'codeact' },
    }
    const terminal = {
      id: 'state', runId: 'old-run', agentSessionId: 'session', sequence: 2, createdAt: '',
      entry: { kind: 'run-state' as const, state },
    }
    expect(buildRenderItems([invocation, terminal])).toMatchObject([{ tools: [{ status: 'interrupted' }] }])
  })

  it('uses the active run state for an unresolved tool without a terminal entry', () => {
    const invocation = {
      id: 'tool', runId: 'old-run', agentSessionId: 'session', sequence: 1, createdAt: '',
      entry: { kind: 'tool-invocation' as const, toolId: 'codeact', invocationId: 'call', exposedName: 'codeact' },
    }
    expect(buildRenderItems([invocation], { runId: 'old-run', status: 'suspended' }))
      .toMatchObject([{ tools: [{ status: 'interrupted' }] }])
    expect(buildRenderItems([invocation], { runId: 'old-run', status: 'running' }))
      .toMatchObject([{ tools: [{ status: 'running' }] }])
  })

  it('shows a pending invocation until its result arrives', () => {
    const invocation = {
      id: 'call', agentSessionId: 'session', sequence: 1, createdAt: '',
      entry: { kind: 'tool-invocation' as const, toolId: 'read', invocationId: 'call-1', exposedName: 'read', transport: 'native-function' as const, status: 'proposed' as const },
    }
    const result = {
      id: 'result', agentSessionId: 'session', sequence: 2, createdAt: '',
      entry: { kind: 'tool-result' as const, invocationId: 'call-1', toolId: 'read', status: 'completed' as const, content: [{ type: 'text' as const, text: 'done' }] },
    }
    expect(buildRenderItems([invocation])).toMatchObject([{ kind: 'tool-group', tools: [{ status: 'running' }] }])
    expect(buildRenderItems([invocation, result])).toMatchObject([{ kind: 'tool-group', tools: [{
      status: 'success', inputs: [{ label: '调用', content: '未记录调用内容' }], resultContent: 'done',
    }] }])
  })

  it('retains CodeAct source and structured arguments beside a result or error', () => {
    const code = {
      id: 'code', agentSessionId: 'session', sequence: 1, createdAt: '',
      entry: { kind: 'tool-invocation', toolId: 'official/codeact', invocationId: 'code-1', exposedName: 'codeact', rawInput: 'print(1 + 1)' },
    }
    const failure = {
      id: 'failure', agentSessionId: 'session', sequence: 2, createdAt: '',
      entry: { kind: 'tool-result', invocationId: 'code-1', status: 'failed', content: [], error: { code: 'codeact.syntax', message: 'Unexpected token' } },
    }
    expect(buildRenderItems([code, failure])).toMatchObject([{ kind: 'tool-group', tools: [{
      inputs: [{ label: '代码', content: 'print(1 + 1)' }],
      errorContent: 'codeact.syntax: Unexpected token', status: 'error',
    }] }])

    const structured = {
      id: 'json', agentSessionId: 'session', sequence: 3, createdAt: '',
      entry: { kind: 'tool-invocation', toolId: 'official/search', invocationId: 'search-1', exposedName: 'search', arguments: { query: 'hello' } },
    }
    expect(buildRenderItems([structured])).toMatchObject([{ kind: 'tool-group', tools: [{
      inputs: [{ label: '参数', content: '{\n  "query": "hello"\n}' }],
      status: 'running',
    }] }])
  })

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
      resultContent: 'result😀\n{"text":""}\n{"text":0}\nnull\nfalse\n0\n"plain"\n["nested"]\n{"value":1}',
    }])
  })

  it('shows a real empty session without fabricated tools or messages', () => {
    const tree = panelElements(0, false)
    expect(tree.some(element => Array.isArray(element.props.tools))).toBe(false)
    expect(tree.some(element => element.props.message)).toBe(false)
    expect(tree.some(element => element.type === 'p' && element.props.children === createTranslator('en-US')('agent.sessionEmpty'))).toBe(true)
  })

  it('keeps group identity as tools and the following reply arrive', () => {
    const completedGroup = (count: number, reply: boolean) => panelElements(count, reply, true).find(element => Array.isArray(element.props.tools))!
    const one = completedGroup(1, false)
    const many = completedGroup(2, false)
    const answered = completedGroup(2, true)
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

it('renders a tool argument draft as preparation, retaining its identity after commitment', () => {
  const draft = { id: 'draft', runId: 'run', agentSessionId: 'session', sequence: 1, createdAt: '',
    entry: { kind: 'tool-input', exposedName: 'codeact_json', rawInput: '{"source":', status: 'preparing' } }
  const items = buildRenderItems([draft], { runId: 'run', status: 'running' })
  expect(items[0]).toMatchObject({ kind: 'tool-group', tools: [{ id: 'draft', status: 'preparing', inputs: [{ label: '参数草稿', content: '{"source":' }] }] })
  expect(buildRenderItems([draft], { runId: 'run', status: 'suspended' })[0])
    .toMatchObject({ tools: [{ status: 'interrupted', label: 'codeact_json · 参数生成已中断，尚未执行' }] })
  const committed = { ...draft, id: 'saved', presentationId: 'draft', entry: { kind: 'tool-invocation', invocationId: 'call', exposedName: 'codeact_json' } }
  expect(buildRenderItems([committed], { runId: 'run', status: 'running' })[0])
    .toMatchObject({ id: 'tool-group-draft', tools: [{ id: 'draft', status: 'running' }] })
})
