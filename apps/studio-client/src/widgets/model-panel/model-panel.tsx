import type { FormEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'
import { isLikelyProviderEndpoint, normalizeOpenAICompatibleBaseUrl, readChatCompletionsEndpoint } from '../../features/provider-settings/model/provider-base-url.js'
import type { Translator } from '../../shared/i18n/index.js'
import { ProviderAccountList } from './provider-account-list.js'
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
  providerAccounts: ProviderAccount[]
  t: Translator
}

export function ModelPanel(props: ModelPanelProps) {
  const chatEndpoint = readChatCompletionsEndpoint(props.providerAccountDraft.baseUrl)
  const endpointWarning = isLikelyProviderEndpoint(props.providerAccountDraft.baseUrl)

  return (
    <aside className={styles.modelPanel} data-loom-component="model-panel">
      <section className={styles.accountsSection}>
        <header className={styles.sectionHeader}>
          <h2>{props.t('provider.title')}</h2>
          <span>{props.providerAccounts.length}</span>
        </header>
        <details className={styles.createAccount}>
          <summary><ChevronRight aria-hidden="true" />{props.t('provider.addAccount')}</summary>
          <form className={`${styles.providerForm} loom-underlined-fields`} onSubmit={props.onCreateProviderAccount}>
            <label>
              <span>{props.t('provider.name')}</span>
              <input
                required
                placeholder={props.t('provider.namePlaceholder')}
                value={props.providerAccountDraft.displayName}
                onChange={event => props.onChangeProviderAccountDraft({ ...props.providerAccountDraft, displayName: event.target.value })}
              />
            </label>
            <label>
              <span>{props.t('provider.baseUrl')}</span>
              <input
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
                placeholder={props.t('provider.apiKeyPlaceholder')}
                value={props.providerAccountDraft.apiKey}
                onChange={event => props.onChangeProviderAccountDraft({ ...props.providerAccountDraft, apiKey: event.target.value })}
              />
            </label>
            <button disabled={props.busy} type="submit">{props.t('provider.createAccount')}</button>
          </form>
        </details>
        <ProviderAccountList
          accounts={props.providerAccounts}
          busy={props.busy}
          modelProfiles={props.modelProfiles}
          onCreateModel={props.onCreateModelProfile}
          onDelete={props.onDeleteProviderAccount}
          onDeleteModel={props.onDeleteModelProfile}
          t={props.t}
        />
      </section>
    </aside>
  )
}
