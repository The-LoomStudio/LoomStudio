import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ExternalLink, X } from 'lucide-react'
import { parseResourceLink } from '@loom-studio/shared'
import { loadEntityReference, type EntityReferenceView } from './entity-reference-model.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { loadResourceReference, type ReferenceView } from './reference-model.js'
import styles from './resource-reference-dialog.module.scss'

export function ResourceReferenceDialog(props: { api: StudioApi; onOpenEditor(target: NonNullable<ReferenceView['editor']>): void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const uri = new URLSearchParams(location.search).get('resourceRef')
  const dialog = useRef<HTMLDialogElement>(null)
  const selected = useRef<HTMLSpanElement>(null)
  const [result, setResult] = useState<{ uri: string; view?: ReferenceView; entity?: EntityReferenceView; error?: string }>()

  useEffect(() => {
    const handle = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail?.uri
      if (typeof value !== 'string' || !parseResourceLink(value)) return
      const search = new URLSearchParams(location.search)
      search.set('resourceRef', value)
      navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash })
    }
    window.addEventListener('loom:open-reference', handle)
    return () => window.removeEventListener('loom:open-reference', handle)
  }, [location.pathname, location.search, location.hash, navigate])

  useEffect(() => {
    if (!uri) return
    let active = true
    if (!dialog.current?.open) dialog.current?.showModal()
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
    return () => { active = false; dialog.current?.close() }
  }, [uri, props.api])

  const current = result?.uri === uri ? result : undefined
  const view = current?.view
  useEffect(() => { selected.current?.scrollIntoView({ block: 'center' }) }, [view])

  function close() {
    const search = new URLSearchParams(location.search)
    search.delete('resourceRef')
    navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash }, { replace: true })
  }

  if (!uri) return null
  return (
    <dialog ref={dialog} className={styles.dialog} aria-label="资源引用" onCancel={event => { event.preventDefault(); close() }}>
      <header>
        <strong>{current?.entity?.title ?? view?.title ?? '资源引用'}</strong>
        {view?.editor ? <button type="button" title="打开编辑器" aria-label="打开编辑器" onClick={() => {
          close()
          props.onOpenEditor(view.editor!)
        }}><ExternalLink size={16} /></button> : null}
        <button type="button" title="关闭" aria-label="关闭" onClick={close}><X size={18} /></button>
      </header>
      {!current ? <p role="status">正在读取…</p> : current.error ? <p role="alert">{current.error}</p> : null}
      {current?.entity && <div className={styles.entity}>
        {current.entity.avatarUrl && <img src={current.entity.avatarUrl} alt="" />}
        <div><strong>{current.entity.title}</strong>{current.entity.note && <p>{current.entity.note}</p>}</div>
        {current.entity.href && <button type="button" onClick={() => navigate(current.entity!.href!)}><ExternalLink size={16} />打开</button>}
      </div>}
      {view ? <>
        <p role="status">{!view.exact
          ? '资源版本已变化。以下为当前内容，未按旧行号定位。'
          : view.range ? `第 ${view.range.startLine}–${view.range.endLine} 行 · 引用版本一致`
            : '引用行范围无效，已打开资源，未定位。'}</p>
        <div className={styles.body} tabIndex={0}>
          {view.body.split('\n').map((line, index) => <span
            key={index}
            ref={view.range?.startLine === index + 1 ? selected : undefined}
            data-selected={Boolean(view.range && index + 1 >= view.range.startLine && index + 1 <= view.range.endLine)}
          ><span className={styles.number} aria-hidden="true">{index + 1}</span><code>{line || '\u00a0'}</code></span>)}
        </div>
      </> : null}
    </dialog>
  )
}
