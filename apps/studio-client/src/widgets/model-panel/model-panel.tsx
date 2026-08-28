import type { FormEvent } from 'react'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { ChevronRight } from 'lucide-react'
import type {
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  AiCapabilityProfile,
  ModelProfile,
  ProviderAccount,
  RegisteredAiGatewayProvider,
} from '../../entities/index.js'
import { isLikelyProviderEndpoint, normalizeOpenAICompatibleBaseUrl, readChatCompletionsEndpoint } from '../../features/provider-settings/model/provider-base-url.js'
import type { Translator } from '../../shared/i18n/index.js'
import { ProviderAccountList } from './provider-account-list.js'
import { AiCapabilityLab } from './ai-capability-lab.js'
import styles from './model-panel.module.scss'

type ProviderAccountDraft = {
  apiKey: string
  baseUrl: string
  displayName: string
}

export type ModelPanelProps = {
  busy: boolean
  providerAccountDraft: ProviderAccountDraft
  modelProfiles: ModelProfile[]
  onChangeProviderAccountDraft(value: ProviderAccountDraft): void
  onCreateModelProfile(providerAccountId: string, providerModelId: string): void
  onCreateProviderAccount(event: FormEvent): void
  onDeleteModelProfile(id: string): void
  onDeleteProviderAccount(id: string): void
  onListProviderModels(providerAccountId: string): Promise<string[]>
  onUpdateProviderConnection(providerAccountId: string, connection: { displayName: string; baseUrl: string; apiKey?: string }): Promise<boolean>
  providerAccounts: ProviderAccount[]
  aiProviders: RegisteredAiGatewayProvider[]
  aiCapabilityProfiles: AiCapabilityProfile[]
  onCreateAiProviderAccount(input: {
    providerExtensionId: string
    displayName: string
    config: Record<string, ClientJsonValue>
    credential?: Record<string, string>
  }): Promise<string | undefined>
  onCreateAiCapabilityProfile(input: {
    providerProfileId: string
    capabilityId: string
    displayName: string
    config: Record<string, ClientJsonValue>
  }): Promise<string | undefined>
  onUpdateAiProviderAccount(input: {
    providerProfileId: string
    displayName: string
    config: Record<string, ClientJsonValue>
    credential?: Record<string, string>
  }): Promise<void>
  onUpdateAiCapabilityProfile(input: {
    profileId: string
    displayName: string
    config: Record<string, ClientJsonValue>
  }): Promise<void>
  onInvokeAiCapability(input: Omit<AiGatewayInvokeInput, 'signal' | 'caller'>): Promise<AiGatewayInvokeResult>
  onRefreshAiProviders(): Promise<void>
  t: Translator
}

export function ModelPanel(props: ModelPanelProps) {
  const chatEndpoint = readChatCompletionsEndpoint(props.providerAccountDraft.baseUrl)
  const endpointWarning = isLikelyProviderEndpoint(props.providerAccountDraft.baseUrl)
  const chatProviderAccounts = props.providerAccounts.filter(account => legacyChatProviderIds.has(account.providerExtensionId))

  return (
    <aside className={styles.modelPanel} data-loom-component="model-panel">
      <AiCapabilityLab
        providers={props.aiProviders}
        providerAccounts={props.providerAccounts}
        profiles={props.aiCapabilityProfiles}
        onCreateProviderAccount={props.onCreateAiProviderAccount}
        onCreateProfile={props.onCreateAiCapabilityProfile}
        onUpdateProviderAccount={props.onUpdateAiProviderAccount}
        onUpdateProfile={props.onUpdateAiCapabilityProfile}
        onInvoke={props.onInvokeAiCapability}
        onRefresh={props.onRefreshAiProviders}
        t={props.t}
      />
      <section className={styles.accountsSection}>
        <header className={styles.sectionHeader}>
          <h2>{props.t('provider.title')}</h2>
          <span>{chatProviderAccounts.length}</span>
        </header>
        <details className={styles.createAccount}>
          <summary><ChevronRight aria-hidden="true" />{props.t('provider.addAccount')}</summary>
          <form autoComplete="off" className={`${styles.providerForm} loom-underlined-fields`} onSubmit={props.onCreateProviderAccount}>
            <label>
              <span>{props.t('provider.name')}</span>
              <input
                autoComplete="off"
                name="loom-provider-display-name"
                required
                placeholder={props.t('provider.namePlaceholder')}
                value={props.providerAccountDraft.displayName}
                onChange={event => props.onChangeProviderAccountDraft({ ...props.providerAccountDraft, displayName: event.target.value })}
              />
            </label>
            <label>
              <span>{props.t('provider.baseUrl')}</span>
              <input
                autoComplete="off"
                name="loom-provider-base-url"
                required
                value={props.providerAccountDraft.baseUrl}
                onChange={event => props.onChangeProviderAccountDraft({ ...props.providerAccountDraft, baseUrl: event.target.value })}
                onBlur={() => props.onChangeProviderAccountDraft({
                  ...props.providerAccountDraft,
                  baseUrl: normalizeOpenAICompatibleBaseUrl(props.providerAccountDraft.baseUrl),
                })}
              />
              {chatEndpoint ? (
                <small className={endpointWarning ? styles.warning : styles.hint}>
                  {endpointWarning
                    ? props.t('provider.baseUrlEndpointWarning')
                    : props.t('provider.chatEndpointPreview', { endpoint: chatEndpoint })}
                </small>
              ) : null}
            </label>
            <label>
              <span>{props.t('provider.apiKey')}</span>
              <input
                autoComplete="new-password"
                name="loom-provider-api-key"
                placeholder={props.t('provider.apiKeyPlaceholder')}
                type="password"
                value={props.providerAccountDraft.apiKey}
                onChange={event => props.onChangeProviderAccountDraft({ ...props.providerAccountDraft, apiKey: event.target.value })}
              />
            </label>
            <button disabled={props.busy} type="submit">{props.t('provider.createAccount')}</button>
          </form>
        </details>
        <ProviderAccountList
          accounts={chatProviderAccounts}
          busy={props.busy}
          modelProfiles={props.modelProfiles}
          onCreateModel={props.onCreateModelProfile}
          onDelete={props.onDeleteProviderAccount}
          onDeleteModel={props.onDeleteModelProfile}
          onListModels={props.onListProviderModels}
          onUpdateConnection={props.onUpdateProviderConnection}
          t={props.t}
        />
      </section>
    </aside>
  )
}

const legacyChatProviderIds = new Set([
  'official.openai',
  'openai',
  'official.anthropic',
  'anthropic',
  'official.google',
  'google',
  'official.openai-compatible',
  'openai-compatible',
  'official.fake',
  'fake',
])
