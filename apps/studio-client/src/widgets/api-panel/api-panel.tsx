import type { FormEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'
import { isLikelyProviderEndpoint, normalizeOpenAICompatibleBaseUrl, readChatCompletionsEndpoint } from '../../features/provider-settings/model/provider-base-url.js'
import type { Translator } from '../../shared/i18n/index.js'
import { ProviderAccountList } from './provider-account-list.js'
import styles from './api-panel.module.scss'

type GatewayForm = {
  apiKey: string
  baseUrl: string
  displayName: string
}

export type ApiPanelProps = {
  busy: boolean
  gatewayForm: GatewayForm
  modelProfiles: ModelProfile[]
  onChangeGatewayForm(value: GatewayForm): void
  onCreateModelProfile(providerAccountId: string, providerModelId: string): void
  onCreateProviderAccount(event: FormEvent): void
  onDeleteModelProfile(id: string): void
  onDeleteProviderAccount(id: string): void
  providerAccounts: ProviderAccount[]
  t: Translator
}

export function ApiPanel(props: ApiPanelProps) {
  const chatEndpoint = readChatCompletionsEndpoint(props.gatewayForm.baseUrl)
  const endpointWarning = isLikelyProviderEndpoint(props.gatewayForm.baseUrl)

  return (
    <aside className={styles.apiPane} data-loom-component="api-panel">
      <section className={styles.accountsSection}>
        <header className={styles.sectionHeader}>
          <h2>{props.t('gateway.title')}</h2>
          <span>{props.providerAccounts.length}</span>
        </header>
        <details className={styles.createCard}>
          <summary><ChevronRight aria-hidden="true" />{props.t('gateway.addProvider')}</summary>
          <form className={styles.providerForm} onSubmit={props.onCreateProviderAccount}>
            <label>
              <span>{props.t('gateway.providerName')}</span>
              <input
                required
                placeholder={props.t('gateway.providerNamePlaceholder')}
                value={props.gatewayForm.displayName}
                onChange={event => props.onChangeGatewayForm({ ...props.gatewayForm, displayName: event.target.value })}
              />
            </label>
            <label>
              <span>{props.t('gateway.baseUrl')}</span>
              <input
                required
                value={props.gatewayForm.baseUrl}
                onChange={event => props.onChangeGatewayForm({ ...props.gatewayForm, baseUrl: event.target.value })}
                onBlur={() => props.onChangeGatewayForm({
                  ...props.gatewayForm,
                  baseUrl: normalizeOpenAICompatibleBaseUrl(props.gatewayForm.baseUrl),
                })}
              />
              {chatEndpoint ? (
                <small className={endpointWarning ? styles.warning : styles.hint}>
                  {endpointWarning
                    ? props.t('gateway.baseUrlEndpointWarning')
                    : props.t('gateway.chatEndpointPreview', { endpoint: chatEndpoint })}
                </small>
              ) : null}
            </label>
            <label>
              <span>{props.t('gateway.apiKey')}</span>
              <input
                placeholder={props.t('gateway.apiKeyPlaceholder')}
                value={props.gatewayForm.apiKey}
                onChange={event => props.onChangeGatewayForm({ ...props.gatewayForm, apiKey: event.target.value })}
              />
            </label>
            <button disabled={props.busy} type="submit">{props.t('gateway.createProvider')}</button>
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
