import { StartupReady } from '../app/startup-curtain.js'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@loom-studio/ui'
import { CodeMirrorEditor } from '../shared/ui/long-text-editor/code-mirror-editor.js'
import { TextRulePreviewDialog } from '../features/loom-scripts/ui/text-rule-preview-dialog.js'
import type { ScriptPreviewInput, ScriptPreviewResult } from '../features/loom-scripts/ui/loom-script-source-fields.js'
import { TextRuleComparison } from '../features/loom-scripts/ui/text-rule-comparison.js'
import { createTranslator } from '../shared/i18n/index.js'
import type { RegexLabRequest, RegexLabState, RegexLabProjection } from './regex-lab-contract.js'
import { regexLabSamples } from './regex-lab-samples.js'
import styles from './regex-lab-preview.module.scss'
import '../styles/global.css'
const t = createTranslator('zh-CN')
async function request<T>(input: RegexLabRequest): Promise<T> {
  const response = await fetch('/__dev/regex-lab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}
const previewSource = (input: ScriptPreviewInput) => request<ScriptPreviewResult>({ action: 'preview', ...input })
export function RegexLabPreview() {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sampleId, setSampleId] = useState('finish')
  const sample = regexLabSamples.find(item => item.id === sampleId)!
  const [sources, setSources] = useState(sample.sources)
  const [ruleIndex, setRuleIndex] = useState(0)
  const [input, setInput] = useState(sample.input)
  const [stored, setStored] = useState<RegexLabState>()
  const [adoptionRevision, setAdoptionRevision] = useState(0)
  const [installed, setInstalled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(3)
  const [projection, setProjection] = useState<RegexLabProjection>()
  const [projecting, setProjecting] = useState(false)
  const sequence = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void request<RegexLabState>({ action: 'state' }).then(state => {
      if (!alive.current) return
      setStored(state)
      const selected = regexLabSamples.find(item => item.id === state.caseId) ?? regexLabSamples[0]!
      const active = state.rules.filter(item => item.enabled).sort((a, b) => a.order - b.order)
      setSampleId(selected.id); setInput(selected.input); setSources(active.length ? active.map(item => item.source) : selected.sources); setInstalled(active.length > 0)
    }).catch(cause => { if (alive.current) setError(String(cause)) })
    return () => { alive.current = false; sequence.current++ }
  }, [])
  useEffect(() => {
    if (!playing || !installed || projecting) return
    if (position >= input.length) { setPlaying(false); return }
    const timer = setTimeout(() => setPosition(value => Math.min(input.length, value + [...input.slice(value)].slice(0, speed).join('').length)), 100)
    return () => clearTimeout(timer)
  }, [playing, installed, projecting, position, input, speed])
  useEffect(() => {
    const ticket = ++sequence.current
    if (!installed) return
    setProjecting(true)
    void request<RegexLabProjection>({ action: 'project', text: input.slice(0, position), streaming: position < input.length })
      .then(value => { if (ticket === sequence.current) { setProjection(value); setError('') } })
      .catch(cause => { if (ticket === sequence.current) { setError(String(cause)); setPlaying(false) } })
      .finally(() => { if (ticket === sequence.current) setProjecting(false) })
  }, [installed, input, position, adoptionRevision])
  function choose(id: string) {
    const next = regexLabSamples.find(item => item.id === id)!
    setSampleId(id); setInput(next.input); setSources(next.sources); setRuleIndex(0)
    setInstalled(false); setPlaying(false); setPosition(0); setProjection(undefined); setError('')
  }
  async function perform(operation: () => Promise<RegexLabState>, install = false) {
    setBusy(true); setPlaying(false); setError('')
    try { const state = await operation(); setStored(state); if (install) { setAdoptionRevision(value => value + 1); setInstalled(true); setPosition(0); setProjection(undefined) } }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <main className={styles.page}><StartupReady />
    <h1>原生正则实验室</h1>
    {previewOpen && <TextRulePreviewDialog source={sources[ruleIndex] ?? ''} name={sample.name} t={t} onPreview={previewSource} onClose={() => setPreviewOpen(false)} />}
    <p className={styles.note}>真实 Script / Mount → 文本管线 → 正式 MessageContent / iframe。数据独立保存在 .artifacts/regex-preview，刷新和重启保留；没有请求外部 AI。</p>
    <div className={styles.controls}>
      <label>用例 <select disabled={busy} value={sampleId} onChange={event => choose(event.target.value)}>{regexLabSamples.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <Button disabled={busy || !stored} onClick={() => void perform(() => request({ action: 'install', caseId: sampleId, sources }), true)}>保存并启用示例规则</Button>
      <Button onClick={() => setPreviewOpen(true)}>作者实时预览</Button>
      <span className={styles.note}>{installed ? '当前源码已采用' : '尚未采用：保存后才能运行'}</span>
    </div>
    <p>{sample.description}</p>
    {sample.limitation && <p className={styles.note}>{sample.limitation}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <TextRuleComparison input={input} output={projection?.text ?? ''} position={position} streaming={position < input.length} disabled={busy} t={t}
      onInputChange={value => { setPlaying(false); setInput(value); setPosition(value.length) }}
      onPositionChange={value => { setPlaying(false); setPosition(value) }}
      status={`${position < input.length ? '流式快照' : '结束快照'} · ${projection?.matches ?? 0} 次匹配${projecting ? ' · 处理中' : ''}`}
      controls={<>
        <Button disabled={!installed || busy} onClick={() => { if (position >= input.length) setPosition(0); setPlaying(value => !value) }}>{playing ? '暂停' : '播放'}</Button>
        <Button disabled={!installed || busy || projecting} onClick={() => { setPlaying(false); setPosition(value => Math.min(input.length, value + ([...input.slice(value)][0]?.length ?? 0))) }}>单字符</Button>
        <Button disabled={!installed || busy} onClick={() => { setPlaying(false); setPosition(input.length) }}>跳到结束</Button>
        <Button disabled={busy} onClick={() => { setPlaying(false); setPosition(0) }}>回到开头</Button>
        <label>步长 <input aria-label="步长" type="number" min={1} max={30} value={speed} onChange={event => setSpeed(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /></label>
      </>} />
    {projection?.diagnostics.map((message, index) => <p key={index} className={styles.error}>{message}</p>)}
    <details className={styles.inspect}><summary>当前输入切片与实际规则 ID</summary><pre>{input.slice(0, position)}</pre><pre>{projection?.rules.join('\n')}</pre></details>
    {sample.expected !== undefined && <details className={styles.inspect}><summary>本例标准输入断言：{installed && !projecting && position === input.length && input === sample.input && sources.join('\0') === sample.sources.join('\0') ? projection?.text === sample.expected ? '通过' : '未通过' : '等待标准输入完整执行（自定义输入不套用样例预期）'}</summary><pre>{sample.expected}</pre></details>}
    <details className={styles.inspect}><summary>编辑 MD 规则与顺序（{sources.length} 条）</summary>
        <div className={styles.controls}><label>规则顺序 <select value={ruleIndex} onChange={event => setRuleIndex(Number(event.target.value))}>{sources.map((_, index) => <option key={index} value={index}>规则 {index + 1}</option>)}</select></label>
          <Button size="small" disabled={busy || ruleIndex === 0} onClick={() => { const next = [...sources]; [next[ruleIndex - 1], next[ruleIndex]] = [next[ruleIndex]!, next[ruleIndex - 1]!]; setSources(next); setRuleIndex(ruleIndex - 1); setInstalled(false) }}>上移</Button>
        </div>
        <div className={styles.editor}><CodeMirrorEditor language="loom-rule" onCommit={() => { if (!busy) void perform(() => request({ action: 'install', caseId: sampleId, sources }), true) }} labelledBy="regex-source-label" value={sources[ruleIndex] ?? ''} onChange={value => { setSources(current => current.map((source, index) => index === ruleIndex ? value : source)); setInstalled(false); setPlaying(false) }} /></div>
        <span id="regex-source-label" className={styles.note}>编辑后保存会更新真实 Script，并重新采用；源码原文可直接复制为 MD 文件。</span>
    </details>
    <div className={styles.controls}>
      <Button disabled={!installed || busy} onClick={() => void perform(() => request({ action: 'commit', text: input }))}>完成并持久化</Button>
      <Button disabled={busy} onClick={() => void perform(() => request({ action: 'state' }))}>从 SQLite 重新读取</Button>
      <span className={styles.note}>真实会话：{stored?.sessionId ?? '正在初始化'}</span>
    </div>
    <details className={styles.inspect} open><summary>持久化证据：原始记录 / 显示投影 / 提示词投影</summary>
      <div className={styles.grid}><section><h2>数据库内的最近记录</h2><pre>{stored?.history.slice(-6).map(item => `[${item.kind}] ${item.id}\n${item.text}`).join('\n\n') || '尚未提交输出'}</pre></section>
      <section><h2>最后一条回复的两种投影</h2><pre>显示：{stored?.storedDisplay ?? '—'}</pre><pre>提示词：{stored?.storedPrompt ?? '—'}</pre></section></div>
    </details>
  </main>
}
