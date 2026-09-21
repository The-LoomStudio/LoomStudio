import { Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AgentProfile, AgentToolDefinition, ModelProfile, PresetToolMount, PromptResource, ProviderAccount, ProviderModelSelection } from '../../entities/index.js'
import { MasterDetailWorkbench } from '../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import type { Translator } from '../../shared/i18n/index.js'
import { IconButton, Toggle } from '@loom-studio/ui'
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
  onCreate(input: { name: string; presetId?: string; model: ProviderModelSelection; delivery?: 'stream' | 'complete' }): void
  onDelete(id: string): void
  onSelect(id: string): void
  onUpdate(id: string, updates: { name?: string; presetId?: string; model?: ProviderModelSelection; toolOverrides?: Record<string, boolean>; delivery?: 'stream' | 'complete' }): void
}

type DetailTab = 'basic' | 'tools'

export function AgentPanel(props: AgentPanelProps) {
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [detailTab, setDetailTab] = useState<DetailTab>('basic')
  const [creating, setCreating] = useState(false)
  const [toolsQuery, setToolsQuery] = useState('')

  // New Profile draft state
  const [newName, setNewName] = useState('')
  const [newPresetId, setNewPresetId] = useState('')
  const [newModelProfileId, setNewModelProfileId] = useState('')
  const [newDelivery, setNewDelivery] = useState<'stream' | 'complete'>('stream')

  const defaultPresetId = props.presets.find(preset => preset.origin?.kind === 'builtin')?.id ?? props.presets[0]?.id ?? ''
  const activeProfileId = props.selectedAgentProfileId || props.agentProfiles[0]?.id

  const modelOptions = useMemo(() => props.modelProfiles.map(model => ({
    model,
    provider: props.providerAccounts.find(provider => provider.id === model.providerAccountId),
  })), [props.modelProfiles, props.providerAccounts])

  const currentProfile = useMemo(() => {
    return props.agentProfiles.find(profile => profile.id === activeProfileId) ?? props.agentProfiles[0]
  }, [props.agentProfiles, activeProfileId])

  // Group and filter tools for the selected profile
  const toolGroups = useMemo(() => {
    const normalized = normalizeSearchText(toolsQuery)
    const filtered = props.tools.filter(tool => {
      if (!normalized) return true
      return normalizeSearchText(`${tool.name} ${tool.description} ${tool.owner.namespace}`).includes(normalized)
    })

    const groups = new Map<string, AgentToolDefinition[]>()
    for (const tool of filtered) {
      const namespace = tool.owner.namespace || 'default'
      const list = groups.get(namespace) ?? []
      list.push(tool)
      groups.set(namespace, list)
    }

    return Array.from(groups.entries())
      .map(([namespace, tools]) => ({
        namespace,
        tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace))
  }, [props.tools, toolsQuery])

  function handleCreateSubmit(event: FormEvent) {
    event.preventDefault()
    const model = readModelSelection(newModelProfileId, props.modelProfiles)
    const effectivePresetId = newPresetId || defaultPresetId
    if (!newName.trim() || !model || !effectivePresetId) return

    props.onCreate({
      name: newName.trim(),
      presetId: effectivePresetId,
      model,
      delivery: newDelivery,
    })

    setNewName('')
    setNewPresetId('')
    setNewModelProfileId('')
    setNewDelivery('stream')
    setCreating(false)
    setMobilePane('detail')
  }

  const currentModelProfile = currentProfile
    ? props.modelProfiles.find(model =>
        model.providerAccountId === currentProfile.model.providerProfileId &&
        model.providerModelId === currentProfile.model.modelId,
      )
    : undefined

  const currentPreset = currentProfile
    ? props.presets.find(preset => preset.id === currentProfile.presetId)
    : undefined

  // Number of tools mounted by the current preset
  const mountedToolsCount = useMemo(() => {
    if (!currentProfile) return 0
    return props.toolMounts.filter(m => m.presetResourceId === currentProfile.presetId).length
  }, [props.toolMounts, currentProfile])

  return (
    <aside className={styles.panel} data-loom-component="agent-panel">
      <MasterDetailWorkbench
        masterWidth="minmax(240px, 290px)"
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        master={
          <div className={styles.masterContainer}>
            <header className={styles.masterHeader}>
              <div className={styles.masterTitleRow}>
                <h2>{props.t('agent.profile.title')}</h2>
                <span className={styles.profileCount}>{props.agentProfiles.length}</span>
              </div>
              <button
                className={styles.newButton}
                type="button"
                onClick={() => {
                  setCreating(prev => !prev)
                  if (!creating) setMobilePane('master')
                }}
              >
                <Plus aria-hidden="true" />
                {props.t('agent.profile.new')}
              </button>
            </header>

            {creating ? (
              <form className={`${styles.createForm} loom-underlined-fields`} onSubmit={handleCreateSubmit}>
                <label>
                  <span>{props.t('agent.profile.name')}</span>
                  <input
                    autoFocus
                    required
                    placeholder={props.t('agent.profile.name')}
                    value={newName}
                    onChange={event => setNewName(event.target.value)}
                  />
                </label>
                <label>
                  <span>{props.t('agent.profile.preset')}</span>
                  <select
                    required
                    value={newPresetId || defaultPresetId}
                    onChange={event => setNewPresetId(event.target.value)}
                  >
                    {props.presets.length === 0 ? <option value="">{props.t('agent.profile.defaultPreset')}</option> : null}
                    {props.presets.map(preset => (
                      <option key={preset.id} value={preset.id}>{readPresetLabel(preset, props.t)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{props.t('agent.profile.model')}</span>
                  <select
                    required
                    value={newModelProfileId}
                    onChange={event => setNewModelProfileId(event.target.value)}
                  >
                    <option value="">{props.t('agent.profile.selectModel')}</option>
                    {modelOptions.map(({ model, provider }) => (
                      <option key={model.id} value={model.id}>
                        {provider?.displayName ?? model.providerAccountId} / {model.providerModelId}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.toggleField}>
                  <span className={styles.fieldLabel}>{props.t('agent.profile.deliveryStream')}</span>
                  <Toggle
                    checked={newDelivery === 'stream'}
                    label={props.t('agent.profile.deliveryStream')}
                    onChange={checked => setNewDelivery(checked ? 'stream' : 'complete')}
                  />
                </div>
                <div className={styles.formActions}>
                  <button
                    disabled={props.busy || !newName.trim() || !newModelProfileId || !(newPresetId || defaultPresetId)}
                    type="submit"
                  >
                    {props.t('agent.profile.save')}
                  </button>
                  <button type="button" onClick={() => setCreating(false)}>
                    {props.t('agent.profile.cancel')}
                  </button>
                </div>
              </form>
            ) : null}

            <div className={styles.masterList}>
              {props.agentProfiles.length === 0 && !creating ? (
                <p className={styles.empty}>{props.t('agent.profile.empty')}</p>
              ) : null}

              {props.agentProfiles.map(profile => {
                const isActive = profile.id === currentProfile?.id
                const profilePreset = props.presets.find(p => p.id === profile.presetId)
                const provider = props.providerAccounts.find(account => account.id === profile.model.providerProfileId)

                return (
                  <div
                    key={profile.id}
                    className={`${styles.profileItem} ${isActive ? styles.profileItemActive : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      props.onSelect(profile.id)
                      setMobilePane('detail')
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        props.onSelect(profile.id)
                        setMobilePane('detail')
                      }
                    }}
                  >
                    <div className={styles.profileItemMain}>
                      <strong className={styles.profileItemName}>{profile.name}</strong>
                      <span className={styles.profileItemMeta}>
                        {profilePreset ? readPresetLabel(profilePreset, props.t) : profile.presetId} · {provider?.displayName ?? profile.model.providerProfileId} / {profile.model.modelId}
                      </span>
                    </div>
                    <IconButton
                      aria-label={props.t('agent.profile.deleteNamed', { name: profile.name })}
                      className={styles.profileItemDelete}
                      disabled={props.busy}
                      size="small"
                      variant="danger"
                      onClick={event => {
                        event.stopPropagation()
                        props.onDelete(profile.id)
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                )
              })}
            </div>
          </div>
        }
      >
        {currentProfile ? (
          <div className={styles.detailContainer}>
            <header className={styles.detailHeader}>
              <PanelTabs<DetailTab>
                activeId={detailTab}
                ariaLabel={props.t('agent.profile.tabBasic')}
                items={[
                  { id: 'basic', label: props.t('agent.profile.tabBasic') },
                  {
                    id: 'tools',
                    label: props.t('agent.profile.tabTools'),
                    badge: <span className={styles.tabBadge}>{mountedToolsCount}</span>,
                  },
                ]}
                onChange={setDetailTab}
              />
            </header>

            <div className={styles.detailBody}>
              {detailTab === 'basic' ? (
                <div className={`${styles.basicForm} loom-underlined-fields`}>
                  <label>
                    <span>{props.t('agent.profile.name')}</span>
                    <input
                      key={`name-${currentProfile.id}`}
                      defaultValue={currentProfile.name}
                      onBlur={event => {
                        const next = event.target.value.trim()
                        if (next && next !== currentProfile.name) {
                          props.onUpdate(currentProfile.id, { name: next })
                        }
                      }}
                    />
                  </label>

                  <label>
                    <span>{props.t('agent.profile.preset')}</span>
                    <select
                      value={currentProfile.presetId}
                      onChange={event => props.onUpdate(currentProfile.id, { presetId: event.target.value })}
                    >
                      {props.presets.map(preset => (
                        <option key={preset.id} value={preset.id}>
                          {readPresetLabel(preset, props.t)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>{props.t('agent.profile.model')}</span>
                    <select
                      value={currentModelProfile?.id ?? ''}
                      onChange={event => {
                        const model = readModelSelection(event.target.value, props.modelProfiles)
                        if (model) props.onUpdate(currentProfile.id, { model })
                      }}
                    >
                      <option disabled value="">{props.t('agent.profile.selectModel')}</option>
                      {modelOptions.map(({ model, provider }) => (
                        <option key={model.id} value={model.id}>
                          {provider?.displayName ?? model.providerAccountId} / {model.providerModelId}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className={styles.deliverySection}>
                    <div className={styles.toggleRow}>
                      <div className={styles.toggleInfo}>
                        <span className={styles.toggleTitle}>{props.t('agent.profile.deliveryStream')}</span>
                        <small className={styles.toggleHint}>{props.t('agent.profile.streamHint')}</small>
                      </div>
                      <Toggle
                        checked={currentProfile.delivery !== 'complete'}
                        disabled={props.busy}
                        label={props.t('agent.profile.deliveryStream')}
                        onChange={checked => {
                          props.onUpdate(currentProfile.id, { delivery: checked ? 'stream' : 'complete' })
                        }}
                      />
                    </div>
                  </div>

                  <div className={styles.dangerZone}>
                    <button
                      className={styles.deleteButton}
                      disabled={props.busy}
                      type="button"
                      onClick={() => props.onDelete(currentProfile.id)}
                    >
                      <Trash2 aria-hidden="true" />
                      {props.t('agent.profile.delete')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.toolsView}>
                  <div className={styles.toolsSearch}>
                    <Search aria-hidden="true" />
                    <input
                      aria-label={props.t('agent.profile.toolsSearchPlaceholder')}
                      placeholder={props.t('agent.profile.toolsSearchPlaceholder')}
                      value={toolsQuery}
                      onChange={event => setToolsQuery(event.target.value)}
                    />
                    {toolsQuery ? (
                      <button
                        aria-label={props.t('agent.profile.cancel')}
                        type="button"
                        onClick={() => setToolsQuery('')}
                      >
                        <X aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  {toolGroups.length === 0 ? (
                    <div className={styles.toolsEmpty}>{props.t('agent.profile.toolsSearchEmpty')}</div>
                  ) : null}

                  {toolGroups.map(group => (
                    <section key={group.namespace} className={styles.toolNamespaceSection}>
                      <header className={styles.toolNamespaceHeader}>
                        <span className={styles.toolNamespaceName}>{group.namespace}</span>
                        <span className={styles.toolNamespaceCount}>{group.tools.length}</span>
                      </header>

                      <div className={styles.toolList}>
                        {group.tools.map(tool => {
                          const mount = props.toolMounts.find(
                            item => item.presetResourceId === currentProfile.presetId && item.toolId === tool.id,
                          )
                          const inherited = currentProfile.toolOverrides[tool.id] === undefined
                          const enabled = mount ? (currentProfile.toolOverrides[tool.id] ?? mount.defaultEnabled) : false

                          return (
                            <div key={tool.id} className={styles.toolItem}>
                              <div className={styles.toolItemMain}>
                                <div className={styles.toolTitleRow}>
                                  <strong className={styles.toolName}>{tool.name}</strong>
                                  <span className={styles.toolKindBadge}>
                                    {tool.input.kind === 'structured' ? 'provider' : 'custom'}
                                  </span>
                                  {mount ? (
                                    <span className={inherited ? styles.badgeInherited : styles.badgeOverridden}>
                                      {props.t(inherited ? 'agent.profile.toolInherited' : 'agent.profile.toolOverridden')}
                                    </span>
                                  ) : (
                                    <span className={styles.badgeNotMounted}>
                                      {props.t('agent.profile.toolNotMounted')}
                                    </span>
                                  )}
                                </div>
                                <p className={styles.toolDescription}>{tool.description}</p>
                                {!inherited && mount ? (
                                  <button
                                    className={styles.resetButton}
                                    type="button"
                                    onClick={() => {
                                      props.onUpdate(currentProfile.id, {
                                        toolOverrides: omitToolOverride(currentProfile.toolOverrides, tool.id),
                                      })
                                    }}
                                  >
                                    <RotateCcw aria-hidden="true" />
                                    {props.t('agent.profile.resetToDefault')}
                                  </button>
                                ) : null}
                              </div>

                              <div className={styles.toolItemToggle}>
                                <Toggle
                                  checked={enabled}
                                  disabled={props.busy || !mount}
                                  label={`${tool.name} enabled`}
                                  onChange={checked => {
                                    props.onUpdate(currentProfile.id, {
                                      toolOverrides: {
                                        ...currentProfile.toolOverrides,
                                        [tool.id]: checked,
                                      },
                                    })
                                  }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.emptyDetail}>
            <h3>{props.t('agent.profile.noSelectionTitle')}</h3>
            <p>{props.t('agent.profile.noSelectionBody')}</p>
          </div>
        )}
      </MasterDetailWorkbench>
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
