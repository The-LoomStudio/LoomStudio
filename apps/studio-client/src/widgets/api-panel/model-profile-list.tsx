import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useState } from 'react'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'
import { readModelConfig, readModelConfigForm, type ModelConfigForm } from '../../features/provider-settings/model/model-profile-config.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './api-panel.module.css'

type ModelProfileListProps = {
  busy: boolean
  modelProfiles: ModelProfile[]
  onDelete: (id: string) => void
  onPing: (id: string) => Promise<string>
  onUpdate: (id: string, updates: { displayName?: string; providerModelId?: string; config?: Record<string, ClientJsonValue> }) => void
  providerAccounts: ProviderAccount[]
  t: Translator
}

export function ModelProfileList(props: ModelProfileListProps) {
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelConfigForm, setModelConfigForm] = useState<ModelConfigForm>({
    additionalParameters: '',
    excludeParameters: '',
    customHeaders: '',
  })

  function findProviderAccount(id: string) {
    return props.providerAccounts.find(account => account.id === id)
  }

  return (
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
                <ModelConfigEditor
                  form={modelConfigForm}
                  onCancel={() => setEditingModelId(null)}
                  onChange={setModelConfigForm}
                  onSave={() => {
                    try {
                      props.onUpdate(profile.id, { config: readModelConfig(profile, modelConfigForm) })
                      setEditingModelId(null)
                    } catch {
                      alert(props.t('gateway.model.yamlError'))
                    }
                  }}
                  t={props.t}
                />
              ) : (
                <div className={styles.entityActions}>
                  <button
                    className={styles.entityActionDanger}
                    style={{ borderColor: 'var(--loom-accent)', color: 'var(--loom-accent)' }}
                    type="button"
                    onClick={async () => {
                      try {
                        const result = await props.onPing(profile.id)
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
                    style={{ borderColor: 'var(--loom-border)', color: 'var(--loom-text)' }}
                    type="button"
                    onClick={() => {
                      setEditingModelId(profile.id)
                      setModelConfigForm(readModelConfigForm(profile))
                    }}
                    disabled={props.busy}
                  >
                    {props.t('gateway.edit')}
                  </button>
                  <button
                    className={styles.entityActionDanger}
                    type="button"
                    onClick={() => props.onDelete(profile.id)}
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
  )
}

function ModelConfigEditor(props: {
  form: ModelConfigForm
  onCancel: () => void
  onChange: (form: ModelConfigForm) => void
  onSave: () => void
  t: Translator
}) {
  return (
    <div className={styles.modelEditor}>
      <div className={styles.gatewayForm}>
        <label>
          {props.t('gateway.model.additionalParameters')}
          <textarea
            className={styles.yamlTextarea}
            value={props.form.additionalParameters}
            onChange={event => props.onChange({ ...props.form, additionalParameters: event.target.value })}
            placeholder={props.t('gateway.model.additionalParametersPlaceholder')}
          />
        </label>
        <label>
          {props.t('gateway.model.excludeParameters')}
          <textarea
            className={styles.yamlTextarea}
            value={props.form.excludeParameters}
            onChange={event => props.onChange({ ...props.form, excludeParameters: event.target.value })}
            placeholder={props.t('gateway.model.excludeParametersPlaceholder')}
          />
        </label>
        <label>
          {props.t('gateway.model.customHeaders')}
          <textarea
            className={styles.yamlTextarea}
            value={props.form.customHeaders}
            onChange={event => props.onChange({ ...props.form, customHeaders: event.target.value })}
            placeholder={props.t('gateway.model.customHeadersPlaceholder')}
          />
        </label>
        <div className={styles.gatewayGrid}>
          <button type="button" onClick={props.onSave}>{props.t('gateway.save')}</button>
          <button
            style={{ background: 'transparent', border: '1px solid var(--loom-border)', color: 'var(--loom-text-muted)' }}
            type="button"
            onClick={props.onCancel}
          >
            {props.t('gateway.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
