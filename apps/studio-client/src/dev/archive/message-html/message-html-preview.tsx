import { useEffect, useMemo, useState } from 'react'
import { Code2, Pause, Play, RotateCcw, StepForward } from 'lucide-react'
import { MessageContent } from '../../../features/message-content/ui/message-content.js'
import { messageHtmlExamples, nextPreviewStreamOffset } from './message-html-examples.js'
import sceneUrl from './message-html-scene.jpg'
import styles from './message-html-preview.module.scss'

export function MessageHtmlPreview() {
  const [image, setImage] = useState('')
  const [assetError, setAssetError] = useState('')
  const [selected, setSelected] = useState('status')
  const [offset, setOffset] = useState<number | undefined>()
  const [playing, setPlaying] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [draft, setDraft] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    const reader = new FileReader()
    reader.onload = () => setImage(String(reader.result))
    reader.onerror = () => setAssetError('图片样例读取失败')
    void fetch(sceneUrl, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(`图片样例读取失败：${response.status}`)
      return response.blob()
    }).then(blob => { if (!controller.signal.aborted) reader.readAsDataURL(blob) })
      .catch(error => { if (!controller.signal.aborted) setAssetError(String(error)) })
    return () => { controller.abort(); reader.onload = null; reader.onerror = null; reader.abort() }
  }, [])
  const examples = useMemo(() => messageHtmlExamples(image), [image])
  const example = examples.find(item => item.id === selected)!
  const value = draft ?? example.value
  const streaming = offset !== undefined && offset < value.length
  const ready = selected !== 'gallery' || Boolean(image)

  useEffect(() => {
    if (!playing || !streaming) return
    const timer = window.setTimeout(() => {
      const next = nextPreviewStreamOffset(value, offset!)
      setOffset(next)
      if (next === value.length) setPlaying(false)
    }, 50)
    return () => window.clearTimeout(timer)
  }, [playing, streaming, offset, value])

  function choose(id: string) {
    setSelected(id); setOffset(undefined); setPlaying(false); setDraft(undefined)
  }

  return <main className={styles.page}>
    <header className={styles.toolbar}>
      <strong>消息组件</strong>
      <select aria-label="消息样例" value={selected} onChange={event => choose(event.target.value)}>
        {examples.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <div className={styles.actions}>
        <button disabled={!ready} title={playing ? '暂停流式播放' : '播放流式输出'} aria-label={playing ? '暂停流式播放' : '播放流式输出'}
          onClick={() => { if (!streaming) setOffset(0); setPlaying(current => !current) }}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button disabled={!ready || playing} title="下一段" aria-label="下一段"
          onClick={() => setOffset(nextPreviewStreamOffset(value, streaming ? offset! : 0, 256))}><StepForward size={17} /></button>
        <button title="显示完整消息" aria-label="显示完整消息" onClick={() => { setPlaying(false); setOffset(undefined) }}><RotateCcw size={17} /></button>
        <button title="查看源码" aria-label="查看源码" aria-pressed={sourceOpen} onClick={() => setSourceOpen(current => !current)}><Code2 size={17} /></button>
        <label className={styles.width}><input type="checkbox" checked={narrow} onChange={event => setNarrow(event.target.checked)} />窄屏</label>
      </div>
    </header>
    <div className={styles.meta}>
      <span>{example.format}</span>
      <output aria-live="polite" aria-label="播放状态">{playing ? '输出中' : streaming ? '已暂停' : '已完成'}</output>
    </div>
    <progress className={styles.progress} aria-label="输出进度" max={value.length} value={offset ?? value.length} />
    {assetError ? <p role="alert">{assetError}</p> : null}
    {sourceOpen ? <section className={styles.source}>
      {example.raw ? <details><summary>替换前原文</summary><pre>{example.raw}</pre></details> : null}
      <textarea aria-label="消息源码" spellCheck={false} value={value} onChange={event => { setPlaying(false); setOffset(undefined); setDraft(event.target.value) }} />
    </section> : null}
    <section className={`${styles.stage} ${narrow ? styles.narrow : ''}`} aria-label="消息预览">
      <header className={styles.messageHeader}><span className={styles.avatar}>叙</span><div><strong>叙事记录</strong><small>第 12 日 · 21:40</small></div></header>
      {ready ? <MessageContent value={value.slice(0, offset ?? value.length)} streaming={streaming} role="assistant" codeBlockLabels={{
        copy: '复制', copied: '已复制', copyFailed: '复制失败', enableWrap: '换行', disableWrap: '取消换行',
      }} /> : <p role="status">附件载入中</p>}
    </section>
  </main>
}
