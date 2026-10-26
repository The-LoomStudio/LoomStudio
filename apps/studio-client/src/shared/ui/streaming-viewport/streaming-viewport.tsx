import { useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useSmoothFollow } from './use-smooth-follow.js'
import styles from './streaming-viewport.module.scss'

export function StreamingViewport({ children, label, active = true, onInspect, className }: {
  children: ReactNode
  label: string
  active?: boolean
  onInspect?(): void
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const follow = useSmoothFollow({ scrollRef, contentRef, enabled: active })
  return <div className={styles.shell}>
    <div ref={scrollRef} className={`${styles.viewport} ${className ?? ''}`} tabIndex={active ? 0 : -1}
      role="region" aria-label={label} onWheel={event => { event.stopPropagation(); if (event.deltaY < 0) onInspect?.() }}
      onTouchMove={event => { event.stopPropagation(); onInspect?.() }} onKeyDown={event => event.stopPropagation()}
      onFocus={() => onInspect?.()}>
      <div ref={contentRef}>{children}</div>
    </div>
    {!follow.following && active && <button type="button" className={styles.latest} onClick={follow.resume}>
      <ChevronDown aria-hidden="true" />回到最新
    </button>}
  </div>
}
