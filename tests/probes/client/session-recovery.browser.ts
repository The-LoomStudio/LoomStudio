import { createStudioTrpcClient } from '../../../apps/studio-client/src/shared/api/trpc-client.js'
// 通过 Vite 加载此模块；只使用内存 API，不访问真实数据库或 Storage。
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { FormEvent } from 'react'
import type { AgentSession, AgentTranscriptEntry, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'
import { createStudioApi, type StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const timestamp = '2026-09-12T00:00:00.000Z'
const session = (id: string, timelineId?: string, agentPresetId = 'profile-a'): AgentSession => ({ kind: 'agent' as const,
  id, timelineId, agentPresetId, title: id, entryCount: 1, createdAt: timestamp, updatedAt: timestamp,
})
const message = (owner: AgentSession, suffix = '', role: 'user' | 'assistant' = 'user') => ({
  id: `${owner.id}${suffix}`, agentSessionId: owner.id, sequence: 1, createdAt: timestamp,
  entry: { kind: 'message' as const, role, content: owner.id + suffix },
} satisfies AgentTranscriptEntry)
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function runChecks() {
  const results: string[] = []
  const errors: unknown[] = []
  const sessions = [session('a-new', 'a', 'profile-b'), session('a-old', 'a'), session('b', 'b'), session('standalone')]
  const createInputs: Array<{ timelineId?: string; agentPresetId: string }> = []
  const invokeInputs: Parameters<StudioApi['agentSessions']['createRun']>[0][] = []
  const runs = new Map<string, typeof invokeInputs[number]>()
  const delayed = new Map<string, PromiseWithResolvers<void>>()
  let transcriptFailure: string | undefined
  let creationDelay: PromiseWithResolvers<void> | undefined
  let invokeDelay: PromiseWithResolvers<void> | undefined
  let createdTimelines = 0
  let current!: ReturnType<typeof useNarrativeRuntime>
  let selectedProfile!: string
  const timeline = (id: string): NarrativeTimeline => ({
    id, title: id, activeBranchId: `${id}-main`, promptResourceIds: [], createdAt: timestamp, updatedAt: timestamp,
  })
  const branch = (id: string): Awaited<ReturnType<StudioApi['narratives']['getPage']>>['branch'] => ({ id: `${id}-main`, timelineId: id, stateHeadRevisionId: 'state', workspaceHeadRevisionId: 'workspace', createdAt: timestamp, updatedAt: timestamp })
  const page = (id: string) => ({ timeline: timeline(id), branch: branch(id), nodes: [] })
  const baseApi = createStudioApi(createStudioTrpcClient({ fetch: async () => { throw new Error('Unexpected RPC in rendering test') } }))
  const api: StudioApi = {
    ...baseApi,
    narratives: {
      ...baseApi.narratives,
      list: async () => ({ timelines: [] }),
      get: async (id: string) => ({ timeline: timeline(id), branches: [branch(id)] }),
      getPage: async ({ timelineId }: { timelineId: string }) => page(timelineId),
      create: async () => ({ ...page(`created-${++createdTimelines}`), mutation: { changesetId: 'create-timeline' } }),
      appendInput: async input => ({
        ...page(input.timelineId),
        node: { id: input.nodeId, timelineId: input.timelineId, stateRevisionId: 'state', workspaceRevisionId: 'workspace', kind: 'user-input', floor: 1, createdAt: timestamp,
          body: { format: 'loom-markdown.v1', raw: input.content } },
        mutation: { changesetId: 'append-input' },
      }),
    },
    agentSessions: {
      ...baseApi.agentSessions,
      acknowledgeRunCompletion: async runId => ({ runId, accepted: true }),
      list: async ({ timelineId, standalone } = {}) => ({
        sessions: sessions.filter(item => standalone ? !item.timelineId : item.timelineId === timelineId),
      }),
      getTranscript: async ({ agentSessionId, cursor }: { agentSessionId: string; cursor?: string }) => {
        await delayed.get(agentSessionId)?.promise
        if (transcriptFailure === agentSessionId) throw new Error('模拟读取失败')
        const owner = sessions.find(item => item.id === agentSessionId)!
        if (agentSessionId === 'a-new' && !cursor) return { session: owner, entries: [message(owner, '-latest')], nextCursor: 'older' }
        return { session: owner, entries: [message(owner)] }
      },
      create: async (input: { timelineId?: string; agentPresetId: string }) => {
        createInputs.push(input)
        const created = session(`created-session-${createInputs.length}`, input.timelineId, input.agentPresetId)
        sessions.unshift(created)
        await creationDelay?.promise
        return { session: created, mutation: { changesetId: 'create-session' } }
      },
      createRun: async input => {
        invokeInputs.push(input)
        const runId = `run-${invokeInputs.length}`
        runs.set(runId, input)
        return { runId }
      },
      subscribeRun: async runId => {
        await invokeDelay?.promise
        const input = runs.get(runId)!
        const owner = sessions.find(item => item.id === input.agentSessionId)!
        return {
          events: [{
            type: 'completed', runId, result: {
              runId, provider: { provider: 'test', model: 'test-model', finishReason: 'stop' },
              projection: { messages: [], editorProjection: { sourceRows: [], promptRows: [] } }, toolExposures: [], toolPromptBuildTrace: { sourceCount: 0, activeCount: 0, requestedOrder: [], effectiveOrder: [], activations: [], orders: [] },
    promptBuildTrace: { version: 'core-compact-1' as const, status: 'ok' as const, initialFragmentCount: 0, finalFragmentCount: 0, messageFragmentCount: 0, diagnostics: [], executions: [] }, macroInspection: { snapshot: { global: {}, computed: {}, aliases: {} }, entries: [], capturedAt: '' },
              mutation: { changesetId: 'turn-commit', scope: 'agent-session-transcript' as const },
              agentSession: owner, entries: { user: message(owner, '-u'), assistant: message(owner, '-a', 'assistant') },
              ...(input.narrativeTarget ? { narrative: page(input.narrativeTarget.timelineId) } : {}),
            },
          }],
          nextCursor: 1, done: true, state: 'completed',
        }
      },
    },
  }
  const runAction = async (action: () => Promise<void>) => {
    try { await action(); return true } catch (error) { errors.push(error); return false }
  }
  function Harness() {
    const [profileId, setProfileId] = useState('profile-a')
    selectedProfile = profileId
    current = useNarrativeRuntime({
      api, storageScope: 'session-recovery-probe', initialInput: '', selectedCardId: 'card', selectedAgentPresetId: profileId,
      onSelectCard: () => undefined,
      onSelectAgentPreset: setProfileId, runAction,
      runAgentAction: async action => { await runAction(action) },
      runLatestAction: async action => { await runAction(() => action({ isCurrent: () => true })) },
      getMacroSelections: (timelineId, branchId) => ({ context: `${timelineId}:${branchId}` }),
    })
    return null
  }
  const root = createRoot(document.getElementById('root')!)
  const event = { preventDefault() {} } as FormEvent
  const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!
  const eventSource = window.EventSource
  const storage = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  } })
  Object.defineProperty(window, 'EventSource', { configurable: true, writable: true, value: undefined })
  try {
    await act(async () => { root.render(createElement(Harness)) })
    assert(current.agentSession?.id === 'standalone' && createInputs.length === 0, '浏览不应创建 Session')
    results.push('PASS 独立会话恢复，浏览不创建空会话')

    await act(async () => { await current.activateTimeline('a') })
    assert(current.agentSession?.id === 'a-new' && current.agentSession.agentPresetId === 'profile-b', '最新会话或预设绑定未恢复')
    assert(selectedProfile === 'profile-a', '浏览已有会话不应改变新建会话的预设选择')
    assert(current.agentMessages.length === 2 && current.agentMessages[0].id === 'a-new', '分页历史未按顺序恢复')
    assert(current.agentSessions.length === 2 && current.agentSessionReady, '当前 Timeline 会话列表错误')
    results.push('PASS Timeline 最近会话、绑定预设与分页历史恢复，不改变新建预设选择')

    await act(async () => { await current.activateAgentSession('a-old') })
    assert(current.agentSession?.id === 'a-old' && selectedProfile === 'profile-a', '选择旧会话后被 Profile effect 清空')
    results.push('PASS 选择旧会话后不被 Profile 同步清空')

    await act(async () => { current.newAgentSession() })
    assert(!current.agentSession && current.agentMessages.length === 0 && createInputs.length === 0, '新建草稿不应持久化')
    assert(current.agentSessions.length === 2, '新建草稿丢失历史选项')
    await act(async () => { await current.activateTimeline('empty') })
    assert(!current.agentSession && current.agentSessions.length === 0 && current.agentSessionReady, '无历史 Timeline 应保持待发送')
    results.push('PASS 新建草稿和无历史 Timeline 不写数据库')

    await act(async () => { current.resetToDraftTimeline() })
    assert(!current.timeline && !current.agentSession && !current.primarySession, '退出 Timeline 未清空会话上下文')
    await act(async () => { await current.createAgentSession('profile-a', true) })
    assert(current.primarySession?.timelineId === 'created-1', '主会话未绑定刚创建的 Timeline')
    await act(async () => { current.setInput('第一轮') })
    await act(async () => { await current.submitTurn(event) })
    assert(createInputs.at(-1)?.timelineId === 'created-1', '首次发送绑定旧 Timeline')
    assert(invokeInputs.at(-1)?.narrativeTarget?.timelineId === 'created-1', '叙事 Target 错误')
    assert(invokeInputs.at(-1)?.macroSelections?.context === 'created-1:created-1-main', '宏上下文使用了旧闭包')
    results.push('PASS 显式创建主会话后发送绑定新 Timeline 与宏上下文')

    const slowRead = Promise.withResolvers<void>()
    delayed.set('a-new', slowRead)
    let opening!: Promise<string | undefined>
    await act(async () => { opening = current.activateTimeline('a') })
    await act(async () => { await current.activateTimeline('b') })
    await act(async () => { slowRead.resolve(); await opening })
    delayed.delete('a-new')
    assert(current.timeline?.id === 'b' && current.agentSession?.id === 'b', '迟到的 A 覆盖了 B')
    assert(current.agentMessages.every(item => item.agentSessionId === 'b'), '消息混入其他会话')
    results.push('PASS 慢请求 A 返回后不覆盖已打开的 B')

    transcriptFailure = 'a-old'
    await act(async () => { await current.activateAgentSession('a-old') })
    assert(current.agentSession?.id === 'b' && current.agentMessages.every(item => item.agentSessionId === 'b')
      && !current.agentSessionReady, '切换失败后污染当前视图或允许静默新建')
    const beforeFailureSend = createInputs.length
    await act(async () => { current.setAgentInput('不应发送') })
    await act(async () => { await current.submitAgentTurn(event) })
    assert(createInputs.length === beforeFailureSend, '恢复失败后发送创建了重复会话')
    assert(errors.length === 1, '读取失败未上报')
    transcriptFailure = undefined
    results.push('PASS 切换失败保持原视图、阻止发送并上报错误')

    await act(async () => { await current.activateTimeline('empty'); current.newAgentSession() })
    await act(async () => { current.setAgentInput('延迟创建') })
    creationDelay = Promise.withResolvers<void>()
    let sending!: Promise<void>
    await act(async () => { sending = current.submitAgentTurn(event) })
    await act(async () => { await current.activateTimeline('b') })
    const callsBefore = invokeInputs.length
    await act(async () => { creationDelay!.resolve(); await sending })
    creationDelay = undefined
    assert(current.agentSession?.id === 'b' && invokeInputs.length === callsBefore, '迟到创建覆盖选择或仍然调用模型')
    results.push('PASS 迟到的 Session 创建不会覆盖新选择或继续发送')

    await act(async () => { current.setAgentInput('延迟响应') })
    invokeDelay = Promise.withResolvers<void>()
    await act(async () => { sending = current.submitAgentTurn(event) })
    await act(async () => { await current.activateAgentSession('standalone') })
    await act(async () => { invokeDelay!.resolve(); await sending })
    invokeDelay = undefined
    assert(!current.timeline && current.agentSession?.id === 'standalone', '独立会话未清除 Narrative 上下文')
    assert(current.agentMessages.every(item => item.agentSessionId === 'standalone'), '迟到 Run 响应污染独立会话')
    results.push('PASS 独立会话切换清除 Timeline，迟到 Run 不串消息')
    return results.join('\n')
  } finally {
    await act(async () => { root.unmount() })
    Object.defineProperty(window, 'localStorage', storageDescriptor)
    Object.defineProperty(window, 'EventSource', { configurable: true, writable: true, value: eventSource })
  }
}

const runButton = document.getElementById('run') as HTMLButtonElement
runButton.addEventListener('click', async () => {
  const output = document.getElementById('result')!
  runButton.disabled = true
  output.textContent = '检查中'
  try { output.textContent = await runChecks() }
  catch (error) { output.textContent = `FAIL ${error instanceof Error ? error.stack : error}` }
  finally { runButton.disabled = false }
})
