import { InfoDialog } from '../../../shared/ui/info-dialog/info-dialog.js'
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ScriptPreviewInput, ScriptPreviewResult } from './loom-script-source-fields.js'
import { TextRuleComparison } from './text-rule-comparison.js'
import styles from './text-rule-preview.module.scss'

export function TextRulePreviewDialog(props: {
  source: string; name: string; onClose(): void; t: Translator
  onPreview(input: ScriptPreviewInput): Promise<ScriptPreviewResult>
}) {
  const [input, setInput] = useState('')
  const [position, setPosition] = useState(0)
  const [phase, setPhase] = useState<ScriptPreviewInput['phase']>('display')
  const [playing, setPlaying] = useState(false)
  const [result, setResult] = useState<ScriptPreviewResult>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const request = useRef(0)
  const streaming = phase === 'display' && position < input.length
  useEffect(() => {
    const ticket = ++request.current
    setPending(true)
    const timer = setTimeout(() => {
      void props.onPreview({ source: props.source, text: input.slice(0, position), phase, streaming })
        .then(value => { if (ticket === request.current) { setResult(value); setError('') } })
        .catch(cause => { if (ticket === request.current) { setError(cause instanceof Error ? cause.message : String(cause)); setResult(undefined); setPlaying(false) } })
        .finally(() => { if (ticket === request.current) setPending(false) })
    }, 100)
    return () => { clearTimeout(timer); request.current++ }
  }, [props.source, props.onPreview, input, position, phase, streaming])
  useEffect(() => {
    if (!playing || pending) return
    if (position >= input.length) { setPlaying(false); return }
    const timer = setTimeout(() => setPosition(value => value + ([...input.slice(value)][0]?.length ?? 0)), 70)
    return () => clearTimeout(timer)
  }, [playing, pending, position, input])
  return <Dialog open layout="workbench" className={styles.dialog} title={`实时预览 · ${props.name}`} onClose={props.onClose}>
    <div className={styles.body}>
      <div className={styles.toolbar}><InfoDialog title="匹配与提取结果"><pre>{JSON.stringify({ matches: result?.matches ?? [], extractions: result?.extractions ?? [] }, null, 2)}</pre></InfoDialog><label>处理阶段 <select value={phase} onChange={event => { setPhase(event.target.value as typeof phase); setPlaying(false); setPosition(input.length) }}><option value="display">显示</option><option value="prompt">提示词</option><option value="classify">保存时处理（预览）</option></select></label><span className={styles.note}>使用当前编辑源码与默认配置；不保存、不启用、不修改聊天记录。</span></div>
      <TextRuleComparison input={input} output={result?.output ?? ''} position={position} streaming={streaming} t={props.t}
        onInputChange={value => { setInput(value); setPosition(value.length); setPlaying(false) }}
        onPositionChange={value => { setPosition(value); setPlaying(false) }}
        status={pending ? '正在处理…' : `${streaming ? '流式快照' : '完整输入'} · 命中 ${result?.matches.length ?? 0} 次`}
        controls={<><Button disabled={phase !== 'display' || !input} onClick={() => { if (position >= input.length) setPosition(0); setPlaying(value => !value) }}>{playing ? '暂停' : '播放流式'}</Button><Button disabled={!input} onClick={() => { setPlaying(false); setPosition(0) }}>回到开头</Button><Button disabled={!input} onClick={() => { setPlaying(false); setPosition(input.length) }}>跳到结束</Button><span className={styles.note}>流式时只执行声明了 streaming 的显示规则。</span></>} />
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {result?.diagnostics.map((item, index) => <p key={index} className={styles.error}>{item.message}</p>)}
      
    </div>
  </Dialog>
}
