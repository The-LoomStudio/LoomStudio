import { createId } from '@loom-studio/shared'
import { useLayoutEffect, useRef, useState } from 'react'
import { SkeletonText } from '@loom-studio/ui'
import { buildHtmlDocument, readHtmlHeight } from '../model/html-document.js'
import { mountIsolatedFrame } from '../../../shared/iframe-runtime/frame-lifecycle.js'
import { htmlHeightCache } from '../model/html-layout.js'
import styles from './message-content.module.scss'

export function HtmlPreview(props: { value: string }) {
  const root = useRef<HTMLDivElement>(null)
  const active = useRef<{ dispose(): void } | undefined>(undefined)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => () => { active.current?.dispose(); active.current = undefined }, [])
  const [failure, setFailure] = useState<{ value: string; message: string }>()
  useLayoutEffect(() => {
    setFailure(undefined)
    if (!active.current) setReady(false)
    const element = root.current!
    function cacheKey() {
      const html = document.documentElement
      const theme = [html.className, html.getAttribute('style'), html.getAttribute('data-theme'),
        getComputedStyle(html).colorScheme, window.matchMedia('(prefers-color-scheme: dark)').matches]
      return JSON.stringify([props.value, element.clientWidth, theme])
    }
    let height = htmlHeightCache.read(cacheKey()) ?? (element.getBoundingClientRect().height || 240)
    element.style.height = `${height}px`
    // Keep the last painted document until its replacement has measured itself.
    // This avoids flashing the loading skeleton for each streaming snapshot;
    // arbitrary author scripts still restart (this is not a live CTX update).
    const staging = document.createElement('div')
    staging.style.cssText = 'position:absolute;inset:0;opacity:0;pointer-events:none'
    element.append(staging)
    let committed = false
    let instance: ReturnType<typeof mountIsolatedFrame> | undefined
    const candidate = { dispose() { instance?.dispose(); staging.remove() } }
    const applySize = () => {
      if (!instance) return
      // Animate only the host reservation. Animating the iframe viewport would
      // repeatedly reflow its document and feed intermediate sizes back here.
      instance.frame.style.height = `${height}px`
      element.style.height = `${height}px`
    }
    let mountFrame = 0
    // Let the message shell paint at its reserved height before creating the iframe.
    const layoutFrame = requestAnimationFrame(() => {
      mountFrame = requestAnimationFrame(() => {
        try {
          const token = createId()
          instance = mountIsolatedFrame(staging, {
            title: 'HTML',
            source: { html: buildHtmlDocument(props.value, token) },
            onLoad: frame => { frame.markReady() },
            onMessage: data => {
              const measured = readHtmlHeight(data, token)
              if (measured === undefined) return
              if (!committed) {
                active.current?.dispose()
                active.current = candidate
                committed = true
                staging.style.cssText = ''
              }
              height = measured
              htmlHeightCache.write(cacheKey(), height)
              instance?.markReady()
              if (instance) instance.frame.inert = false
              applySize()
              setReady(true)
            },
            onFailure: message => {
              if (!active.current) element.style.height = ''
              setFailure({ value: props.value, message })
            },
          })
          instance.frame.className = styles.preview
          if (active.current) instance.frame.style.animation = 'none'
          instance.frame.inert = true
          applySize()
        } catch (error) {
          candidate.dispose()
          if (!active.current) element.style.height = ''
          setFailure({ value: props.value, message: error instanceof Error ? error.message : String(error) })
        }
      })
    })
    return () => {
      cancelAnimationFrame(layoutFrame)
      cancelAnimationFrame(mountFrame)
      if (!committed) candidate.dispose()
    }
  }, [props.value])
  return <div className={styles.previewShell} data-loom-html-preview="" data-ready={ready || undefined}>
    <div className={styles.previewViewport} aria-busy={!ready && !failure}>
      <div ref={root} className={styles.previewReservation} />
      {!ready && !failure ? <div className={styles.previewSkeleton}><SkeletonText lines={4} /></div> : null}
    </div>
    {failure?.value === props.value ? <p role="alert">{failure.message}</p> : null}
  </div>
}
