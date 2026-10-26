import narrativeText from '../../features/narrative-runtime/ui/narrative-text.module.scss'
import { useSmoothFollow } from '../../shared/ui/streaming-viewport/use-smooth-follow.js'
import { MessageContent } from '../../features/message-content/ui/message-content.js'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BookOpen, Brain, ChevronDown, ChevronLeft, ChevronRight, Circle, GitBranch, Image, LoaderCircle, MessageCircle, PanelRight, Play, RotateCcw, Sparkles, Swords, X } from 'lucide-react'
import { Button, IconButton } from '@loom-studio/ui'
import { NarrativeExecutionFlow } from '../../features/narrative-runtime/ui/narrative-execution-flow.js'
import { NarrativeComposer } from './narrative-composer.js'
import { NarrativeCommunication, useCommunicationExpansion } from '../../features/narrative-runtime/ui/narrative-communication.js'
import styles from './narrative-session.module.scss'

import type { NarrativeSessionExecution } from '../../features/narrative-runtime/model/narrative-execution-view.js'
export type NarrativeSessionCandidate = {
  id: string
  execution: NarrativeSessionExecution
  discussions: NarrativeSessionExecution[]
  revision: number
  image: 'none' | 'waiting' | 'ready'
}
export type NarrativeSessionRound = {
  id: string
  number: number
  input: string
  selected: number
  candidates: NarrativeSessionCandidate[]
}
export type NarrativeSessionProps = {
  rounds: NarrativeSessionRound[]
  previewControls?: ReactNode
  secondaryPanel: ReactNode
  preset: string
  presets: readonly string[]
  writingMode: 'declaration' | 'short'
  busy: boolean
  paused: boolean
  onPresetChange(value: string): void
  onWritingModeChange(value: 'declaration' | 'short'): void
  onSend(content: string, mode: 'roleplay' | 'discussion'): void
  onRetry(roundId: string): void
  onSelectCandidate(roundId: string, index: number): void
  onPause(): void
  onReplay(): void
  onReset(): void
  onAdvance?(): void
}

function ContextView({ rounds }: { rounds: NarrativeSessionRound[] }) {
  const [target, setTarget] = useState<'main' | 'secondary'>('main')
  const [workBuffer, setWorkBuffer] = useState(true)
  return <div className={styles.contextView}>
    <p className={styles.panelIntro}>相同会话历史，两种读取视图。以下使用本页当前候选。</p>
    <div className={styles.segmented} aria-label="上下文消费者">
      <Button aria-pressed={target === 'main'} onClick={() => setTarget('main')}>当前写作</Button>
      <Button aria-pressed={target === 'secondary'} onClick={() => setTarget('secondary')}>副 Agent</Button>
    </div>
    {target === 'main' && <label className={styles.checkOption}><input type="checkbox" checked={workBuffer} onChange={event => setWorkBuffer(event.target.checked)} />保留近期工作过程</label>}
    <section className={styles.contextSummary}><BookOpen /><div><strong>剧情总结</strong><p>先前剧情的固定范围摘要。此处为位置示意，本页未生成摘要。</p></div></section>
    <section className={styles.contextSummary}><Brain /><div><strong>{target === 'main' ? '工作总结' : '副 Agent 自己的工作上下文'}</strong><p>{target === 'main' ? '任务进度、约束与接续信息；与剧情总结分别采用。' : '主写作的工具和讨论不自动带入。'}</p></div></section>
    <h3>{target === 'main' ? '统一历史缓冲' : '正文采样'}</h3>
    {!rounds.length && <p className={styles.muted}>发送第一条扮演输入后，这里会出现记录。</p>}
    {rounds.map(round => {
      const candidate = round.candidates[round.selected]!
      const executionSteps = [candidate.execution, ...candidate.discussions]
      return <div key={round.id} className={styles.contextRound}>
        <small>第 {round.number} 轮 · 候选 {round.selected + 1}</small>
        <div className={styles.contextEntry}><span>USER · 正文</span><p>{round.input}</p></div>
        {executionSteps.map(execution => <div key={execution.id}>
          {target === 'main' && workBuffer && execution.input && <div className={styles.contextEntry}><span>USER · 讨论</span><p>{execution.input}</p></div>}
          {execution.steps.filter(step => step.kind === 'narrative' || (target === 'main' && workBuffer)).map(step => <div key={step.id} className={styles.contextEntry}>
            <span>{step.kind === 'narrative' ? 'ASSISTANT · 正文' : step.kind === 'tool' ? 'TOOL · 工作过程' : step.kind === 'thinking' ? '思考摘要 · 样例' : 'ASSISTANT · 讨论'}</span>
            <p>{step.kind === 'tool' ? `${step.title}\n${step.content}` : step.content}</p>
          </div>)}
        </div>)}
      </div>
    })}
  </div>
}

export function NarrativeSession(props: NarrativeSessionProps) {
  const [mode, setMode] = useState<'roleplay' | 'discussion'>('roleplay')
  const [drafts, setDrafts] = useState({ roleplay: '', discussion: '' })
  const [panel, setPanel] = useState<'context' | 'sessions' | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const scrollArea = useRef<HTMLDivElement>(null)
  const readingContent = useRef<HTMLDivElement>(null)
  const { following, pause: pauseFollowing, resume: resumeFollowing } = useSmoothFollow({ scrollRef: scrollArea, contentRef: readingContent })
  const communicationKeys = useMemo(() => props.rounds.flatMap(round => {
    const candidate = round.candidates[round.selected]!
    return candidate.execution.steps.some(step => step.kind === 'reply') || candidate.discussions.length > 0 ? [candidate.id] : []
  }), [props.rounds])
  const [expandedCommunication, setExpandedCommunication] = useCommunicationExpansion(mode, communicationKeys)
  const lastRound = props.rounds.at(-1)
  const reply = () => { setMode('discussion'); textarea.current?.focus() }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const content = drafts[mode].trim()
    if (!content || props.busy || (mode === 'discussion' && !lastRound)) return
    resumeFollowing()
    props.onSend(content, mode)
    setDrafts(value => ({ ...value, [mode]: '' }))
  }
  return <div className={styles.shell}>
    <div className={styles.previewBar}><span><Circle /> DEV PREVIEW <span className={styles.previewName}>/ Narrative Timeline</span></span><span>流式交互草稿</span>{props.previewControls}{props.onAdvance && <Button size="small" disabled={!props.busy || !props.paused} onClick={props.onAdvance} title="暂停模拟后逐步查看输出"><ChevronRight />推进一步</Button>}<Button size="small" onClick={props.onReset} disabled={props.busy}><RotateCcw />空白开始</Button><Button size="small" onClick={props.onReplay} disabled={props.busy}><Play />重播示例</Button></div>
    <div className={styles.workspace}>
      <nav className={styles.rail} aria-label="预览视图">
        <span className={styles.brand}>L</span>
        <IconButton aria-label="故事" aria-pressed={!panel} onClick={() => setPanel(null)}><BookOpen /></IconButton>
        <IconButton aria-label="副 Session" aria-pressed={panel === 'sessions'} onClick={() => setPanel(panel === 'sessions' ? null : 'sessions')}><MessageCircle /></IconButton>
        <IconButton aria-label="上下文预览" aria-pressed={panel === 'context'} onClick={() => setPanel(panel === 'context' ? null : 'context')}><Brain /></IconButton>
        <span className={styles.railFoot}>LOOM</span>
      </nav>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.storyIdentity}><span className={styles.eyebrow}>渡鸦之城</span><h1>雨夜，旧钟楼</h1></div>
          <span className={styles.branch}><GitBranch />初始分支</span>
          <div className={styles.headerActions}>
            <IconButton aria-label="打开副 Session" aria-pressed={panel === 'sessions'} onClick={() => setPanel(panel === 'sessions' ? null : 'sessions')}><PanelRight /></IconButton>
          </div>
        </header>
        <div className={styles.scrollArea} ref={scrollArea}>
          <div className={styles.readingColumn} ref={readingContent}>
            <div className={styles.opening}><span className={styles.eyebrow}>序幕</span><p>钟楼的第十三次报时落在雨里。巷口那个人停下脚步，右手始终藏在披风下面。你认得那枚银色的渡鸦徽章。</p></div>
            {!props.rounds.length && <div className={styles.empty}><Swords /><h2>接下来，由你行动。</h2><p>从下方发送扮演输入，体验一轮写作。也可以重播示例。</p></div>}
            {props.rounds.map((round, index) => {
              const candidate = round.candidates[round.selected]!
              const latest = index === props.rounds.length - 1
              const communicationOpen = expandedCommunication[candidate.id] ?? false
              return <section key={round.id} className={styles.round} aria-label={`第 ${round.number} 轮`}>
                <div className={styles.roundDivider}><span>第 {round.number} 轮</span><span className={styles.muted}>{latest ? '当前轮次' : '已接续'}</span></div>
                <div className={styles.userRow}><span>你</span><p>{round.input}</p></div>
                <NarrativeExecutionFlow key={candidate.execution.id} execution={candidate.execution} reading={false} hideReplies followWork renderNarrative={step => <article className={narrativeText.narrative} aria-label="剧情正文" aria-busy={step.state === 'running'}><MessageContent role="assistant" value={step.content} streaming={step.state === 'running'} codeBlockLabels={{ copy: '复制', copied: '已复制', copyFailed: '复制失败', enableWrap: '自动换行', disableWrap: '关闭换行' }} /></article>} onInspect={() => pauseFollowing()} />
                <footer className={styles.roundFooter}>
                  {candidate.image !== 'none' && <details className={styles.imageReceipt}><summary>{candidate.image === 'waiting' ? <LoaderCircle className={styles.spin} /> : <Image />}<span>{candidate.image === 'waiting' ? '场景插图生成中' : `场景插图${candidate.revision > 1 ? '已随修订更新' : '已就绪'}`}</span><ChevronDown /></summary><p>模拟文生图任务 · 正文 v{candidate.revision}<br />雨夜、旧钟楼、银色渡鸦徽章。结果关联当前候选及正文版本。</p></details>}
                  <IconButton size="small" title="创作沟通" aria-label={`查看第 ${round.number} 轮创作沟通`} aria-expanded={communicationOpen} aria-controls={`communication-${candidate.id}`} onClick={() => {
                    pauseFollowing()
                    setExpandedCommunication(value => ({ ...value, [candidate.id]: !communicationOpen }))
                  }}><MessageCircle /></IconButton>
                  {latest && <div className={styles.swipe}>
                    <IconButton size="small" aria-label="上一个候选" disabled={props.busy || round.selected === 0} onClick={() => props.onSelectCandidate(round.id, round.selected - 1)}><ChevronLeft /></IconButton>
                    <span>{round.selected + 1} / {round.candidates.length}</span>
                    <IconButton size="small" aria-label="下一个候选" disabled={props.busy || round.selected === round.candidates.length - 1} onClick={() => props.onSelectCandidate(round.id, round.selected + 1)}><ChevronRight /></IconButton>
                    <Button size="small" disabled={props.busy} onClick={() => props.onRetry(round.id)} title="重新尝试本轮；当前候选的指导和修订不会带入新候选"><RotateCcw />Swipe</Button>
                  </div>}
                </footer>
                {communicationOpen && <div id={`communication-${candidate.id}`}><NarrativeCommunication followWork key={candidate.id} candidate={candidate} round={round.number} selected={round.selected} onReply={latest ? reply : undefined} onInspect={() => pauseFollowing()} onReturnCurrent={latest ? undefined : () => resumeFollowing()} /></div>}
              </section>
            })}
          </div>
        </div>
        <div className={styles.composerDock}>
          {!following && <div className={styles.returnLatest}><Button size="small" onClick={() => resumeFollowing()}><ChevronDown />回到最新进度</Button></div>}
          <NarrativeComposer inputRef={textarea} input={drafts[mode]} inputMode={mode}
            onInputModeChange={setMode} onChangeInput={value => setDrafts(drafts => ({ ...drafts, [mode]: value }))}
            onSubmit={submit} canSend={Boolean(drafts[mode].trim()) && !props.busy && (mode === 'roleplay' || Boolean(lastRound))}
            presetControl={<label><Sparkles /><select aria-label="写作预设" value={props.preset} disabled={props.busy}
              onChange={event => props.onPresetChange(event.target.value)}>{props.presets.map(preset => <option key={preset}>{preset}</option>)}</select></label>}
            runStatus={props.busy ? props.paused ? 'suspended' : 'running' : 'idle'}
            onPause={props.onPause} onResume={props.onPause} pauseLabel="暂停模拟" resumeLabel="继续模拟" />
          <div className={styles.suggestions}>{mode === 'roleplay' ? <Button size="small" disabled={props.busy} onClick={() => setDrafts(value => ({ ...value, roleplay: lastRound ? '我压低剑尖，问他为什么一直跟着我。' : '我拿起了剑，冲向那个人。' }))}>试试：{lastRound ? '我压低剑尖，问他为什么一直跟着我。' : '我拿起了剑，冲向那个人。'}</Button> : <Button size="small" disabled={props.busy} onClick={() => setDrafts(value => ({ ...value, discussion: '别让他直接后退。改成他认出了我的剑，因此迟疑了一瞬。' }))}>试试：让对方认出我的剑，修订刚才的正文。</Button>}</div>
        </div>
      </main>
      {panel && <aside className={styles.sidePanel} aria-label={panel === 'context' ? '上下文预览' : '副 Session'}>
        <header><h2>{panel === 'context' ? '上下文预览' : '副 Session'}</h2><IconButton aria-label="关闭侧栏" onClick={() => setPanel(null)}><X /></IconButton></header>
        {panel === 'context' ? <ContextView rounds={props.rounds} /> : <div className={styles.secondaryPanel}>{props.secondaryPanel}</div>}
      </aside>}
    </div>
  </div>
}
