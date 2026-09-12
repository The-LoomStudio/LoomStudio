import { Copy, Download, Maximize, Scan, Share2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Translator } from '../../i18n/index.js'
import { Dialog } from '../dialog/dialog.js'
import { constrainImage, fitImage, zoomImage, type ImageTransform, type Size } from './image-transform.js'
import styles from './image-viewer.module.scss'

type Props = { title: string; src?: string; fileName: string; error?: string; onClose(): void; t: Translator }
type Point = { x: number; y: number }

export function ImageViewer(props: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const [viewport, setViewport] = useState<Size>({ width: 1, height: 1 })
  const [image, setImage] = useState<Size>()
  const [transform, setTransform] = useState<ImageTransform>({ scale: 1, x: 0, y: 0 })
  const [imageError, setImageError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [shareFile, setShareFile] = useState<File>()
  const ready = Boolean(image && !imageError && !props.error)
  const fit = image ? fitImage(image, viewport).scale : 1
  const minScale = fit / 4
  const maxScale = Math.max(8, fit * 8)

  useEffect(() => {
    if (!props.src || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return
    const controller = new AbortController()
    setShareFile(undefined)
    void fetch(props.src, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const file = new File([await response.blob()], props.fileName, { type: response.headers.get('content-type') ?? 'application/octet-stream' })
      if (!controller.signal.aborted && navigator.canShare({ files: [file] })) setShareFile(file)
    }).catch(error => {
      if (!controller.signal.aborted) setNotice(`${props.t('media.actionFailed')}: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => controller.abort()
  }, [props.src, props.fileName, props.t])

  useEffect(() => {
    const element = viewportRef.current!
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { if (image) setTransform(fitImage(image, viewport)) }, [image, viewport])

  function zoom(scale: number, point: Point = { x: 0, y: 0 }) {
    if (!image) return
    setTransform(current => zoomImage(current, Math.max(minScale, Math.min(maxScale, scale)), point, image, viewport))
  }
  function point(clientX: number, clientY: number): Point {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!image || !pointers.current.has(event.pointerId)) return
    const before = [...pointers.current.values()]
    pointers.current.set(event.pointerId, point(event.clientX, event.clientY))
    const after = [...pointers.current.values()]
    setTransform(current => {
      if (before.length === 1) return constrainImage({ ...current, x: current.x + after[0]!.x - before[0]!.x, y: current.y + after[0]!.y - before[0]!.y }, image, viewport)
      const center = (points: Point[]) => ({ x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 })
      const distance = (points: Point[]) => Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)
      const oldDistance = distance(before)
      if (!oldDistance) return current
      const oldCenter = center(before)
      const newCenter = center(after)
      const scaled = zoomImage(current, Math.max(minScale, Math.min(maxScale, current.scale * distance(after) / oldDistance)), oldCenter, image, viewport)
      return constrainImage({ ...scaled, x: scaled.x + newCenter.x - oldCenter.x, y: scaled.y + newCenter.y - oldCenter.y }, image, viewport)
    })
  }
  // A non-passive listener keeps wheel zoom inside the image viewport, including trackpad pinch.
  useEffect(() => {
    const element = viewportRef.current!
    const wheel = (event: WheelEvent) => {
      if (!image) return
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1)
      setTransform(current => zoomImage(current, Math.max(minScale, Math.min(maxScale, current.scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01))), point(event.clientX, event.clientY), image, viewport))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [image, viewport, minScale, maxScale])

  async function png(): Promise<Blob> {
    const element = imageRef.current!
    const canvas = document.createElement('canvas')
    canvas.width = element.naturalWidth
    canvas.height = element.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error(props.t('media.actionFailed'))
    context.drawImage(element, 0, 0)
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(props.t('media.actionFailed'))), 'image/png'))
  }
  async function action(kind: 'copy' | 'save' | 'share') {
    if (!ready || busy) return
    setBusy(true)
    setNotice('')
    try {
      if (kind === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })])
        setNotice(props.t('media.copied'))
      } else if (kind === 'share') {
        if (!shareFile) throw new Error(props.t('media.shareUnsupported'))
        await navigator.share({ files: [shareFile], title: props.title })
      } else {
        const response = await fetch(props.src!)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = props.fileName
        link.click()
        // Keep the object URL alive until the browser has consumed the download navigation.
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice(`${props.t('media.actionFailed')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }
  const button = (label: Parameters<Translator>[0], icon: React.ReactNode, onClick: () => void, disabled = false) => <button type="button" title={props.t(label)} aria-label={props.t(label)} disabled={disabled} onClick={onClick}>{icon}</button>
  return <Dialog open layout="media" title={props.title} onClose={props.onClose} headerActions={<div className={styles.toolbar}>
    {button('media.zoomIn', <ZoomIn />, () => zoom(transform.scale * 1.25), !ready || transform.scale >= maxScale)}
    {button('media.zoomOut', <ZoomOut />, () => zoom(transform.scale / 1.25), !ready || transform.scale <= minScale)}
    <output className={styles.scale}>{Math.round(transform.scale * 100)}%</output>
    {button('media.fit', <Maximize />, () => image && setTransform(fitImage(image, viewport)), !ready)}
    {button('media.original', <Scan />, () => zoom(1), !ready)}
    <span className={styles.separator} />
    {typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function' ? button('media.copy', <Copy />, () => void action('copy'), !ready || busy) : null}
    {button('media.save', <Download />, () => void action('save'), !ready || busy)}
    {shareFile ? button('media.share', <Share2 />, () => void action('share'), !ready || busy) : null}
    {button('media.close', <X />, props.onClose)}
  </div>}>
    <div ref={viewportRef} className={styles.viewport} tabIndex={0} role="region" aria-label={props.title}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') { event.preventDefault(); void action('copy') }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(transform.scale * 1.25) }
        else if (event.key === '-') { event.preventDefault(); zoom(transform.scale / 1.25) }
        else if (event.key === '0' && image) { event.preventDefault(); setTransform(fitImage(image, viewport)) }
      }}
      onDoubleClick={() => image && setTransform(fitImage(image, viewport))}
      onPointerDown={event => { if (!ready || event.button !== 0 || pointers.current.size >= 2) return; event.currentTarget.focus(); pointers.current.set(event.pointerId, point(event.clientX, event.clientY)); event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={pointerMove} onPointerUp={event => pointers.current.delete(event.pointerId)} onPointerCancel={event => pointers.current.delete(event.pointerId)} onLostPointerCapture={event => pointers.current.delete(event.pointerId)}>
      {props.src ? <img ref={imageRef} crossOrigin="anonymous" draggable={false} alt={props.title} src={props.src} onLoad={event => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setImageError(props.t('media.loadFailed'))}
        style={{ width: image?.width, height: image?.height, visibility: ready ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} /> : null}
      {props.error || imageError ? <p className={styles.message} role="alert">{props.error || imageError}</p> : !ready ? <p className={styles.message} role="status">{props.t('directory.loading')}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    </div>
  </Dialog>
}
