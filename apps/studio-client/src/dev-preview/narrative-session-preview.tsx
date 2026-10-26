import type { NarrativeSessionStep, NarrativeSessionExecution } from '../features/narrative-runtime/model/narrative-execution-view.js'
import { StreamingSessionPreview, previewRates, type PreviewRate } from './streaming-session-preview.js'
import { HtmlHeightPreview } from './html-height-preview.js'
import { useEffect, useMemo, useReducer, useState } from 'react'
import { StartupReady } from '../app/startup-curtain.js'
import { NarrativeSession, type NarrativeSessionCandidate,  type NarrativeSessionRound } from './narrative-session/narrative-session.js'
import { alternate, original, revised } from './narrative-session-samples.js'
import '../styles/global.css'

const presets = ['诺姆 · 叙事写作', '诺姆 · 克制叙事', '诺姆 · 对话优先'] as const
const firstInput = '我拿起了剑，冲向那个人。'

type Job = { roundId: string; candidateId: string; executionId: string; frames: NarrativeSessionStep[][]; frame: number; revisedText?: string }
type Demo = { rounds: NarrativeSessionRound[]; preset: string; writingMode: 'declaration' | 'short'; job?: Job; paused: boolean; epoch: number }
type Action =
  | { type: 'send'; content: string; mode: 'roleplay' | 'discussion' }
  | { type: 'retry'; roundId: string }
  | { type: 'select'; roundId: string; index: number }
  | { type: 'preset'; value: string }
  | { type: 'mode'; value: Demo['writingMode'] }
  | { type: 'tick'; step?: number }
  | { type: 'pause' | 'reset' | 'replay' | 'advance' }

function step(id: string, kind: NarrativeSessionStep['kind'], title: string, content: string, state: NarrativeSessionStep['state'] = 'completed'): NarrativeSessionStep {
  return { id, kind, title, content, state }
}

function narrativeParts(text: string): [string, string] {
  const paragraphs = text.split('\n\n')
  const middle = Math.ceil(paragraphs.length / 2)
  return [paragraphs.slice(0, middle).join('\n\n'), paragraphs.slice(middle).join('\n\n')]
}

function streamedFrames(before: NarrativeSessionStep[], output: NarrativeSessionStep): NarrativeSessionStep[][] {
  const frames: NarrativeSessionStep[][] = []
  for (let length = 12; length < output.content.length; length += 12) frames.push([...before, { ...output, content: output.content.slice(0, length), state: 'running' }])
  frames.push([...before, { ...output, state: 'running' }])
  return frames
}

function writingFrames(text: string, mode: Demo['writingMode']): NarrativeSessionStep[][] {
  if (mode === 'short') {
    const thought = step('thought', 'thinking', '正在组织对话', '样例思考摘要：保持这一刻的紧张感，让对方先开口。')
    const body = step('body', 'narrative', '正文', text)
    return [
      [{ ...thought, content: '样例思考摘要：保持这一刻的紧张感。', state: 'running' }],
      [{ ...thought, state: 'running' }],
      ...streamedFrames([thought], body),
      [thought, body],
    ]
  }
  const thought = step('thought', 'thinking', '整理场景', '样例思考摘要：用户已经拔剑冲向对方，接下来要承接这个动作，先写出逼近与接招，不能越过这一步直接让两人开始闲谈。\n\n渡鸦徽章和剑柄的缺口是同一条线索，需要先读取角色资料确认。人物可以认出佩剑，但这一轮不必解释完整来历，让迟疑和动作把线索留在场景里。\n\n正文先推进钟楼前的对峙，再根据场景变量接续人物反应。保留用户下一步选择的空间，不替用户决定是否放下剑或进入钟楼。')
  thought.content = Array.from({ length: 4 }, (_, index) => `第 ${index + 1} 次场景核对：\n${thought.content}`).join('\n\n')
  const read = step('read', 'tool', '读取角色资料', '/lore/渡鸦卫队.md\n已读取：徽章、钟楼与失踪的佩剑。')
  const declare = step('declare', 'tool', '声明下一条输出为正文', 'declare_narrative()\n下一条 Assistant 正文属于本轮剧情；输出后继续执行。')
  const [first, second] = narrativeParts(text)
  const body = step('body', 'narrative', '正文', first)
  const update = step('state', 'tool', '更新场景变量', '/state/scene/tension: 2 → 3\n/state/characters/raven/recognizesSword: true')
  const nextThought = step('next-thought', 'thinking', '接续人物反应', '样例思考摘要：正文已经出现，但本次执行还没有结束。读取刚才更新的状态，让人物先开口；不要替用户选择接下来的行动。')
  const nextDeclare = step('next-declare', 'tool', '声明接下来的正文', 'declare_narrative()\n接续同一次执行中的第二段剧情。')
  const nextBody = step('body-2', 'narrative', '正文', second)
  const save = step('save', 'tool', '保存待揭示的线索', '/workspace/线索.md\n已记录：对方认出了这把佩剑，身份尚未揭示。')
  const question: NarrativeSessionStep = { ...step('question', 'reply', '询问创作方向', '接下来要让他解释这把剑的来历，还是先保留悬念，等你继续行动？'), presentation: 'question' }
  read.content = JSON.stringify({ path: '/lore/渡鸦卫队.md', questions: Array.from({ length: 16 }, (_, index) => `核对线索 ${index + 1}：徽章、佩剑和人物行动的关联。`) }, null, 2)
  const firstWork = [thought, read, declare]
  const secondWork = [...firstWork, body, update, nextThought, nextDeclare]
  return [
    ...streamedFrames([], thought),
    ...streamedFrames([thought], read),
    [thought, read, { ...declare, state: 'running' }],
    ...streamedFrames(firstWork, body),
    [...firstWork, body, { ...update, state: 'running' }],
    ...streamedFrames([...firstWork, body, update], nextThought),
    [...firstWork, body, update, nextThought, { ...nextDeclare, state: 'running' }],
    ...streamedFrames(secondWork, nextBody),
    [...secondWork, nextBody, { ...save, state: 'running' }],
    [...secondWork, nextBody, save, question],
  ]
}

function discussionFrames(edit: boolean): NarrativeSessionStep[][] {
  const thought = step('thought', 'thinking', '理解你的指导', edit ? '样例思考摘要：只修订当前正文的反应，不添加新的剧情轮次。保留用户已经作出的行动。' : '样例思考摘要：这是创作讨论，回复不归入剧情。')
  if (!edit) return [[{ ...thought, state: 'running' }], [thought, step('reply', 'reply', '讨论回复', '这里用“认出剑”留下一个悬念，让人物的迟疑推动对话。你可以继续指导我修改，或者切回扮演推进剧情。')]]
  const patch = step('patch', 'tool', '修订本轮正文', 'edit_narrative(current, expectedVersion)\n将退让改为认出佩剑后的迟疑；保留原来的行动与场景。')
  return [[{ ...thought, state: 'running' }], [thought, { ...patch, state: 'running' }], [thought, patch, step('reply', 'reply', '修订回复', '改好了。他会停在原地，因认出这把剑而迟疑；没有新增剧情楼层。')]]
}

function bodyFor(round: number, candidate: number, input: string): string {
  if (round === 1) return candidate % 2 ? alternate : original
  return `你说完，钟楼下短暂地安静下来。\n\n${candidate % 2 ? '那人先看了看空荡的巷口，才向你走近一步。' : '那人把手从剑锋前缓缓收回，目光第一次落在你的脸上。'}\n\n“我跟着的是那把剑。”他说，“直到刚才，我都以为拿着它的会是另一个人。”\n\n雨声填满了你们之间的距离。你方才的行动——${input.replace(/[。！!？?]$/, '')}——似乎终于让他下定了决心。`
}

function makeCandidate(id: string, preset: string, text: string, mode: Demo['writingMode'], completed: boolean): NarrativeSessionCandidate {
  const frames = writingFrames(text, mode)
  return { id, execution: { id: `${id}-writing`, preset, state: completed ? 'completed' : 'running', steps: frames[completed ? frames.length - 1 : 0]! }, discussions: [], revision: 1, image: completed ? 'ready' : 'none' }
}

function initial(scene: string): Demo {
  const state: Demo = { rounds: [], preset: presets[0], writingMode: 'declaration', paused: false, epoch: 0 }
  if (scene === 'empty') return state
  const count = scene === 'long' ? 6 : scene === 'communication' ? 2 : 1
  for (let index = 0; index < count; index++) {
    const number = index + 1
    const input = index === 0 ? firstInput : index === 1 ? '我压低剑尖，问他为什么一直跟着我。' : `我看向钟楼更深处，继续追问第 ${number} 个线索。`
    const id = `round-${number}`
    const candidate = makeCandidate(`${id}-candidate-1`, state.preset, scene === 'communication' && index === 0 ? revised : bodyFor(number, 0, input), state.writingMode, true)
    if (scene === 'communication') {
      candidate.discussions = [{
        id: `${candidate.id}-discussion-1`, preset: state.preset, state: 'completed',
        input: index === 0 ? '别让他直接后退。改成他认出了我的剑，因此迟疑了一瞬。' : '先保留悬念，不要现在解释他和这把剑的关系。',
        steps: index === 0 ? discussionFrames(true).at(-1)! : [step('reply', 'reply', '讨论回复', '可以。他会先确认你的身份，这一轮不解释佩剑的来历，把选择留给你。')],
      }]
      if (index === 0) candidate.revision = 2
    }
    state.rounds.push({ id, number, input, selected: 0, candidates: [candidate] })
  }
  return scene === 'streaming' ? reducer(initial('empty'), { type: 'send', content: firstInput, mode: 'roleplay' }) : state
}

function mapCandidate(state: Demo, roundId: string, candidateId: string, update: (candidate: NarrativeSessionCandidate) => NarrativeSessionCandidate): Demo {
  return { ...state, rounds: state.rounds.map(round => round.id !== roundId ? round : { ...round, candidates: round.candidates.map(candidate => candidate.id === candidateId ? update(candidate) : candidate) }) }
}

function reducer(state: Demo, action: Action): Demo {
  if (action.type === 'tick') {
    // A fixture's image task completes separately from writing. Only its own candidate is updated.
    let next = { ...state, rounds: state.rounds.map(round => ({ ...round, candidates: round.candidates.map(candidate => candidate.image === 'waiting' ? { ...candidate, image: 'ready' as const } : candidate) })) }
    const job = state.job
    if (!job || state.paused) return next
    const frame = Math.min(job.frames.length, job.frame + (action.step ?? 1))
    const complete = frame === job.frames.length
    const steps = job.frames[complete ? frame - 1 : frame]!
    next = mapCandidate(next, job.roundId, job.candidateId, candidate => {
      const apply = (execution: NarrativeSessionExecution): NarrativeSessionExecution => execution.id !== job.executionId ? execution : { ...execution, steps, state: complete ? 'completed' : 'running' }
      let updated = { ...candidate, execution: apply(candidate.execution), discussions: candidate.discussions.map(apply) }
      if (complete && job.revisedText) {
        const parts = narrativeParts(job.revisedText)
        const segmented = updated.execution.steps.some(item => item.id === 'body-2')
        updated = { ...updated, revision: candidate.revision + 1, execution: { ...updated.execution, steps: updated.execution.steps.map(item => item.kind === 'narrative' ? { ...item, content: segmented ? parts[item.id === 'body-2' ? 1 : 0] : job.revisedText! } : item) } }
      }
      return complete && (!candidate.discussions.length || job.revisedText) ? { ...updated, image: 'waiting' } : updated
    })
    return { ...next, job: complete ? undefined : { ...job, frame } }
  }
  if (action.type === 'reset') return { ...initial('empty'), epoch: state.epoch + 1 }
  if (action.type === 'replay') return reducer({ ...initial('empty'), epoch: state.epoch + 1 }, { type: 'send', content: firstInput, mode: 'roleplay' })
  if (action.type === 'advance') {
    if (!state.job || !state.paused) return state
    const next = reducer({ ...state, paused: false }, { type: 'tick' })
    return next.job ? reducer(next, { type: 'pause' }) : next
  }
  if (action.type === 'pause') {
    if (!state.job) return state
    const job = state.job
    const next = mapCandidate(state, job.roundId, job.candidateId, candidate => {
      const apply = (execution: NarrativeSessionExecution): NarrativeSessionExecution => execution.id === job.executionId ? { ...execution, state: state.paused ? 'running' : 'paused' } : execution
      return { ...candidate, execution: apply(candidate.execution), discussions: candidate.discussions.map(apply) }
    })
    return { ...next, paused: !state.paused }
  }
  if (state.job) return state
  if (action.type === 'preset') return { ...state, preset: action.value }
  if (action.type === 'mode') return { ...state, writingMode: action.value }
  if (action.type === 'select') return { ...state, rounds: state.rounds.map(round => round.id === action.roundId && action.index >= 0 && action.index < round.candidates.length ? { ...round, selected: action.index } : round) }
  if (action.type === 'retry') {
    const round = state.rounds.at(-1)
    if (!round || round.id !== action.roundId) return state
    const text = bodyFor(round.number, round.candidates.length, round.input)
    const candidate = makeCandidate(`${round.id}-candidate-${round.candidates.length + 1}`, state.preset, text, state.writingMode, false)
    return { ...state, paused: false, rounds: [...state.rounds.slice(0, -1), { ...round, selected: round.candidates.length, candidates: [...round.candidates, candidate] }], job: { roundId: round.id, candidateId: candidate.id, executionId: candidate.execution.id, frames: writingFrames(text, state.writingMode), frame: 0 } }
  }
  if (action.type === 'send' && action.mode === 'roleplay') {
    const number = state.rounds.length + 1
    const id = `round-${number}`
    const text = bodyFor(number, 0, action.content)
    const candidate = makeCandidate(`${id}-candidate-1`, state.preset, text, state.writingMode, false)
    return { ...state, paused: false, rounds: [...state.rounds, { id, number, input: action.content, selected: 0, candidates: [candidate] }], job: { roundId: id, candidateId: candidate.id, executionId: candidate.execution.id, frames: writingFrames(text, state.writingMode), frame: 0 } }
  }
  if (action.type === 'send') {
    const round = state.rounds.at(-1)
    if (!round) return state
    const candidate = round.candidates[round.selected]!
    const edit = /改|修|调整|别|迟疑|认出/.test(action.content)
    const frames = discussionFrames(edit)
    const execution: NarrativeSessionExecution = { id: `${candidate.id}-discussion-${candidate.discussions.length + 1}`, preset: state.preset, input: action.content, state: 'running', steps: frames[0]! }
    const next = mapCandidate(state, round.id, candidate.id, item => ({ ...item, discussions: [...item.discussions, execution] }))
    const revisedText = edit ? round.number === 1 ? revised : `${bodyFor(round.number, round.selected, round.input)}\n\n他没有立刻回答。那一瞬的迟疑，让你意识到这件事远比想象中更重要。` : undefined
    return { ...next, paused: false, job: { roundId: round.id, candidateId: candidate.id, executionId: execution.id, frames, frame: 0, revisedText } }
  }
  return state
}

export function NarrativeSessionPreview() {
  return new URLSearchParams(window.location.search).get('scene') === 'html'
    ? <HtmlHeightPreview /> : <WritingPreview />
}

function WritingPreview() {
  const [state, dispatch] = useReducer(reducer, new URLSearchParams(window.location.search).get('scene') ?? '', initial)
  const [rate, setRate] = useState<PreviewRate>('steady')
  const secondaryFrames = useMemo(() => writingFrames(original, state.writingMode), [state.writingMode])
  const hasPendingImage = state.rounds.some(round => round.candidates.some(candidate => candidate.image === 'waiting'))
  useEffect(() => {
    if ((!state.job || state.paused) && !hasPendingImage) return
    const timer = window.setTimeout(() => dispatch({ type: 'tick', step: previewRates[rate].step }), state.job && !state.paused ? (state.job.frame > 0 && state.job.frame % 80 < previewRates[rate].step ? 650 : previewRates[rate].delay) : 1500)
    return () => window.clearTimeout(timer)
  }, [state.job, state.paused, hasPendingImage, rate])
  return <><NarrativeSession key={state.epoch} rounds={state.rounds}
    previewControls={<select aria-label="模拟输出速度" value={rate} onChange={event => setRate(event.target.value as PreviewRate)}><option value="slow">慢速输出</option><option value="steady">均匀输出</option><option value="burst">突发输出</option></select>}
    secondaryPanel={<StreamingSessionPreview frames={secondaryFrames} rate={rate} />}
    preset={state.preset} presets={presets} writingMode={state.writingMode} busy={!!state.job} paused={state.paused}
    onPresetChange={value => dispatch({ type: 'preset', value })} onWritingModeChange={value => dispatch({ type: 'mode', value })}
    onSend={(content, mode) => dispatch({ type: 'send', content, mode })} onRetry={roundId => dispatch({ type: 'retry', roundId })}
    onSelectCandidate={(roundId, index) => dispatch({ type: 'select', roundId, index })} onPause={() => dispatch({ type: 'pause' })}
    onReplay={() => dispatch({ type: 'replay' })} onReset={() => dispatch({ type: 'reset' })} onAdvance={() => dispatch({ type: 'advance' })} /><StartupReady /></>
}
