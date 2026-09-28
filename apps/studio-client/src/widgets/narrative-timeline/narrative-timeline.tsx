import { Check, Copy, GitBranch, Link, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import type { Translator } from '../../shared/i18n/index.js'
import type { NarrativeNode } from '../../entities/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import {
  NarrativeTimelineNavigator,
  type NarrativeTimelineNavigatorItem,
} from './narrative-timeline-navigator.js'
import type { NarrativeTimelineMarker } from './narrative-timeline-navigator-model.js'
import { LongTextEditor } from '../../shared/ui/long-text-editor/long-text-editor.js'
import { SkeletonText } from '@loom-studio/ui'
import { ConversationMessageAction, ConversationMessageChrome, formatConversationTimestamp } from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import styles from './narrative-timeline.module.scss'
import type { ClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererNodeMountHost } from '../../features/extension-renderers/ui/renderer-node-mount-host.js'
import { renderTemplateMacros, type MacroRenderContext } from '../../features/state-variables/model/macro-renderer.js'
import { useNarrativeAnchorNavigation } from './use-narrative-anchor-navigation.js'
import { useAppearanceStore } from '../../shared/studio-shell/appearance-store.js'
import { displayText, type DisplayProjection, type OpeningDisplayProjection } from '../../features/message-content/model/use-display-projection.js'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../features/message-content/ui/message-content.js')
  return { default: module.MessageContent }
})

const MESSAGE_EDITOR_MIN_HEIGHT = 132

type NarrativeNodeView = NarrativeNode

type NarrativeTimelineProps = {
  displayProjection?: DisplayProjection
  anchorNodeId?: string
  busy: boolean
  composerExpanded?: boolean
  composerHeight: number
  emptyTimelineText: string
  openingDraft?: { content: string; isPlaceholder: boolean }
  openingDisplay?: OpeningDisplayProjection
  getNodeLink: (nodeId: string) => string
  hasOlder: boolean
  macroContext?: MacroRenderContext
  onEditNode: (nodeId: string, content: string) => Promise<void>
  onForkNode: (node: NarrativeNodeView) => void
  onLoadOlder(): Promise<void>
  onNodeAnchorChange: (nodeId: string) => void
  rendererHost?: ClientRendererHost
  tail?: ReactNode
  t: Translator
  timeline: NarrativeNodeView[]
  timelineId?: string
  overscan?: number
}

export function NarrativeTimeline(props: NarrativeTimelineProps) {
  const storedOverscan = useAppearanceStore(state => state.narrativeOverscan)
  const [editingId, setEditingId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [editorMinHeight, setEditorMinHeight] = useState(0)
  const [messageMotion, setMessageMotion] = useState<{ id: string; direction: 'to-edit' | 'to-read' }>()
  const [copyState, setCopyState] = useState<{ id: string; status: 'copied' | 'failed' }>()
  const [linkCopyState, setLinkCopyState] = useState<{ id: string; status: 'copied' | 'failed' }>()
  const [activeEntryId, setActiveEntryId] = useState(props.anchorNodeId ? undefined : props.timeline[0]?.id)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const linkCopyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const activeEntryFrameRef = useRef<number | undefined>(undefined)
  const composerMotionActiveRef = useRef(false)
  const composerMotionFrameRef = useRef<number | undefined>(undefined)
  const followsComposerRef = useRef(true)
  const pendingAnchorScrollRef = useRef<{ timelineId?: string; nodeId: string } | undefined>(undefined)
  const messageSurfaceRefs = useRef(new Map<string, HTMLDivElement>())
  const timelineRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(32)
  const editingIndex = props.timeline.findIndex(entry => entry.id === editingId)
  const virtualizer = useVirtualizer({
    count: props.timeline.length,
    getScrollElement: () => timelineRef.current,
    getItemKey: useCallback((index: number) => props.timeline[index].id, [props.timeline]),
    estimateSize: () => 280,
    overscan: props.overscan ?? (Number.isInteger(storedOverscan) && storedOverscan >= 0 && storedOverscan <= 50 ? storedOverscan : 5),
    scrollMargin,
    anchorTo: 'end',
    // Anchor navigation can scroll during a layout effect.
    useFlushSync: false,
    rangeExtractor: useCallback(range => {
      const indices = defaultRangeExtractor(range)
      if (editingIndex >= 0 && !indices.includes(editingIndex)) indices.push(editingIndex)
      return indices.sort((a, b) => a - b)
    }, [editingIndex]),
  })
  useLayoutEffect(() => {
    const update = () => setScrollMargin(listRef.current?.offsetTop ?? 32)
    update()
    const observer = new ResizeObserver(update)
    if (headerRef.current) observer.observe(headerRef.current)
    if (timelineRef.current) observer.observe(timelineRef.current)
    return () => observer.disconnect()
  }, [props.hasOlder, props.timeline.length > 0])
  const navigatorItems = useMemo<NarrativeTimelineNavigatorItem[]>(() => props.timeline.map((node, index) => ({
    id: node.id,
    meta: `#${index + 1} · ${formatConversationTimestamp(node.createdAt)}`,
    preview: renderTemplateMacros(node.body.raw, props.macroContext),
    role: props.t(readNarrativeNodeRole(props.timeline, index) === 'user' ? 'timeline.role.user' : 'timeline.role.assistant'),
  })), [props.macroContext, props.t, props.timeline])
  const navigatorMarkers: NarrativeTimelineMarker[] = []
  const anchorStatus = useNarrativeAnchorNavigation({
    timelineId: props.timelineId,
    nodeId: props.anchorNodeId,
    nodes: props.timeline,
    hasOlder: props.hasOlder,
    busy: props.busy,
    onLoadOlder: props.onLoadOlder,
    onLocate: nodeId => {
      followsComposerRef.current = false
      if (activeEntryFrameRef.current) cancelAnimationFrame(activeEntryFrameRef.current)
      activeEntryFrameRef.current = undefined
      setActiveEntryId(nodeId)
      pendingAnchorScrollRef.current = { timelineId: props.timelineId, nodeId }
      const index = props.timeline.findIndex(entry => entry.id === nodeId)
      virtualizer.scrollToIndex(index, { align: 'center' })
      const surface = messageSurfaceRefs.current.get(nodeId)
      if (surface) {
        surface.scrollIntoView({ block: 'center' })
        pendingAnchorScrollRef.current = undefined
      }
    },
  })

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    if (linkCopyTimerRef.current) clearTimeout(linkCopyTimerRef.current)
    if (activeEntryFrameRef.current) cancelAnimationFrame(activeEntryFrameRef.current)
    if (composerMotionFrameRef.current) cancelAnimationFrame(composerMotionFrameRef.current)
  }, [])

  useEffect(() => {
    if (props.anchorNodeId) {
      if (anchorStatus !== 'located') setActiveEntryId(undefined)
      return
    }
    if (activeEntryId && props.timeline.some(entry => entry.id === activeEntryId)) return
    setActiveEntryId(props.timeline[0]?.id)
  }, [activeEntryId, props.timeline, props.anchorNodeId, anchorStatus])

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

  function beginEdit(node: NarrativeNodeView) {
    if (savingRef.current) return
    saveCallbackRef.current = props.onEditNode
    setSaveError(undefined)
    const messageBody = messageSurfaceRefs.current
      .get(node.id)
      ?.querySelector<HTMLElement>('[data-loom-component="markdown-content"]')
    setEditorMinHeight(Math.max(MESSAGE_EDITOR_MIN_HEIGHT, messageBody?.getBoundingClientRect().height ?? 0))
    setMessageMotion({ id: node.id, direction: 'to-edit' })
    setEditingId(node.id)
    setDraft(node.body.raw)
  }

  function cancelEdit() {
    if (savingRef.current) return
    if (editingId) setMessageMotion({ id: editingId, direction: 'to-read' })
    setEditingId(undefined)
    setDraft('')
  }

  const saveCallbackRef = useRef(props.onEditNode)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()

  function saveEdit() {
    void saveValue(draft)
  }

  async function saveValue(rawValue: string) {
    if (!editingId || !rawValue.trim() || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError(undefined)
    try {
      await saveCallbackRef.current(editingId, rawValue)
      savingRef.current = false
      cancelEdit()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
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
    if (props.anchorNodeId && anchorStatus !== 'located') return
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

      for (const item of virtualizer.getVirtualItems()) {
        const entry = props.timeline[item.index]
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
    followsComposerRef.current = false
    setActiveEntryId(entryId)
    props.onNodeAnchorChange(entryId)
    const index = props.timeline.findIndex(entry => entry.id === entryId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
  }

  return (
    <section
      className={styles.timelinePane}
      data-loom-component="narrative-canvas"
      data-loom-object="narrative-timeline"
      aria-busy={props.displayProjection?.refreshing}
    >
      <div
        className={styles.timeline}
        data-loom-component="base-chat-canvas"
        ref={timelineRef}
        onScroll={scheduleActiveEntryUpdate}
      >
        <div ref={headerRef} className={styles.timelineHeader}>
          {props.displayProjection?.warning ? <p role="status">Display: {props.displayProjection.warning}</p> : null}
          {props.displayProjection?.error ? <div role="alert">
            <span>Display: {props.displayProjection.error}</span>
            <button type="button" disabled={props.displayProjection.refreshing} onClick={props.displayProjection.retry}
              title={props.t('textTransform.refresh')} aria-label={props.t('textTransform.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
          </div> : null}
          {anchorStatus === 'unavailable' ? <p role="status">{props.t('timeline.anchorUnavailable')}</p> : null}
          {anchorStatus === 'failed' ? <p role="alert">{props.t('timeline.anchorLoadFailed')}</p> : null}
          {props.hasOlder ? <button disabled={props.busy || anchorStatus === 'loading'} type="button" onClick={() => void props.onLoadOlder().catch(() => undefined)}>{props.t('timeline.loadOlder')}</button> : null}
        </div>
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
                  {props.openingDisplay?.pending ? <div aria-busy="true"><SkeletonText lines={4} /></div>
                    : props.openingDisplay?.error ? <div role="alert">
                      <span>Display: {props.openingDisplay.error}</span>
                      <button type="button" onClick={props.openingDisplay.retry} title={props.t('textTransform.refresh')} aria-label={props.t('textTransform.refresh')}><RefreshCw aria-hidden="true" /></button>
                    </div> : <>
                  {props.openingDisplay?.warning ? <p role="status">Display: {props.openingDisplay.warning}</p> : null}
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
                          value={props.openingDisplay?.text ?? props.openingDraft.content}
                          macroContext={props.macroContext}
                  />
                  </>}
                </div>
              </article>
            </Suspense>
          ) : (
            <div className={styles.empty}>{props.emptyTimelineText}</div>
          )
        ) : (
          <div ref={listRef} className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map(item => {
              const index = item.index
              const entry = props.timeline[index]
              const role = readNarrativeNodeRole(props.timeline, index)
              return (
                <div
                  key={entry.id}
                  data-index={index}
                  ref={virtualizer.measureElement}
                  className={styles.virtualRow}
                  style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
                >
                <Suspense fallback={<div aria-busy="true"><SkeletonText lines={6} /></div>}>
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
                    if (element) {
                      messageSurfaceRefs.current.set(entry.id, element)
                      const pending = pendingAnchorScrollRef.current
                      if (pending?.timelineId === props.timelineId && pending?.nodeId === entry.id && props.anchorNodeId === entry.id) {
                        element.scrollIntoView({ block: 'center' })
                        pendingAnchorScrollRef.current = undefined
                      }
                    }
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
                      disabled={saving}
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
                      onChange={value => { if (!savingRef.current) setDraft(value) }}
                      onCommit={value => { if (!savingRef.current) setDraft(value) }}
                      onSubmit={saveValue}
                    />
                  ) : (
                    props.rendererHost && props.timelineId ? (
                      <RendererNodeMountHost
                        host={props.rendererHost}
                        nodeId={entry.id}
                        rawText={entry.body.raw}
                        displayText={displayText(props.displayProjection, entry.id, entry.body.raw) ?? ''}
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
                          macroContext={props.macroContext}
                          value={displayText(props.displayProjection, entry.id, entry.body.raw) ?? ''}
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
                        macroContext={props.macroContext}
                        value={displayText(props.displayProjection, entry.id, entry.body.raw) ?? ''}
                      />
                    )
                  )}
                </div>
                <ConversationMessageChrome
                  createdAt={entry.createdAt}
                  index={index}
                  actions={editingId === entry.id ? (
                    <>
                      {saveError ? <span role="alert">{saveError}</span> : null}
                      <ConversationMessageAction disabled={saving} label={props.t('timeline.cancelEdit')} onClick={cancelEdit}><X aria-hidden="true" /></ConversationMessageAction>
                      <ConversationMessageAction disabled={saving || !draft.trim()} label={props.t('timeline.saveEdit')} onClick={saveEdit}><Check aria-hidden="true" /></ConversationMessageAction>
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
                </Suspense>
                </div>
              )
            })}
          </div>
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
  if (node?.id?.startsWith('optimistic-')) return 'user'
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
