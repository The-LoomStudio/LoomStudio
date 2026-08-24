import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import type { AgentProfile, AgentToolDefinition, ModelProfile, PresetToolMount, PromptResource, ProviderAccount, ProviderModelSelection } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './agent-panel.module.scss'

type AgentPanelProps = {
  presets: PromptResource[]
  agentProfiles: AgentProfile[]
  tools: AgentToolDefinition[]
  toolMounts: PresetToolMount[]
  busy: boolean
  modelProfiles: ModelProfile[]
  providerAccounts: ProviderAccount[]
  selectedAgentProfileId?: string
  t: Translator
  onCreate(input: { name: string; presetId?: string; model: ProviderModelSelection }): void
  onDelete(id: string): void
  onSelect(id: string): void
  onUpdate(id: string, updates: { name?: string; presetId?: string; model?: ProviderModelSelection; toolOverrides?: Record<string, boolean> }): void
}

export function AgentPanel(props: AgentPanelProps) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [presetId, setPresetId] = useState('')
  const [modelProfileId, setModelProfileId] = useState('')
  const defaultPresetId = props.presets.find(preset => preset.origin?.kind === 'builtin')?.id ?? props.presets[0]?.id ?? ''
  const selectedPresetId = presetId || defaultPresetId
  const modelOptions = useMemo(() => props.modelProfiles.map(model => ({
    model,
    provider: props.providerAccounts.find(provider => provider.id === model.providerAccountId),
  })), [props.modelProfiles, props.providerAccounts])

  function submit(event: FormEvent) {
    event.preventDefault()
    const model = readModelSelection(modelProfileId, props.modelProfiles)
    if (!name.trim() || !model || !selectedPresetId) return
    props.onCreate({ name: name.trim(), presetId: selectedPresetId, model })
    setName('')
    setPresetId('')
    setModelProfileId('')
    setCreating(false)
  }

  return (
    <aside className={styles.panel} data-loom-component="agent-panel">
      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <div>
            <h2>{props.t('agent.profile.title')}</h2>
            <p>{props.t('agent.profile.description')}</p>
          </div>
          <button className={styles.addButton} type="button" onClick={() => setCreating(value => !value)}>
            <Plus aria-hidden="true" />{props.t('agent.profile.new')}
          </button>
        </header>

        {creating ? (
          <form className={`${styles.createForm} loom-underlined-fields`} onSubmit={submit}>
            <label>
              <span>{props.t('agent.profile.name')}</span>
              <input autoFocus required value={name} onChange={event => setName(event.target.value)} />
            </label>
            <label>
              <span>{props.t('agent.profile.preset')}</span>
              <select required value={selectedPresetId} onChange={event => setPresetId(event.target.value)}>
                {props.presets.length === 0 ? <option value="">{props.t('agent.profile.defaultPreset')}</option> : null}
                {props.presets.map(preset => <option key={preset.id} value={preset.id}>{readPresetLabel(preset, props.t)}</option>)}
              </select>
            </label>
            <label>
              <span>{props.t('agent.profile.model')}</span>
              <select required value={modelProfileId} onChange={event => setModelProfileId(event.target.value)}>
                <option value="">{props.t('agent.profile.selectModel')}</option>
                {modelOptions.map(({ model, provider }) => (
                  <option key={model.id} value={model.id}>{provider?.displayName ?? model.providerAccountId} / {model.providerModelId}</option>
                ))}
              </select>
            </label>
            <div className={styles.formActions}>
              <button disabled={props.busy || !name.trim() || !modelProfileId || !selectedPresetId} type="submit">{props.t('agent.profile.save')}</button>
              <button type="button" onClick={() => setCreating(false)}>{props.t('agent.profile.cancel')}</button>
            </div>
          </form>
        ) : null}

        <div className={styles.profileList}>
          {props.agentProfiles.length === 0 ? <p className={styles.empty}>{props.t('agent.profile.empty')}</p> : null}
          {props.agentProfiles.map(profile => {
            const modelProfile = props.modelProfiles.find(model => model.providerAccountId === profile.model.providerProfileId && model.providerModelId === profile.model.modelId)
            const provider = props.providerAccounts.find(account => account.id === profile.model.providerProfileId)
            return (
              <article className={profile.id === props.selectedAgentProfileId ? styles.profileActive : styles.profile} key={profile.id}>
                <button className={styles.profileIdentity} type="button" onClick={() => props.onSelect(profile.id)}>
                  <strong>{profile.name}</strong>
                  <span>{provider?.displayName ?? profile.model.providerProfileId} / {profile.model.modelId}</span>
                </button>
                <div className={`${styles.profileFields} loom-underlined-fields`}>
                  <label>
                    <span>{props.t('agent.profile.name')}</span>
                    <input defaultValue={profile.name} onBlur={event => {
                      const nextName = event.target.value.trim()
                      if (nextName && nextName !== profile.name) props.onUpdate(profile.id, { name: nextName })
                    }} />
                  </label>
                  <label>
                    <span>{props.t('agent.profile.preset')}</span>
                    <select value={profile.presetId} onChange={event => props.onUpdate(profile.id, { presetId: event.target.value })}>
                      {props.presets.map(preset => <option key={preset.id} value={preset.id}>{readPresetLabel(preset, props.t)}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>{props.t('agent.profile.model')}</span>
                    <select value={modelProfile?.id ?? ''} onChange={event => {
                      const model = readModelSelection(event.target.value, props.modelProfiles)
                      if (model) props.onUpdate(profile.id, { model })
                    }}>
                      <option value="" disabled>{props.t('agent.profile.selectModel')}</option>
                      {modelOptions.map(({ model, provider: optionProvider }) => (
                        <option key={model.id} value={model.id}>{optionProvider?.displayName ?? model.providerAccountId} / {model.providerModelId}</option>
                      ))}
                    </select>
                  </label>
                  {props.tools.length ? (
                    <fieldset className={styles.toolsField}>
                      <legend className={styles.toolsLegend}>Tools</legend>
                      <div className={styles.toolList}>
                        {props.tools.map(tool => {
                          const mount = props.toolMounts.find(item => item.presetResourceId === profile.presetId && item.toolId === tool.id)
                          const inherited = profile.toolOverrides[tool.id] === undefined
                          const enabled = mount ? profile.toolOverrides[tool.id] ?? mount.defaultEnabled : false
                          return (
                            <div className={styles.toolOption} key={tool.id}>
                              <input
                                aria-label={`${tool.name} enabled`}
                                checked={enabled}
                                disabled={props.busy || !mount}
                                type="checkbox"
                                onChange={event => {
                                  props.onUpdate(profile.id, {
                                    toolOverrides: {
                                      ...profile.toolOverrides,
                                      [tool.id]: event.target.checked,
                                    },
                                  })
                                }}
                              />
                              <span className={styles.toolDetails}>
                                <strong>{tool.name}</strong>
                                <small>{tool.description}</small>
                                <em>{mount ? `${tool.owner.namespace} · ${tool.input.kind} · ${inherited ? 'Preset default' : 'Agent override'}` : 'Not mounted by Preset'}</em>
                                {!inherited && mount ? (
                                  <button type="button" onClick={() => props.onUpdate(profile.id, { toolOverrides: omitToolOverride(profile.toolOverrides, tool.id) })}>
                                    Use Preset default
                                  </button>
                                ) : null}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </fieldset>
                  ) : null}
                  <button aria-label={props.t('agent.profile.deleteNamed', { name: profile.name })} className={styles.deleteButton} disabled={props.busy} title={props.t('agent.profile.delete')} type="button" onClick={() => props.onDelete(profile.id)}>
                    <Trash2 aria-hidden="true" />{props.t('agent.profile.delete')}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </aside>
  )
}

function readPresetLabel(preset: PromptResource, t: Translator): string {
  return preset.origin?.kind === 'builtin' ? `${preset.rootNode.label} · ${t('promptResource.official')}` : preset.rootNode.label
}

function omitToolOverride(overrides: Record<string, boolean>, toolId: string): Record<string, boolean> {
  return Object.fromEntries(Object.entries(overrides).filter(([id]) => id !== toolId))
}

function readModelSelection(modelProfileId: string, models: ModelProfile[]): ProviderModelSelection | undefined {
  const model = models.find(item => item.id === modelProfileId)
  return model ? { providerProfileId: model.providerAccountId, modelId: model.providerModelId } : undefined
}
