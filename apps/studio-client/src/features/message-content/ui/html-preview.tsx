import { useLayoutEffect, useRef, useState } from 'react'
import { SkeletonText } from '@loom-studio/ui'
import { buildHtmlDocument, readHtmlHeight } from '../model/html-document.js'
import { mountIsolatedFrame } from '../../../shared/iframe-runtime/frame-lifecycle.js'
import { htmlHeightCache } from '../model/html-layout.js'
import styles from './message-content.module.scss'

export function HtmlPreview(props: { value: string }) {
  const root = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<{ value: string; message: string }>()
  useLayoutEffect(() => {
    setFailure(undefined)
    setReady(false)
    const element = root.current!
    function cacheKey() {
      const html = document.documentElement
      const theme = [html.className, html.getAttribute('style'), html.getAttribute('data-theme'),
        getComputedStyle(html).colorScheme, window.matchMedia('(prefers-color-scheme: dark)').matches]
      return JSON.stringify([props.value, element.clientWidth, theme])
    }
    let height = htmlHeightCache.read(cacheKey()) ?? 240
    element.style.height = `${height}px`
    let instance: ReturnType<typeof mountIsolatedFrame> | undefined
    const applySize = () => {
      if (!instance) return
      instance.frame.style.height = `${height}px`
      element.style.height = `${height}px`
    }
    let mountFrame = 0
    // Let the message shell paint at its reserved height before creating the iframe.
    const layoutFrame = requestAnimationFrame(() => {
      mountFrame = requestAnimationFrame(() => {
        const token = crypto.randomUUID()
        instance = mountIsolatedFrame(element, {
          title: 'HTML',
          source: { html: buildHtmlDocument(props.value, token) },
          onLoad: frame => { frame.markReady(); frame.frame.inert = false; setReady(true) },
          onMessage: data => {
            const measured = readHtmlHeight(data, token)
            if (measured === undefined) return
            height = measured
            htmlHeightCache.write(cacheKey(), height)
            instance?.markReady()
            if (instance) instance.frame.inert = false
            applySize()
            setReady(true)
          },
          onFailure: message => {
            element.style.height = ''
            setFailure({ value: props.value, message })
          },
        })
        instance.frame.className = styles.preview
        instance.frame.inert = true
        applySize()
      })
    })
    return () => {
      cancelAnimationFrame(layoutFrame)
      cancelAnimationFrame(mountFrame)
      instance?.dispose()
    }
  }, [props.value])
  return <div className={styles.previewShell} data-loom-html-preview="" data-ready={ready || undefined}>
    <div className={styles.previewViewport} aria-busy={!ready && !failure}>
      <div ref={root} />
      {!ready && !failure ? <div className={styles.previewSkeleton}><SkeletonText lines={4} /></div> : null}
    </div>
    {failure?.value === props.value ? <p role="alert">{failure.message}</p> : null}
  </div>
}
