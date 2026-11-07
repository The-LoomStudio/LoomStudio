import { ToolCollapse } from '../../features/sessions/ui/agent-tool-blocks.js'
import type { ReviseUserInput } from '../../features/attachments/user-input-editor.js'
import { MessageAttachments } from '../../features/attachments/message-attachments.js'
import { executionActivity } from '../../features/narrative-runtime/model/narrative-execution-view.js'
import { createPortal } from 'react-dom'
import { readConversationPosition } from '../../shared/ui/conversation-viewport/conversation-position.js'
import { NarrativeExecutionFlow } from '../../features/narrative-runtime/ui/narrative-execution-flow.js'
import type { TimelineSessionRound, TimelineSessionCommunication } from '../../features/narrative-runtime/model/timeline-execution-projection.js'
import type { AgentTranscriptEntry } from '../../entities/index.js'
import type { ActiveAgentRun } from '../../features/narrative-runtime/model/agent-run-observer.js'
import { NarrativeCommunication, useCommunicationExpansion } from '../../features/narrative-runtime/ui/narrative-communication.js'
import { UserIdentity, type UserIdentityView } from '../../shared/ui/user-identity/user-identity.js'
import { ContentErrorBoundary } from '../../shared/ui/content-error-boundary.js'
import { NarrativeInputSwipePicker } from '../../features/narrative-runtime/ui/narrative-input-swipe-picker.js'
import type { NarrativeSwipeView } from '../../features/narrative-runtime/model/use-narrative-runtime.js'
import { ConversationMarkdown as StaticMarkdown } from '../../shared/ui/conversation-markdown/conversation-markdown.js'
import { Check, ChevronDown, Copy, GitBranch, Link, Pencil, Play, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useConversationViewport } from '../../shared/ui/conversation-viewport/use-conversation-viewport.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { NarrativeNode } from '../../entities/index.js'
import { useCopyFeedback } from '../../shared/hooks/use-copy-feedback.js'
import { DisplayProjectionStatus } from '../../features/message-content/ui/display-projection-status.js'
import { messageCodeBlockLabels } from '../../features/message-content/ui/message-code-block-labels.js'
import {
  NarrativeTimelineNavigator,
  type NarrativeTimelineNavigatorItem,
} from './narrative-timeline-navigator.js'
import type { NarrativeTimelineMarker } from './narrative-timeline-navigator-model.js'
import { LongTextEditor } from '../../shared/ui/long-text-editor/long-text-editor.js'
import { Button, LoadingText } from '@loom-studio/ui'
import { ConversationMessageAction, ConversationMessageChrome, formatConversationTimestamp } from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import styles from './narrative-timeline.module.scss'
import type { ClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererNodeMountHost } from '../../features/extension-renderers/ui/renderer-node-mount-host.js'
import { renderTemplateMacros, type MacroRenderContext } from '../../features/state-variables/model/macro-renderer.js'
import { useNarrativeAnchorNavigation } from './use-narrative-anchor-navigation.js'
import { useAppearanceStore } from '../../shared/studio-shell/appearance-store.js'
import { displayText, type DisplayProjection, type OpeningDisplayProjection } from '../../features/message-content/model/use-display-projection.js'
import { TextTokenSummary, TokenSummary } from '../../features/prompt-resources/ui/resource-token-summary.js'
import { useTokenCounts } from '../../shared/tokenizer/use-token-counts.js'
import { useTokenDisplaySettings } from '../../shared/tokenizer/settings.js'
import { applyTokenMultiplier } from '@loom-studio/tokenizer/contracts'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../features/message-content/ui/message-content.js')
  return { default: module.MessageContent }
})

const MESSAGE_EDITOR_MIN_HEIGHT = 132

type NarrativeNodeView = NarrativeNode

type NarrativeTimelineProps = {
  actionsHost?: HTMLElement | null
  workEntries?: AgentTranscriptEntry[]
  connecting?: boolean
  activeRun?: ActiveAgentRun
  rounds: TimelineSessionRound[]
  inputMode?: 'roleplay' | 'discussion'
  onDiscuss?(): void
  onSendDiscussion?(content: string): Promise<boolean>
  onReviseDiscussionInput?: ReviseUserInput
  onRetryDiscussionInput?(entryId: string, content: string): Promise<boolean>
  onContinueRun?(): Promise<boolean>
  userIdentity?: UserIdentityView
  communicationDisplay?: DisplayProjection
  displayProjection?: DisplayProjection
  displayOnlyNodeId?: string
  anchorNodeId?: string
  busy: boolean
  emptyTimelineText: string
  openingDraft?: { content: string; isPlaceholder: boolean }
  openingControls?: ReactNode
  swipeControls?: { nodeId?: string; content: ReactNode }
  inputSwipe?: { swipe: NarrativeSwipeView; disabled: boolean; onSelect(candidateId: string): void; onGenerate(input: string): Promise<void> }
  openingDisplay?: OpeningDisplayProjection
  onStartStory?(): void
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
  scrollRestorationScope?: string
  overscan?: number
}

export function NarrativeTimeline(props: NarrativeTimelineProps) {
  const restoredPosition = useMemo(() => props.anchorNodeId || !props.scrollRestorationScope ? undefined
    : readConversationPosition({ view: 'timeline', scope: props.scrollRestorationScope }), [props.anchorNodeId, props.scrollRestorationScope])
  const { rounds } = props
  const communicationKeys = useMemo(() => rounds.flatMap(round => round.communications.filter(group => group.execution.steps.length > 0 || group.discussions.length > 0).map(group => `${round.candidateId ?? round.id}:${group.id}`)), [rounds])
  const [expandedCommunication, setExpandedCommunication] = useCommunicationExpansion(props.inputMode ?? 'roleplay', communicationKeys, props.scrollRestorationScope ?? props.timelineId)
  const resolvedUserName = renderTemplateMacros('{{user}}', props.macroContext).trim()
  const userName = props.userIdentity?.name ?? (resolvedUserName && resolvedUserName !== '{{user}}' ? resolvedUserName : props.t('timeline.role.user'))
  const tokenScope = props.timelineId ?? props.timeline[0]?.timelineId ?? ''
  const tokenMultiplier = useTokenDisplaySettings(state => state.multiplier)
  const nodeTokens = useTokenCounts(props.timeline.map(node => node.body.raw),
    JSON.stringify([tokenScope, ...props.timeline.map(node => node.id)]))
  const storedOverscan = useAppearanceStore(state => state.narrativeOverscan)
  const [editingId, setEditingId] = useState<string>()
  const [editingInputSwipe, setEditingInputSwipe] = useState(false)
  const [draft, setDraft] = useState('')
  const [editorMinHeight, setEditorMinHeight] = useState(0)
  const [messageMotion, setMessageMotion] = useState<{ id: string; direction: 'to-edit' | 'to-read' }>()
  const { feedback: copyState, copy: copyText } = useCopyFeedback()
  const { feedback: linkCopyState, copy: copyLink } = useCopyFeedback()
  const [activeEntryId, setActiveEntryId] = useState(props.anchorNodeId ? undefined : props.timeline[0]?.id)
  const activeEntryFrameRef = useRef<number | undefined>(undefined)
  const pendingAnchorScrollRef = useRef<{ timelineId?: string; nodeId: string } | undefined>(undefined)
  const messageSurfaceRefs = useRef(new Map<string, HTMLDivElement>())
  const {
    scrollRef: timelineRef, contentRef, listRef, headerRef, scrollMargin, virtualizer, smooth,
    onScroll: updateViewportFollow,
  } = useConversationViewport({
    items: rounds,
    restoration: props.scrollRestorationScope ? { view: 'timeline', scope: props.scrollRestorationScope, anchorId: activeEntryId } : undefined,
    scopeId: props.timelineId,
    pinnedId: rounds.find(round => round.nodes.some(node => node.id === editingId))?.id,
    followInitially: !props.anchorNodeId,
    anchorReadingPosition: true,
    overscan: props.overscan ?? (Number.isInteger(storedOverscan) && storedOverscan >= 0 && storedOverscan <= 50 ? storedOverscan : 5),
  })
  const navigatorItems = useMemo<NarrativeTimelineNavigatorItem[]>(() => props.timeline.map((node, index) => ({
    id: node.id,
    meta: `#${node.floor} · ${formatConversationTimestamp(node.createdAt)}`,
    preview: node.body.raw,
    role: props.t(readNarrativeNodeRole(props.timeline, index) === 'user' ? 'timeline.role.user' : 'timeline.role.assistant'),
  })), [props.t, props.timeline])
  const navigatorMarkers: NarrativeTimelineMarker[] = []
  const { status: anchorStatus, cancel: cancelAnchorNavigation } = useNarrativeAnchorNavigation({
    timelineId: props.timelineId,
    nodeId: props.anchorNodeId ?? (restoredPosition?.following === false ? restoredPosition.anchorId : undefined),
    nodes: props.timeline,
    hasOlder: props.hasOlder,
    busy: props.busy,
    onLoadOlder: props.onLoadOlder,
    onLocate: nodeId => {
      if (!props.anchorNodeId) return
      smooth.pause()
      if (activeEntryFrameRef.current) cancelAnimationFrame(activeEntryFrameRef.current)
      activeEntryFrameRef.current = undefined
      setActiveEntryId(nodeId)
      pendingAnchorScrollRef.current = { timelineId: props.timelineId, nodeId }
      const index = rounds.findIndex(round => round.nodes.some(node => node.id === nodeId))
      virtualizer.scrollToIndex(index, { align: 'center' })
      const surface = messageSurfaceRefs.current.get(nodeId)
      if (surface) {
        surface.scrollIntoView({ block: 'center' })
        pendingAnchorScrollRef.current = undefined
      }
    },
  })

  useEffect(() => () => {
    if (activeEntryFrameRef.current) cancelAnimationFrame(activeEntryFrameRef.current)
  }, [])

  useEffect(() => {
    if (props.anchorNodeId && anchorStatus !== 'idle') {
      if (anchorStatus !== 'located') setActiveEntryId(undefined)
      return
    }
    if (activeEntryId && props.timeline.some(entry => entry.id === activeEntryId)) return
    setActiveEntryId(props.timeline[0]?.id)
  }, [activeEntryId, props.timeline, props.anchorNodeId, anchorStatus])

  function beginEdit(node: NarrativeNodeView, inputSwipe = false) {
    if (savingRef.current) return
    saveCallbackRef.current = inputSwipe ? (_nodeId, raw) => props.inputSwipe!.onGenerate(raw) : props.onEditNode
    setEditingInputSwipe(inputSwipe)
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
    setEditingInputSwipe(false)
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
    if (editingInputSwipe && (!props.inputSwipe || props.inputSwipe.disabled || !props.inputSwipe.swipe.canGenerate
      || props.inputSwipe.swipe.active || props.inputSwipe.swipe.suspended || props.inputSwipe.swipe.inputNodeId !== editingId)) {
      setSaveError(props.t('swipe.inputUnavailable'))
      return
    }
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
    await copyText(node.body.raw, node.id)
  }

  async function copyEntryLink(node: NarrativeNodeView) {
    await copyLink(props.getNodeLink(node.id), node.id)
  }

  function scheduleActiveEntryUpdate() {
    if (props.anchorNodeId && anchorStatus !== 'located' && anchorStatus !== 'idle') return
    updateViewportFollow()
    if (activeEntryFrameRef.current) return
    activeEntryFrameRef.current = requestAnimationFrame(() => {
      activeEntryFrameRef.current = undefined
      const timelineElement = timelineRef.current
      if (!timelineElement) return
      const viewport = timelineElement.getBoundingClientRect()
      const readingLine = viewport.top + viewport.height * 0.42
      let nearestEntryId = props.timeline[0]?.id
      let nearestDistance = Number.POSITIVE_INFINITY

      for (const item of virtualizer.getVirtualItems()) for (const entry of rounds[item.index].nodes) {
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
    smooth.pause()
    setActiveEntryId(entryId)
    props.onNodeAnchorChange(entryId)
    const index = rounds.findIndex(round => round.nodes.some(node => node.id === entryId))
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
  }

  function pauseFollowing() {
    smooth.pause()
  }

  function returnToLatest() {
    cancelAnchorNavigation()
    pendingAnchorScrollRef.current = undefined
    smooth.resume()
  }

  function communicationKey(round: TimelineSessionRound, communication: TimelineSessionCommunication) {
    return `${round.candidateId ?? round.id}:${communication.id}`
  }

  function renderCommunication(round: TimelineSessionRound, communication: TimelineSessionCommunication, latest: boolean) {
    const key = communicationKey(round, communication)
    const activeExecution = [...communication.discussions].reverse().find(execution => execution.runId === props.activeRun?.runId)
      ?? (round.execution.runId === props.activeRun?.runId ? round.execution : communication.execution)
    const activity = latest && communication === round.communications.at(-1)
      ? props.connecting ? '正在连接' : props.activeRun ? executionActivity(activeExecution) : undefined
      : undefined
    if (!communication.execution.steps.length && !communication.discussions.length && !activity) return null
    const expanded = expandedCommunication[key] ?? false
    const selected = latest ? props.inputSwipe?.swipe.candidates.findIndex(candidate => candidate.id === props.inputSwipe?.swipe.selectedCandidateId) : undefined
    return <section className={styles.communicationRecord}>
      <button className={styles.communicationToggle} type="button" aria-expanded={expanded} aria-controls={`communication-${key}`} onClick={() => {
        pauseFollowing()
        setExpandedCommunication(value => ({ ...value, [key]: !expanded }))
      }}>
        <span>Agent 对话</span>
        {activity && <span className={styles.communicationActivity} role="status">{activity}</span>}
        <ChevronDown className={styles.communicationChevron} data-expanded={expanded} aria-hidden="true" />
      </button>
      <ToolCollapse open={expanded} id={`communication-${key}`}>
      <div className={styles.communication}>
      <NarrativeCommunication rendererHost={props.rendererHost} agentSessionId={props.timelineId} displayProjection={props.communicationDisplay} followWork key={key} candidate={communication} round={round.number} selected={selected !== undefined && selected >= 0 ? selected : undefined}
        connecting={!!props.connecting && latest && communication === round.communications.at(-1)} activeRunId={props.activeRun?.runId} actionsDisabled={props.busy || props.activeRun?.status === 'running'}
        onSend={key === communicationKeys.at(-1) ? props.onSendDiscussion : undefined}
        editRunning={props.activeRun?.status === 'running'} onReviseInput={props.onReviseDiscussionInput}
        onRetryInput={props.onRetryDiscussionInput} onContinue={props.onContinueRun}
        onInspect={pauseFollowing} onReply={latest ? props.onDiscuss : undefined} onReturnCurrent={latest ? undefined : returnToLatest} />
      </div>
    </ToolCollapse></section>
  }

  function renderRoundNode(entry: NarrativeNodeView, round: TimelineSessionRound, latest: boolean) {
    const communication = round.communications.find(group => group.anchorNodeId === entry.id)!
    return renderNode(entry, undefined, renderCommunication(round, communication, latest))
  }

  function renderNode(entry: NarrativeNodeView, communication?: ReactNode, communicationContent?: ReactNode): ReactNode {
    const index = props.timeline.findIndex(node => node.id === entry.id)
    const role = readNarrativeNodeRole(props.timeline, index)
    return (
      <ContentErrorBoundary key={entry.id} resetKey={entry.body.raw} fallback={<pre role="alert">{entry.body.raw}</pre>}>
      <Suspense fallback={<div aria-busy="true" className={styles.messagePending} />}>
      <article
      inert={entry.id === props.displayOnlyNodeId || undefined}
      aria-busy={entry.id === props.displayOnlyNodeId || undefined}
      className={`${styles.message} ${styles[role]}`}
      data-loom-component="chat-message"
      data-loom-role="narrative"
      data-loom-motion={messageMotion?.id === entry.id ? messageMotion.direction : undefined}
      data-loom-state={editingId === entry.id ? 'editing' : 'settled'}
      data-loom-latest={index === props.timeline.length - 1 ? 'true' : undefined}
      id={`node-${encodeURIComponent(entry.id)}`}
      key={entry.id}
    >
      <NarrativeMessageHeader role={role} userName={userName} avatarUrl={props.userIdentity?.avatarUrl} t={props.t} />
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
        {entry.id === props.displayOnlyNodeId ? (
          <StaticMarkdown value={entry.body.raw} role={role} codeBlockLabels={messageCodeBlockLabels(props.t)} />
        ) : editingId === entry.id ? (
          <LongTextEditor
            autoFocus
            clearLabel={props.t('longTextEditor.clear')}
            clearedLabel={props.t('longTextEditor.cleared')}
            compact
            copiedLabel={props.t('longTextEditor.copied')}
            copyFailedLabel={props.t('longTextEditor.copyFailed')}
            copyLabel={props.t('longTextEditor.copy')}
            label={props.t(editingInputSwipe ? 'swipe.editInput' : 'timeline.editLocal')}
            headerExtra={<TextTokenSummary text={draft} scope={`${tokenScope}:${entry.id}`} t={props.t} />}
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
          <NarrativeMessageBody
            displayProjection={props.displayProjection}
            entry={entry}
            macroContext={props.macroContext}
            rendererHost={props.rendererHost}
            role={role}
            t={props.t}
            timelineId={props.timelineId}
          />
        )}
      </div>
      <MessageAttachments align={role === 'user' ? 'end' : 'start'} t={props.t} attachments={props.workEntries?.flatMap(item => item.id === entry.entryId && item.entry.kind === 'message' ? item.entry.attachments ?? [] : [])} />
      <ConversationMessageChrome
        createdAt={entry.createdAt}
        index={index}
        trailing={<>
          {communication}
          {entry.id === props.inputSwipe?.swipe.inputNodeId && editingId !== entry.id
            ? <NarrativeInputSwipePicker swipe={props.inputSwipe.swipe} disabled={props.inputSwipe.disabled || saving}
                onEdit={() => beginEdit(entry, true)} onSelect={props.inputSwipe.onSelect} t={props.t} />
            : props.swipeControls?.nodeId === entry.id ? props.swipeControls.content
            : !entry.parentNodeId ? props.openingControls : undefined}
        </>}
        metadata={editingId !== entry.id
          ? <span> · <TokenSummary t={props.t} multiplier={tokenMultiplier} pending={nodeTokens.currentCounts[index] === undefined}
              error={nodeTokens.currentCounts[index] === undefined ? nodeTokens.error : undefined}
              textTokens={nodeTokens.currentCounts[index] !== undefined
                ? applyTokenMultiplier(nodeTokens.currentCounts[index]!, tokenMultiplier).estimatedTokens : undefined} /></span> : undefined}
        actions={entry.id === props.displayOnlyNodeId ? undefined : editingId === entry.id ? (
          <>
            {saveError ? <span role="alert">{saveError}</span> : null}
            <ConversationMessageAction disabled={saving} label={props.t('timeline.cancelEdit')} onClick={cancelEdit}><X aria-hidden="true" /></ConversationMessageAction>
            <ConversationMessageAction disabled={saving || !draft.trim() || (editingInputSwipe && props.inputSwipe?.disabled)}
              label={props.t(editingInputSwipe ? 'swipe.submitInput' : 'timeline.saveEdit')} onClick={saveEdit}><Check aria-hidden="true" /></ConversationMessageAction>
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
      {communicationContent}
      </Suspense></ContentErrorBoundary>
    )
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
        <div className={styles.readingSurface} ref={contentRef}>
        <div ref={headerRef} className={styles.timelineHeader}>
          <DisplayProjectionStatus projection={props.displayProjection} retryLabel={props.t('textTransform.refresh')} />
          <DisplayProjectionStatus projection={props.communicationDisplay} retryLabel={props.t('textTransform.refresh')} />
          <DisplayProjectionStatus projection={props.timeline.length === 0 && props.openingDraft ? props.openingDisplay : undefined} retryLabel={props.t('textTransform.refresh')} />
          {anchorStatus === 'unavailable' ? <p role="status">{props.t('timeline.anchorUnavailable')}</p> : null}
          {anchorStatus === 'failed' ? <p role="alert">{props.t('timeline.anchorLoadFailed')}</p> : null}
          {props.hasOlder ? <button disabled={props.busy || anchorStatus === 'loading'} type="button" onClick={() => void props.onLoadOlder().catch(() => undefined)}>{props.t('timeline.loadOlder')}</button> : null}
        </div>
        {props.timeline.length === 0 ? (
          props.openingDraft ? (
            <ContentErrorBoundary resetKey={props.openingDraft.content} fallback={<pre role="alert">{props.openingDraft.content}</pre>}>
            <Suspense fallback={<div aria-busy="true" className={styles.renderingMessages} />}>
              <article
                className={`${styles.message} ${styles.assistant} ${styles.openingDraft}`}
                data-loom-component="chat-message"
                data-loom-role="narrative"
                data-loom-state="draft"
              >
                <NarrativeMessageHeader role="assistant" userName={userName} avatarUrl={props.userIdentity?.avatarUrl} t={props.t} />
                <div
                  className={styles.messageSurface}
                  data-loom-slot="message-content"
                >
                  {props.openingDisplay?.pending ? <div aria-busy="true" className={styles.displayPending} />
                    : <>
                  <ConversationMarkdown
                    className={`${styles.messageBody} ${props.openingDraft.isPlaceholder ? styles.placeholderBody : ''}`}
                    codeBlockLabels={messageCodeBlockLabels(props.t)}
                    role="assistant"
                          value={props.openingDisplay?.text ?? props.openingDraft.content}
                          macroContext={props.macroContext}
                  />
                  </>}
                </div>
                <ConversationMessageChrome index={0}
                  metadata={<> · {props.t('character.preview')} · <TextTokenSummary
                    text={props.openingDraft.isPlaceholder ? '' : props.openingDraft.content}
                    scope="opening-preview" t={props.t} /></>}
                  trailing={props.openingControls} />
              </article>
            </Suspense></ContentErrorBoundary>
          ) : props.busy ? (
            <div aria-busy="true" className={styles.timelineCenterLoading}>
              <LoadingText label={props.t('directory.loading')} />
            </div>
          ) : (
            <div className={`${styles.message} ${styles.assistant}`}>
              <div className={styles.empty}>{props.emptyTimelineText}</div>
              {props.openingControls ? <ConversationMessageChrome
                metadata={<TextTokenSummary text="" scope="opening-empty" t={props.t} />}
                trailing={props.openingControls} /> : null}
            </div>
          )
        ) : (
          <div ref={listRef} className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map(item => {
              const round = rounds[item.index]
              const latest = item.index === rounds.length - 1
              return <div key={round.id} data-index={item.index} ref={virtualizer.measureElement}
                className={styles.virtualRow} style={{ top: `${item.start - scrollMargin}px` }}>
                <section aria-label={round.number ? `第 ${round.number} 轮` : '创作准备'}>
                  {round.communications.filter(group => !group.anchorNodeId).map(group => <div key={group.id}>
                    {renderCommunication(round, group, latest)}
                  </div>)}
                  {round.inputNode && renderRoundNode(round.inputNode, round, latest)}
                  <NarrativeExecutionFlow key={round.execution.id} execution={round.execution} reading={false} hideReplies followWork onInspect={pauseFollowing}
                    renderNarrative={step => {
                      const node = round.nodes.find(node => node.id === step.id)
                      return node ? renderRoundNode(node, round, latest) : <article
                        className={`${styles.message} ${styles.assistant}`}
                        data-loom-component="chat-message" data-loom-role="narrative"
                        data-loom-state="streaming" aria-busy={step.state === 'running'}>
                        <NarrativeMessageHeader role="assistant" userName={userName} t={props.t} />
                        <div className={styles.messageSurface} data-loom-slot="message-content">
                          <ConversationMarkdown className={styles.messageBody}
                            role="assistant" value={displayText(props.displayProjection, step.id, step.content, true) ?? step.content} streaming={step.state === 'running'}
                            macroContext={props.macroContext} codeBlockLabels={messageCodeBlockLabels(props.t)} />
                        </div>
                      </article>
                    }} />
                </section>
              </div>
            })}
          </div>
        )}
        {!props.timelineId && props.onStartStory ? <button className={styles.startStory} type="button"
          disabled={props.busy} onClick={props.onStartStory}>
          <Play size={16} aria-hidden="true" />{props.t('timeline.startStory')}
        </button> : null}
        {props.timeline.length === 0 && rounds.map(round => <div className={styles.preparation} key={round.id}>
          <NarrativeExecutionFlow execution={round.execution} reading={false} hideReplies followWork onInspect={pauseFollowing} />
          {round.communications.map(group => <div key={group.id}>
            {renderCommunication(round, group, true)}
          </div>)}
        </div>)}
        {props.tail ? <div className={styles.tail} data-loom-surface="narrative.timeline.tail">{props.tail}</div> : null}
        </div>
      </div>
      {!smooth.following && (props.actionsHost ? createPortal(<Button size="small" className={styles.returnLatestButton} aria-label="回到最新" title="回到最新" onClick={returnToLatest}><ChevronDown aria-hidden="true" /><span className={styles.returnLatestLabel}>回到最新</span></Button>, props.actionsHost) : <div className={styles.returnLatest}><Button size="small" className={styles.returnLatestButton} aria-label="回到最新进度" title="回到最新进度" onClick={returnToLatest}><ChevronDown aria-hidden="true" /><span className={styles.returnLatestLabel}>回到最新进度</span></Button></div>)}
      <NarrativeTimelineNavigator
        activeId={activeEntryId}
        items={navigatorItems}
        renderPreview={text => renderTemplateMacros(text, props.macroContext)}
        label={props.t('timeline.navigator')}
        markers={navigatorMarkers}
        onNavigate={navigateToEntry}
      />
    </section>
  )
}

function NarrativeMessageBody(props: {
  displayProjection?: DisplayProjection
  entry: NarrativeNodeView
  macroContext?: MacroRenderContext
  rendererHost?: ClientRendererHost
  role: 'user' | 'assistant'
  t: Translator
  timelineId?: string
}) {
  const lastDisplay = useRef<{ raw: string; text: string } | undefined>(undefined)
  const projected = displayText(props.displayProjection, props.entry.id, props.entry.body.raw)
  if (projected !== undefined) lastDisplay.current = { raw: props.entry.body.raw, text: projected }
  const text = resolveNarrativeDisplayText(projected, props.entry.body.raw, lastDisplay.current, props.displayProjection)
  const content = (
    <ConversationMarkdown
      className={styles.messageBody}
      codeBlockLabels={messageCodeBlockLabels(props.t)}
      role={props.role}
      macroContext={props.macroContext}
      value={text}
    />
  )
  return props.rendererHost && props.timelineId ? (
    <RendererNodeMountHost
      host={props.rendererHost}
      nodeId={props.entry.id}
      rawText={props.entry.body.raw}
      displayText={text}
      surface="narrative"
      timelineId={props.timelineId}
    >
      {content}
    </RendererNodeMountHost>
  ) : content
}

function NarrativeMessageHeader(props: { role: 'user' | 'assistant'; userName: string; avatarUrl?: string; t: Translator }) {
  return <header className={styles.messageHeader}>
    {props.role === 'user' ? <UserIdentity name={props.userName} avatarUrl={props.avatarUrl} /> : <span>{props.t('timeline.role.assistant')}</span>}
  </header>
}

export function readNarrativeNodeRole(nodes: NarrativeNode[], index: number): 'user' | 'assistant' {
  return nodes[index].kind === 'user-input' ? 'user' : 'assistant'
}

export function resolveNarrativeDisplayText(
  projected: string | undefined,
  raw: string,
  lastDisplay?: { raw: string; text: string },
  projectionState?: { error?: string; pending?: boolean },
): string {
  return projected ?? (
    lastDisplay?.raw === raw
      ? lastDisplay.text
      : projectionState?.error
        ? raw
        : projectionState?.pending
          ? ''
          : raw
  )
}
