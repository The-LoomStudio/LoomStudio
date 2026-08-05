import { Package, Plus } from 'lucide-react'
import { useState } from 'react'
import type { AgentRuntimeProfile, ModelProfile } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './agent-runtime-manager.module.scss'

type AgentRuntimeManagerProps = {
  profiles: AgentRuntimeProfile[]
  models: ModelProfile[]
  selectedId?: string
  onSelect: (id: string) => void
  onCreate: (input: { name: string; purpose: string; presetId?: string; modelProfileId?: string }) => void
  onUpdate: (id: string, updates: { name?: string; purpose?: string; modelProfileId?: string }) => void
  onDelete: (id: string) => void
  t: Translator
}

export function AgentRuntimeManager(props: AgentRuntimeManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newModelId, setNewModelId] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  const activeProfile = props.profiles.find(profile => profile.id === props.selectedId)
  const activeModel = activeProfile?.modelProfileId ? props.models.find(model => model.id === activeProfile.modelProfileId) : undefined

  function resetCreateForm() {
    setIsCreating(false)
    setNewName('')
    setNewModelId('')
  }

  return (
    <div className={styles.agentRuntimeManager}>
      <header className={styles.agentHeader}>
        <button className={styles.agentHeaderToggle} type="button" aria-expanded={isExpanded} onClick={() => setIsExpanded(value => !value)}>
          <span className={styles.agentHeaderInfo}>
            <Package aria-hidden="true" size={16} />
            <span className={styles.agentTitle}>{props.t('preset.agentProfile')}</span>
            {activeProfile ? (
              <span className={styles.agentActiveBadge}>
                {activeProfile.name} {activeModel ? `(${activeModel.displayName})` : ''}
              </span>
            ) : (
              <span className={styles.agentEmptyBadge}>{props.t('preset.agentProfile.unselected')}</span>
            )}
          </span>
        </button>
        <button
          className={styles.agentAddButton}
          type="button"
          onClick={() => {
            setIsCreating(true)
            setIsExpanded(true)
          }}
        >
          <Plus aria-hidden="true" size={14} /> {props.t('preset.agentProfile.new')}
        </button>
      </header>

      {isExpanded ? (
        <div className={styles.agentBody}>
          {isCreating ? (
            <div className={styles.agentCreateForm}>
              <input
                placeholder={props.t('preset.agentProfile.namePlaceholder')}
                value={newName}
                onChange={event => setNewName(event.target.value)}
              />
              <select value={newModelId} onChange={event => setNewModelId(event.target.value)}>
                <option value="">{props.t('preset.agentProfile.selectModel')}</option>
                {props.models.map(model => (
                  <option key={model.id} value={model.id}>{model.displayName}</option>
                ))}
              </select>
              <div className={styles.agentFormActions}>
                <button
                  className={styles.agentBtnPrimary}
                  disabled={!newName || !newModelId}
                  type="button"
                  onClick={() => {
                    props.onCreate({ name: newName, purpose: 'General', modelProfileId: newModelId })
                    resetCreateForm()
                  }}
                >
                  {props.t('preset.agentProfile.save')}
                </button>
                <button className={styles.agentBtnCancel} type="button" onClick={resetCreateForm}>
                  {props.t('preset.agentProfile.cancel')}
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.agentList}>
            {props.profiles.length === 0 && !isCreating ? (
              <p className={styles.agentEmptyList}>{props.t('preset.agentProfile.empty')}</p>
            ) : null}
            {props.profiles.map(profile => {
              const model = profile.modelProfileId ? props.models.find(item => item.id === profile.modelProfileId) : undefined
              const isActive = profile.id === props.selectedId

              return (
                <div key={profile.id} className={`${styles.agentItem} ${isActive ? styles.agentItemActive : ''}`}>
                  <button className={styles.agentItemInfo} type="button" aria-pressed={isActive} onClick={() => props.onSelect(profile.id)}>
                    <strong>{profile.name}</strong>
                    <span>{model ? model.displayName : props.t('preset.agentProfile.noModel')}</span>
                  </button>
                  <div className={styles.agentItemActions}>
                    <select
                      value={profile.modelProfileId ?? ''}
                      onChange={event => props.onUpdate(profile.id, { modelProfileId: event.target.value })}
                    >
                      <option value="">{props.t('preset.agentProfile.selectModel')}</option>
                      {props.models.map(item => (
                        <option key={item.id} value={item.id}>{item.displayName}</option>
                      ))}
                    </select>
                    <button className={styles.agentBtnDanger} type="button" onClick={() => props.onDelete(profile.id)}>
                      {props.t('preset.agentProfile.delete')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
