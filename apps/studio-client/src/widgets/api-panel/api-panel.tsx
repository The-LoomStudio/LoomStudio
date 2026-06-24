import type { FormEvent } from 'react'
import { useState } from 'react'
import type { Locale, Translator } from '../../shared/i18n/index.js'
import { localeLabels, supportedLocales } from '../../shared/i18n/index.js'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { ModelProfileList } from './model-profile-list.js'
import { ProviderAccountList } from './provider-account-list.js'
import styles from './api-panel.module.css'

type GatewayForm = {
  baseUrl: string
  apiKey: string
  model: string
  temperature: string
  maxTokens: string
}

export type ApiPanelProps = {
  busy: boolean
  endpoint: string
  gatewayForm: GatewayForm
  gatewayProfileSummary?: string
  locale: Locale
  onChangeEndpoint: (endpoint: string) => void
  onChangeGatewayForm: (value: GatewayForm) => void
  onChangeLocale: (locale: Locale) => void
  onCreateGatewayProfile: (event: FormEvent) => void
  t: Translator
  providerAccounts: ProviderAccount[]
  modelProfiles: ModelProfile[]
  onDeleteProviderAccount: (id: string) => void
  onUpdateModelProfile: (id: string, updates: { displayName?: string; providerModelId?: string; config?: Record<string, ClientJsonValue> }) => void
  onDeleteModelProfile: (id: string) => void
  onPingModelProfile: (id: string) => Promise<string>
}

export function ApiPanel(props: ApiPanelProps) {
  const [expandedSection, setExpandedSection] = useState<'provider' | 'model' | null>(null)

  function toggleSection(section: 'provider' | 'model') {
    setExpandedSection(current => current === section ? null : section)
  }

  return (
    <aside className={styles.apiPane} data-loom-component="api-panel">
      <section className={styles.resourceSummary}>
        <p className={styles.resourceKicker}>System settings</p>
        <h2>{props.t('rail.api')}</h2>
        
        <div className={styles.hostControls}>
          <label>
            {props.t('app.localeLabel')}
            <select value={props.locale} onChange={event => props.onChangeLocale(event.target.value as Locale)}>
              {supportedLocales.map(item => (
                <option key={item} value={item}>{localeLabels[item]}</option>
              ))}
            </select>
          </label>
          <label>
            {props.t('app.rpcLabel')}
            <input value={props.endpoint} onChange={event => props.onChangeEndpoint(event.target.value)} />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>{props.t('gateway.title')}</h2>
        </div>
        <form className={styles.gatewayForm} onSubmit={props.onCreateGatewayProfile}>
          <label>
            {props.t('gateway.baseUrl')}
            <input
              required
              value={props.gatewayForm.baseUrl}
              onChange={e => props.onChangeGatewayForm({ ...props.gatewayForm, baseUrl: e.target.value })}
            />
          </label>
          <label>
            {props.t('gateway.apiKey')}
            <input
              placeholder={props.t('gateway.apiKeyPlaceholder')}
              value={props.gatewayForm.apiKey}
              onChange={e => props.onChangeGatewayForm({ ...props.gatewayForm, apiKey: e.target.value })}
            />
          </label>
          <label>
            {props.t('gateway.model')}
            <input
              required
              value={props.gatewayForm.model}
              onChange={e => props.onChangeGatewayForm({ ...props.gatewayForm, model: e.target.value })}
            />
          </label>
          <div className={styles.gatewayGrid}>
            <label>
              {props.t('gateway.temperature')}
              <input
                required
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={props.gatewayForm.temperature}
                onChange={e => props.onChangeGatewayForm({ ...props.gatewayForm, temperature: e.target.value })}
              />
            </label>
            <label>
              {props.t('gateway.maxTokens')}
              <input
                required
                type="number"
                step="1"
                min="1"
                value={props.gatewayForm.maxTokens}
                onChange={e => props.onChangeGatewayForm({ ...props.gatewayForm, maxTokens: e.target.value })}
              />
            </label>
          </div>
          <button type="submit" disabled={props.busy}>
            {props.t('gateway.createAgentProfile')}
          </button>
        </form>

        {props.gatewayProfileSummary ? (
          <div className={styles.gatewayProfile}>
            <p>{props.gatewayProfileSummary}</p>
          </div>
        ) : null}
      </section>

      {/* Provider Accounts */}
      <section className={styles.section}>
        <div className={styles.sectionHead} onClick={() => toggleSection('provider')} style={{ cursor: 'pointer' }}>
          <h2>{props.t('gateway.providerAccounts')}</h2>
          <span className={styles.badge}>{props.providerAccounts.length}</span>
        </div>
        {expandedSection === 'provider' && (
          <ProviderAccountList
            accounts={props.providerAccounts}
            busy={props.busy}
            onDelete={props.onDeleteProviderAccount}
            t={props.t}
          />
        )}
      </section>

      {/* Model Profiles */}
      <section className={styles.section}>
        <div className={styles.sectionHead} onClick={() => toggleSection('model')} style={{ cursor: 'pointer' }}>
          <h2>{props.t('gateway.modelProfiles')}</h2>
          <span className={styles.badge}>{props.modelProfiles.length}</span>
        </div>
        {expandedSection === 'model' && (
          <ModelProfileList
            busy={props.busy}
            modelProfiles={props.modelProfiles}
            onDelete={props.onDeleteModelProfile}
            onPing={props.onPingModelProfile}
            onUpdate={props.onUpdateModelProfile}
            providerAccounts={props.providerAccounts}
            t={props.t}
          />
        )}
      </section>
    </aside>
  )
}
