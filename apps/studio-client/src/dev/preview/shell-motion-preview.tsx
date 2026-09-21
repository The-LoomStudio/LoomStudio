import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { BookOpen, ChevronRight, FileText, MessageSquare, PanelLeft, PanelRight, Send, Settings2, X } from 'lucide-react'
import styles from './shell-motion-preview.module.scss'

export function ShellMotionPreview() {
  const [panels, setPanels] = useState({ left: false, right: false })
  const [duration, setDuration] = useState(320)
  const [enabled, setEnabled] = useState(true)
  const contentRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLElement>(null)
  const rightRef = useRef<HTMLElement>(null)
  const animations = useRef<Animation[]>([])

  useEffect(() => () => animations.current.forEach(animation => animation.cancel()), [])

  function changePanels(next: typeof panels) {
    const content = contentRef.current
    const sides = [leftRef.current, rightRef.current]
    if (!content || sides.some(side => !side)) return
    // Read the in-flight presentation before cancelling, so rapid reversals stay continuous.
    const first = content.getBoundingClientRect()
    const firstTransforms = sides.map(side => getComputedStyle(side!).transform)
    animations.current.forEach(animation => animation.cancel())
    animations.current = []
    flushSync(() => setPanels(next))
    const last = content.getBoundingClientRect()
    const lastTransforms = sides.map(side => getComputedStyle(side!).transform)
    if (!enabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const opening = (!panels.left && next.left) || (!panels.right && next.right)
    const timing = {
      duration: opening ? duration : Math.round(duration * 0.75),
      easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
    }
    animations.current.push(content.animate([
      { transform: `translate(${first.left - last.left}px, ${first.top - last.top}px)` },
      { transform: 'translate(0, 0)' },
    ], timing))
    sides.forEach((side, index) => {
      animations.current.push(side!.animate([
        { transform: firstTransforms[index] },
        { transform: lastTransforms[index] },
      ], timing))
    })
  }

  return (
    <main className={styles.page}>
      <header className={styles.toolbar}>
        <strong>Shell / Motion Study</strong>
        <label className={styles.speed}>
          <span>入场</span>
          <input aria-label="入场时长" type="range" min={180} max={500} step={20} value={duration} onChange={event => setDuration(Number(event.target.value))} />
          <output>{duration} ms</output>
        </label>
        <label className={styles.switch}>
          <input type="checkbox" checked={enabled} onChange={event => {
            setEnabled(event.target.checked)
            animations.current.forEach(animation => animation.cancel())
          }} />
          动画
        </label>
        <button type="button" onClick={() => changePanels({ left: !panels.left, right: !panels.right })}>切换双栏</button>
      </header>
      <div className={styles.stage} data-left={panels.left} data-right={panels.right}>
        <nav className={styles.rail} aria-label="主导航">
          <img src="/images/logo.png" alt="LoomStudio" />
          <button type="button" aria-label="资源侧栏" title="资源侧栏" aria-expanded={panels.left} onClick={() => changePanels({ ...panels, left: !panels.left })}><PanelLeft /></button>
          <span><MessageSquare /></span>
          <span><BookOpen /></span>
          <span className={styles.railBottom}><Settings2 /></span>
        </nav>
        <div className={styles.center}>
          <div ref={contentRef} className={styles.reading}>
            <header className={styles.chapter}><small>LOOMSTUDIO / NARRATIVE</small><h1>雨停之前</h1><span>第十二幕 · 旧城车站</span></header>
            <article className={styles.message}>
              <div className={styles.author}><img src="/images/default-card.png" alt="" /><strong>林间</strong><small>19:42</small></div>
              <p>站台的灯亮了。雨水顺着屋檐落下，在铁轨边积成一条细细的河。</p>
              <p>她把车票折好，放回外套口袋。广播里传来列车延误的消息，声音被雨声打散，听不太清楚。</p>
              <p>“那就再等一会儿。”她往旁边挪了挪，留出一个座位。</p>
            </article>
            <div className={styles.reply}>我收起伞，在她身旁坐下。</div>
            <article className={styles.message}><div className={styles.author}><strong>林间</strong><small>19:43</small></div><p>她没有立刻说话，只是把手里的热咖啡往你这边推了一点。远处的信号灯由红转绿。</p></article>
            <div className={styles.composer}><span>接下来发生什么……</span><Send size={18} /></div>
          </div>
        </div>
        <div className={`${styles.sideClip} ${styles.leftClip}`}>
          <aside ref={leftRef} className={`${styles.side} ${styles.left}`} inert={!panels.left} aria-label="资源目录">
            <header><strong>资源</strong><button type="button" aria-label="收起左栏" title="收起左栏" onClick={() => changePanels({ ...panels, left: false })}><X /></button></header>
            <div className={styles.collection}><BookOpen size={16} /><strong>旧城纪事</strong><small>24</small></div>
            {['世界背景', '旧城车站', '角色与关系', '雨季', '列车时刻', '街道与建筑', '未寄出的信'].map((label, index) => <div className={styles.treeRow} data-selected={index === 1} key={label}><FileText size={15} /><span>{label}</span><ChevronRight size={13} /></div>)}
            <footer>世界书 · 旧城纪事</footer>
          </aside>
        </div>
        <div className={`${styles.sideClip} ${styles.rightClip}`}>
          <aside ref={rightRef} className={`${styles.side} ${styles.right}`} inert={!panels.right} aria-label="Agent 侧栏">
            <header><strong>Agent</strong><button type="button" aria-label="收起右栏" title="收起右栏" onClick={() => changePanels({ ...panels, right: false })}><X /></button></header>
            <div className={styles.agentBody}><small>当前会话</small><h2>场景协作</h2><p>故事停留在旧城车站。两位角色正在等待一班晚点的列车。</p><hr /><small>上下文</small><dl><dt>场景</dt><dd>旧城车站</dd><dt>时间</dt><dd>傍晚 · 雨季</dd><dt>状态</dt><dd>等待下一步</dd></dl></div>
            <footer>Draft · Narrative Agent</footer>
          </aside>
        </div>
        <button className={styles.rightToggle} type="button" aria-label="Agent 侧栏" title="Agent 侧栏" aria-expanded={panels.right} onClick={() => changePanels({ ...panels, right: !panels.right })}><PanelRight /></button>
      </div>
    </main>
  )
}
