import { useState } from 'react'
import { Bot, Check, ChevronDown, ExternalLink, Layers, Sparkles, UserRound, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  SearchField,
} from '@loom-studio/ui'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { AgentPreset, ProviderAccount, ProviderModelSelection } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import { ExtensionIcon, presetIconUrl, useExtensionIdentities } from '../../shared/ui/extension-icon/extension-icon.js'
import { resolveModelBrand, resolveProviderBrand } from '../../features/provider-settings/model/model-brand.js'
import { ModelBrandIcon } from '../../features/provider-settings/ui/model-brand-icon.js'
import composerStyles from './agent-chat-panel.module.scss'
import styles from './agent-preset-picker.module.scss'

export function AgentPresetPicker(props: {
  disabled: boolean
  profiles: AgentPreset[]
  providers: ProviderAccount[]
  selectedId?: string
  t: Translator
  onSelect(id: string): void
  onSaveModel?(presetId: string, model: ProviderModelSelection | null): Promise<void> | void
  onOpenWorkbench?(presetId: string, nodeId?: string): void
  open?: boolean
  onOpenChange?(open: boolean): void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = props.open ?? internalOpen
  const setOpen = props.onOpenChange ?? setInternalOpen
  const [query, setQuery] = useState('')
  const [activeSourceId, setActiveSourceId] = useState<string>('all')

  const identities = useExtensionIdentities()

  const sourceOf = (profile: AgentPreset) => {
    const origin = profile.origin
    if (origin?.kind === 'extension-package') {
      const identity = identities.find(
        item =>
          item.packageId === origin.packageId &&
          extensionInstallationId(item.packageId, item.target ?? { kind: 'global' }) ===
            (origin.installationId ?? extensionInstallationId(origin.packageId, { kind: 'global' })),
      )
      const scope = identity?.target?.kind === 'card' ? '角色' : identity || !origin.installationId ? '全局' : '安装来源未解析'
      return {
        id: `${origin.packageId}:${origin.installationId ?? ''}`,
        label: `${identity?.displayName ?? origin.packageId} · ${scope}`,
        shortLabel: identity?.displayName ?? origin.packageId,
        iconUrl: identity?.iconUrl,
        kind: 'extension',
      }
    }
    return origin?.kind === 'builtin'
      ? { id: 'builtin', label: '官方 · Loom Studio', shortLabel: '官方', iconUrl: undefined, kind: 'builtin' }
      : { id: 'personal', label: '我的预设', shortLabel: '个人', iconUrl: undefined, kind: 'personal' }
  }

  // 聚合所有不重复的来源集合（驱动左侧分类栏）
  const sourceCategories = (() => {
    const map = new Map<string, ReturnType<typeof sourceOf>>()
    for (const profile of props.profiles) {
      const src = sourceOf(profile)
      if (!map.has(src.id)) {
        map.set(src.id, src)
      }
    }
    return [...map.values()]
  })()

  // 检索过滤
  const search = normalizeSearchText(query)
  const filteredProfiles = props.profiles.filter(profile => {
    const src = sourceOf(profile)
    if (activeSourceId !== 'all' && src.id !== activeSourceId) {
      return false
    }
    if (!search) return true
    const model = profile.model?.modelId ?? ''
    const text = `${profile.rootNode.label} ${src.label} ${model}`
    return normalizeSearchText(text).includes(search)
  })

  // 按来源分组
  const sections = (() => {
    const groupMap = new Map<string, { source: ReturnType<typeof sourceOf>; profiles: AgentPreset[] }>()
    for (const profile of filteredProfiles) {
      const src = sourceOf(profile)
      const existing = groupMap.get(src.id) ?? { source: src, profiles: [] }
      existing.profiles.push(profile)
      groupMap.set(src.id, existing)
    }
    return [...groupMap.values()]
  })()

  // 当前已选预设
  const selected = props.profiles.find(profile => profile.id === props.selectedId)

  const handleSelectPreset = (presetId: string) => {
    props.onSelect(presetId)
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* 1. Composer 底部常驻胶囊触发按钮 */}
      <DropdownMenuTrigger asChild>
        <button
          className={composerStyles.profilePicker}
          type="button"
          disabled={props.disabled}
          aria-haspopup="dialog"
          title={props.t('agent.profile.choose')}
        >
          <ExtensionIcon
            iconUrl={selected ? presetIconUrl(selected, identities) : undefined}
            size={18}
            fallback={<Bot size={16} />}
          />
          <span>{selected?.rootNode.label ?? props.t('agent.profile.unselected')}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      {/* 2. 紧凑两列悬浮 Popover 容器 */}
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className={styles.popoverContent}
        data-loom-component="catalog-preset-popover"
      >
        <header className={styles.popoverHeader}>
          <h2 className={styles.popoverTitle}>选择预设</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => setOpen(false)}
            aria-label={props.t('agent.close')}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.pickerContainer}>
          {/* 左侧来源/分类侧栏 */}
          <aside className={styles.rail} aria-label="预设来源导航">
            <button
              type="button"
              className={styles.railButton}
              data-active={activeSourceId === 'all' || undefined}
              title="全部预设"
              aria-label="全部预设"
              onClick={() => setActiveSourceId('all')}
            >
              <span className={styles.railIcon}><Layers size={16} /></span>
              <span className={styles.railText}>全部</span>
            </button>

            <div className={styles.railDivider} />

            {sourceCategories.map(source => {
              const isActive = activeSourceId === source.id
              return (
                <button
                  key={source.id}
                  type="button"
                  className={styles.railButton}
                  data-active={isActive || undefined}
                  title={source.label}
                  aria-label={source.label}
                  onClick={() => setActiveSourceId(source.id)}
                >
                  <span className={styles.railIcon}>
                    {source.iconUrl ? (
                      <ExtensionIcon iconUrl={source.iconUrl} size={18} />
                    ) : source.kind === 'personal' ? (
                      <UserRound size={16} />
                    ) : source.kind === 'builtin' ? (
                      <Sparkles size={15} />
                    ) : (
                      <Layers size={15} />
                    )}
                  </span>
                  <span className={styles.railText}>{source.shortLabel}</span>
                </button>
              )
            })}
          </aside>

          {/* 右侧主预设列表 */}
          <section className={styles.master}>
            <div className={styles.searchHeader}>
              <SearchField
                autoFocus
                value={query}
                placeholder="搜索预设名称或模型…"
                aria-label="搜索预设"
                clearLabel={props.t('agent.clearSearch')}
                onChange={event => setQuery(event.target.value)}
                onClear={() => setQuery('')}
              />
            </div>

            <div className={styles.itemList} role="listbox">
              {filteredProfiles.length === 0 ? (
                <p className={styles.empty}>
                  {props.profiles.length ? '没有匹配的预设' : props.t('agent.profile.configureFirst')}
                </p>
              ) : null}

              {sections.map(section => {
                const showGroupHeader = activeSourceId === 'all' || Boolean(query)
                return (
                  <div key={section.source.id} className={styles.sectionGroup}>
                    {showGroupHeader && (
                      <div className={styles.groupHeader}>
                        {section.source.iconUrl ? (
                          <span className={styles.groupIcon}>
                            <ExtensionIcon iconUrl={section.source.iconUrl} size={14} />
                          </span>
                        ) : null}
                        <span className={styles.groupTitle}>{section.source.label}</span>
                      </div>
                    )}

                    <div className={styles.groupItems}>
                      {section.profiles.map(profile => {
                        const isCurrentSelected = profile.id === props.selectedId
                        const provider = props.providers.find(item => item.id === profile.model?.providerProfileId)
                        const modelLabel = profile.model?.modelId
                          ? [provider?.displayName ?? profile.model.providerProfileId, profile.model.modelId]
                              .filter(Boolean)
                              .join(' · ')
                          : '未绑定模型'

                        const providerBaseUrl = typeof provider?.config.baseUrl === 'string' ? provider.config.baseUrl : ''
                        const providerBrand = provider
                          ? resolveProviderBrand(provider.displayName, providerBaseUrl, provider.providerExtensionId)
                          : undefined
                        const modelBrand = (profile.model?.modelId ? resolveModelBrand(profile.model.modelId) : undefined) ?? providerBrand

                        return (
                          <div
                            key={profile.id}
                            role="option"
                            aria-selected={isCurrentSelected}
                            data-selected={isCurrentSelected || undefined}
                            className={styles.presetItem}
                            onClick={() => handleSelectPreset(profile.id)}
                          >
                            <span className={styles.presetIcon}>
                              <ExtensionIcon
                                iconUrl={presetIconUrl(profile, identities)}
                                size={22}
                                fallback={<Bot size={20} />}
                              />
                            </span>
                            <div className={styles.presetInfo}>
                              <div className={styles.presetName}>{profile.rootNode.label}</div>
                              <div className={styles.presetSubtitle}>
                                <span className={styles.modelIcon}>
                                  {modelBrand ? (
                                    <ModelBrandIcon
                                      brand={modelBrand}
                                      className={styles.brandIconImage}
                                      fallback={<Bot size={13} className={styles.brandIconImage} />}
                                    />
                                  ) : (
                                    <Bot size={13} className={styles.brandIconImage} />
                                  )}
                                </span>
                                <span className={styles.modelNameText}>{modelLabel}</span>
                              </div>
                            </div>

                            <div className={styles.itemRight} onClick={e => e.stopPropagation()}>
                              {props.onOpenWorkbench ? (
                                <button
                                  type="button"
                                  className={styles.editIconButton}
                                  title={`在工作台中编辑「${profile.rootNode.label}」`}
                                  aria-label={`在工作台中编辑 ${profile.rootNode.label}`}
                                  onClick={e => {
                                    e.stopPropagation()
                                    props.onOpenWorkbench?.(profile.id, profile.rootNode.id)
                                    setOpen(false)
                                  }}
                                >
                                  <ExternalLink size={15} aria-hidden="true" />
                                </button>
                              ) : null}

                              <span className={styles.checkSlot} aria-hidden="true">
                                {isCurrentSelected ? (
                                  <Check size={15} className={styles.selectedCheck} aria-label="已选中" />
                                ) : null}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
