import { useEffect, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { Dialog, IconButton } from '@loom-studio/ui'
import { parseResourceLink } from '@loom-studio/shared'
import { loadEntityReference, type EntityReferenceView } from './entity-reference-model.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { loadResourceReference, type ReferenceView } from './reference-model.js'
import styles from './resource-reference-dialog.module.scss'

export function ResourceReferenceDialog(props: {
  api: StudioApi
  onOpenEditor(target: NonNullable<ReferenceView['editor']>): void
  uri?: string
  onClose(): void
  onNavigate(uri: string): void
}) {
  const uri = props.uri
  const selected = useRef<HTMLSpanElement>(null)
  const [result, setResult] = useState<{ uri: string; view?: ReferenceView; entity?: EntityReferenceView; error?: string }>()

  useEffect(() => {
    if (!uri) return
    let active = true
    const reference = parseResourceLink(uri)
    if (reference?.kind === 'entity') {
      void loadEntityReference(props.api, reference).then(
        entity => { if (active) setResult({ uri, entity }) },
        error => { if (active) setResult({ uri, error: error instanceof Error ? error.message : '无法打开资源引用。' }) },
      )
    } else {
      void loadResourceReference(props.api, uri).then(
        view => { if (active) setResult({ uri, view }) },
        error => { if (active) setResult({ uri, error: error instanceof Error ? error.message : '无法打开资源引用。' }) },
      )
    }
    return () => { active = false }
  }, [uri, props.api])

  const current = result?.uri === uri ? result : undefined
  const view = current?.view
  useEffect(() => { selected.current?.scrollIntoView({ block: 'center' }) }, [view])

  if (!uri) return null
  return (
    <Dialog open onClose={props.onClose} className={styles.dialog} title={current?.entity?.title ?? view?.title ?? '资源引用'}
      headerActions={<>
        {view?.editor ? <IconButton title="打开编辑器" aria-label="打开编辑器" onClick={() => props.onOpenEditor(view.editor!)}><ExternalLink size={16} /></IconButton> : null}
        <IconButton title="关闭" aria-label="关闭" onClick={props.onClose}><X size={18} /></IconButton>
      </>}>
      <div className={styles.content}>
          {view?.path ? <div className={styles.path} title={view.path}>{view.path}</div> : null}
          {view ? <div className={styles.status}>{!view.exact
            ? '资源版本已变化 · 显示当前内容'
            : view.range ? `第 ${view.range.startLine}–${view.range.endLine} 行 · 引用版本一致`
              : '引用行范围无效 · 未定位'}</div> : null}
        {!current ? <p role="status">正在读取…</p> : current.error ? <p role="alert">{current.error}</p> : null}
        {current?.entity && <div className={styles.entity}>
          {current.entity.avatarUrl && <img src={current.entity.avatarUrl} alt="" />}
          <div><strong>{current.entity.title}</strong>{current.entity.note && <p>{current.entity.note}</p>}</div>
          {current.entity.uri && <button type="button" onClick={() => props.onNavigate(current.entity!.uri!)}><ExternalLink size={16} />打开</button>}
        </div>}
        {view ? <div className={styles.body} tabIndex={0}>
          {view.body.split('\n').map((line, index) => <span
            key={index}
            ref={view.range?.startLine === index + 1 ? selected : undefined}
            data-selected={Boolean(view.range && index + 1 >= view.range.startLine && index + 1 <= view.range.endLine)}
          ><span className={styles.number} aria-hidden="true">{index + 1}</span><code>{line || '\u00a0'}</code></span>)}
        </div> : null}
      </div>
    </Dialog>
  )
}
