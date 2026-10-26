import { useMemo, useState, type ReactNode } from 'react'
import { buildInspectorJsonPreview } from './inspector-json-preview.js'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import { formatNumber, type Translator } from '../../shared/i18n/index.js'
import type {
  AiCapabilityProfile,
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  ProviderAccount,
  RegisteredAiGatewayProvider,
} from '../../entities/index.js'
import type { PromptBuildStep } from '../../features/prompt-build/model/build-prompt-build-steps.js'
import { PromptBuildFlow } from '../prompt-build-flow/prompt-build-flow.js'
import { AiCapabilityLab } from '../model-panel/ai-capability-lab.js'
import styles from './inspector-panel.module.scss'

type InspectorPanelProps = {
  tokenEstimate?: import('@loom-studio/ai-gateway').RequestTokenEstimate
  agentTranscript: unknown
  cardSnapshot: unknown
  promptBuildSteps: PromptBuildStep[]
  promptBuildTrace: unknown
  promptMessages: unknown
  providerPayloadPreview: unknown
  runDetails: unknown
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
  return (
    <aside className={styles.inspector} data-loom-component="overlay-utility-layer" data-loom-object="inspector-panel">
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
      <InspectorSection title={props.t('inspector.promptBuildFlow')}>
        <PromptBuildFlow steps={props.promptBuildSteps} />
      </InspectorSection>
      <InspectorSection title="PromptBuild Trace">
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={props.promptBuildTrace} />
      </InspectorSection>
      <InspectorSection title={props.t('inspector.prompt')}>
        {props.tokenEstimate ? <details>
          <summary>{props.t('tokens.requestEstimate')} · {formatNumber(props.tokenEstimate.estimatedTokens)} tokens</summary>
          <p>{props.tokenEstimate.basis.encoding} × {props.tokenEstimate.basis.multiplier} · {props.tokenEstimate.scope}</p>
          <p>{props.t('tokens.messageAndToolEstimate', {
            messages: props.tokenEstimate.messages.join(' / '), tools: props.tokenEstimate.tools.join(' / ') || '0',
          })}</p>
          <p>{props.t('tokens.uncounted', { items: props.tokenEstimate.uncounted.join(', ') })}</p>
        </details> : null}
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={props.promptMessages} />
      </InspectorSection>
      <InspectorSection title="Provider Payload">
        <JsonBlock truncatedLabel={props.t('inspector.previewTruncated')} value={props.providerPayloadPreview} />
      </InspectorSection>
    </aside>
  )
}

function InspectorSection(props: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  return <details className={styles.section} onToggle={event => setExpanded(event.currentTarget.open)}>
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
