import { useState, type ReactNode } from 'react'
import { Tabs } from '@loom-studio/ui'
import { MessageContent } from '../../message-content/ui/message-content.js'
import { messageCodeBlockLabels } from '../../message-content/ui/message-code-block-labels.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './text-rule-preview.module.scss'

/** Shared authoring surface; the caller owns the real projection and persistence boundary. */
export function TextRuleComparison(props: {
  input: string; output: string; onInputChange(value: string): void; streaming?: boolean
  position: number; onPositionChange(value: number): void; disabled?: boolean
  controls?: ReactNode; status?: ReactNode; t: Translator
}) {
  const [view, setView] = useState<'text' | 'render'>('text')
  return <div className={styles.comparison}>
    <section><header><h3>原文本</h3><span>可直接编辑</span></header>
      <textarea aria-label="原文本" value={props.input} disabled={props.disabled} onChange={event => props.onInputChange(event.target.value)} />
      <label className={styles.position}>输入位置 {props.position} / {props.input.length}<input aria-label="流式切片位置" type="range" min={0} max={props.input.length} value={props.position} disabled={props.disabled} onChange={event => props.onPositionChange(Number(event.target.value))} /></label>
    </section>
    <section><header><h3>处理结果</h3><Tabs activeId={view} onChange={setView} ariaLabel="结果查看方式" items={[{ id: 'text', label: '替换文本' }, { id: 'render', label: '原生渲染' }]} /></header>
      <div className={styles.output} data-regex-lab-output="">{view === 'text' ? <pre>{props.output}</pre> : <MessageContent role="assistant" value={props.output} streaming={props.streaming} codeBlockLabels={messageCodeBlockLabels(props.t)} />}</div>
      <div className={styles.status} role="status">{props.status}</div>
    </section>
    <div className={styles.playback}>{props.controls}</div>
  </div>
}
