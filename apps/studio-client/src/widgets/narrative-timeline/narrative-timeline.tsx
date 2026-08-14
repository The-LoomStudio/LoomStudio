import { Check, Copy, GitBranch, Link, Pencil, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import {
  NarrativeTimelineNavigator,
  type NarrativeTimelineNavigatorItem,
} from './narrative-timeline-navigator.js'
import { createMockNarrativeTimelineMarkers } from './narrative-timeline-navigator-model.js'
import { LongTextEditor } from '../../shared/ui/long-text-editor/long-text-editor.js'
import { SkeletonText } from '../../shared/ui/skeleton/skeleton.js'
import styles from './narrative-timeline.module.scss'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../shared/ui/conversation-markdown/conversation-markdown.js')
  return { default: module.ConversationMarkdown }
})

const MESSAGE_EDITOR_MIN_HEIGHT = 132

type NarrativeEntryView = {
  id: string
  version: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  branchId: string
  parentEntryId?: string
  runId?: string
}

type NarrativeTimelineProps = {
  anchorEntryId?: string
  busy: boolean
  composerExpanded: boolean
  composerHeight: number
  emptyTimelineText: string
  getEntryLink: (entryId: string) => string
  onEditEntry: (entryId: string, content: string) => void
  onEntryAnchorChange: (entryId: string) => void
  onForkEntry: (entry: NarrativeEntryView) => void
  t: Translator
  timeline: NarrativeEntryView[]
}

export function NarrativeTimeline(props: NarrativeTimelineProps) {
  const [editingId, setEditingId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [editorMinHeight, setEditorMinHeight] = useState(0)
  const [messageMotion, setMessageMotion] = useState<{ id: string; direction: 'to-edit' | 'to-read' }>()
  const [copyState, setCopyState] = useState<{ id: string; status: 'copied' | 'failed' }>()
  const [linkCopyState, setLinkCopyState] = useState<{ id: string; status: 'copied' | 'failed' }>()
  const [activeEntryId, setActiveEntryId] = useState(props.timeline[0]?.id)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const linkCopyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const handledAnchorRef = useRef<string | undefined>(undefined)
  const activeEntryFrameRef = useRef<number | undefined>(undefined)
  const composerMotionActiveRef = useRef(false)
  const composerMotionFrameRef = useRef<number | undefined>(undefined)
  const followsComposerRef = useRef(true)
  const messageSurfaceRefs = useRef(new Map<string, HTMLDivElement>())
  const timelineRef = useRef<HTMLDivElement>(null)
  const navigatorItems = useMemo<NarrativeTimelineNavigatorItem[]>(() => props.timeline.map((entry, index) => ({
    id: entry.id,
    meta: `#${index + 1} · ${formatTimestamp(entry.createdAt)}`,
    preview: entry.content,
    role: props.t(entry.role === 'user' ? 'timeline.role.user' : 'timeline.role.assistant'),
  })), [props.t, props.timeline])
  const navigatorMarkers = useMemo(
    () => import.meta.env.DEV ? createMockNarrativeTimelineMarkers(props.timeline.map(entry => entry.id)) : [],
    [props.timeline],
  )

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    if (linkCopyTimerRef.current) clearTimeout(linkCopyTimerRef.current)
    if (activeEntryFrameRef.current) cancelAnimationFrame(activeEntryFrameRef.current)
    if (composerMotionFrameRef.current) cancelAnimationFrame(composerMotionFrameRef.current)
  }, [])

  useEffect(() => {
    if (activeEntryId && props.timeline.some(entry => entry.id === activeEntryId)) return
    setActiveEntryId(props.timeline[0]?.id)
  }, [activeEntryId, props.timeline])

  useLayoutEffect(() => {
    const timeline = timelineRef.current
    if (!timeline || !props.composerHeight || !followsComposerRef.current) return
    timeline.scrollTop = timeline.scrollHeight
  }, [props.composerHeight])

  useLayoutEffect(() => {
    const timeline = timelineRef.current
    if (!timeline || !followsComposerRef.current) return
    if (composerMotionFrameRef.current) cancelAnimationFrame(composerMotionFrameRef.current)
    const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      timeline.scrollTop = timeline.scrollHeight
      return
    }

    composerMotionActiveRef.current = true
    const startedAt = performance.now()
    const followComposer = (timestamp: number) => {
      timeline.scrollTop = timeline.scrollHeight
      if (timestamp - startedAt < 200) {
        composerMotionFrameRef.current = requestAnimationFrame(followComposer)
        return
      }
      composerMotionFrameRef.current = undefined
      composerMotionActiveRef.current = false
    }
    composerMotionFrameRef.current = requestAnimationFrame(followComposer)
    return () => {
      if (composerMotionFrameRef.current) cancelAnimationFrame(composerMotionFrameRef.current)
      composerMotionFrameRef.current = undefined
      composerMotionActiveRef.current = false
    }
  }, [props.composerExpanded])

  useLayoutEffect(() => {
    if (!props.anchorEntryId) {
      handledAnchorRef.current = undefined
      return
    }
    if (handledAnchorRef.current === props.anchorEntryId || !props.timeline.some(entry => entry.id === props.anchorEntryId)) return
    handledAnchorRef.current = props.anchorEntryId
    setActiveEntryId(props.anchorEntryId)
    messageSurfaceRefs.current.get(props.anchorEntryId)?.scrollIntoView({ block: 'center' })
  }, [props.anchorEntryId, props.timeline])

  function beginEdit(entry: NarrativeEntryView) {
    const messageBody = messageSurfaceRefs.current
      .get(entry.id)
      ?.querySelector<HTMLElement>('[data-loom-component="markdown-content"]')
    setEditorMinHeight(Math.max(MESSAGE_EDITOR_MIN_HEIGHT, messageBody?.getBoundingClientRect().height ?? 0))
    setMessageMotion({ id: entry.id, direction: 'to-edit' })
    setEditingId(entry.id)
    setDraft(entry.content)
  }

  function cancelEdit() {
    if (editingId) setMessageMotion({ id: editingId, direction: 'to-read' })
    setEditingId(undefined)
    setDraft('')
  }

  function saveEdit() {
    saveValue(draft)
  }

  function saveValue(rawValue: string) {
    const value = rawValue.trim()
    if (!editingId || !value) return
    props.onEditEntry(editingId, value)
    cancelEdit()
  }

  async function copyEntry(entry: NarrativeEntryView) {
    try {
      await navigator.clipboard.writeText(entry.content)
      setCopyState({ id: entry.id, status: 'copied' })
    } catch {
      setCopyState({ id: entry.id, status: 'failed' })
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyState(undefined), 1600)
  }

  async function copyEntryLink(entry: NarrativeEntryView) {
    try {
      await navigator.clipboard.writeText(props.getEntryLink(entry.id))
      setLinkCopyState({ id: entry.id, status: 'copied' })
    } catch {
      setLinkCopyState({ id: entry.id, status: 'failed' })
    }
    if (linkCopyTimerRef.current) clearTimeout(linkCopyTimerRef.current)
    linkCopyTimerRef.current = setTimeout(() => setLinkCopyState(undefined), 1600)
  }

  function scheduleActiveEntryUpdate() {
    if (composerMotionActiveRef.current) return
    const timelineElement = timelineRef.current
    if (timelineElement) followsComposerRef.current = isTimelineNearBottom(timelineElement)
    if (activeEntryFrameRef.current) return
    activeEntryFrameRef.current = requestAnimationFrame(() => {
      activeEntryFrameRef.current = undefined
      const timelineElement = timelineRef.current
      if (!timelineElement) return
      const viewport = timelineElement.getBoundingClientRect()
      const readingLine = viewport.top + viewport.height * 0.42
      let nearestEntryId = props.timeline[0]?.id
      let nearestDistance = Number.POSITIVE_INFINITY

      // ponytail: 当前开发规模按百楼会话线性扫描；接入消息虚拟化后改由虚拟列表直接提供可见索引。
      for (const entry of props.timeline) {
        const surface = messageSurfaceRefs.current.get(entry.id)
        if (!surface) continue
        const bounds = surface.getBoundingClientRect()
        const distance = Math.abs((bounds.top + bounds.bottom) / 2 - readingLine)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestEntryId = entry.id
        }
      }
      setActiveEntryId(nearestEntryId)
    })
  }

  function navigateToEntry(entryId: string) {
    setActiveEntryId(entryId)
    props.onEntryAnchorChange(entryId)
    messageSurfaceRefs.current.get(entryId)?.scrollIntoView({
      behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    })
  }

  return (
    <section
      className={styles.timelinePane}
      data-loom-component="narrative-canvas"
      data-loom-object="narrative-timeline"
    >
      <div
        className={styles.timeline}
        data-loom-component="base-chat-canvas"
        ref={timelineRef}
        onScroll={scheduleActiveEntryUpdate}
      >
        {props.timeline.length === 0 ? (
          <div className={styles.empty}>{props.emptyTimelineText}</div>
        ) : (
          <Suspense fallback={(
            <div aria-busy="true" className={styles.renderingMessages}>
              <SkeletonText lines={6} />
            </div>
          )}>
            {props.timeline.map((entry, index) => (
              <article
                className={`${styles.message} ${entry.role === 'user' ? styles.user : styles.assistant}`}
                data-loom-component="chat-message"
                data-loom-role={entry.role}
                data-loom-motion={messageMotion?.id === entry.id ? messageMotion.direction : undefined}
                data-loom-state={editingId === entry.id ? 'editing' : 'settled'}
                id={`entry-${encodeURIComponent(entry.id)}`}
                key={entry.id}
              >
                <div
                  className={styles.messageSurface}
                  data-loom-slot="message-content"
                  ref={element => {
                    if (element) messageSurfaceRefs.current.set(entry.id, element)
                    else messageSurfaceRefs.current.delete(entry.id)
                  }}
                >
                  {editingId === entry.id ? (
                    <LongTextEditor
                      autoFocus
                      clearLabel={props.t('longTextEditor.clear')}
                      clearedLabel={props.t('longTextEditor.cleared')}
                      compact
                      copiedLabel={props.t('longTextEditor.copied')}
                      copyFailedLabel={props.t('longTextEditor.copyFailed')}
                      copyLabel={props.t('longTextEditor.copy')}
                      label={props.t('timeline.editLocal')}
                      minHeight={editorMinHeight || undefined}
                      mode="source"
                      restoreInitialLabel={props.t('longTextEditor.restoreInitial')}
                      showLineNumbers={false}
                      sourceOnly
                      spellCheck={false}
                      undoEditLabel={props.t('longTextEditor.undoEdit')}
                      undoLabel={props.t('longTextEditor.undoClear')}
                      value={draft}
                      onCancel={cancelEdit}
                      onChange={setDraft}
                      onCommit={setDraft}
                      onSubmit={saveValue}
                    />
                  ) : (
                    <ConversationMarkdown
                      className={styles.messageBody}
                      codeBlockLabels={{
                        copied: props.t('longTextEditor.copied'),
                        copy: props.t('longTextEditor.copy'),
                        copyFailed: props.t('longTextEditor.copyFailed'),
                        disableWrap: props.t('markdown.code.disableWrap'),
                        enableWrap: props.t('markdown.code.enableWrap'),
                      }}
                      role={entry.role}
                      value={entry.content}
                    />
                  )}
                </div>
                <footer className={styles.messageFooter}>
                  <span className={styles.messageTimestamp} title={formatFullTimestamp(entry.createdAt)}>
                    #{index + 1} · {formatTimestamp(entry.createdAt)}
                  </span>
                  <div className={styles.messageActions}>
                    {editingId === entry.id ? (
                      <>
                      <MessageAction label={props.t('timeline.cancelEdit')} onClick={cancelEdit}><X aria-hidden="true" /></MessageAction>
                      <MessageAction disabled={!draft.trim()} label={props.t('timeline.saveEdit')} onClick={saveEdit}><Check aria-hidden="true" /></MessageAction>
                      </>
                    ) : (
                      <>
                      <MessageAction
                        label={props.t(copyState?.id === entry.id
                          ? copyState.status === 'copied' ? 'timeline.copied' : 'timeline.copyFailed'
                          : 'timeline.copy')}
                        onClick={() => void copyEntry(entry)}
                      >
                        {copyState?.id === entry.id && copyState.status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      </MessageAction>
                      <MessageAction
                        label={props.t(linkCopyState?.id === entry.id
                          ? linkCopyState.status === 'copied' ? 'timeline.linkCopied' : 'timeline.linkCopyFailed'
                          : 'timeline.copyLink')}
                        onClick={() => void copyEntryLink(entry)}
                      >
                        {linkCopyState?.id === entry.id && linkCopyState.status === 'copied' ? <Check aria-hidden="true" /> : <Link aria-hidden="true" />}
                      </MessageAction>
                      <MessageAction label={props.t('timeline.editLocal')} onClick={() => beginEdit(entry)}><Pencil aria-hidden="true" /></MessageAction>
                      <MessageAction disabled={props.busy} label={props.t('timeline.fork')} onClick={() => props.onForkEntry(entry)}><GitBranch aria-hidden="true" /></MessageAction>
                      <MessageAction disabled label={props.t('timeline.deleteUnavailable')}><Trash2 aria-hidden="true" /></MessageAction>
                      </>
                    )}
                  </div>
                </footer>
              </article>
            ))}
          </Suspense>
        )}
      </div>
      <NarrativeTimelineNavigator
        activeId={activeEntryId}
        items={navigatorItems}
        label={props.t('timeline.navigator')}
        markers={navigatorMarkers}
        onNavigate={navigateToEntry}
      />
    </section>
  )
}

export function isTimelineNearBottom(element: Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 48
}

function MessageAction(props: { children: ReactNode; disabled?: boolean; label: string; onClick?: () => void }) {
  return (
    <button aria-label={props.label} className={styles.messageAction} disabled={props.disabled} title={props.label} type="button" onClick={props.onClick}>
      {props.children}
    </button>
  )
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatFullTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
