// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { NarrativeCommunication } from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-communication.js'
import { projectTimelineRounds } from '../../../apps/studio-client/src/features/narrative-runtime/model/timeline-execution-projection.js'
import type { AgentTranscriptEntry, NarrativeNode } from '../../../apps/studio-client/src/entities/index.js'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function savedFailure(legacyAbandoned = false) {
  const entry = (id: string, sequence: number, data: AgentTranscriptEntry['entry']): AgentTranscriptEntry => ({
    id, sequence, agentSessionId: 'story', createdAt: '', ...(sequence > 1 ? { roundId: 'communication-round', runId: 'failed-run' } : {}), entry: data,
  })
  const entries = [entry('opening', 1, { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Opening' }),
    entry('input', 2, { kind: 'message', role: 'user', content: '先探索世界书' }),
    entry('failed', 3, { kind: 'run-state', state: 'failed', reason: 'HTTP 503 overloaded', recovery: legacyAbandoned
      ? { phase: 'provider', nextProviderStep: 1, userEntryId: 'input' } : { materialBaseline: { headEntryId: 'opening' } } }),
    ...(legacyAbandoned ? [entry('discarded', 4, { kind: 'run-state', state: 'discarded' })] : []),
  ]
  const node: NarrativeNode = { id: 'opening-node', entryId: 'opening', kind: 'narrative', floor: 1, timelineId: 'story', body: { format: 'loom-markdown.v1', raw: 'Opening' }, createdAt: '' }
  return projectTimelineRounds(entries, [node], 'Writer')[0]!.communications.find(item => item.anchorNodeId === node.id)!
}

async function mount(legacyAbandoned = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const onContinue = vi.fn(async () => true)
  const onRetryInput = vi.fn(async () => true)
  await act(async () => root.render(createElement(NarrativeCommunication, { candidate: savedFailure(legacyAbandoned), round: 0, activeRunId: 'failed-run', onContinue, onRetryInput })))
  return { host, onContinue, onRetryInput }
}

it('renders a persisted 503 without assistant output at the input anchor and provides direct continuation', async () => {
  const f = await mount()
  expect(f.host.textContent).toContain('先探索世界书')
  expect(f.host.querySelector('[role="status"]')?.textContent).toContain('HTTP 503 overloaded')
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

it('keeps edit and retry controls visible for a legacy abandoned first-request failure', async () => {
  const f = await mount(true)
  expect(f.host.querySelector<HTMLButtonElement>('[aria-label="编辑沟通输入"]')?.disabled).toBe(false)
  expect(f.host.querySelector<HTMLButtonElement>('[aria-label="重试沟通"]')?.disabled).toBe(false)
  await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="重试沟通"]')!.click())
  expect(f.onRetryInput).toHaveBeenCalledWith('input', '先探索世界书')
  expect(savedFailure(true).discussions[0]).toMatchObject({ retryable: true, state: 'cancelled', resumable: false })
})
