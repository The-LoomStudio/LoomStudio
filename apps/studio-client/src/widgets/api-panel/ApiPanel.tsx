import type { FormEvent } from 'react'
import { useState } from 'react'
import type { Locale, Translator } from '../../shared/i18n/index.js'
import { localeLabels, supportedLocales } from '../../shared/i18n/index.js'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import yaml from 'yaml'
import styles from './ApiPanel.module.css'

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
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelConfigForm, setModelConfigForm] = useState<{ additionalParameters: string; excludeParameters: string; customHeaders: string }>({ additionalParameters: '', excludeParameters: '', customHeaders: '' })

  function toggleSection(section: 'provider' | 'model') {
    setExpandedSection(current => current === section ? null : section)
  }

  function findProviderAccount(id: string) {
    return props.providerAccounts.find(a => a.id === id)
  }

  return (
    <aside className={styles.apiPane} data-airp-component="api-panel">
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
          <div className={styles.entityList}>
            {props.providerAccounts.length === 0 ? (
              <p className={styles.entityEmpty}>{props.t('gateway.noProviderAccounts')}</p>
            ) : (
              props.providerAccounts.map(account => (
                <div key={account.id} className={styles.entityItem}>
                  <div className={styles.entityInfo}>
                    <span className={styles.entityName}>{account.displayName}</span>
                    <span className={styles.entityMeta}>{account.providerExtensionId}</span>
                    {account.config.baseUrl ? (
                      <span className={styles.entityMeta}>{String(account.config.baseUrl)}</span>
                    ) : null}
                  </div>
                  <div className={styles.entityActions}>
                    <button
                      className={styles.entityActionDanger}
                      onClick={() => props.onDeleteProviderAccount(account.id)}
                      disabled={props.busy}
                    >
                      {props.t('gateway.delete')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Model Profiles */}
      <section className={styles.section}>
        <div className={styles.sectionHead} onClick={() => toggleSection('model')} style={{ cursor: 'pointer' }}>
          <h2>{props.t('gateway.modelProfiles')}</h2>
          <span className={styles.badge}>{props.modelProfiles.length}</span>
        </div>
        {expandedSection === 'model' && (
          <div className={styles.entityList}>
            {props.modelProfiles.length === 0 ? (
              <p className={styles.entityEmpty}>{props.t('gateway.noModelProfiles')}</p>
            ) : (
              props.modelProfiles.map(profile => {
                const account = findProviderAccount(profile.providerAccountId)
                return (
                  <div key={profile.id} className={styles.entityItem}>
                    <div className={styles.entityInfo}>
                      <span className={styles.entityName}>{profile.displayName}</span>
                      <span className={styles.entityMeta}>{profile.providerModelId}</span>
                      {account ? (
                        <span className={styles.entityMeta}>@ {account.displayName}</span>
                      ) : null}
                    </div>
                    {editingModelId === profile.id ? (
                      <div className={styles.modelEditor}>
                        <div className={styles.gatewayForm}>
                          <label>
                            {props.t('gateway.model.additionalParameters')}
                            <textarea
                              className={styles.yamlTextarea}
                              value={modelConfigForm.additionalParameters}
                              onChange={e => setModelConfigForm({ ...modelConfigForm, additionalParameters: e.target.value })}
                              placeholder={props.t('gateway.model.additionalParametersPlaceholder')}
                            />
                          </label>
                          <label>
                            {props.t('gateway.model.excludeParameters')}
                            <textarea
                              className={styles.yamlTextarea}
                              value={modelConfigForm.excludeParameters}
                              onChange={e => setModelConfigForm({ ...modelConfigForm, excludeParameters: e.target.value })}
                              placeholder={props.t('gateway.model.excludeParametersPlaceholder')}
                            />
                          </label>
                          <label>
                            {props.t('gateway.model.customHeaders')}
                            <textarea
                              className={styles.yamlTextarea}
                              value={modelConfigForm.customHeaders}
                              onChange={e => setModelConfigForm({ ...modelConfigForm, customHeaders: e.target.value })}
                              placeholder={props.t('gateway.model.customHeadersPlaceholder')}
                            />
                          </label>
                          <div className={styles.gatewayGrid}>
                            <button
                              onClick={() => {
                                try {
                                  const config = { ...profile.config }
                                  if (modelConfigForm.additionalParameters) config.additionalParameters = yaml.parse(modelConfigForm.additionalParameters)
                                  else delete config.additionalParameters
                                  
                                  if (modelConfigForm.excludeParameters) config.excludeParameters = yaml.parse(modelConfigForm.excludeParameters)
                                  else delete config.excludeParameters
                                  
                                  if (modelConfigForm.customHeaders) config.customHeaders = yaml.parse(modelConfigForm.customHeaders)
                                  else delete config.customHeaders

                                  props.onUpdateModelProfile(profile.id, { config: config as Record<string, ClientJsonValue> })
                                  setEditingModelId(null)
                                } catch {
                                  alert(props.t('gateway.model.yamlError'))
                                }
                              }}
                            >
                              {props.t('gateway.save')}
                            </button>
                            <button
                              style={{ background: 'transparent', border: '1px solid var(--airp-color-border)', color: 'var(--airp-color-muted)' }}
                              onClick={() => setEditingModelId(null)}
                            >
                              {props.t('gateway.cancel')}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.entityActions}>
                        <button
                          className={styles.entityActionDanger}
                          style={{ borderColor: 'var(--airp-color-accent)', color: 'var(--airp-color-accent)' }}
                          onClick={async () => {
                            try {
                              const result = await props.onPingModelProfile(profile.id)
                              alert(props.t('gateway.model.testSuccess') + '\n\n' + result)
                            } catch (error) {
                              const message = error instanceof Error ? error.message : String(error)
                              alert(props.t('gateway.model.testFailed') + '\n\n' + message)
                            }
                          }}
                          disabled={props.busy}
                        >
                          {props.t('gateway.model.test')}
                        </button>
                        <button
                          className={styles.entityActionDanger}
                          style={{ borderColor: 'var(--airp-color-border)', color: 'var(--airp-color-text)' }}
                          onClick={() => {
                            setEditingModelId(profile.id)
                            setModelConfigForm({
                              additionalParameters: profile.config.additionalParameters ? yaml.stringify(profile.config.additionalParameters) : '',
                              excludeParameters: profile.config.excludeParameters ? yaml.stringify(profile.config.excludeParameters) : '',
                              customHeaders: profile.config.customHeaders ? yaml.stringify(profile.config.customHeaders) : '',
                            })
                          }}
                          disabled={props.busy}
                        >
                          {props.t('gateway.edit')}
                        </button>
                        <button
                          className={styles.entityActionDanger}
                          onClick={() => props.onDeleteModelProfile(profile.id)}
                          disabled={props.busy}
                        >
                          {props.t('gateway.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </section>
    </aside>
  )
}
