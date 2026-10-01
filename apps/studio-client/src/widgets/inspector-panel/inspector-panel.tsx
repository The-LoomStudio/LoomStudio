import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { Translator } from '../../shared/i18n/index.js'
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
        <section className={styles.section}>
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
        </section>
      ) : null}
      <section className={styles.section}>
        <h2>{props.t('inspector.cardSnapshot')}</h2>
        <JsonBlock value={props.cardSnapshot} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.run')}</h2>
        <JsonBlock value={props.runDetails} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.agentTranscript')}</h2>
        <JsonBlock value={props.agentTranscript} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.promptBuildFlow')}</h2>
        <PromptBuildFlow steps={props.promptBuildSteps} />
      </section>
      <section className={styles.section}>
        <h2>PromptBuild Trace</h2>
        <JsonBlock value={props.promptBuildTrace} />
      </section>
      <section className={styles.section}>
        <h2>{props.t('inspector.prompt')}</h2>
        {props.tokenEstimate ? <details>
          <summary>{props.t('tokens.requestEstimate')} · {props.tokenEstimate.estimatedTokens.toLocaleString()} tokens</summary>
          <p>{props.tokenEstimate.basis.encoding} × {props.tokenEstimate.basis.multiplier} · {props.tokenEstimate.scope}</p>
          <p>消息: {props.tokenEstimate.messages.join(' / ')} · 工具: {props.tokenEstimate.tools.join(' / ') || '0'}</p>
          <p>未计入: {props.tokenEstimate.uncounted.join(', ')}</p>
        </details> : null}
        <JsonBlock value={props.promptMessages} />
      </section>
      <section className={styles.section}>
        <h2>Provider Payload</h2>
        <JsonBlock value={props.providerPayloadPreview} />
      </section>
    </aside>
  )
}

function JsonBlock(props: { value: unknown }) {
  return <pre className={styles.json}>{props.value === null || props.value === undefined ? 'null' : JSON.stringify(props.value, null, 2)}</pre>
}
