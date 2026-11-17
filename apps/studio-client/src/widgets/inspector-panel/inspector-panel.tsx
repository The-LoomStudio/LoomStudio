import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildInspectorJsonPreview } from './inspector-json-preview.js'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { formatNumber, type Translator } from '../../shared/i18n/index.js'
import type {
  AiCapabilityProfile,
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  ProviderAccount,
  RegisteredAiGatewayProvider,
} from '../../entities/index.js'
import type { ObservationEntry } from '../../entities/observation.js'
import { RunTroubleshootingLedgers } from '../../features/observability/ui/run-troubleshooting-ledgers.js'
import type { PromptBuildStep } from '../../features/prompt-build/model/build-prompt-build-steps.js'
import { PromptBuildFlow } from '../prompt-build-flow/prompt-build-flow.js'
import { AiCapabilityLab } from '../model-panel/ai-capability-lab.js'
import styles from './inspector-panel.module.scss'

type InspectorPanelProps = {
  api?: StudioApi
  endpoint?: string
  runId?: string
  tokenEstimate?: import('@loom-studio/ai-gateway').RequestTokenEstimate
  agentTranscript: unknown
  cardSnapshot: unknown
  promptBuildSteps: PromptBuildStep[]
  promptBuildTrace: unknown
  promptMessages: unknown
  providerPayloadPreview: unknown
  runDetails: unknown
  buildId?: string
  loadBuild?(buildId: string): Promise<ObservationEntry | null>
  resolvePromptBuildSteps?(build: NonNullable<ObservationEntry['build']>): PromptBuildStep[]
  toolPromptBuildTrace?: unknown
  macroInspection?: unknown
  aiProviders?: RegisteredAiGatewayProvider[]
  providerAccounts?: ProviderAccount[]
  aiCapabilityProfiles?: AiCapabilityProfile[]
  onCreateAiProviderAccount?(input: {
    providerExtensionId: string
    displayName: string
    config: Record<string, ClientJsonValue>
    credential?: Record<string, string>
  }): Promise<string | undefined>
  onCreateAiCapabilityProfile?(input: {
    providerProfileId: string
    capabilityId: string
    displayName: string
    config: Record<string, ClientJsonValue>
  }): Promise<string | undefined>
  onUpdateAiProviderAccount?(input: {
    providerProfileId: string
    displayName: string
    config: Record<string, ClientJsonValue>
    credential?: Record<string, string>
  }): Promise<void>
  onUpdateAiCapabilityProfile?(input: {
    profileId: string
    providerProfileId?: string
    displayName: string
    config: Record<string, ClientJsonValue>
  }): Promise<void>
  onInvokeAiCapability?(input: Omit<AiGatewayInvokeInput, 'signal' | 'caller'>): Promise<AiGatewayInvokeResult>
  onRefreshAiProviders?(): Promise<void>
  t: Translator
}

export function InspectorPanel(props: InspectorPanelProps) {
  const [buildState, setBuildState] = useState<{
    buildId?: string
    status: 'idle' | 'loading' | 'loaded' | 'error'
    entry?: ObservationEntry | null
  }>({ status: 'idle' })
  const [expandedBuildSections, setExpandedBuildSections] = useState(0)
  const latestBuildIdRef = useRef(props.buildId)
  latestBuildIdRef.current = props.buildId
  const requestedBuildIdRef = useRef<string | undefined>(undefined)

  const requestBuild = useCallback((targetBuildId: string | undefined) => {
    if (!targetBuildId || !props.loadBuild || requestedBuildIdRef.current === targetBuildId) return
    requestedBuildIdRef.current = targetBuildId
    setBuildState({ buildId: targetBuildId, status: 'loading' })
    void props.loadBuild(targetBuildId).then(
      entry => {
        if (latestBuildIdRef.current !== targetBuildId) return
        setBuildState({ buildId: targetBuildId, status: 'loaded', entry })
      },
      () => {
        if (latestBuildIdRef.current !== targetBuildId) return
        setBuildState({ buildId: targetBuildId, status: 'error' })
      },
    )
  }, [props.loadBuild])

  useEffect(() => {
    if (!props.buildId) {
      requestedBuildIdRef.current = undefined
      setBuildState({ status: 'idle' })
      return
    }
    if (expandedBuildSections > 0) {
      requestBuild(props.buildId)
    } else if (requestedBuildIdRef.current !== props.buildId || buildState.status === 'error') {
      requestedBuildIdRef.current = undefined
      setBuildState({ status: 'idle' })
    }
  }, [props.buildId, expandedBuildSections, requestBuild, buildState.status])

  const handleBuildSectionExpanded = useCallback((expanded: boolean) => {
    setExpandedBuildSections(count => Math.max(0, count + (expanded ? 1 : -1)))
  }, [])

  const activeBuild = buildState.buildId === props.buildId && buildState.status === 'loaded'
    ? buildState.entry?.build : undefined
  const buildNotice = props.buildId && buildState.buildId === props.buildId
    ? buildState.status === 'loading' ? props.t('observation.loading')
      : buildState.status === 'error' ? props.t('observation.buildError')
        : buildState.status === 'loaded' && buildState.entry === null ? props.t('observation.buildUnavailable') : undefined
    : undefined
  const promptBuildSteps = activeBuild && props.resolvePromptBuildSteps
    ? props.resolvePromptBuildSteps(activeBuild) : props.promptBuildSteps
  const promptBuildTrace = props.promptBuildTrace ?? activeBuild?.promptBuildTrace ?? null
  const promptMessages = props.promptMessages ?? activeBuild?.messages ?? null
  const toolPromptBuildTrace = props.toolPromptBuildTrace ?? activeBuild?.toolPromptBuildTrace ?? null
  const macroInspection = props.macroInspection ?? activeBuild?.macroInspection ?? null

  return (
    <aside className={styles.inspector} data-loom-component="overlay-utility-layer" data-loom-object="inspector-panel">
      {props.api ? (
        <RunTroubleshootingLedgers
          api={props.api}
          endpoint={props.endpoint ?? 'default'}
          runId={props.runId}
          buildId={props.buildId}
          tokenEstimate={props.tokenEstimate}
          promptBuildSteps={promptBuildSteps}
          promptBuildTrace={promptBuildTrace}
          promptMessages={promptMessages}
          t={props.t}
        />
      ) : null}
      {props.aiProviders && props.onInvokeAiCapability ? (
        <InspectorSection title={props.t('provider.aiLabTitle')}>
          <AiCapabilityLab
            providers={props.aiProviders}
            providerAccounts={props.providerAccounts ?? []}
            profiles={props.aiCapabilityProfiles ?? []}
            onCreateProviderAccount={props.onCreateAiProviderAccount ?? (async () => undefined)}
            onCreateProfile={props.onCreateAiCapabilityProfile ?? (async () => undefined)}
            onUpdateProviderAccount={props.onUpdateAiProviderAccount ?? (async () => {})}
            onUpdateProfile={props.onUpdateAiCapabilityProfile ?? (async () => {})}
            onInvoke={props.onInvokeAiCapability}
            onRefresh={props.onRefreshAiProviders ?? (async () => {})}
            t={props.t}
          />
        </InspectorSection>
      ) : null}
      <InspectorSection title={props.t('inspector.cardSnapshot')}>
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={props.cardSnapshot} />
      </InspectorSection>
      <InspectorSection title={props.t('inspector.run')}>
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={props.runDetails} />
      </InspectorSection>
      <InspectorSection title={props.t('inspector.agentTranscript')}>
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={props.agentTranscript} />
      </InspectorSection>
      <InspectorSection title={props.t('inspector.promptBuildFlow')} onExpandedChange={handleBuildSectionExpanded}>
        {buildNotice ? <p className={styles.previewNotice}>{buildNotice}</p> : null}
        <PromptBuildFlow steps={promptBuildSteps} />
      </InspectorSection>
      <InspectorSection title="PromptBuild Trace" onExpandedChange={handleBuildSectionExpanded}>
        {buildNotice ? <p className={styles.previewNotice}>{buildNotice}</p> : null}
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={promptBuildTrace} />
      </InspectorSection>
      <InspectorSection title={props.t('inspector.prompt')} onExpandedChange={handleBuildSectionExpanded}>
        {buildNotice ? <p className={styles.previewNotice}>{buildNotice}</p> : null}
        {props.tokenEstimate ? <details>
          <summary>{props.t('tokens.requestEstimate')} · {formatNumber(props.tokenEstimate.estimatedTokens)} tokens</summary>
          <p>{props.tokenEstimate.basis.encoding} × {props.tokenEstimate.basis.multiplier} · {props.tokenEstimate.scope}</p>
          <p>{props.t('tokens.messageAndToolEstimate', {
            messages: props.tokenEstimate.messages.join(' / '), tools: props.tokenEstimate.tools.join(' / ') || '0',
          })}</p>
          <p>{props.t('tokens.uncounted', { items: props.tokenEstimate.uncounted.join(', ') })}</p>
        </details> : null}
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={promptMessages} />
      </InspectorSection>
      <InspectorSection title="Provider Payload">
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={props.providerPayloadPreview} />
      </InspectorSection>
      <InspectorSection title="ToolPromptBuild Trace" onExpandedChange={handleBuildSectionExpanded}>
        {buildNotice ? <p className={styles.previewNotice}>{buildNotice}</p> : null}
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={toolPromptBuildTrace} />
      </InspectorSection>
      <InspectorSection title="Macro Inspection" onExpandedChange={handleBuildSectionExpanded}>
        {buildNotice ? <p className={styles.previewNotice}>{buildNotice}</p> : null}
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={macroInspection} />
      </InspectorSection>
    </aside>
  )
}

function InspectorSection(props: { title: string; onExpandedChange?(expanded: boolean): void; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const expandedRef = useRef(false)
  return <details className={styles.section} onToggle={event => {
    const next = event.currentTarget.open
    if (expandedRef.current !== next) {
      expandedRef.current = next
      setExpanded(next)
      props.onExpandedChange?.(next)
    }
  }}>
    <summary>{props.title}</summary>
    {expanded ? props.children : null}
  </details>
}

function JsonBlock(props: { value: unknown; truncatedLabel: string }) {
  const preview = useMemo(() => buildInspectorJsonPreview(props.value), [props.value])
  return <>
    {preview.truncated ? <p className={styles.previewNotice}>{props.truncatedLabel}</p> : null}
    <pre className={styles.json}>{preview.text}</pre>
  </>
}
