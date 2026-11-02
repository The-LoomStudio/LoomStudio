import { useId, useState } from 'react'
import styles from './context-window-info.module.scss'

/** Unknown limits stay unknown; session usage is not the current context size. */
export function ContextWindowInfo() {
  const id = useId()
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || pinned
  return <div className={styles.host} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setPinned(false); setHovered(false) } }}
    onKeyDown={event => { if (event.key === 'Escape') { setPinned(false); setHovered(false); event.stopPropagation() } }}>
    <button type="button" className={styles.trigger} aria-label="上下文信息，0%，暂无统计数据" aria-expanded={open} aria-controls={id}
      onClick={() => { setHovered(false); setPinned(value => !value) }} onFocus={() => setHovered(true)}>
      <svg className={styles.ring} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle className={styles.ringTrack} cx="12" cy="12" r="9" pathLength="100" strokeDasharray="3 5" />
        <circle cx="12" cy="12" r="9" pathLength="100" strokeDasharray="0 100" transform="rotate(-90 12 12)" />
      </svg>
    </button>
    {open && <div id={id} className={styles.panel} role="region" aria-label="上下文信息">
      <strong>上下文窗口</strong>
      <dl><div><dt>当前占用</dt><dd>暂无数据</dd></div><div><dt>模型上限</dt><dd>未知</dd></div><div><dt>会话累计消耗</dt><dd>暂无数据</dd></div></dl>
      <p>累计消耗不等于当前上下文占用。</p>
    </div>}
  </div>
}
