import { useState } from 'react'
import type { ModelProfile, PromptResource, ProviderAccount, ProviderModelSelection } from '../../entities/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from '../preset-workbench/preset-workbench.module.scss'

export function AgentModelEditor(props: {
  preset: PromptResource
  modelProfiles: ModelProfile[]
  providerAccounts: ProviderAccount[]
  t: Translator
  onSave(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
}) {
  const [committed, setCommitted] = useState<PromptResource>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const current = committed && committed.version > props.preset.version ? committed : props.preset
  const selectedModel = props.modelProfiles.find(model =>
    model.providerAccountId === current.model?.providerProfileId && model.providerModelId === current.model?.modelId)

  async function save(model: ProviderModelSelection | undefined, delivery: 'stream' | 'complete') {
    if (pending) return
    setPending(true)
    setError(undefined)
    try {
      const result = await props.onSave({
        agentPresetId: props.preset.id,
        expectedVersion: current.version,
        model: model ?? null,
        delivery,
      })
      setCommitted(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  return <div className={`${styles.toolForm} ${styles.presetModelForm} loom-underlined-fields`}>
      <select aria-label={props.t('agent.profile.model')} disabled={pending} value={selectedModel?.id ?? (current.model ? '__unavailable__' : '')}
        onChange={event => {
          const model = props.modelProfiles.find(item => item.id === event.target.value)
          void save(model ? { providerProfileId: model.providerAccountId, modelId: model.providerModelId } : undefined, current.delivery ?? 'stream')
        }}>
        <option value="">{props.t('agent.model.unbound')}</option>
        {current.model && !selectedModel ? <option disabled value="__unavailable__">
          {props.t('agent.profile.modelUnavailable', { id: `${current.model.providerProfileId} / ${current.model.modelId}` })}
        </option> : null}
        {props.modelProfiles.map(model => <option key={model.id} value={model.id}>
          {props.providerAccounts.find(provider => provider.id === model.providerAccountId)?.displayName ?? model.providerAccountId} / {model.providerModelId}
        </option>)}
      </select>
    <label className={styles.toolCheckbox}>
      <input type="checkbox" checked={(current.delivery ?? 'stream') === 'stream'} disabled={pending}
        onChange={event => void save(current.model, event.target.checked ? 'stream' : 'complete')} />
      <span>{props.t('agent.profile.deliveryStream')}</span>
    </label>
    {error ? <p role="alert" className={styles.toolError}>{error}</p> : null}
  </div>
}
