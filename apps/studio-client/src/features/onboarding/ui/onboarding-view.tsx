import studioLogoUrl from '../../../shared/assets/logo.png'
import { onboardingCopy } from '../model/onboarding-copy.js'
import type { Locale } from '../../../shared/i18n/index.js'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button, UnderlineTabs } from '@loom-studio/ui'
import styles from './onboarding-view.module.scss'

export function OnboardingView(props: {
  locale?: Locale
  busy?: boolean
  step: number
  title: string
  description: string
  children: ReactNode | ((changeStep: (step: number) => void) => ReactNode)
  actions: (changeStep: (step: number) => void) => ReactNode
  completedSteps: number[]
  availableStep: number
  onStepChange: (step: number) => void
  onBack?: () => void
}) {
  const copy = onboardingCopy[props.locale ?? 'zh-CN']
  const logo = useRef<HTMLImageElement>(null)
  const [revealed, setRevealed] = useState(false)
  useLayoutEffect(() => {
    // The welcome logo takes over the initial HTML curtain before the first paint.
    document.getElementById('loom-startup')?.remove()
    const image = logo.current
    if (!image || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRevealed(true)
      return
    }
    const box = image.getBoundingClientRect()
    const x = window.innerWidth / 2 - (box.left + box.width / 2)
    const y = window.innerHeight / 2 - (box.top + box.height / 2)
    const scale = Math.min(260, Math.max(180, window.innerWidth * .2)) / box.width
    const origin = `translate(${x}px, ${y}px) scale(${scale})`
    const animation = image.animate([
      { transform: origin, opacity: 0, offset: 0, easing: 'ease-out' },
      { transform: origin, opacity: 1, offset: .2 },
      { transform: origin, opacity: 1, offset: .6, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 1 },
    ], { duration: 2000, easing: 'linear' })
    const timer = window.setTimeout(() => setRevealed(true), 1600)
    return () => { animation.cancel(); window.clearTimeout(timer) }
  }, [])
  const content = useRef<HTMLElement>(null)
  const transition = useRef<Animation | null>(null)
  const changeStep = async (next: number) => {
    if (props.busy || next === props.step || transition.current) return
    const element = content.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!element || reduced) { props.onStepChange(next); return }
    const fade = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: 'ease-in', fill: 'forwards' })
    transition.current = fade
    try { await fade.finished } catch { return }
    props.onStepChange(next)
  }
  useLayoutEffect(() => {
    const previous = transition.current
    if (!previous) return
    previous.cancel()
    const fade = content.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' })
    transition.current = fade ?? null
    if (fade) void fade.finished.then(() => { if (transition.current === fade) transition.current = null }, () => {})
  }, [props.step])
  useEffect(() => () => { transition.current?.cancel() }, [])
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (revealed) title.current?.focus({ preventScroll: true }) }, [props.step, revealed])
  return <main className={styles.page}>
    <div className={styles.layout}>
      <aside className={styles.intro}>
        <img ref={logo} src={studioLogoUrl} alt="Loom Studio" />
        <div className={styles.introText} data-visible={revealed} inert={!revealed}>
        <p>{copy.tagline}</p>

        </div>
      </aside>
      <div className={styles.reveal} data-visible={revealed} inert={!revealed}>
      <UnderlineTabs className={styles.steps} size="compact" ariaLabel={copy.stepsLabel}
        activeId={String(props.step)} onChange={id => { void changeStep(Number(id)) }}
        items={copy.steps.map((label, index) => ({
          id: String(index), disabled: props.busy || index > props.availableStep,
          ariaLabel: `${label}${props.completedSteps.includes(index) ? ` · ${copy.done}` : ''}`,
          label: <span className={props.completedSteps.includes(index) ? styles.completed : undefined}>{props.completedSteps.includes(index) ? '✓ ' : `${index + 1}. `}{label}</span>,
        }))} />
      <section ref={content} className={styles.content} role="tabpanel" aria-label={props.title}>
        <h1 ref={title} tabIndex={-1}>{props.title}</h1>
        <p className={styles.description}>{props.description}</p>
        <div className={styles.body}>{typeof props.children === 'function' ? props.children(next => { void changeStep(next) }) : props.children}</div>
        <footer className={styles.actions}>{props.onBack ? <Button disabled={props.busy} onClick={() => { void changeStep(props.step - 1) }}>{copy.back}</Button> : null}<div>{props.actions(next => { void changeStep(next) })}</div></footer>
      </section>

      </div>
    </div>
  </main>
}
