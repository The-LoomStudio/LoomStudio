// 通过 Vite 加载此模块；只使用内存 API，不访问真实数据库或 Storage。
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { FormEvent } from 'react'
import type { AgentSession, AgentTranscriptEntry, NarrativeTimeline, NarrativeBranch } from '../../../apps/studio-client/src/entities/index.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const timestamp = '2026-09-12T00:00:00.000Z'
const session = (id: string, timelineId?: string, agentProfileId = 'profile-a'): AgentSession => ({
  id, timelineId, agentProfileId, title: id, entryCount: 1, createdAt: timestamp, updatedAt: timestamp,
})
const message = (owner: AgentSession, suffix = ''): AgentTranscriptEntry => ({
  id: `${owner.id}${suffix}`, agentSessionId: owner.id, sequence: 1, createdAt: timestamp,
  entry: { kind: 'message', role: 'user', content: owner.id + suffix },
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function runChecks() {
  const results: string[] = []
  const errors: unknown[] = []
  const sessions = [session('a-new', 'a', 'profile-b'), session('a-old', 'a'), session('b', 'b'), session('standalone')]
  const createInputs: Array<{ timelineId?: string; agentProfileId: string }> = []
  const invokeInputs: Array<{ agentSessionId: string; narrativeTarget?: { timelineId: string }; macroSelections?: Record<string, string> }> = []
  const delayed = new Map<string, ReturnType<typeof deferred>>()
  let transcriptFailure: string | undefined
  let creationDelay: ReturnType<typeof deferred> | undefined
  let invokeDelay: ReturnType<typeof deferred> | undefined
  let createdTimelines = 0
  let current!: ReturnType<typeof useNarrativeRuntime>
  let selectedProfile!: string
  const timeline = (id: string): NarrativeTimeline => ({
    id, title: id, activeBranchId: `${id}-main`, promptResourceIds: [], createdAt: timestamp, updatedAt: timestamp,
  })
  const branch = (id: string): NarrativeBranch => ({ id: `${id}-main`, timelineId: id, createdAt: timestamp, updatedAt: timestamp })
  const page = (id: string) => ({ timeline: timeline(id), branch: branch(id), nodes: [] })
  const api = {
    narratives: {
      list: async () => ({ timelines: [] }),
      get: async (id: string) => ({ timeline: timeline(id), branches: [branch(id)] }),
      getPage: async ({ timelineId }: { timelineId: string }) => page(timelineId),
      create: async () => page(`created-${++createdTimelines}`),
    },
    agentSessions: {
      list: async ({ timelineId, standalone }: { timelineId?: string; standalone?: boolean }) => ({
        sessions: sessions.filter(item => standalone ? !item.timelineId : item.timelineId === timelineId),
      }),
      getTranscript: async ({ agentSessionId, cursor }: { agentSessionId: string; cursor?: string }) => {
        await delayed.get(agentSessionId)?.promise
        if (transcriptFailure === agentSessionId) throw new Error('模拟读取失败')
        const owner = sessions.find(item => item.id === agentSessionId)!
        if (agentSessionId === 'a-new' && !cursor) return { session: owner, entries: [message(owner, '-latest')], nextCursor: 'older' }
        return { session: owner, entries: [message(owner)] }
      },
      create: async (input: { timelineId?: string; agentProfileId: string }) => {
        createInputs.push(input)
        const created = session(`created-session-${createInputs.length}`, input.timelineId, input.agentProfileId)
        sessions.unshift(created)
        await creationDelay?.promise
        return { session: created }
      },
      invoke: async (input: typeof invokeInputs[number]) => {
        invokeInputs.push(input)
        await invokeDelay?.promise
        const owner = sessions.find(item => item.id === input.agentSessionId)!
        return {
          agentSession: owner, entries: { user: message(owner, '-u'), assistant: message(owner, '-a') },
          ...(input.narrativeTarget ? { narrative: page(input.narrativeTarget.timelineId) } : {}),
        }
      },
    },
  } as unknown as StudioApi
  const runAction = async (action: () => Promise<void>) => { try { await action() } catch (error) { errors.push(error) } }
  function Harness() {
    const [profileId, setProfileId] = useState('profile-a')
    selectedProfile = profileId
    current = useNarrativeRuntime({
      api, initialInput: '', selectedCardId: 'card', selectedAgentProfileId: profileId,
      onSelectAgentProfile: setProfileId, runAction, runAgentAction: runAction,
      runLatestAction: action => runAction(() => action({ isCurrent: () => true })),
      getMacroSelections: (timelineId, branchId) => ({ context: `${timelineId}:${branchId}` }),
    })
    return null
  }
  const root = createRoot(document.getElementById('root')!)
  const event = { preventDefault() {} } as FormEvent
  try {
    await act(async () => { root.render(createElement(Harness)) })
    assert(current.agentSession?.id === 'standalone' && createInputs.length === 0, '浏览不应创建 Session')
    results.push('PASS 独立会话恢复，浏览不创建空会话')

    await act(async () => { await current.activateTimeline('a') })
    assert(current.agentSession?.id === 'a-new' && selectedProfile === 'profile-b', '最新会话或 Profile 未恢复')
    assert(current.agentMessages.length === 2 && current.agentMessages[0].id === 'a-new', '分页历史未按顺序恢复')
    assert(current.agentSessions.length === 2 && current.agentSessionReady, '当前 Timeline 会话列表错误')
    results.push('PASS Timeline 最近会话、Profile 与分页历史同步恢复')

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
    assert(!current.timeline && current.agentSession?.id === 'standalone', '退出 Timeline 未恢复独立上下文')
    await act(async () => { current.setInput('第一轮') })
    await act(async () => { await current.submitTurn(event) })
    assert(createInputs.at(-1)?.timelineId === 'created-1', '首次发送绑定旧 Timeline')
    assert(invokeInputs.at(-1)?.narrativeTarget?.timelineId === 'created-1', '叙事 Target 错误')
    assert(invokeInputs.at(-1)?.macroSelections?.context === 'created-1:created-1-main', '宏上下文使用了旧闭包')
    results.push('PASS 首次发送绑定刚创建的 Timeline 与宏上下文')

    const slowRead = deferred()
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
    assert(!current.agentSession && current.agentMessages.length === 0 && !current.agentSessionReady, '失败后保留旧消息或允许静默新建')
    const beforeFailureSend = createInputs.length
    await act(async () => { current.setAgentInput('不应发送') })
    await act(async () => { await current.submitAgentTurn(event) })
    assert(createInputs.length === beforeFailureSend, '恢复失败后发送创建了重复会话')
    assert(errors.length === 1, '读取失败未上报')
    transcriptFailure = undefined
    results.push('PASS 恢复失败清空旧消息、阻止发送并上报错误')

    await act(async () => { await current.activateTimeline('empty'); current.newAgentSession() })
    await act(async () => { current.setAgentInput('延迟创建') })
    creationDelay = deferred()
    let sending!: Promise<void>
    await act(async () => { sending = current.submitAgentTurn(event) })
    await act(async () => { await current.activateTimeline('b') })
    const callsBefore = invokeInputs.length
    await act(async () => { creationDelay!.resolve(); await sending })
    creationDelay = undefined
    assert(current.agentSession?.id === 'b' && invokeInputs.length === callsBefore, '迟到创建覆盖选择或仍然调用模型')
    results.push('PASS 迟到的 Session 创建不会覆盖新选择或继续发送')

    await act(async () => { current.setAgentInput('延迟响应') })
    invokeDelay = deferred()
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
  }
}

document.getElementById('run')!.addEventListener('click', async () => {
  const output = document.getElementById('result')!
  output.textContent = '检查中'
  try { output.textContent = await runChecks() }
  catch (error) { output.textContent = `FAIL ${error instanceof Error ? error.stack : error}` }
})
