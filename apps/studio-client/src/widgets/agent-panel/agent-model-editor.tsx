import { useState, type FormEvent } from 'react'
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
  const [draft, setDraft] = useState<{
    version: number
    model?: ProviderModelSelection
    delivery: 'stream' | 'complete'
  }>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const current = draft ?? {
    version: props.preset.version,
    model: props.preset.model,
    delivery: props.preset.delivery ?? 'stream',
  }
  const selectedModel = props.modelProfiles.find(model =>
    model.providerAccountId === current.model?.providerProfileId && model.providerModelId === current.model?.modelId)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || pending) return
    setPending(true)
    setError(undefined)
    try {
      await props.onSave({
        agentPresetId: props.preset.id,
        expectedVersion: draft.version,
        model: draft.model ?? null,
        delivery: draft.delivery,
      })
      setDraft(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  return <form className={`${styles.toolForm} ${styles.zoneDetail} loom-underlined-fields`} onSubmit={save}>
    <label>
      <span>{props.t('agent.profile.model')}</span>
      <select disabled={pending} value={selectedModel?.id ?? (current.model ? '__unavailable__' : '')}
        onChange={event => {
          const model = props.modelProfiles.find(item => item.id === event.target.value)
          setDraft({ ...current, model: model ? { providerProfileId: model.providerAccountId, modelId: model.providerModelId } : undefined })
        }}>
        <option value="">{props.t('agent.model.unbound')}</option>
        {current.model && !selectedModel ? <option disabled value="__unavailable__">
          {props.t('agent.profile.modelUnavailable', { id: `${current.model.providerProfileId} / ${current.model.modelId}` })}
        </option> : null}
        {props.modelProfiles.map(model => <option key={model.id} value={model.id}>
          {props.providerAccounts.find(provider => provider.id === model.providerAccountId)?.displayName ?? model.providerAccountId} / {model.providerModelId}
        </option>)}
      </select>
    </label>
    <label className={styles.toolCheckbox}>
      <input type="checkbox" checked={current.delivery === 'stream'} disabled={pending}
        onChange={event => setDraft({ ...current, delivery: event.target.checked ? 'stream' : 'complete' })} />
      <span>{props.t('agent.profile.deliveryStream')}</span>
    </label>
    {error ? <p role="alert" className={styles.toolError}>{error}</p> : null}
    <button type="submit" disabled={pending || !draft}>{props.t('agent.profile.save')}</button>
    {draft ? <button type="button" disabled={pending} onClick={() => { setDraft(undefined); setError(undefined) }}>
      {props.t('context.discardDraft')}
    </button> : null}
  </form>
}
