import { useRef, useState } from 'react'
import { Bot, Check, Layers, Server, X } from 'lucide-react'
import { Button, Dialog, SearchField } from '@loom-studio/ui'
import type { ModelProfile, ProviderAccount, ProviderModelSelection } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { normalizeSearchText } from '../../../shared/lib/text.js'
import { resolveModelBrand, resolveProviderBrand } from '../model/model-brand.js'
import { ModelBrandIcon } from './model-brand-icon.js'
import styles from './agent-model-picker.module.scss'

type Catalog = { models?: string[]; loading?: boolean; error?: string }

export function AgentModelPicker(props: {
  open: boolean
  pending: boolean
  current?: ProviderModelSelection
  modelProfiles: ModelProfile[]
  providerAccounts: ProviderAccount[]
  error?: string
  t: Translator
  onClose(): void
  onSelect(model: ProviderModelSelection | undefined, enable: boolean): Promise<void>
  onListModels(accountId: string): Promise<string[]>
  asPopover?: boolean
}) {
  const [query, setQuery] = useState('')
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({})
  const requests = useRef(new Set<string>())
  const search = normalizeSearchText(query)
  const manualId = query.trim()

  // 当前激活的分类/提供商（'all' 表示全部）
  const [activeAccountId, setActiveAccountId] = useState<string>('all')

  async function load(accountId: string) {
    if (requests.current.has(accountId)) return
    requests.current.add(accountId)
    setCatalogs(previous => ({ ...previous, [accountId]: { ...previous[accountId], loading: true, error: undefined } }))
    try {
      const models = await props.onListModels(accountId)
      setCatalogs(previous => ({ ...previous, [accountId]: { models } }))
    } catch (error) {
      setCatalogs(previous => ({
        ...previous,
        [accountId]: {
          ...previous[accountId],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }))
    } finally {
      requests.current.delete(accountId)
    }
  }

  // 聚合各账号数据（纯计算，保证与非 Hook 单测兼容）
  const accountSections = props.providerAccounts.map(account => {
    const catalog = catalogs[account.id]
    const enabled = new Set(
      props.modelProfiles
        .filter(model => model.providerAccountId === account.id)
        .map(model => model.providerModelId),
    )
    const models = [...new Set([...enabled, ...(catalog?.models ?? [])])]
    const accountMatches = normalizeSearchText(account.displayName).includes(search)
    const visible = models.filter(model => accountMatches || normalizeSearchText(model).includes(search))
    const baseUrl = typeof account.config.baseUrl === 'string' ? account.config.baseUrl : ''
    const brand = resolveProviderBrand(account.displayName, baseUrl, account.providerExtensionId)

    return {
      account,
      brand,
      catalog,
      enabled,
      models,
      visible,
    }
  })

  // 当前可见的模型平铺列表（按分类过滤）
  const displayedSections = activeAccountId === 'all'
    ? accountSections
    : accountSections.filter(s => s.account.id === activeAccountId)

  const handleSelectModel = async (accountId: string, modelId: string, isNew: boolean) => {
    await props.onSelect({ providerProfileId: accountId, modelId }, isNew)
    if (props.asPopover) {
      props.onClose()
    }
  }

  const currentSelectionAccount = props.providerAccounts.find(
    account => account.id === props.current?.providerProfileId,
  )
  const currentAccountBaseUrl = typeof currentSelectionAccount?.config.baseUrl === 'string' ? currentSelectionAccount.config.baseUrl : ''
  const currentAccountBrand = currentSelectionAccount
    ? resolveProviderBrand(currentSelectionAccount.displayName, currentAccountBaseUrl, currentSelectionAccount.providerExtensionId)
    : undefined
  const currentBrand = (props.current?.modelId ? resolveModelBrand(props.current.modelId) : undefined) ?? currentAccountBrand

  const pickerBody = (
    <div
      className={styles.pickerContainer}
      data-loom-component="catalog-model-picker"
    >
      {/* 1. Left Sidebar (带标题和图标的分类侧栏，同底色通透) */}
      <aside className={styles.rail} aria-label="提供商与账号导航">
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
          const brand = resolveProviderBrand(account.displayName, baseUrl, account.providerExtensionId)
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
                {brand ? (
                  <ModelBrandIcon brand={brand} fallback={<Server size={14} />} />
                ) : (
                  <Server size={14} />
                )}
              </span>
              <span className={styles.railText}>{account.displayName}</span>
            </button>
          )
        })}
      </aside>

      {/* 2. Master Column (紧凑主列表：当前模型置顶 + 搜索 + 分组模型条目) */}
      <section className={styles.master}>
        {props.current && (
          <div className={styles.currentBar}>
            <div className={styles.currentInfo}>
              <span className={styles.currentLabel}>当前:</span>
              <span className={styles.currentIcon}>
                {currentBrand ? (
                  <ModelBrandIcon brand={currentBrand} fallback={<Bot size={13} />} />
                ) : (
                  <Bot size={13} />
                )}
              </span>
              <strong className={styles.currentText}>{`${currentSelectionAccount?.displayName ?? props.current.providerProfileId} / ${props.current.modelId}`}</strong>
            </div>
            <button
              type="button"
              className={styles.unbindLink}
              disabled={props.pending}
              onClick={() => {
                void props.onSelect(undefined, false)
                if (props.asPopover) props.onClose()
              }}
            >
              {props.t('agent.model.unbind')}
            </button>
          </div>
        )}

        <div className={styles.searchHeader}>
          <SearchField
            autoFocus
            value={query}
            disabled={props.pending}
            placeholder={props.t('agent.model.search')}
            aria-label={props.t('agent.model.search')}
            clearLabel={props.t('agent.clearSearch')}
            onChange={event => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
        </div>

        {props.error && (
          <p className={styles.error} role="alert">
            {props.error}
          </p>
        )}

        <div className={styles.itemList} role="listbox" aria-busy={props.pending}>
          {props.providerAccounts.length === 0 ? (
            <p className={styles.empty}>{props.t('agent.model.noAccounts')}</p>
          ) : null}

          {displayedSections.map(section => {
            return (
              <div key={section.account.id} className={styles.sectionGroup}>
                <div className={styles.groupHeader}>
                  <div className={styles.groupHeaderLeft}>
                    {section.brand ? (
                      <span className={styles.groupIcon}>
                        <ModelBrandIcon brand={section.brand} fallback={<Server size={13} />} />
                      </span>
                    ) : null}
                    <span className={styles.groupTitle}>{section.account.displayName}</span>
                  </div>
                  <div className={styles.groupHeaderRight}>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={props.pending || section.catalog?.loading}
                      onClick={() => void load(section.account.id)}
                    >
                      {section.catalog?.loading
                        ? '正在获取…'
                        : '获取模型'}
                    </Button>
                  </div>
                </div>

                {section.catalog?.error ? (
                  <p role="alert" className={styles.error}>
                    {section.catalog.error}
                  </p>
                ) : null}

                <div className={styles.groupItems}>
                  {section.visible.map(modelId => {
                    const isSelected =
                      props.current?.providerProfileId === section.account.id &&
                      props.current.modelId === modelId
                    const isEnabled = section.enabled.has(modelId)

                    return (
                      <button
                        key={modelId}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        aria-pressed={isSelected}
                        data-selected={isSelected || undefined}
                        disabled={props.pending}
                        className={styles.modelItem}
                        onClick={() => {
                          void handleSelectModel(section.account.id, modelId, !isEnabled)
                        }}
                      >
                        <ModelBrandIcon
                          brand={resolveModelBrand(modelId)}
                          className={styles.modelIcon}
                          fallback={<Bot className={styles.modelIcon} aria-hidden="true" />}
                        />
                        <span className={styles.modelName}>{modelId}</span>
                        {isSelected ? (
                          <Check size={15} className={styles.selectedCheck} aria-hidden="true" />
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

                  {manualId && !section.models.includes(manualId) ? (
                    <Button
                      variant="ghost"
                      className={styles.manual}
                      disabled={props.pending}
                      onClick={() => {
                        void props.onSelect({ providerProfileId: section.account.id, modelId: manualId }, true)
                        if (props.asPopover) props.onClose()
                      }}
                    >
                      {props.t('agent.model.manual', { id: manualId })}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )

  if (props.asPopover) {
    return (
      <>
        <header className={styles.popoverHeader}>
          <h2 className={styles.popoverTitle}>{props.t('agent.profile.selectModel')}</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={props.onClose}
            aria-label={props.t('agent.close')}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        {pickerBody}
      </>
    )
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      dismissible={!props.pending}
      layout="workbench"
      className={styles.dialog}
      title={props.t('agent.profile.selectModel')}
      closeLabel={props.t('agent.close')}
    >
      {pickerBody}
    </Dialog>
  )
}
