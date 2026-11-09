import { ResourceUpdateNotifications } from '../features/resource-updates/ui/resource-update-notifications.js'
import { ExtensionIdentityContext } from '../shared/ui/extension-icon/extension-icon.js'
import { AgentMutationApprovalDialog } from '../widgets/agent-chat-panel/agent-mutation-approval-dialog.js'
import { useUserBackgrounds } from '../features/backgrounds/model/use-user-backgrounds.js'
import { SessionSummaryActivity, type SummaryControl, type SummaryRow, type SummaryCoverage } from '../features/sessions/ui/session-summary-activity.js'
import { useExtensionCardContext } from '../features/extension-renderers/model/use-extension-card-context.js'
import { StartupReady } from './startup-curtain.js'
import { StudioPanelLoading } from '../pages/studio/studio-panel-loading.js'
import { useRecentCharacters } from '../features/recent-characters/model/use-recent-characters.js'
import type { RecentCharacter } from '../features/recent-characters/model/recent-characters.js'
import { Button, Dialog } from '@loom-studio/ui'
import { StudioOnboarding } from '../features/onboarding/ui/studio-onboarding.js'
import { assistantPresetId, completeOnboarding, readOnboardingComplete } from '../features/onboarding/model/onboarding-preferences.js'
import { onboardingCopy } from '../features/onboarding/model/onboarding-copy.js'
import onboardingStyles from '../features/onboarding/ui/studio-onboarding.module.scss'
import { AppStatusPage } from './app-status-page.js'
import { ContentErrorBoundary } from '../shared/ui/content-error-boundary.js'
import { StudioTimelineActions } from './studio-timeline-actions.js'
import { SelectionToolbar, appendQuote } from '../shared/ui/selection-toolbar/selection-toolbar.js'
import type { ResourceSearchReveal } from '../shared/lib/search-match.js'
import { startupAreas } from './use-studio-startup.js'
import type { Logger, MemoryLogSink } from '@loom-studio/logging'
import { useStudioState } from './use-studio-state.js'
import { StudioPage } from '../pages/studio/studio-page.js'
import { RecentPlayRail } from '../widgets/play-panel/recent-play-rail.js'
import { PresetWorkbenchHeader } from '../widgets/preset-workbench/preset-workbench-header.js'
import { ContextWorkbenchHeader } from '../widgets/context-workbench/context-workbench-header.js'
import { AgentComposer } from '../widgets/agent-composer/agent-composer.js'
import { AgentChatPanel, AgentPresetPicker } from '../widgets/agent-chat-panel/agent-chat-panel.js'
import { NarrativeTimeline } from '../widgets/narrative-timeline/narrative-timeline.js'
import { NarrativeSwipePicker } from '../features/narrative-runtime/ui/narrative-swipe-picker.js'
import { AgentTaskMenu } from '../features/narrative-runtime/ui/agent-task-menu.js'
import { CharacterPanelHeader } from '../widgets/character-panel/character-panel-header.js'
import { createClientRendererHost } from '../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererFocusSurface } from '../features/extension-renderers/ui/renderer-focus-surface.js'
import { RendererSurfaceHost } from '../features/extension-renderers/ui/renderer-surface-host.js'
import { useClientExtensionRuntime } from '../features/extension-renderers/model/use-client-extension-runtime.js'
import { OfficialExtensionSetup } from '../features/extension-renderers/ui/remote-extension-install.js'
import { resolveBackground } from '../features/extension-renderers/model/resolve-background.js'
import { listClientActions } from '../features/extension-renderers/model/client-actions.js'
import { ClientActionIcon } from '../features/extension-renderers/ui/client-action-icon.js'
import { type LoomScriptInputProjection, type LoomScriptRendererContribution } from '../features/loom-scripts/runtime/index.js'
import { useScriptRuntime } from '../features/loom-scripts/model/use-script-runtime.js'
import type { ClientRendererScope } from '../shared/extension-renderer-runtime/client-renderer-host.js'

import { NotificationToaster } from '../shared/ui/notification-toaster/notification-toaster.js'
import { ConfirmDialogHost } from '../shared/ui/confirm-dialog/index.js'
import type { StudioApi } from '../shared/api/studio-api.js'
import { notify } from '../shared/notifications/index.js'
import { useQueryClient } from '@tanstack/react-query'
import { createRendererNotifications } from '../shared/extension-renderer-runtime/renderer-notifications.js'
import { hasCompleteProviderAccount } from '../features/provider-settings/model/provider-account-status.js'
import { useStudioLayoutStore } from '../shared/studio-shell/studio-layout-store.js'
import { useStudioNavigation } from '../shared/studio-shell/use-studio-navigation.js'
import { useStudioUiState } from './use-studio-ui-state.js'
import { useStudioDerivedState } from './use-studio-derived-state.js'
import { StudioResourcePanels } from './studio-resource-panels.js'
import { createStudioPanels } from './studio-panel-registry.js'
import { preloadStudioPanel } from './studio-panel-modules.js'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { projectTimelineRounds } from '../features/narrative-runtime/model/timeline-execution-projection.js'
import { isTransientAgentEntryId, useDisplayProjection, useOpeningDisplayProjection } from '../features/message-content/model/use-display-projection.js'
import styles from './app.module.scss'
import '../styles/global.css'
import { isProviderOperationError } from '../shared/notifications/provider-error.js'
import { useAppearanceStore } from '../shared/studio-shell/appearance-store.js'
import { formatEntityReference, type GlobalSearchHit } from '@loom-studio/shared'
import { useGlobalSearchStore } from '../features/global-search/model/global-search-store.js'
import { GlobalSearchOverlay } from '../features/global-search/ui/global-search-overlay.js'
import { findNodeById } from '../shared/ui/file-tree/file-tree-model.js'
import { applyEffectiveMotion, initializeMotionPreference, useEffectiveMotion } from '../shared/hooks/use-motion-preference.js'
import { useThemeRuntime } from '../features/themes/model/use-theme-runtime.js'
import { createAppearanceCss } from '../features/themes/model/appearance-parameters.js'
import { useStudioAutofocus } from '../shared/studio-shell/use-studio-autofocus.js'

const ResourceReferenceDialog = lazy(async () => ({ default: (await import('../features/resource-references/resource-reference-dialog.js')).ResourceReferenceDialog }))
const StudioDashboard = lazy(async () => ({ default: (await import('./studio-dashboard.js')).StudioDashboard }))

function initializeAppearancePreview() {
  const root = document.documentElement
  if (!root.dataset.loomMaterialPreview) {
    root.dataset.loomMaterialPreview = 'glass'
  }
}

export function App(props: {
  clientLogs: MemoryLogSink
  transportLogger: Logger
  extensionLogger: Logger
  themeLogger?: Logger
  runtimeLogger?: Logger
}) {
  initializeAppearancePreview()
  initializeMotionPreference()
  const narrativeSelectionRef = useRef<HTMLDivElement>(null)
  const narrativeInputRef = useRef<HTMLTextAreaElement>(null)
  const appearance = useAppearanceStore()
  const state = useStudioState(props.transportLogger, props.runtimeLogger)
  const latestState = useRef(state)
  latestState.current = state
  const userBackgrounds = useUserBackgrounds(state.api.userBackgrounds, state.endpoint, state.t)
  const [onboardingComplete, setOnboardingComplete] = useState(readOnboardingComplete)
  const [summaryCoverage, setSummaryCoverage] = useState<{ sessionId: string; coverage?: SummaryCoverage }>()
  const [summaryRows, setSummaryRows] = useState<{ sessionId: string; rows: SummaryRow[] }>()
  const [summaryControl, setSummaryControl] = useState<SummaryControl>()
  const [assistantGuide, setAssistantGuide] = useState(false)
  const [timelineActionsHost, setTimelineActionsHost] = useState<HTMLDivElement | null>(null)
  const queryClient = useQueryClient()
  useEffect(() => {
    document.documentElement.lang = state.locale
  }, [state.locale])
  const appearanceCardId = state.narrativeTimeline?.createdFrom?.cardId ?? state.selectedCardId
  const effectiveMotion = useEffectiveMotion()
  useEffect(() => applyEffectiveMotion(effectiveMotion), [effectiveMotion])
  const rendererHost = useMemo(() => createClientRendererHost(), [])
  const notifications = useMemo(() => createRendererNotifications((owner, input) => {
    notify[input.level ?? 'info'](input.message, { description: '扩展通知', details: `来源：${owner}`, duration: 4000 })
  }), [])
  const clientExtensions = useClientExtensionRuntime({ api: state.clientExtensionApi, rendererHost, logger: props.extensionLogger, clientLogs: props.clientLogs, notify: notifications.show })
  const extensionCardContext = useExtensionCardContext(state.api, appearanceCardId, state.selectedCardDetails, `${clientExtensions.refreshSequence}:${state.cards.find(card => card.id === appearanceCardId)?.version ?? ''}`, state.readCardDetails)
  const themeController = useThemeRuntime({
    packages: clientExtensions.packages,
    ready: clientExtensions.refreshSequence > 0 || !!clientExtensions.error,
    authorize: clientExtensions.enable,
    logger: props.themeLogger,
  })
  const reportedExtensionError = useRef<string | undefined>(undefined)
  const extensionConnectionError = clientExtensions.connectionError?.message
  useEffect(() => {
    const id = 'extension-events-unavailable'
    if (!extensionConnectionError) { notify.dismiss(id); return }
    props.extensionLogger.warn('Extension event connection remains unavailable; automatic reconnect is active', {
      event: 'extension.connection.unavailable', error: extensionConnectionError,
    })
    notify.warning(state.t('renderer.connectionUnavailable'), { id })
    return () => { notify.dismiss(id) }
  }, [extensionConnectionError, props.extensionLogger, state.t])
  const extensionError = clientExtensions.error?.message
  useEffect(() => {
    if (reportedExtensionError.current === extensionError) return
    reportedExtensionError.current = extensionError
    if (!extensionError) return
    props.extensionLogger.warn('Client extension runtime synchronization failed', {
      event: 'extension.sync.failed', error: extensionError,
    })
    notify.warning(state.t('renderer.runtimeUnavailable'), {
      id: 'extension-runtime-unavailable', description: extensionError,
    })
  }, [extensionError, props.extensionLogger, state.t])
  const appearanceBackground = resolveBackground(
    appearance.scopedBackground && appearance.scopedBackground.cardId === appearanceCardId
      ? appearance.scopedBackground : appearance.background,
    [...clientExtensions.host.backgrounds(), ...userBackgrounds.backgrounds],
    appearanceCardId,
  )
  useEffect(() => {
    const root = document.documentElement
    root.dataset.loomMaterialPreview = appearance.material.mode
    if (appearance.material.mode === 'glass' && (appearance.material.glassPanels ?? true)) {
      root.dataset.loomGlassPanels = 'true'
    } else {
      delete root.dataset.loomGlassPanels
    }
    if (appearanceBackground) {
      root.dataset.loomPreviewBackground = appearanceBackground.key
      root.style.setProperty('--loom-preview-wallpaper', `url(${JSON.stringify(appearanceBackground.image)})`)
    } else {
      delete root.dataset.loomPreviewBackground
      root.style.removeProperty('--loom-preview-wallpaper')
    }
  }, [appearanceBackground, appearance.canvasWidth, appearance.material])
  const uiState = useStudioUiState()
  const timelineRouteRequestRef = useRef(0)
  const navigation = useStudioNavigation({ endpoint: state.endpoint, api: state.api })
  const [overlaysReady, setOverlaysReady] = useState(false)
  useStudioAutofocus(overlaysReady, narrativeInputRef, appearance.focusComposerOnStartup)
  const onStartupDismissed = useCallback(() => setOverlaysReady(true), [])
  const [referenceVisited, setReferenceVisited] = useState(false)
  useEffect(() => {
    if (navigation.referenceUri) setReferenceVisited(true)
  }, [navigation.referenceUri])
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [dashboardVisited, setDashboardVisited] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMatch, setSearchMatch] = useState<ResourceSearchReveal>()
  const [recentSearch, setRecentSearch] = useState<{ endpoint: string; items: GlobalSearchHit[] }>({ endpoint: state.endpoint, items: [] })
  useEffect(() => {
    function onSearchShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.code !== 'KeyK' || event.isComposing) return
      if (!searchOpen && document.querySelector('dialog[open]')) return
      event.preventDefault()
      setSearchOpen(value => !value)
    }
    window.addEventListener('keydown', onSearchShortcut)
    return () => window.removeEventListener('keydown', onSearchShortcut)
  }, [searchOpen])
  async function openSearchResult(hit: GlobalSearchHit, query: string) {
    setSearchOpen(false)
    const target = hit.target
    const isCurrent = navigation.beginTargetNavigation()
    try {
      if (target.type === 'card') await navigation.openUri(formatEntityReference({ kind: 'entity', type: 'card', id: target.cardId }))
      else if (target.type === 'resource') {
        const resource = await state.refreshPromptResource(target.resourceId)
        if (!isCurrent()) return
        if (!resource || !findNodeById([resource.rootNode], target.nodeId)) throw new Error(state.t('navigation.targetUnavailable'))
        if (target.resourceKind === 'preset') uiState.setSelectedPresetId(target.resourceId)
        setSearchMatch(previous => ({ resourceId: target.resourceId, nodeId: target.nodeId, query, requestId: (previous?.requestId ?? 0) + 1 }))
        navigation.setSearchQuery('')
        await navigation.openResource(target.resourceKind === 'preset' ? 'preset' : 'resource', target.resourceId, target.nodeId, false, true)
      } else if (target.type === 'timeline') await navigation.openNarrative(target.timelineId)
      else await openAgentSession(target.sessionId)
      setRecentSearch(current => ({ endpoint: state.endpoint, items: [hit, ...(current.endpoint === state.endpoint ? current.items : []).filter(item => item.id !== hit.id)].slice(0, 8) }))
    } catch (error) {
      notify.error(state.t('navigation.targetUnavailable'), { details: error instanceof Error ? error.message : String(error) })
    }
  }
  async function openAgentSession(sessionId: string) {
    const isCurrent = navigation.beginTargetNavigation()
    const activated = await state.activateAgentSession(sessionId, isCurrent)
    if (!activated || !isCurrent()) return
    const closeSourceTool = navigation.route.tool && navigation.isCurrent()
    if (closeSourceTool) void navigation.closeTool()
    if (activated.session.timelineId) {
      void navigation.updateNarrativeContext(activated.session.timelineId, activated.branchId ?? '')
    }
    uiState.setAgentPanelOpen(true)
  }
  function onTextTransformsChanged() {
    uiState.bumpLoomScriptRefreshToken()
    void queryClient.invalidateQueries({ queryKey: ['user-resources', state.endpoint, 'rules'] })
  }
  const [navigationRetry, setNavigationRetry] = useState(0)
  const [navigationFailure, setNavigationFailure] = useState<{ target: string; message: string }>()
  const narrativeTarget = JSON.stringify([state.endpoint, navigation.route.timelineId, navigation.route.branchId, navigation.route.previewCardId])
  const uiScale = useStudioLayoutStore(current => current.uiScale)
  const uiScaleOverridden = useStudioLayoutStore(current => current.uiScaleOverridden)
  useEffect(() => {
    const sheet = document.createElement('style')
    sheet.textContent = createAppearanceCss(appearance, uiScale, uiScaleOverridden)
    document.head.append(sheet)
    document.dispatchEvent(new Event('loom:theme-changed'))
    return () => { sheet.remove() }
  }, [appearance.canvasWidth, appearance.material, appearance.explicitOverrides, uiScale, uiScaleOverridden])
  const setUiScale = useStudioLayoutStore(current => current.setUiScale)
  const composerPinned = useStudioLayoutStore(current => current.composerPinned)
  const toggleComposerPinned = useStudioLayoutStore(current => current.toggleComposerPinned)
  const derived = useStudioDerivedState(state)
  const { assetWorkspaceId, cardsBusy, providerBusy, agentPresetBusy, activePresetId,
    sourceCardId, canOpenTimelineSource,
    sessionBusy, agentChatBusy, mutationBusy } = derived
  const globalSearchQuery = useGlobalSearchStore(store => store.byEndpoint[state.endpoint]?.query ?? '')
  const contextWorkspaceId = JSON.stringify([state.endpoint, assetWorkspaceId])
  function inspectDisplayRules(diagnostics: NonNullable<ReturnType<typeof useDisplayProjection>>['diagnostics']) {
    const presetId = diagnostics?.find(item => item.presetId)?.presetId
    const preset = state.promptResources.find(item => item.id === presetId)
    if (preset) void navigation.openResource('preset', preset.id, preset.rootNode.id)
    else void navigation.openPanel('text-transform')
  }
  const openingDisplay = useOpeningDisplayProjection({
    onInspect: inspectDisplayRules,
    api: state.textTransformsApi,
    endpoint: state.endpoint,
    opening: !state.narrativeTimeline && state.selectedCardDetails?.id === state.selectedCardId
      && state.selectedCardId && state.openingDraft && !state.openingDraft.isPlaceholder
      ? { cardId: state.selectedCardId, presetId: activePresetId, text: state.openingDraft.content }
      : undefined,
    refreshToken: uiState.loomScriptRefreshToken,
  })
  const narrativePresetName = state.agentPresets.find(preset => preset.id === state.narrativeAgentSession?.agentPresetId)?.rootNode.label ?? '尚未选择预设'
  const narrativeRounds = useMemo(() => projectTimelineRounds(state.narrativeWorkEntries,
    state.narrativeNodes, narrativePresetName, state.narrativeActiveRun),
  [state.narrativeWorkEntries, state.narrativeNodes, narrativePresetName, state.narrativeActiveRun])
  const narrativeStreamingEntries = useMemo(() => narrativeRounds
    .flatMap(round => round.execution.steps.flatMap(step => step.kind === 'narrative' && step.state === 'running'
      ? [{ id: step.id, text: step.content, role: 'assistant' as const, streaming: true }] : [])),
  [narrativeRounds])
  const narrativeDisplay = useDisplayProjection({
    onInspect: inspectDisplayRules,
    api: state.textTransformsApi,
    endpoint: state.endpoint,
    source: state.narrativeTimeline && state.branch ? { kind: 'narrative', timelineId: state.narrativeTimeline.id, branchId: state.branch.id } : undefined,
    consumerAgentSessionId: state.narrativeAgentSession?.id,
    entries: [...state.narrativeNodes.map(node => ({ id: node.id, text: node.body.raw })), ...narrativeStreamingEntries],
    revision: activePresetId,
    refreshToken: uiState.loomScriptRefreshToken,
  })
  const communicationDisplay = useDisplayProjection({
    onInspect: inspectDisplayRules,
    api: state.textTransformsApi,
    endpoint: state.endpoint,
    source: state.narrativeAgentSession ? { kind: 'agent-session', sessionId: state.narrativeAgentSession.id } : undefined,
    entries: state.narrativeWorkEntries.flatMap(message => message.entry.kind === 'message' && typeof message.entry.content === 'string'
      ? [{ id: message.id, text: message.entry.content, role: message.entry.role, streaming: isTransientAgentEntryId(message.id) || message.entry.state === 'partial' }] : []),
    revision: activePresetId,
    refreshToken: uiState.loomScriptRefreshToken,
  })
  const agentDisplay = useDisplayProjection({
    onInspect: inspectDisplayRules,
    api: state.textTransformsApi,
    endpoint: state.endpoint,
    source: state.agentChatSession ? { kind: 'agent-session', sessionId: state.agentChatSession.id } : undefined,
    entries: state.agentChatMessages.flatMap(message => message.entry.kind === 'message' && typeof message.entry.content === 'string'
      ? [{ id: message.id, text: message.entry.content, role: message.entry.role, streaming: isTransientAgentEntryId(message.id) || message.entry.state === 'partial' }] : []),
    revision: activePresetId,
    refreshToken: uiState.loomScriptRefreshToken,
  })
  const historyNavigationContext = useRef('')
  historyNavigationContext.current = JSON.stringify([state.endpoint, navigation.locationKey, assetWorkspaceId, state.selectedCardId])
  const narrativeNavigating = navigation.targetPending
    || navigation.route.timelineId !== state.narrativeTimeline?.id
    || Boolean(navigation.route.branchId && navigation.route.branchId !== state.branch?.id)
    || Boolean(!navigation.route.timelineId && navigation.route.previewCardId
      && (state.selectedCardId !== navigation.route.previewCardId || state.selectedCardDetails?.id !== navigation.route.previewCardId))
  const visitedCardId = onboardingComplete && !narrativeNavigating && !navigation.route.panel && !navigation.route.targetUri
    ? state.narrativeTimeline?.createdFrom?.cardId
      ?? (navigation.route.previewCardId === state.selectedCardDetails?.id ? navigation.route.previewCardId : undefined)
    : undefined
  const recentCharacters = useRecentCharacters(state.endpoint, visitedCardId,
    visitedCardId ? state.narrativeTimeline?.id : undefined,
    visitedCardId ? state.branch?.id : undefined)
  const recentNavigationRequest = useRef(0)
  async function openRecentCharacter(visit: RecentCharacter) {
    const request = ++recentNavigationRequest.current
    try {
      const card = state.cards.find(item => item.id === visit.cardId)
      if (!card) return
      if (card.validationError !== undefined) { void navigation.openPanel('character', { cardId: card.id }); return }
      const timelines = await state.refreshCardTimelines(card.id)
      if (request !== recentNavigationRequest.current || !navigation.isCurrent()) return
      const timeline = timelines.find(item => item.id === visit.timelineId)
      if (timeline) {
        const details = await state.api.narratives.get(timeline.id)
        if (request !== recentNavigationRequest.current || !navigation.isCurrent()) return
        if (visit.branchId && details.branches.some(branch => branch.id === visit.branchId)) {
          void navigation.openNarrative(timeline.id, visit.branchId)
          return
        }
      }
      state.setSelectedCardId(card.id)
      state.resetToDraftTimeline()
      void navigation.openCardPreview(card.id)
      if (visit.timelineId) notify.info(state.t('recentCharacters.unavailable'))
    } catch (error) {
      if (request === recentNavigationRequest.current && navigation.isCurrent()) notify.failure('打开历史记录失败', error)
    }
  }
  const composerCommandContext = {
    sourceSurface: 'composer.quick-actions' as const,
    workspaceId: 'workspace',
    ...(appearanceCardId ? { cardId: appearanceCardId } : {}),
    ...(state.narrativeTimeline ? { timelineId: state.narrativeTimeline.id } : {}),
    ...(state.agentChatSession ? { agentSessionId: state.agentChatSession.id } : {}),
  }
  const composerQuickActions = listClientActions({
    packages: [...clientExtensions.packages, ...clientExtensions.cardPackages],
    isAvailable: clientExtensions.host.isPackageAvailable,
    surface: 'composer.quick-actions',
    context: composerCommandContext,
  }).map(action => ({
    id: action.key,
    label: action.command.title,
    ...(action.command.icon ? { icon: <ClientActionIcon name={action.command.icon} /> } : {}),
    onSelect: () => {
      void clientExtensions.host.executeCommand({
        packageId: action.packageId,
        moduleId: action.moduleId,
        commandId: action.command.id,
        target: action.target,
        sourceSurface: 'composer.quick-actions',
      }).then(result => {
        if (result.status === 'failed') notify.failure(`扩展命令「${action.command.title}」执行失败`, result.message)
      })
    },
  }))
  const headerActions = listClientActions({
    packages: [...clientExtensions.packages, ...clientExtensions.cardPackages],
    isAvailable: clientExtensions.host.isPackageAvailable,
    surface: 'stage.header.actions',
    context: composerCommandContext,
  }).map(action => {
    const extensionPackage = clientExtensions.packages.find(item => item.packageId === action.packageId)
    const iconUrl = extensionIconUrl(extensionPackage)
    return (
      <button
        aria-label={action.command.title}
        className={`loom-stage-extension-action${action.packageId === 'official.the-world' ? ' loom-stage-the-world-action' : ''}`}
        key={action.key}
        title={action.command.title}
        type="button"
        onClick={() => {
          void clientExtensions.host.executeCommand({ packageId: action.packageId, moduleId: action.moduleId, commandId: action.command.id, target: action.target, sourceSurface: 'stage.header.actions' }).then(result => {
            if (result.status === 'failed') notify.failure(`扩展命令「${action.command.title}」执行失败`, result.message)
          })
        }}
      >
        {action.packageId === 'official.the-world'
          ? <span data-the-world-toggle="" aria-hidden="true" />
          : iconUrl ? <img src={iconUrl} alt="" aria-hidden="true" /> : <ClientActionIcon name={action.command.icon} />}
      </button>
    )
  })

  function focusHistoryAsset(target: Awaited<ReturnType<typeof state.undoEdit>>) {
    if (!target) return
    useStudioLayoutStore.getState().openAssetDetail(target.layoutId, contextWorkspaceId, target.assetId)
  }

  async function applyHistoryAction(action: typeof state.undoEdit) {
    const context = historyNavigationContext.current
    const layouts = useStudioLayoutStore.getState().assetLayouts
    const canNavigate = () => context === historyNavigationContext.current
      && layouts === useStudioLayoutStore.getState().assetLayouts
    const target = await action(canNavigate)
    if (canNavigate()) focusHistoryAsset(target)
  }

  function openStateSource(scope: 'global' | 'timeline') {
    if (scope !== 'timeline' || !canOpenTimelineSource) return
    uiState.setVariableView('authoring')
    navigation.openPanel('state')
  }

  const reportedOperationSequence = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!state.operationError || reportedOperationSequence.current === state.operationError.sequence) return
    reportedOperationSequence.current = state.operationError.sequence
    const isProvider = isProviderOperationError(state.operationError.scope, state.operationError.message)
    if (isProvider) {
      notify.providerError(state.operationError.message, state.t, {
        id: `operation-error-${state.operationError.sequence}`,
        action: { label: '查看应用日志', onClick: () => { void navigation.openPanel('logs', { search: 'logView=application' }) } },
      })
    } else {
      notify.failure('操作未完成', state.operationError.message, {
        id: `operation-error-${state.operationError.sequence}`,
        action: { label: '查看应用日志', onClick: () => { void navigation.openPanel('logs', { search: 'logView=application' }) } },
      })
    }
  }, [state.operationError, state.t])

  useEffect(() => {
    for (const area of startupAreas) {
      if (!state.startup.failures.some(failure => failure.area === area)) notify.dismiss(`startup-${area}`)
    }
    for (const { area, error } of state.startup.failures) {
      notify.failure(`${({ cards: '角色列表', sessions: '会话列表', providers: '模型配置', tools: '工具目录', network: '网络配置' })[area]}加载失败`, error, {
        id: `startup-${area}`, duration: Infinity,
        action: { label: state.t('appError.reload'), onClick: () => { void state.startup.retry(area) } },
      })
    }
  }, [state.startup.failures])

  useEffect(() => {
    if (!state.invalidPromptResources.length) { notify.dismiss('prompt-resource-invalid'); return }
    notify.warning(state.t('promptResource.invalidResourcesNotice'), { id: 'prompt-resource-invalid', duration: Infinity,
      action: { label: state.t('rail.user'), onClick: () => navigation.openPanel('user') },
    })
  }, [state.invalidPromptResources, state.t])

  useEffect(() => {
    if (!state.promptResourceError) { notify.dismiss('prompt-resource-query-error'); return }
    notify.failure('读取提示词资源失败', state.promptResourceError, { id: 'prompt-resource-query-error', duration: Infinity,
      action: { label: state.t('appError.reload'), onClick: () => { void state.retryPromptResources().catch(() => undefined) } },
    })
  }, [state.promptResourceError])

  useEffect(() => {
    const warnings = state.promptBuildTrace?.diagnostics.filter(item => item && typeof item === 'object'
      && 'code' in item && typeof item.code === 'string' && item.code.startsWith('prompt.processor_')) ?? []
    if (!warnings.length) { notify.dismiss('prompt-processor-warning'); return }
    notify.warning(state.t('promptResource.processingWarning'), { id: 'prompt-processor-warning', duration: Infinity,
      action: { label: state.t('rail.inspector'), onClick: () => navigation.openPanel('inspector') },
    })
  }, [state.promptBuildTrace, state.t])

  useEffect(() => {
    rendererHost.setScopeSnapshot({
      workspace: 'workspace',
      cardId: state.narrativeTimeline?.createdFrom?.cardId ?? state.selectedCardId,
      ...(!narrativeNavigating && state.narrativeTimeline && state.branch?.timelineId === state.narrativeTimeline.id
        ? { timelineId: state.narrativeTimeline.id, branchId: state.branch.id } : {}),
      ...(state.agentChatSession ? { agentSessionId: state.agentChatSession.id } : {}),
    })
  }, [rendererHost, narrativeNavigating, state.agentChatSession?.id, state.narrativeTimeline?.id, state.narrativeTimeline?.createdFrom?.cardId, state.branch?.id, state.branch?.timelineId, state.selectedCardId])

  useScriptRuntime({
    onInspectScript: scriptId => { void navigation.openPanel('extensions', { search: new URLSearchParams({ extensionView: 'scripts', scriptFilter: 'runtime', ...(scriptId ? { scriptId } : {}) }).toString() }) },
    api: state.api,
    rendererHost,
    listBackgrounds: clientExtensions.host.backgrounds,
    logger: props.extensionLogger,
    presetId: activePresetId,
    refreshToken: uiState.loomScriptRefreshToken,
    resolveInputs: (scope, contribution) => resolveLoomScriptInputs({
      api: state.api,
      scope,
      contribution,
      narrative: state.narrativeTimeline && state.branch ? {
        timelineId: state.narrativeTimeline.id,
        branchId: state.branch.id,
        consumerAgentSessionId: state.narrativeAgentSession?.id ?? state.agentChatSession?.id,
      } : undefined,
      agentSessionId: state.agentChatSession?.id,
    }),
    stateRead: async target => (await state.statesApi.get(target)).snapshot.value,
    notify: notifications.show,
  })

  useEffect(() => {
    if (navigation.route.targetUri !== undefined) return
    setNavigationFailure(undefined)
    const requestId = ++timelineRouteRequestRef.current
    const isCurrent = () => requestId === timelineRouteRequestRef.current && navigation.isNarrativeCurrent()
    if (!navigation.route.timelineId) {
      state.resetToDraftTimeline()
      const previewCardId = navigation.route.previewCardId
      if (previewCardId && state.startup.ready('cards')) {
        if (!state.cards.some(card => card.id === previewCardId)) {
          setNavigationFailure({ target: narrativeTarget, message: state.t('navigation.targetUnavailable') })
        } else {
          state.setSelectedCardId(previewCardId)
          navigation.acceptPreview(previewCardId)
        }
      } else if (!previewCardId) navigation.acceptPreview()
      return () => { timelineRouteRequestRef.current++ }
    }
    if (state.agentChatSessionReady && navigation.route.timelineId === state.narrativeTimeline?.id && (!navigation.route.branchId || navigation.route.branchId === state.branch?.id)) {
      navigation.updateNarrativeContext(state.narrativeTimeline.id, state.branch!.id)
      return () => { timelineRouteRequestRef.current++ }
    }
    void state.activateTimeline(navigation.route.timelineId, navigation.route.branchId, isCurrent).then(branchId => {
      if (!isCurrent()) return
      if (!branchId) setNavigationFailure({ target: narrativeTarget, message: state.t('navigation.targetUnavailable') })
      else navigation.updateNarrativeContext(navigation.route.timelineId!, branchId)
    })
    return () => { timelineRouteRequestRef.current++ }
  }, [narrativeTarget, navigation.route.targetUri, navigationRetry, state.startup.ready('cards')])

  async function deleteCards(cardIds: string[], options?: { includePlayData?: boolean; includePromptResources?: boolean }) {
    const source = state.api
    let committed = false
    try {
      await state.deleteCards(cardIds, options, deletedCardIds => {
        committed = true
        const latest = latestState.current
        if (source !== latest.api) return
        const timelines = [...latest.allTimelines, ...latest.cardTimelines, ...(latest.narrativeTimeline ? [latest.narrativeTimeline] : [])]
        const deletedTimelineIds = options?.includePlayData
          ? timelines.filter(timeline => timeline.createdFrom?.cardId && deletedCardIds.includes(timeline.createdFrom.cardId)).map(timeline => timeline.id)
          : []
        if (latest.narrativeTimeline && deletedTimelineIds.includes(latest.narrativeTimeline.id)) latest.resetToDraftTimeline()
        navigation.clearDeletedCards(deletedCardIds, deletedTimelineIds)
      })
    } finally {
      if (committed && source === latestState.current.api) await latestState.current.refreshAllTimelines()
    }
  }

  const resourcePanels = StudioResourcePanels({ state, currentCard: extensionCardContext.card, uiState, navigation, assetWorkspaceId,
    globalSearchQuery,
    searchMatch: !globalSearchQuery.trim() ? undefined : searchMatch?.query === globalSearchQuery ? searchMatch
      : navigation.route.resourceId && navigation.route.assetId ? { resourceId: navigation.route.resourceId, nodeId: navigation.route.assetId, query: globalSearchQuery, requestId: 0 } : undefined })
  const panels = createStudioPanels({ state, onDeleteCards: deleteCards, recentCharacters, openRecentCharacter, extensionCardContext, uiState, navigation, rendererHost, clientExtensions, themeController, clientLogs: props.clientLogs, resourcePanels, assetWorkspaceId, cardsBusy, providerBusy, agentPresetBusy, activePresetId, sourceCardId, sessionBusy, openStateSource, openAgentSession, onTextTransformsChanged, uiScale, setUiScale, backgrounds: clientExtensions.host.backgrounds(), userBackgrounds })

  const studio = (
    <StudioPage
      overlaysReady={overlaysReady}
      mobileChromeLocked={Boolean(state.runRecovery)}
      navigation={navigation}
      assetWorkspaceId={contextWorkspaceId}
      wallpaperUrl={appearanceBackground?.image}
      background={(
        <RendererSurfaceHost
          host={rendererHost}
          scope={{ kind: 'workspace', key: 'workspace' }}
          surface="shell.background"
        />
      )}
      headerActions={headerActions}
      onOpenDashboard={() => { setDashboardVisited(true); setDashboardOpen(true) }}
      onOpenSearch={() => setSearchOpen(true)}
      searchQuery={globalSearchQuery.trim()}
      onClearSearch={() => {
        const { dispatch } = useGlobalSearchStore.getState()
        dispatch(state.endpoint, { type: 'mode', mode: 'results' })
        dispatch(state.endpoint, { type: 'input', value: '' })
        setSearchMatch(undefined)
      }}
      modelConfigured={state.providerAccountsLoaded ? hasCompleteProviderAccount(state.providerAccounts) : undefined}
      busy={mutationBusy}
      canRedo={state.canRedoEdit}
      agentSession={state.agentChatSession}
      agentSessionsCount={state.agentChatSessions?.length}
      agentPanel={<ContentErrorBoundary resetKey={state.agentChatSession?.id} fallback={error => <p role="alert">{error.message}</p>}><AgentChatPanel scrollRestorationScope={JSON.stringify([state.endpoint, state.agentChatSession?.id])}
        userIdentity={state.agentUserIdentity}
        onboardingHint={assistantGuide ? <aside className={onboardingStyles.guide} role="status"><p>{onboardingCopy[state.locale].guide}</p><Button onClick={() => setAssistantGuide(false)}>{onboardingCopy[state.locale].dismiss}</Button></aside> : null}
        initialCreatePresetId={assistantGuide ? assistantPresetId : undefined}
        active={uiState.agentPanelOpen}
      busy={agentChatBusy}
      summaryCoverage={summaryCoverage?.sessionId === state.agentChatSession?.id ? summaryCoverage?.coverage : undefined}
      summaryRows={summaryRows?.sessionId === state.agentChatSession?.id ? summaryRows?.rows : undefined}
      summaryControl={summaryControl?.sessionId === state.agentChatSession?.id ? summaryControl : undefined}
      activeRun={state.agentActiveRun}
      runRecovery={state.runRecovery}
      runRecoveryBusy={state.runRecoveryBusy}
      abandonAgentRun={state.abandonAgentRun}
      canRestoreRunInput={state.canRestoreRunInput}
      reconnectAgentRun={state.reconnectAgentRun}
      restoreRunInput={state.restoreRunInput}
      attachmentNotice={state.agentAttachments.notice} onRetryAttachment={state.agentAttachments.retry} attachments={state.agentAttachments.items} onAddAttachments={state.agentAttachments.add} onRemoveAttachment={state.agentAttachments.remove}
      input={state.agentChatInput}
      onReviseInput={state.agentChatSession ? (entryId, expected, originalAttachments, content, attachments) => state.reviseUserInput(state.agentChatSession!.id, entryId, expected, originalAttachments, content, attachments) : undefined}
      messages={state.agentChatMessages}
      displayProjection={agentDisplay}
      onOpenMemory={() => { if (state.agentChatSession) void navigation.openSessionSummary(state.agentChatSession.id) }}
      session={state.agentChatSession}
      sessions={state.agentChatSessions}
      cards={state.cards}
      timelines={state.allTimelines}
      sessionReady={state.agentChatSessionReady}
      profiles={state.agentPresets}
      sessionTail={state.agentChatSession ? (<>
        <SessionSummaryActivity key={state.agentChatSession.id} api={state.api} sessionId={state.agentChatSession.id}
          onCoverage={setSummaryCoverage} historyVersion={agentChatBusy ? undefined : state.agentChatMessages.at(-1)?.id} onRows={setSummaryRows} onControl={setSummaryControl} title={state.agentChatSession.title ?? '当前会话'} onUpdate={state.refreshTaskSession}
          onOpen={() => { void navigation.openSessionSummary(state.agentChatSession!.id) }} />
        <RendererSurfaceHost
          host={rendererHost}
          scope={{ kind: 'agent-session', key: state.agentChatSession.id }}
          surface="agent.session.tail"
        /></>
      ) : undefined}
      onChangeInput={state.setAgentChatInput}
      onSelectProfile={state.selectAgentPreset}
      onSelectSession={id => { void openAgentSession(id) }}
      onNewSession={state.newAgentSession}
      onCreateSession={async presetId => {
        const session = await state.createAgentSession(presetId, false)
        if (session) setAssistantGuide(false)
        return session
      }}
      primarySessionId={state.narrativeAgentSession?.id}
      onRenameSession={state.renameAgentSession}
      onDeleteSession={id => { void state.deleteAgentSession(id) }}
      onSubmit={state.submitAgentTurn}
      onCancelRun={() => { void state.cancelAgentRun() }}
      onPauseRun={() => { void state.pauseAgentRun() }}
      onResumeRun={() => { void state.resumeAgentRun() }}
      onApproveMutation={state.approveAgentMutation}
      providerAccounts={state.providerAccounts}
      rendererHost={rendererHost}
      selectedProfileId={state.selectedAgentPresetId}
      t={state.t}
      /></ContentErrorBoundary>}
      agentPanelOpen={uiState.agentPanelOpen}
      canUndo={state.canUndoEdit}
      characterControl={appearanceCardId ? <StudioTimelineActions
        key={JSON.stringify([state.endpoint, appearanceCardId, state.narrativeTimeline?.id])}
        state={state} navigation={navigation} cardId={appearanceCardId} onDeleteCards={deleteCards}
        busy={sessionBusy || cardsBusy || mutationBusy || narrativeNavigating || Boolean(state.runRecovery)
          || state.agentActiveRun?.status === 'running' || state.agentActiveRun?.status === 'suspended'} /> : undefined}
      onRedo={() => { void applyHistoryAction(state.redoEdit) }}
      onToggleAgentPanel={() => uiState.setAgentPanelOpen(prev => !prev)}
      onUndo={() => {
        void applyHistoryAction(state.undoEdit)
      }}
      panelHeaderMain={{
        character: <CharacterPanelHeader t={state.t} />,
        agent: (
          <PresetWorkbenchHeader
            library={!navigation.route.resourceId && !navigation.route.assetId}
            resources={state.promptResources}
            selectedResourceId={navigation.route.panel === 'agent' ? navigation.route.resourceId ?? uiState.selectedPresetId : uiState.selectedPresetId}
            onSelectResource={resourceId => {
              uiState.setSelectedPresetId(resourceId)
              const resource = state.promptResources.find(item => item.id === resourceId)
              if (resource) void navigation.openResource('preset', resourceId, resource.rootNode.id)
            }}
            t={state.t}
            workspaceId={contextWorkspaceId}
          />
        ),
        resource: (
          <ContextWorkbenchHeader
            resources={state.promptResources}
            selectedResourceId={navigation.route.panel === 'resource' ? navigation.route.resourceId : undefined}
            t={state.t}
            workspaceId={contextWorkspaceId}
            onSelectResource={resourceId => {
              const target = state.promptResources.find(r => r.id === resourceId)
              if (target) {
                void navigation.openResource('resource', target.id, target.rootNode.id)
              }
            }}
          />
        ),
      }}
      recentSessions={(
        <RecentPlayRail
          cards={state.cards}
          timelines={state.allTimelines.length > 0 ? state.allTimelines : state.cardTimelines}
          t={state.t}
          recent={recentCharacters}
          onOpenCharacter={visit => { void openRecentCharacter(visit) }}
        />
      )}
      panels={panels}
      preloadPanel={preloadStudioPanel}
      t={state.t}
      canvas={(
        <div
          ref={narrativeSelectionRef}
          className={styles.canvasStack}
          style={{
            '--loom-composer-height': uiState.composerHeight ? `${uiState.composerHeight}px` : undefined,
          } as CSSProperties}
        >
          <SelectionToolbar key={JSON.stringify(['selection-toolbar', state.endpoint, state.narrativeTimeline?.id, state.branch?.id])}
            containerRef={narrativeSelectionRef} inputRef={narrativeInputRef} t={state.t}
            onQuote={text => state.setInput(appendQuote(state.input, text))} />
          <ContentErrorBoundary resetKey={state.branch?.id} fallback={error => <p role="alert">{error.message}</p>}><NarrativeTimeline actionsHost={timelineActionsHost} scrollRestorationScope={JSON.stringify([state.endpoint, state.narrativeTimeline?.id, state.branch?.id])}
            inputMode={state.narrativeInputMode}
            onSendDiscussion={state.sendDiscussionInput}
            onDiscuss={() => { state.setNarrativeInputMode('discussion'); narrativeInputRef.current?.focus() }}
            onReviseDiscussionInput={state.narrativeTimeline ? (entryId, expected, originalAttachments, content, attachments) => state.reviseUserInput(state.narrativeTimeline!.id, entryId, expected, originalAttachments, content, attachments) : undefined}
            onRetryDiscussionInput={state.retryDiscussionInput}
            onContinueRun={state.resumeNarrativeRun}
            connecting={state.narrativeConnecting}
            workEntries={state.narrativeWorkEntries}
            activeRun={state.narrativeActiveRun}
            rounds={narrativeRounds}
            userIdentity={state.userIdentity}
            displayProjection={narrativeDisplay}
            communicationDisplay={communicationDisplay}
            displayOnlyNodeId={state.displayOnlyNarrativeNodeId}
            key={JSON.stringify(['narrative-timeline', state.endpoint, state.narrativeTimeline?.id, state.branch?.id])}
            anchorNodeId={navigation.nodeAnchorId}
            busy={sessionBusy || narrativeNavigating}
            emptyTimelineText={state.emptyTimelineText}
            openingDraft={!state.narrativeTimeline && state.selectedCardDetails?.id === state.selectedCardId ? state.openingDraft : undefined}
            openingDisplay={openingDisplay}
            inputSwipe={state.narrativeSwipe && state.narrativeSwipe.inputKind !== 'communication' ? {
              swipe: state.narrativeSwipe,
              disabled: state.narrativeSwipeBusy || narrativeNavigating || !state.narrativeAgentSession,
              onSelect: id => { void state.selectNarrativeSwipe(id) },
              onGenerate: async input => {
                if (!await state.generateNarrativeSwipe('swipe', false, input)) throw new Error(state.t('swipe.inputUnavailable'))
              },
            } : undefined}
            swipeControls={state.narrativeSwipe ? {
              nodeId: state.narrativeSwipe.candidates.find(candidate => candidate.id === state.narrativeSwipe?.selectedCandidateId)?.nodeId,
              content: <NarrativeSwipePicker key={state.narrativeSwipe.id} swipe={state.narrativeSwipe}
                busy={state.narrativeSwipeBusy || narrativeNavigating}
                primarySessionId={state.narrativeAgentSession?.id} t={state.t}
                onSelect={id => { void state.selectNarrativeSwipe(id) }}
                onGenerate={(mode, allowSessionChange) => { void state.generateNarrativeSwipe(mode, allowSessionChange) }} />,
            } : undefined}
            openingControls={(!state.narrativeTimeline || (state.narrativeTimeline.opening && !state.narrativeTimeline.opening.locked)) && state.selectedCardDetails
              && state.selectedCardDetails.id === (state.narrativeTimeline?.createdFrom?.cardId ?? state.selectedCardId)
              ? <OpeningPicker opening={state.selectedCardDetails.opening} choice={state.openingChoice}
                onChange={choice => {
                  state.setOpeningChoice(choice)
                  if (state.narrativeTimeline && choice.kind !== 'custom') void state.replaceOpening(choice)
                }}
                onApply={state.narrativeTimeline ? () => { void state.replaceOpening() } : undefined}
                disabled={sessionBusy || narrativeNavigating} t={state.t} />
              : undefined}
            onStartStory={!narrativeNavigating && !state.narrativeTimeline && state.selectedCardDetails?.id === state.selectedCardId
              ? () => {
                const isCurrent = navigation.isCurrent
                void state.createTimelineFromCard().then(activated => {
                  if (activated && isCurrent()) navigation.openNarrative(activated.timelineId, activated.branchId)
                })
              } : undefined}
            getNodeLink={navigation.getNodeLink}
            hasOlder={state.hasOlderNarrativeNodes}
            onEditNode={state.editNarrativeNode}
            onLoadOlder={state.loadOlderNodes}
            onNodeAnchorChange={navigation.setNodeAnchor}
            onForkNode={node => {
              void state.forkFromNode(node).then(activated => {
                if (activated) navigation.openNarrative(activated.timelineId, activated.branchId)
              })
            }}
            rendererHost={rendererHost}
            macroContext={state.macroContext}
            t={state.t}
            timeline={state.narrativeNodes}
            timelineId={state.narrativeTimeline?.id}
            tail={state.narrativeTimeline ? (
              <RendererSurfaceHost
                host={rendererHost}
                scope={{ kind: 'timeline', key: state.narrativeTimeline.id }}
                surface="narrative.timeline.tail"
              />
            ) : undefined}
          /></ContentErrorBoundary>
          {state.narrativeActiveRun?.approval && <AgentMutationApprovalDialog
            key={state.narrativeActiveRun.approval.requestId} approval={state.narrativeActiveRun.approval}
            onApprove={state.approveNarrativeMutation} onClose={() => {}} t={state.t} />}
          <AgentComposer
            actionsHostRef={setTimelineActionsHost}
            inputMode={state.narrativeInputMode}
            onInputModeChange={state.setNarrativeInputMode}
            sendLeadingAction={<AgentPresetPicker
              disabled={!state.narrativeAgentSession || sessionBusy || state.narrativeActiveRun?.status === 'running' || state.narrativeActiveRun?.status === 'suspended'}
              profiles={state.agentPresets}
              providers={state.providerAccounts}
              selectedId={state.narrativeAgentSession?.agentPresetId}
              t={state.t}
              onSelect={agentPresetId => { void state.configureNarrativeSession({ agentPresetId }) }}
            />}
            runStatus={state.narrativeActiveRun?.status === 'running' ? 'running' : state.narrativeActiveRun?.status === 'suspended' ? 'suspended' : 'idle'}
            onPause={() => { void state.pauseNarrativeRun() }}
            onResume={() => { void state.resumeNarrativeRun() }}
            inputRef={narrativeInputRef}
            canRetryNarrativeInput={state.canRetryNarrativeInput && !narrativeNavigating}
            onRetryNarrativeInput={() => { void state.retryNarrativeInput() }}
            runRecovery={state.narrativeRecovery}
            runRecoveryBusy={state.runRecoveryBusy}
            abandonAgentRun={state.abandonNarrativeRun}
            canRestoreRunInput={false}
            reconnectAgentRun={state.reconnectNarrativeRun}
            restoreRunInput={state.restoreRunInput}
            canPreviewPrompt={state.canPreviewPrompt}
            attachmentNotice={state.narrativeAttachments.notice} onRetryAttachment={state.narrativeAttachments.retry} attachments={state.narrativeAttachments.items} onAddAttachments={state.narrativeAttachments.add} onRemoveAttachment={state.narrativeAttachments.remove}
            canSendNarrative={state.canSend && !narrativeNavigating}
            taskCard={(
              <AgentTaskMenu key={JSON.stringify([state.endpoint, state.narrativeTimeline?.id])}
                activeRun={state.narrativeActiveRun} messages={state.narrativeWorkEntries}
                api={state.api} endpoint={state.endpoint} timelineId={state.narrativeTimeline?.id} t={state.t}
                onOpen={async (sessionId, runId) => { await openAgentSession(sessionId); if (runId) state.observeTaskRun(sessionId, runId) }}
                onResumed={state.observeTaskRun} onAbandoned={state.refreshTaskSession} />
            )}
            composerSheet={(
              <RendererSurfaceHost
                host={rendererHost}
                scope={state.narrativeTimeline
                  ? { kind: 'timeline', key: state.narrativeTimeline.id }
                  : state.agentChatSession
                    ? { kind: 'agent-session', key: state.agentChatSession.id }
                    : { kind: 'workspace', key: 'workspace' }}
                surface="composer.sheet"
              />
            )}
            narrativeInput={state.input}
            narrativeTextareaDisabled={false}
            pinned={composerPinned}
            onTogglePinned={toggleComposerPinned}
            quickActions={composerQuickActions}
            t={state.t}
            onChangeNarrativeInput={value => {
              state.setInput(value)
            }}
            onHeightChange={uiState.setComposerHeight}
            onPreviewPrompt={() => {
              void state.previewPrompt()
            }}
            onSubmitNarrative={async event => {
              await state.submitTurn(event)
            }}
          />
        </div>
      )}
    />
  )

  if (!onboardingComplete) return <><StudioOnboarding api={state.api} locale={state.locale} localePending={state.localePending} onLocale={state.setLocale}
    accounts={state.providerAccounts} accountsLoaded={state.providerAccountsLoaded}
    assistant={state.agentPresets.find(preset => preset.id === assistantPresetId)}
    onRefresh={async () => { await Promise.all([state.refreshProviderAccounts(), state.refreshResourceConsumers()]) }}
    onFinish={guided => {
      completeOnboarding()
      setOnboardingComplete(true)
      if (guided) {
        setAssistantGuide(true)
        uiState.setAgentPanelOpen(true)
      }
    }} /><NotificationToaster label={state.t('notification.label')} /><ConfirmDialogHost /></>

  return (
    <ExtensionIdentityContext.Provider value={[...clientExtensions.packages, ...clientExtensions.cardPackages]}>
      <ResourceUpdateNotifications api={state.api.resourceDownloads} endpoint={state.endpoint} ready={overlaysReady} onOpen={() => { void navigation.openPath('/studio/extensions?downloads=1') }} />
      {themeController.startupReady ? <StartupReady onDismissed={onStartupDismissed} /> : null}
      <OfficialExtensionSetup api={state.api.extensions} ready={overlaysReady && !assistantGuide && state.startup.ready('cards')} t={state.t}
        onInstalled={async () => {
          await Promise.all([clientExtensions.refresh(), state.refreshResourceConsumers()])
        }} />
      {(navigation.targetError || navigationFailure?.target === narrativeTarget) && !navigation.route.tool ? (
        <AppStatusPage eyebrow="LOOM STUDIO" title={state.t('pageError.title')} description={navigation.targetError ?? navigationFailure?.message ?? ""} actions={<>
          {navigationFailure?.target === narrativeTarget ? <button type="button" onClick={() => setNavigationRetry(value => value + 1)}>{state.t('appError.reload')}</button> : null}
          <button type="button" onClick={() => {
            setNavigationFailure(undefined)
            void navigation.returnToReading()
          }}>{state.t('navigation.returnToWorkspace')}</button>
        </>} />
      ) : studio}
      {overlaysReady && <>
      {state.newStoryExtensionsDialog}
      {referenceVisited || navigation.referenceUri ? <ContentErrorBoundary resetKey={navigation.referenceUri} fallback={error => navigation.referenceUri ? (
        <Dialog open onClose={() => { void navigation.closeReference() }} title={state.t('reference.title')}><p role="alert">{error.message}</p></Dialog>
      ) : null}><Suspense fallback={navigation.referenceUri ? <Dialog open onClose={() => { void navigation.closeReference() }} title={state.t('reference.title')}><StudioPanelLoading /></Dialog> : null}>
      <ResourceReferenceDialog t={state.t} api={state.api} uri={navigation.referenceUri}
        onClose={() => { void navigation.closeReference() }}
        onNavigate={uri => { void navigation.openUri(uri) }}
        onOpenEditor={target => {
        if (target.panel === 'preset') uiState.setSelectedPresetId(target.resourceId)
        navigation.openResource(target.panel, target.resourceId, target.nodeId)
        if (target.panel === 'preset') useStudioLayoutStore.getState().openAssetDetail('preset', contextWorkspaceId, target.nodeId)
      }} />
      </Suspense></ContentErrorBoundary> : null}
      {dashboardVisited ? <ContentErrorBoundary resetKey={dashboardOpen} fallback={error => dashboardOpen ? (
        <Dialog open onClose={() => setDashboardOpen(false)} title={state.t('dashboard.open')}><p role="alert">{error.message}</p></Dialog>
      ) : null}><Suspense fallback={dashboardOpen ? <Dialog open onClose={() => setDashboardOpen(false)} title={state.t('dashboard.open')}><StudioPanelLoading /></Dialog> : null}>
      <StudioDashboard api={state.api} endpoint={state.endpoint} open={dashboardOpen} onClose={() => setDashboardOpen(false)}
        onAction={action => {
          setDashboardOpen(false)
          if (action.kind === 'story') { void navigation.openNarrative(action.id); return }
          if (action.kind === 'card') { void navigation.openPanel('character', { cardId: action.id }); return }
          if (action.kind === 'provider') { void navigation.openPanel('model'); return }
          if (action.kind === 'calls') { void navigation.openPanel('logs'); return }
          const targets = { character: 'character', cards: 'character', resource: 'resource', preset: 'preset', extensions: 'extensions', scripts: 'extensions', 'text-transform': 'text-transform', extractors: 'text-transform', timelines: 'recent', sessions: 'sessions', logs: 'logs' } as const
          const target = targets[action.id as keyof typeof targets]
          if (target) void navigation.openPanel(target)
        }} />
      </Suspense></ContentErrorBoundary> : null}
      <GlobalSearchOverlay key={state.endpoint} api={state.api} endpoint={state.endpoint} open={searchOpen} t={state.t}
        currentCardId={appearanceCardId} currentPresetId={activePresetId}
        recent={recentSearch.endpoint === state.endpoint ? recentSearch.items : []}
        onClose={() => setSearchOpen(false)} onOpenPanel={panel => { setSearchOpen(false); void navigation.openPanel(panel) }}
        onOpenResult={(hit, query) => { void openSearchResult(hit, query) }} />
      <RendererFocusSurface host={rendererHost} scope={{ kind: 'workspace', key: 'workspace' }} />
      </>}
      <NotificationToaster label={state.t('notification.label')} />
      <ConfirmDialogHost />
    </ExtensionIdentityContext.Provider>
  )
}

function extensionIconUrl(extensionPackage: { iconUrl?: string; modules: Array<{ runtimeKind: string; entryUrl?: string }> } | undefined): string | undefined {
  if (extensionPackage?.iconUrl) return extensionPackage.iconUrl
  const entryUrl = extensionPackage?.modules.find(module => module.runtimeKind === 'client')?.entryUrl
  if (!entryUrl) return undefined
  try { return new URL('../../icon.png', entryUrl).href } catch { return undefined }
}

async function resolveLoomScriptInputs(input: {
  api: StudioApi
  scope: ClientRendererScope
  contribution: LoomScriptRendererContribution
  narrative?: { timelineId: string; branchId: string; consumerAgentSessionId?: string }
  agentSessionId?: string
}): Promise<LoomScriptInputProjection> {
  const source = resolveInspectionSource(input)
  if (!source) return { matches: [], artifacts: [] }
  const inspection = await input.api.textTransforms.inspectTextPipeline({
    source: source.source,
    phase: 'display',
    ...(source.consumerAgentSessionId ? { consumerAgentSessionId: source.consumerAgentSessionId } : {}),
  })
  const entryId = source.entryId
  return {
    matches: inspection.snapshot.matches
      .filter(match => !entryId || match.entryId === entryId)
      .map(match => ({
        matchId: match.matchId,
        ruleId: match.ruleId,
        value: {
          entryId: match.entryId,
          match: match.match,
          captures: match.captures.map(capture => capture ?? null),
          namedCaptures: Object.fromEntries(Object.entries(match.namedCaptures).map(([name, capture]) => [name, capture ?? null])),
        },
        ...(match.displayRange ? { displayRange: match.displayRange } : {}),
      })),
    artifacts: inspection.artifacts.flatMap(artifact => artifact.values
      .filter(value => !entryId || value.sourceEntryId === entryId)
      .map((value, index) => ({
        id: `${artifact.artifactId}:${index}`,
        artifactType: artifact.artifactType,
        sourceEntryId: value.sourceEntryId,
        value: value.value,
      }))),
  }
}

function resolveInspectionSource(input: {
  scope: ClientRendererScope
  narrative?: { timelineId: string; branchId: string; consumerAgentSessionId?: string }
  agentSessionId?: string
}): {
  source: { kind: 'narrative'; timelineId: string; branchId: string } | { kind: 'agent-session'; sessionId: string }
  entryId?: string
  consumerAgentSessionId?: string
} | undefined {
  if (input.scope.entity?.kind === 'narrative-node') {
    if (!input.narrative || input.narrative.timelineId !== input.scope.entity.timelineId) return undefined
    return {
      source: { kind: 'narrative', timelineId: input.narrative.timelineId, branchId: input.narrative.branchId },
      entryId: input.scope.entity.nodeId,
      ...(input.narrative.consumerAgentSessionId ? { consumerAgentSessionId: input.narrative.consumerAgentSessionId } : {}),
    }
  }
  if (input.scope.entity?.kind === 'agent-message') {
    if (input.agentSessionId !== input.scope.entity.agentSessionId) return undefined
    return { source: { kind: 'agent-session', sessionId: input.scope.entity.agentSessionId }, entryId: input.scope.entity.messageId }
  }
  if (input.scope.kind === 'timeline' && input.narrative?.timelineId === input.scope.key) {
    return {
      source: { kind: 'narrative', timelineId: input.narrative.timelineId, branchId: input.narrative.branchId },
      ...(input.narrative.consumerAgentSessionId ? { consumerAgentSessionId: input.narrative.consumerAgentSessionId } : {}),
    }
  }
  if (input.scope.kind === 'agent-session' && input.agentSessionId === input.scope.key) {
    return { source: { kind: 'agent-session', sessionId: input.agentSessionId } }
  }
  return undefined
}
import { OpeningPicker } from '../features/cards/ui/opening-picker.js'
