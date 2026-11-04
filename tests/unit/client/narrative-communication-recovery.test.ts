import { projectTimelinePositions } from '../../../packages/application-runtime/src/agents/timeline-position.js'
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { NarrativeExecutionFlow } from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-execution-flow.js'
import type { NarrativeSessionExecution } from '../../../apps/studio-client/src/features/narrative-runtime/model/narrative-execution-view.js'
import { AgentToolActionItem } from '../../../apps/studio-client/src/features/sessions/ui/agent-tool-blocks.js'
import { NarrativeCommunication, useCommunicationExpansion } from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-communication.js'
import { projectTimelineRounds as renderTimelineRounds } from '../../../apps/studio-client/src/features/narrative-runtime/model/timeline-execution-projection.js'
import type { AgentTranscriptEntry, NarrativeNode } from '../../../apps/studio-client/src/entities/index.js'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function savedFailure(abandoned = false) {
  const entry = (id: string, sequence: number, data: AgentTranscriptEntry['entry']): AgentTranscriptEntry => ({
    id, sequence, agentSessionId: 'story', createdAt: '', ...(sequence > 1 ? { roundId: 'communication-round', runId: 'failed-run' } : {}), entry: data,
  })
  const entries = [entry('opening', 1, { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Opening' }),
    entry('input', 2, { kind: 'message', role: 'user', content: '先探索世界书', editBaseline: { timelineId: 'story', branchId: 'branch', headEntryId: 'opening', headNodeId: 'opening-node', stateRevisionId: 'state', workspaceRevisionId: 'workspace' } }),
    entry('failed', 3, { kind: 'run-state', state: 'failed', reason: 'HTTP 503 overloaded', recovery: { phase: 'provider', nextProviderStep: 1, userEntryId: 'input', materialBaseline: { timelineId: 'story', branchId: 'branch', headEntryId: 'opening', headNodeId: 'opening-node', stateRevisionId: 'state', workspaceRevisionId: 'workspace' } } }),
    ...(abandoned ? [entry('discarded', 4, { kind: 'run-state', state: 'discarded' })] : []),
  ]
  const node: NarrativeNode = { id: 'opening-node', entryId: 'opening', kind: 'narrative', floor: 1, timelineId: 'story', body: { format: 'loom-markdown.v1', raw: 'Opening' }, createdAt: '' }
  return projectTimelineRounds(entries, [node], 'Writer')[0]!.communications.find(item => item.anchorNodeId === node.id)!
}

async function mount(abandoned = false, withReplies = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const onContinue = vi.fn(async () => true)
  const onRetryInput = vi.fn(async () => true)
  const candidate = savedFailure(abandoned)
  if (withReplies) candidate.discussions[0]!.steps = ['first', 'last'].map(id => ({ id, kind: 'reply', role: 'assistant', title: '回复', content: id, state: 'completed' }))
  await act(async () => root.render(createElement(NarrativeCommunication, { candidate, round: 0, activeRunId: 'failed-run', onContinue, onRetryInput })))
  return { host, onContinue, onRetryInput }
}

it('keeps failed input recoverable without pasting the gateway error into the conversation', async () => {
  const f = await mount()
  expect(f.host.textContent).toContain('先探索世界书')
  expect(f.host.textContent).not.toContain('HTTP 503 overloaded')
  const button = [...f.host.querySelectorAll('button')].find(item => item.textContent === '继续')!
  await act(async () => button.click())
  expect(f.onContinue).toHaveBeenCalledOnce()
  expect(f.onRetryInput).not.toHaveBeenCalled()
  // The same saved Entries reconstruct the record without any live observer state.
  expect(savedFailure().discussions[0]).toMatchObject({ runId: 'failed-run', inputEntryId: 'input', state: 'paused', resumable: true })
})

it('edits the latest input in place, retries only changed text, and retains the input identity', async () => {
  const f = await mount()
  const edit = f.host.querySelector<HTMLButtonElement>('[aria-label="编辑沟通输入"]')!
  await act(async () => edit.click())
  const save = [...f.host.querySelectorAll('button')].find(item => item.textContent === '保存并重试')!
  expect(save.disabled).toBe(true)
  const textarea = f.host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '先探索角色关系')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(save.disabled).toBe(false)
  await act(async () => f.host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(f.onRetryInput).toHaveBeenCalledWith('input', '先探索角色关系')
  expect(f.host.querySelector('textarea')).toBeNull()
  await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="编辑沟通输入"]')!.click())
  await act(async () => f.host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(f.onRetryInput).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(f.host.querySelector('[aria-label="编辑沟通输入"]'))
})

it('retries saved input directly without requiring composer text', async () => {
  const f = await mount()
  await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="重试沟通"]')!.click())
  expect(f.onRetryInput).toHaveBeenCalledWith('input', '先探索世界书')
})

it('places retry beside copy on the last assistant reply only', async () => {
  const f = await mount(false, true)
  const copies = f.host.querySelectorAll('[aria-label="复制回复"]')
  const retries = f.host.querySelectorAll<HTMLButtonElement>('[aria-label="重试沟通"]')
  expect(copies).toHaveLength(2)
  expect(retries).toHaveLength(1)
  expect(retries[0]!.closest('[data-conversation-message-actions]')).toBe(copies[1]!.closest('[data-conversation-message-actions]'))
  expect(copies[0]!.closest('[data-conversation-message-actions]')!.contains(retries[0]!)).toBe(false)
  await act(async () => retries[0]!.click())
  expect(f.onRetryInput).toHaveBeenCalledWith('input', '先探索世界书')
})

it('keeps edit and retry controls visible for an abandoned first-request failure with a saved baseline', async () => {
  const f = await mount(true)
  expect(f.host.querySelector<HTMLButtonElement>('[aria-label="编辑沟通输入"]')?.disabled).toBe(false)
  expect(f.host.querySelector<HTMLButtonElement>('[aria-label="重试沟通"]')?.disabled).toBe(false)
  await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="重试沟通"]')!.click())
  expect(f.onRetryInput).toHaveBeenCalledWith('input', '先探索世界书')
  expect(savedFailure(true).discussions[0]).toMatchObject({ retryable: true, state: 'cancelled', resumable: false })
})


it('keeps a reply-only narrative run and its single reasoning disclosure together', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const entry = (id: string, sequence: number, data: AgentTranscriptEntry['entry']): AgentTranscriptEntry => ({
    id, sequence, agentSessionId: 'story', createdAt: '', roundId: 'round', runId: 'run', entry: data,
  })
  const entries = [
    entry('input', 1, { kind: 'message', role: 'user', purpose: 'narrative', content: '介绍项目' }),
    entry('thought', 2, { kind: 'reasoning', content: '先整理项目知识', source: 'provider-native', visibility: 'collapsed', replay: 'omit' }),
    entry('reply', 3, { kind: 'message', role: 'assistant', content: '这是项目介绍' }),
  ]
  const node: NarrativeNode = { id: 'input-node', entryId: 'input', kind: 'user-input', floor: 1, timelineId: 'story', body: { format: 'loom-markdown.v1', raw: '介绍项目' }, createdAt: '' }
  const round = projectTimelineRounds(entries, [node], 'Assistant')[0]!
  expect(round.nodes).toEqual([node])
  expect(round.execution.steps).toEqual([])
  const candidate = round.communications.find(group => group.anchorNodeId === node.id)!
  expect(candidate.execution.steps.map(step => step.kind)).toEqual(['thinking', 'reply'])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(createElement(NarrativeCommunication, { candidate, round: 1 })))
  expect(host.textContent).toContain('这是项目介绍')
  expect(host.querySelectorAll('details')).toHaveLength(0)
  expect(host.querySelector('[aria-label="查看工作过程"]')?.getAttribute('aria-expanded')).toBe('false')
})


it('keeps communication collapsed by default and preserves manual choices across mode changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let state!: ReturnType<typeof useCommunicationExpansion>
  const keys = ['older', 'latest']
  function Harness({ mode }: { mode: 'roleplay' | 'discussion' }) {
    state = useCommunicationExpansion(mode, keys)
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => root.render(createElement(Harness, { mode: 'roleplay' })))
  await act(async () => root.render(createElement(Harness, { mode: 'discussion' })))
  expect(state[0]).toEqual({})
  await act(async () => root.render(createElement(Harness, { mode: 'roleplay' })))
  expect(state[0]).toEqual({})
  await act(async () => state[1](current => ({ ...current, older: true, latest: false })))
  await act(async () => root.render(createElement(Harness, { mode: 'discussion' })))
  expect(state[0]).toEqual({ older: true, latest: false })
})


it('restores explicit communication choices after remount and isolates branches', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  let state!: ReturnType<typeof useCommunicationExpansion>
  const keys = ['older', 'latest']
  function Harness({ scope }: { scope: string }) {
    state = useCommunicationExpansion('roleplay', keys, scope)
    return null
  }
  const first = createRoot(document.createElement('div'))
  await act(async () => first.render(createElement(Harness, { scope: 'branch-a' })))
  await act(async () => state[1]({ older: true, latest: false }))
  await act(async () => first.unmount())
  const second = createRoot(document.createElement('div'))
  roots.push(second)
  await act(async () => second.render(createElement(Harness, { scope: 'branch-a' })))
  expect(state[0]).toEqual({ older: true, latest: false })
  await act(async () => second.render(createElement(Harness, { scope: 'branch-b' })))
  expect(state[0]).toEqual({})
  await act(async () => second.render(createElement(Harness, { scope: 'branch-a' })))
  expect(state[0]).toEqual({ older: true, latest: false })
  localStorage.clear()
})


it.each([true, false])('keeps old-prose edits under their triggering input (original loaded=%s)', originalLoaded => {
  const entry = (id: string, sequence: number, roundId: string, runId: string, data: AgentTranscriptEntry['entry']): AgentTranscriptEntry =>
    ({ id, sequence, roundId, runId, agentSessionId: 'story', createdAt: '', entry: data })
  const entries = [
    entry('input1', 1, 'round1', 'writer', { kind: 'message', role: 'user', purpose: 'narrative', narrativeId: 'user1', content: 'Write' }),
    ...(originalLoaded ? [entry('original', 2, 'round1', 'writer', { kind: 'message', role: 'assistant', purpose: 'narrative', narrativeId: 'old-prose', content: 'Original' })] : []),
    entry('input2', 3, 'round2', 'editor', { kind: 'message', role: 'user', purpose: 'narrative', narrativeId: 'user2', content: 'Edit the previous floor' }),
    entry('thought', 4, 'round2', 'editor', { kind: 'reasoning', content: 'Editing now', source: 'provider-native', visibility: 'collapsed', replay: 'omit' }),
    entry('revision', 5, 'round2', 'editor', { kind: 'message', role: 'assistant', purpose: 'narrative', narrativeId: 'new-prose', content: 'Edited' }),
    entry('receipt', 6, 'round2', 'editor', { kind: 'message', role: 'assistant', content: 'Edited successfully' }),
  ]
  const node = (id: string, entryId: string, kind: NarrativeNode['kind'], floor: number, raw: string): NarrativeNode =>
    ({ id, entryId, kind, floor, timelineId: 'story', createdAt: '', body: { format: 'loom-markdown.v1', raw } })
  const nodes = [node('user1', 'input1', 'user-input', 1, 'Write'),
    { ...node('new-prose', 'revision', 'narrative', 2, 'Edited'), source: { agentSessionId: 'story', runId: 'writer' } },
    node('user2', 'input2', 'user-input', 3, 'Edit the previous floor')]
  const rounds = projectTimelineRounds(entries, nodes, 'Writer')
  expect(rounds).toHaveLength(2)
  expect(rounds[0]!.execution.steps.filter(step => step.kind === 'narrative').map(step => step.content)).toEqual(['Edited'])
  expect(rounds[0]!.communications.flatMap(group => group.execution.steps)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'receipt' })]))
  const work = rounds[1]!.communications.find(group => group.anchorNodeId === 'user2')!
  expect(work.execution.steps.map(step => step.id)).toEqual(['thought', 'receipt'])
})

it('sends inline discussion, preserves rejected text, and ignores IME confirmation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await act(async () => root.render(createElement(NarrativeCommunication, { candidate: savedFailure(), round: 0, onSend })))
  const textarea = host.querySelector<HTMLTextAreaElement>('[aria-label="继续与 Agent 对话"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '调整这一段')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
  expect(onSend).not.toHaveBeenCalled()
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(onSend).toHaveBeenCalledWith('调整这一段')
  expect(textarea.value).toBe('调整这一段')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="发送沟通"]')!.click())
  expect(textarea.value).toBe('')
})

it('exposes tool results in the collapsed header without conflating interrupted and successful work', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.push(root)
  for (const [status, label] of [['success', '执行成功'], ['error', '执行失败'], ['interrupted', '执行中断'], ['running', '执行中'], ['preparing', '准备参数中']] as const) {
    await act(async () => root.render(createElement(AgentToolActionItem, { id: 'tool', label: 'codeact_json', iconType: 'terminal', inputs: [], status })))
    const header = host.querySelector('button')!
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(label)
  }
})

it('keeps manual expansion unchanged across streaming prose and completion', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.push(root)
  const execution: NarrativeSessionExecution = { id: 'run', preset: 'writer', state: 'running', steps: [{ id: 'think', kind: 'thinking', title: '思考', content: 'plan', state: 'completed' }] }
  const render = async () => { await act(async () => root.render(createElement(NarrativeExecutionFlow, { execution: { ...execution }, reading: false, followWork: true }))) }
  await render()
  expect(host.querySelector('details')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看工作过程"]')!.click())
  expect(host.querySelector('[aria-label="思考：思考"]')?.getAttribute('aria-expanded')).toBe('false')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="思考：思考"]')!.click())
  expect(host.querySelector('[aria-label="思考：思考"]')?.getAttribute('aria-expanded')).toBe('true')
  execution.steps.push({ id: 'prose', kind: 'narrative', title: '正文', content: 'writing', state: 'running' })
  await render()
  expect(host.querySelector('[aria-label="剧情正文"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="思考：思考"]')?.getAttribute('aria-expanded')).toBe('true')
  execution.steps.push({ id: 'after', kind: 'thinking', title: '收尾', content: 'finish', state: 'running' })
  await render()
  expect(host.querySelector('[aria-label="思考：收尾"]')?.getAttribute('aria-expanded')).toBe('false')
  execution.state = 'completed'
  await render()
  expect(host.querySelectorAll('[aria-label^="思考："]')).toHaveLength(2)
  expect(host.querySelector('[aria-label="思考：思考"]')?.getAttribute('aria-expanded')).toBe('true')
})

it('renders projected Agent replies in both initial and follow-up Timeline communication', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const execution = (id: string): NarrativeSessionExecution => ({ id, preset: 'Writer', state: 'completed',
    steps: [{ id, kind: 'reply', title: '回复', content: '<nom|smile|原文>', state: 'completed' }] })
  const source = { kind: 'agent-session' as const, sessionId: 'story' }
  await act(async () => root.render(createElement(NarrativeCommunication, {
    round: 1, candidate: { execution: execution('first'), discussions: [execution('followup')] },
    displayProjection: { pending: false, entries: new Map(['first', 'followup'].map(id => [id, {
      source, id, sequence: 1, depth: 0, originalText: '<nom|smile|原文>',
      text: `<div class="nom-bubble">${id} 已处理</div>`, appliedRuleIds: ['nom'], promotedReasoning: [],
    }])) },
  })))
  await act(async () => { await import('../../../apps/studio-client/src/shared/ui/markdown-content/safe-html-markdown.js') })
  expect(host.querySelectorAll('[data-loom-message-content]')).toHaveLength(2)
  expect(host.textContent).toContain('first 已处理')
  expect(host.textContent).toContain('followup 已处理')
  expect(host.textContent).not.toContain('<div')
  expect(host.textContent).not.toContain('<nom|')
})

// Exercise the same authoritative positioning boundary as transcript reads.
function projectTimelineRounds(...args: Parameters<typeof renderTimelineRounds>) {
  return renderTimelineRounds(projectTimelinePositions(args[0] as never, args[1] as never) as typeof args[0], ...args.slice(1) as [typeof args[1], typeof args[2], typeof args[3]])
}
