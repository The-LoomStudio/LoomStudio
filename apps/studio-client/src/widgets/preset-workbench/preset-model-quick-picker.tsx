import { useRef, useState } from 'react'
import { Bot, Check, ChevronDown, Layers, RefreshCw, Server, X } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  SearchField,
} from '@loom-studio/ui'
import type { ModelProfile, PromptResource, ProviderAccount, ProviderModelSelection } from '../../entities/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import { resolveModelBrand, resolveProviderBrand } from '../../features/provider-settings/model/model-brand.js'
import { ModelBrandIcon } from '../../features/provider-settings/ui/model-brand-icon.js'
import styles from './preset-model-quick-picker.module.scss'

type Catalog = { models?: string[]; loading?: boolean; error?: string }

export interface PresetModelQuickPickerProps {
  preset: PromptResource
  modelProfiles: ModelProfile[]
  providerAccounts: ProviderAccount[]
  onListModels(accountId: string): Promise<string[]>
  onCreateModel(accountId: string, modelId: string): Promise<void>
  onSaveModel(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
  t: Translator
  variant?: 'icon' | 'inline'
}

export function PresetModelQuickPicker(props: PresetModelQuickPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeAccountId, setActiveAccountId] = useState<string>('all')
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({})
  const [pending, setPending] = useState(false)
  const requests = useRef(new Set<string>())

  const currentModel = props.preset.model
  const currentAccount = props.providerAccounts.find(
    a => a.id === currentModel?.providerProfileId,
  )
  const currentModelLabel = currentModel?.modelId
    ? `${currentAccount?.displayName ?? currentModel.providerProfileId} · ${currentModel.modelId}`
    : '选择模型'
  const currentAccountBaseUrl = typeof currentAccount?.config.baseUrl === 'string' ? currentAccount.config.baseUrl : ''
  const currentAccountBrand = currentAccount
    ? resolveProviderBrand(currentAccount.displayName, currentAccountBaseUrl, currentAccount.providerExtensionId)
    : undefined
  const brand = (currentModel?.modelId ? resolveModelBrand(currentModel.modelId) : null) ?? currentAccountBrand ?? null

  async function loadModels(accountId: string) {
    if (requests.current.has(accountId)) return
    requests.current.add(accountId)
    setCatalogs(prev => ({
      ...prev,
      [accountId]: { ...prev[accountId], loading: true, error: undefined },
    }))
    try {
      const models = await props.onListModels(accountId)
      setCatalogs(prev => ({ ...prev, [accountId]: { models } }))
    } catch (err) {
      setCatalogs(prev => ({
        ...prev,
        [accountId]: {
          ...prev[accountId],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }))
    } finally {
      requests.current.delete(accountId)
    }
  }

  const search = normalizeSearchText(query)

  const accountSections = props.providerAccounts.map(account => {
    const catalog = catalogs[account.id]
    const enabled = new Set(
      props.modelProfiles
        .filter(model => model.providerAccountId === account.id)
        .map(model => model.providerModelId),
    )
    const models = [...new Set([...enabled, ...(catalog?.models ?? [])])]
    const accountMatches = normalizeSearchText(account.displayName).includes(search)
    const visible = models.filter(
      model => accountMatches || normalizeSearchText(model).includes(search),
    )
    const baseUrl = typeof account.config.baseUrl === 'string' ? account.config.baseUrl : ''
    const accountBrand = resolveProviderBrand(
      account.displayName,
      baseUrl,
      account.providerExtensionId,
    )

    return {
      account,
      brand: accountBrand,
      catalog,
      enabled,
      models,
      visible,
    }
  })

  const displayedSections =
    activeAccountId === 'all'
      ? accountSections
      : accountSections.filter(s => s.account.id === activeAccountId)

  const handleSelect = async (accountId: string, modelId: string, needEnable: boolean) => {
    setPending(true)
    try {
      if (needEnable) {
        await props.onCreateModel(accountId, modelId)
      }
      await props.onSaveModel({
        agentPresetId: props.preset.id,
        expectedVersion: props.preset.version,
        model: { providerProfileId: accountId, modelId },
        delivery: props.preset.delivery ?? 'stream',
      })
      setOpen(false)
    } finally {
      setPending(false)
    }
  }

  const handleUnbind = async () => {
    setPending(true)
    try {
      await props.onSaveModel({
        agentPresetId: props.preset.id,
        expectedVersion: props.preset.version,
        model: null,
        delivery: props.preset.delivery ?? 'stream',
      })
      setOpen(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={styles.quickPickerRoot}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          {props.variant === 'inline' ? (
            <button
              type="button"
              className={styles.modelInlineButton}
              title={`为「${props.preset.rootNode.label}」更换模型（当前：${currentModelLabel}）`}
              aria-label={`预设模型: ${currentModelLabel}`}
            >
              {brand ? (
                <ModelBrandIcon brand={brand} fallback={<Bot size={16} />} />
              ) : (
                <Bot size={16} />
              )}
              <span>{currentModel?.modelId ?? '选择模型'}</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.modelIconButton}
              title={`绑定模型: ${currentModelLabel}`}
              aria-label={`绑定模型: ${currentModelLabel}`}
            >
              {brand ? (
                <ModelBrandIcon brand={brand} fallback={<Bot size={16} />} />
              ) : (
                <Bot size={16} />
              )}
            </button>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="bottom"
          align="end"
          sideOffset={6}
          className={styles.popoverContent}
          data-loom-component="preset-model-quick-popover"
        >
          <header className={styles.popoverHeader}>
            <h2 className={styles.popoverTitle}>绑定模型</h2>
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
            {/* 1. 分类侧栏 */}
            <aside className={styles.rail} aria-label="模型来源导航">
              <button
                type="button"
                className={styles.railButton}
                data-active={activeAccountId === 'all' || undefined}
                title="全部账号与模型"
                aria-label="全部账号与模型"
                onClick={() => setActiveAccountId('all')}
              >
                <span className={styles.railIcon}><Layers size={14} /></span>
                <span className={styles.railText}>全部</span>
              </button>

              <div className={styles.railDivider} />

              {props.providerAccounts.map(account => {
                const baseUrl = typeof account.config.baseUrl === 'string' ? account.config.baseUrl : ''
                const accountBrand = resolveProviderBrand(
                  account.displayName,
                  baseUrl,
                  account.providerExtensionId,
                )
                const isActive = activeAccountId === account.id

                return (
                  <button
                    key={account.id}
                    type="button"
                    className={styles.railButton}
                    data-active={isActive || undefined}
                    title={account.displayName}
                    aria-label={account.displayName}
                    onClick={() => setActiveAccountId(account.id)}
                  >
                    <span className={styles.railIcon}>
                      {accountBrand ? (
                        <ModelBrandIcon brand={accountBrand} fallback={<Server size={14} />} />
                      ) : (
                        <Server size={14} />
                      )}
                    </span>
                    <span className={styles.railText}>{account.displayName}</span>
                  </button>
                )
              })}
            </aside>

            {/* 2. 主列表 */}
            <section className={styles.master}>
              {currentModel && (
                <div className={styles.currentBar}>
                  <div className={styles.currentInfo}>
                    <span className={styles.currentLabel}>当前:</span>
                    <span className={styles.currentIcon}>
                      {brand ? (
                        <ModelBrandIcon brand={brand} fallback={<Bot size={13} />} />
                      ) : (
                        <Bot size={13} />
                      )}
                    </span>
                    <strong className={styles.currentText}>{currentModelLabel}</strong>
                  </div>
                  <button
                    type="button"
                    className={styles.unbindLink}
                    disabled={pending}
                    onClick={() => void handleUnbind()}
                  >
                    {props.t('agent.model.unbind')}
                  </button>
                </div>
              )}

              <div className={styles.searchHeader}>
                <SearchField
                  autoFocus
                  value={query}
                  disabled={pending}
                  placeholder={props.t('agent.model.search')}
                  aria-label={props.t('agent.model.search')}
                  clearLabel={props.t('agent.clearSearch')}
                  onChange={event => setQuery(event.target.value)}
                  onClear={() => setQuery('')}
                />
              </div>

              <div className={styles.itemList} role="listbox" aria-busy={pending}>
                {props.providerAccounts.length === 0 ? (
                  <p className={styles.empty}>{props.t('agent.model.noAccounts')}</p>
                ) : null}

                {displayedSections.map(section => {
                  const showGroupHeader = activeAccountId === 'all' || Boolean(query)
                  return (
                    <div key={section.account.id} className={styles.sectionGroup}>
                      {showGroupHeader && (
                        <div className={styles.groupHeader}>
                          <div className={styles.groupHeaderLeft}>
                            {section.brand ? (
                              <span className={styles.groupIcon}>
                                <ModelBrandIcon
                                  brand={section.brand}
                                  fallback={<Server size={13} />}
                                />
                              </span>
                            ) : null}
                            <span className={styles.groupTitle}>{section.account.displayName}</span>
                          </div>
                          <div className={styles.groupHeaderRight}>
                            <Button
                              size="small"
                              variant="ghost"
                              disabled={pending || section.catalog?.loading}
                              onClick={() => void loadModels(section.account.id)}
                            >
                              <RefreshCw size={11} aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className={styles.groupItems}>
                        {section.visible.map(modelId => {
                          const isSelected =
                            currentModel?.providerProfileId === section.account.id &&
                            currentModel.modelId === modelId
                          const isEnabled = section.enabled.has(modelId)

                          return (
                            <button
                              key={modelId}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              data-selected={isSelected || undefined}
                              disabled={pending}
                              className={styles.modelItem}
                              onClick={() => {
                                void handleSelect(section.account.id, modelId, !isEnabled)
                              }}
                            >
                              <ModelBrandIcon
                                brand={resolveModelBrand(modelId)}
                                className={styles.modelIcon}
                                fallback={<Bot className={styles.modelIcon} aria-hidden="true" />}
                              />
                              <span className={styles.modelName}>{modelId}</span>
                              {isSelected ? (
                                <Check size={14} className={styles.selectedCheck} aria-hidden="true" />
                              ) : (
                                <span className={styles.action}>
                                  {props.t(isEnabled ? 'agent.model.select' : 'agent.model.addAndSelect')}
                                </span>
                              )}
                            </button>
                          )
                        })}

                        {!section.visible.length ? (
                          <p className={styles.empty}>
                            {props.t(
                              section.models.length || search
                                ? 'agent.model.noMatches'
                                : 'agent.model.fetchHint',
                            )}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
