import { useRef, useState, type ReactNode } from 'react'
import type { PromptResource, ProviderModelSelection } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './agent-model-editor.module.scss'

export function AgentModelEditor(props: {
  preset: PromptResource
  renderModelPicker(input: { model?: ProviderModelSelection; pending: boolean; open: boolean; error?: string; onOpen(): void; onClose(): void; onSelect(model: ProviderModelSelection | undefined, enable?: boolean): Promise<void> }): ReactNode
  t: Translator
  onSave(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
  onCreateModel(accountId: string, modelId: string): Promise<void>
}) {
  const [committed, setCommitted] = useState<PromptResource>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  const saving = useRef(false)
  const current = committed && committed.version > props.preset.version ? committed : props.preset

  async function save(model: ProviderModelSelection | undefined, delivery: 'stream' | 'complete', enable = false, close = false, approvalPolicy = current.approvalPolicy) {
    if (saving.current) return
    saving.current = true
    setPending(true)
    setError(undefined)
    let addedToAccount = false
    try {
      if (model && enable) {
        await props.onCreateModel(model.providerProfileId, model.modelId)
        addedToAccount = true
      }
      const sameModel = model?.providerProfileId === current.model?.providerProfileId && model?.modelId === current.model?.modelId
      const samePolicy = (['workspaceWrite', 'resourceWrite', 'stateWrite', 'narrativeWrite', 'historyRead', 'authorMode'] as const)
        .every(scope => (approvalPolicy?.[scope] ?? 'ask') === (current.approvalPolicy?.[scope] ?? 'ask'))
      if (sameModel && delivery === (current.delivery ?? 'stream') && samePolicy) {
        if (close) setOpen(false)
        return
      }
      const result = await props.onSave({
        agentPresetId: props.preset.id,
        expectedVersion: current.version,
        model: model ?? null,
        delivery,
        ...(approvalPolicy !== undefined ? { approvalPolicy } : {}),
      })
      setCommitted(result)
      if (close) setOpen(false)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(addedToAccount ? `${props.t('agent.model.addedButNotBound')} ${message}` : message)
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  return <div className={`${styles.toolForm} ${styles.presetModelForm} loom-underlined-fields`}>
    {props.renderModelPicker({ model: current.model, pending, open, error,
      onOpen: () => { setError(undefined); setOpen(true) }, onClose: () => setOpen(false),
      onSelect: (model, enable) => save(model, current.delivery ?? 'stream', enable, true),
    })}
    <label className={styles.toolCheckbox}>
      <input type="checkbox" checked={(current.delivery ?? 'stream') === 'stream'} disabled={pending}
        onChange={event => void save(current.model, event.target.checked ? 'stream' : 'complete')} />
      <span>{props.t('agent.profile.deliveryStream')}</span>
    </label>
    <fieldset className={styles.approvals} disabled={pending}>
      <legend>{props.t('agent.approvalSettings')}</legend>
      <p>{props.t('agent.approvalSettingsHint')}</p>
      {(['workspaceWrite', 'resourceWrite', 'stateWrite', 'narrativeWrite', 'historyRead', 'authorMode'] as const).map(scope =>
        <label key={scope}><span>{props.t(`agent.approvalScope.${scope}`)}</span>
          <select aria-label={props.t(`agent.approvalScope.${scope}`)} value={current.approvalPolicy?.[scope] ?? 'ask'}
            onChange={event => {
              const mode = event.target.value
              if (mode === 'ask' || mode === 'allow' || mode === 'deny')
                void save(current.model, current.delivery ?? 'stream', false, false, { ...current.approvalPolicy, [scope]: mode })
            }}>
            <option value="ask">{props.t('agent.approvalMode.ask')}</option>
            <option value="allow">{props.t('agent.approvalMode.allow')}</option>
            <option value="deny">{props.t('agent.approvalMode.deny')}</option>
          </select>
        </label>)}
    </fieldset>
    {error && !open ? <p role="alert" className={styles.toolError}>{error}</p> : null}
  </div>
}
