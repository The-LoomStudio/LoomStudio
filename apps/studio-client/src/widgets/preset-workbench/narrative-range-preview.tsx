import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { StudioApi } from '../../shared/api/studio-api.js'
import styles from './preset-workbench.module.scss'

type Preview = Awaited<ReturnType<StudioApi['narratives']['getEffectivePreview']>>

export function NarrativeRangePreview(props: {
  api: StudioApi['narratives']
  timelineId?: string
  branchId?: string
}) {
  const [result, setResult] = useState<Preview>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    requestId.current++
    setResult(undefined)
    setError(undefined)
    setBusy(false)
  }, [props.timelineId, props.branchId])

  async function load() {
    if (!props.timelineId || !props.branchId) return
    const request = ++requestId.current
    setBusy(true)
    setError(undefined)
    try {
      const preview = await props.api.getEffectivePreview({ timelineId: props.timelineId, branchId: props.branchId })
      if (request === requestId.current) setResult(preview)
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (request === requestId.current) setBusy(false)
    }
  }

  return <section className={styles.anchorPreview} aria-label="Narrative 有效范围预览">
    <h3>Narrative 有效范围</h3>
    <p>当前 Timeline / Branch 的已发布范围；不是本轮 PromptBuild 或关键词激活结果。</p>
    {props.timelineId && props.branchId ? <>
      <button className={styles.previewLoad} type="button" disabled={busy} onClick={() => void load()}>{busy ? '读取中…' : '查看有效范围'}</button>
    </> : <p role="status">当前没有明确的 Timeline / Branch。</p>}
    {error ? <p role="alert">{error}</p> : null}
    {result ? <div className={styles.previewResult}>
      <p className={styles.previewScope}>{result.sourceId === 'runtime.recent-100'
        ? '未发布 Narrative 范围，当前显示最近 100 个节点的采样。'
        : `本次预览 · ${result.memory.length} 条 Memory · ${result.nodes.length} 条原文`}</p>
      {result.memory.map((entry, index) => <details className={styles.previewFragment} key={entry.id}>
        <summary><ChevronRight aria-hidden="true" />Memory {index + 1}</summary><pre>{entry.content}</pre>
      </details>)}
      {result.nodes.map((node, index) => <details className={styles.previewFragment} key={node.id}>
        <summary><ChevronRight aria-hidden="true" />原文 {index + 1}</summary><pre>{node.text}</pre>
      </details>)}
      {!result.complete ? <p role="status">仅显示范围末端最多 40 个节点；更早内容未在此视图加载。</p> : null}
    </div> : null}
  </section>
}
