import { Check, Copy, GitBranch, Link, Pencil, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import type { NarrativeNode } from '../../entities/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import {
  NarrativeTimelineNavigator,
  type NarrativeTimelineNavigatorItem,
} from './narrative-timeline-navigator.js'
import type { NarrativeTimelineMarker } from './narrative-timeline-navigator-model.js'
import { LongTextEditor } from '../../shared/ui/long-text-editor/long-text-editor.js'
import { SkeletonText } from '../../shared/ui/skeleton/skeleton.js'
import { ConversationMessageAction, ConversationMessageChrome, formatConversationTimestamp } from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import styles from './narrative-timeline.module.scss'
import type { ClientRendererHost } from '../../features/extension-renderers/model/client-renderer-host.js'
import { RendererNodeMountHost } from '../../features/extension-renderers/ui/renderer-node-mount-host.js'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../shared/ui/conversation-markdown/conversation-markdown.js')
  return { default: module.ConversationMarkdown }
})

const MESSAGE_EDITOR_MIN_HEIGHT = 132

type NarrativeNodeView = NarrativeNode

type NarrativeTimelineProps = {
  anchorNodeId?: string
  busy: boolean
  composerExpanded: boolean
  composerHeight: number
  emptyTimelineText: string
  openingDraft?: { content: string; isPlaceholder: boolean }
  getNodeLink: (nodeId: string) => string
  hasOlder: boolean
  onEditNode: (nodeId: string, content: string) => void
  onForkNode: (node: NarrativeNodeView) => void
  onLoadOlder(): void
  onNodeAnchorChange: (nodeId: string) => void
  rendererHost?: ClientRendererHost
  tail?: ReactNode
  t: Translator
  timeline: NarrativeNodeView[]
  timelineId?: string
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
  const navigatorItems = useMemo<NarrativeTimelineNavigatorItem[]>(() => props.timeline.map((node, index) => ({
    id: node.id,
    meta: `#${index + 1} · ${formatConversationTimestamp(node.createdAt)}`,
    preview: node.body.raw,
    role: props.t(readNarrativeNodeRole(props.timeline, index) === 'user' ? 'timeline.role.user' : 'timeline.role.assistant'),
  })), [props.t, props.timeline])
  const navigatorMarkers: NarrativeTimelineMarker[] = []

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
    if (!props.anchorNodeId) {
      handledAnchorRef.current = undefined
      return
    }
    if (handledAnchorRef.current === props.anchorNodeId || !props.timeline.some(node => node.id === props.anchorNodeId)) return
    handledAnchorRef.current = props.anchorNodeId
    setActiveEntryId(props.anchorNodeId)
    messageSurfaceRefs.current.get(props.anchorNodeId)?.scrollIntoView({ block: 'center' })
  }, [props.anchorNodeId, props.timeline])

  function beginEdit(node: NarrativeNodeView) {
    const messageBody = messageSurfaceRefs.current
      .get(node.id)
      ?.querySelector<HTMLElement>('[data-loom-component="markdown-content"]')
    setEditorMinHeight(Math.max(MESSAGE_EDITOR_MIN_HEIGHT, messageBody?.getBoundingClientRect().height ?? 0))
    setMessageMotion({ id: node.id, direction: 'to-edit' })
    setEditingId(node.id)
    setDraft(node.body.raw)
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
    props.onEditNode(editingId, value)
    cancelEdit()
  }

  async function copyEntry(node: NarrativeNodeView) {
    const copied = await tryWriteClipboardText(node.body.raw)
    setCopyState({ id: node.id, status: copied ? 'copied' : 'failed' })
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyState(undefined), 1600)
  }

  async function copyEntryLink(node: NarrativeNodeView) {
    const copied = await tryWriteClipboardText(props.getNodeLink(node.id))
    setLinkCopyState({ id: node.id, status: copied ? 'copied' : 'failed' })
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
    props.onNodeAnchorChange(entryId)
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
          props.openingDraft ? (
            <Suspense fallback={(
              <div aria-busy="true" className={styles.renderingMessages}>
                <SkeletonText lines={4} />
              </div>
            )}>
              <article
                className={`${styles.message} ${styles.assistant}`}
                data-loom-component="chat-message"
                data-loom-role="narrative"
                data-loom-state="draft"
              >
                <div
                  className={styles.messageSurface}
                  data-loom-slot="message-content"
                >
                  <ConversationMarkdown
                    className={`${styles.messageBody} ${props.openingDraft.isPlaceholder ? styles.placeholderBody : ''}`}
                    codeBlockLabels={{
                      copied: props.t('longTextEditor.copied'),
                      copy: props.t('longTextEditor.copy'),
                      copyFailed: props.t('longTextEditor.copyFailed'),
                      disableWrap: props.t('markdown.code.disableWrap'),
                      enableWrap: props.t('markdown.code.enableWrap'),
                    }}
                    role="assistant"
                    value={props.openingDraft.content}
                  />
                </div>
              </article>
            </Suspense>
          ) : (
            <div className={styles.empty}>{props.emptyTimelineText}</div>
          )
        ) : (
          <Suspense fallback={(
            <div aria-busy="true" className={styles.renderingMessages}>
              <SkeletonText lines={6} />
            </div>
          )}>
            {props.hasOlder ? <button disabled={props.busy} type="button" onClick={props.onLoadOlder}>{props.t('timeline.loadOlder')}</button> : null}
            {props.timeline.map((entry, index) => {
              const role = readNarrativeNodeRole(props.timeline, index)
              return (
                <article
                className={`${styles.message} ${styles[role]}`}
                data-loom-component="chat-message"
                data-loom-role="narrative"
                data-loom-motion={messageMotion?.id === entry.id ? messageMotion.direction : undefined}
                data-loom-state={editingId === entry.id ? 'editing' : 'settled'}
                id={`node-${encodeURIComponent(entry.id)}`}
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
                    props.rendererHost && props.timelineId ? (
                      <RendererNodeMountHost
                        host={props.rendererHost}
                        nodeId={entry.id}
                        rawText={entry.body.raw}
                        surface="narrative"
                        timelineId={props.timelineId}
                      >
                        <ConversationMarkdown
                          className={styles.messageBody}
                          codeBlockLabels={{
                            copied: props.t('longTextEditor.copied'),
                            copy: props.t('longTextEditor.copy'),
                            copyFailed: props.t('longTextEditor.copyFailed'),
                            disableWrap: props.t('markdown.code.disableWrap'),
                            enableWrap: props.t('markdown.code.enableWrap'),
                          }}
                          role={role}
                          value={entry.body.raw}
                        />
                      </RendererNodeMountHost>
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
                        role={role}
                        value={entry.body.raw}
                      />
                    )
                  )}
                </div>
                <ConversationMessageChrome
                  createdAt={entry.createdAt}
                  index={index}
                  actions={editingId === entry.id ? (
                    <>
                      <ConversationMessageAction label={props.t('timeline.cancelEdit')} onClick={cancelEdit}><X aria-hidden="true" /></ConversationMessageAction>
                      <ConversationMessageAction disabled={!draft.trim()} label={props.t('timeline.saveEdit')} onClick={saveEdit}><Check aria-hidden="true" /></ConversationMessageAction>
                    </>
                  ) : (
                    <>
                      <ConversationMessageAction
                        label={props.t(copyState?.id === entry.id
                          ? copyState.status === 'copied' ? 'timeline.copied' : 'timeline.copyFailed'
                          : 'timeline.copy')}
                        onClick={() => void copyEntry(entry)}
                      >
                        {copyState?.id === entry.id && copyState.status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      </ConversationMessageAction>
                      <ConversationMessageAction
                        label={props.t(linkCopyState?.id === entry.id
                          ? linkCopyState.status === 'copied' ? 'timeline.linkCopied' : 'timeline.linkCopyFailed'
                          : 'timeline.copyLink')}
                        onClick={() => void copyEntryLink(entry)}
                      >
                        {linkCopyState?.id === entry.id && linkCopyState.status === 'copied' ? <Check aria-hidden="true" /> : <Link aria-hidden="true" />}
                      </ConversationMessageAction>
                      <ConversationMessageAction label={props.t('timeline.editLocal')} onClick={() => beginEdit(entry)}><Pencil aria-hidden="true" /></ConversationMessageAction>
                      <ConversationMessageAction disabled={props.busy} label={props.t('timeline.fork')} onClick={() => props.onForkNode(entry)}><GitBranch aria-hidden="true" /></ConversationMessageAction>
                      <ConversationMessageAction disabled label={props.t('timeline.deleteUnavailable')}><Trash2 aria-hidden="true" /></ConversationMessageAction>
                    </>
                  )}
                />
                </article>
              )
            })}
          </Suspense>
        )}
        {props.tail ? <div className={styles.tail} data-loom-surface="narrative.timeline.tail">{props.tail}</div> : null}
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

export function readNarrativeNodeRole(nodes: NarrativeNode[], index: number): 'user' | 'assistant' {
  const node = nodes[index]
  const next = nodes[index + 1]
  if (!node?.source?.runId || !node.source.agentMessageId || !next?.source?.agentMessageId) return 'assistant'

  // ponytail: Narrative Store 暂无持久化 role 字段；同一 Run 的连续父子节点当前固定为 user → assistant，新增其他多节点提交形态时应改为显式 role。
  return next.parentNodeId === node.id
    && next.source?.runId === node.source.runId
    && next.source.agentSessionId === node.source.agentSessionId
    ? 'user'
    : 'assistant'
}

export function isTimelineNearBottom(element: Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 48
}
