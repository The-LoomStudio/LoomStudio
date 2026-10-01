import { Bot, ChevronRight, Copy, Plus, Server, Trash2, Wrench } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'
import { mergeModelCatalog } from '../../features/provider-settings/model/model-catalog.js'
import { resolveModelBrand, resolveProviderBrand, type ModelBrand } from '../../features/provider-settings/model/model-brand.js'
import type { Translator } from '../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import { IconButton, Toggle } from '@loom-studio/ui'
import styles from './model-panel.module.scss'
import { ModelBrandIcon } from './model-brand-icon.js'

type ProviderAccountListProps = {
  onUpdateTokenMultiplier?(modelProfileId: string, multiplier: number): Promise<void>
  accounts: ProviderAccount[]
  busy: boolean
  modelProfiles: ModelProfile[]
  onCreateModel(providerAccountId: string, providerModelId: string): Promise<void>
  onDelete(id: string): Promise<void>
  onDeleteModel(id: string): Promise<void>
  onListModels(providerAccountId: string): Promise<string[]>
  onUpdateConnection(providerAccountId: string, connection: { displayName: string; baseUrl: string; apiKey?: string }): Promise<boolean>
  t: Translator
}

export function ProviderAccountList(props: ProviderAccountListProps) {
  return (
    <div className={styles.accountList}>
      {props.accounts.length === 0
        ? <p className={styles.empty}>{props.t('provider.noProviderAccounts')}</p>
        : props.accounts.map(account => (
            <ProviderAccountItem
              key={account.id}
              account={account}
              busy={props.busy}
              models={props.modelProfiles.filter(profile => profile.providerAccountId === account.id)}
              onCreateModel={props.onCreateModel}
              onDelete={props.onDelete}
              onDeleteModel={props.onDeleteModel}
              onListModels={props.onListModels}
              onUpdateConnection={props.onUpdateConnection}
              onUpdateTokenMultiplier={props.onUpdateTokenMultiplier}
              t={props.t}
            />
          ))}
    </div>
  )
}

function ProviderAccountItem(props: {
  onUpdateTokenMultiplier?(modelProfileId: string, multiplier: number): Promise<void>
  account: ProviderAccount
  busy: boolean
  models: ModelProfile[]
  onCreateModel(providerAccountId: string, providerModelId: string): Promise<void>
  onDelete(id: string): Promise<void>
  onDeleteModel(id: string): Promise<void>
  onListModels(providerAccountId: string): Promise<string[]>
  onUpdateConnection(providerAccountId: string, connection: { displayName: string; baseUrl: string; apiKey?: string }): Promise<boolean>
  t: Translator
}) {
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingModelIds, setPendingModelIds] = useState<Set<string>>(() => new Set())
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [modelCatalogState, setModelCatalogState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [displayNameDraft, setDisplayNameDraft] = useState(props.account.displayName)
  const [baseUrlDraft, setBaseUrlDraft] = useState(() => typeof props.account.config.baseUrl === 'string' ? props.account.config.baseUrl : '')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const copyRequestRef = useRef(0)
  const pickerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const baseUrl = typeof props.account.config.baseUrl === 'string' ? props.account.config.baseUrl : ''
  const catalog = mergeModelCatalog(props.models.map(profile => profile.providerModelId), fetchedModels, query)
  const providerBrand = resolveProviderBrand(props.account.displayName, baseUrl, props.account.providerExtensionId)
  const fake = props.account.providerExtensionId === 'official.fake' || props.account.providerExtensionId === 'fake'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    setBaseUrlDraft(baseUrl)
  }, [baseUrl])

  useEffect(() => {
    setDisplayNameDraft(props.account.displayName)
  }, [props.account.displayName])

  async function addModel(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    if (await enableModel(query.trim())) {
      setQuery(current => current === query ? '' : current)
    }
  }

  async function enableModel(modelId: string) {
    const model = modelId.trim()
    if (!model || props.models.some(profile => profile.providerModelId === model) || pendingModelIds.has(model)) return false
    setPendingModelIds(prev => new Set(prev).add(model))
    setActionError(undefined)
    try {
      await props.onCreateModel(props.account.id, model)
      return true
    } catch (error) {
      if (mountedRef.current) setActionError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      if (mountedRef.current) {
        setPendingModelIds(prev => {
          const next = new Set(prev)
          next.delete(model)
          return next
        })
      }
    }
  }

  async function loadModelCatalog() {
    if (modelCatalogState === 'loading' || modelCatalogState === 'loaded') return
    setModelCatalogState('loading')
    try {
      const modelIds = await props.onListModels(props.account.id)
      if (!mountedRef.current) return
      setFetchedModels(modelIds)
      setModelCatalogState('loaded')
    } catch {
      if (mountedRef.current) setModelCatalogState('error')
    }
  }

  async function saveConnection(event: FormEvent) {
    event.preventDefault()
    const apiKey = apiKeyDraft.trim()
    setActionError(undefined)
    try {
      const succeeded = await props.onUpdateConnection(props.account.id, {
        displayName: displayNameDraft,
        baseUrl: baseUrlDraft,
        ...(apiKey ? { apiKey } : {}),
      })
      if (!succeeded || !mountedRef.current) return
      setApiKeyDraft('')
      setFetchedModels([])
      setModelCatalogState('idle')
    } catch (error) {
      if (mountedRef.current) setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function copyBaseUrl() {
    if (!baseUrl) return
    const requestId = ++copyRequestRef.current
    if (!await tryWriteClipboardText(baseUrl) || !mountedRef.current || requestId !== copyRequestRef.current) return
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = undefined
      setCopied(false)
    }, 1200)
  }

  const uniqueModelBrands = Array.from(
    new Set(
      props.models
        .map(profile => resolveModelBrand(profile.providerModelId))
        .filter((brand): brand is ModelBrand => brand !== null),
    ),
  )
  const hasGenericModel = props.models.some(profile => resolveModelBrand(profile.providerModelId) === null)

  return (
    <details className={styles.accountCard}>
      <summary className={styles.accountSummary}>
        <ChevronRight aria-hidden="true" />
        {fake ? (
          <Wrench aria-hidden="true" className={styles.brandIconFallback} />
        ) : (
          <ModelBrandIcon brand={providerBrand} fallback={<Server aria-hidden="true" className={styles.brandIconFallback} />} />
        )}
        <span className={styles.accountDisplayName}>{props.account.displayName}</span>
        <div className={styles.accountModelStack}>
          {uniqueModelBrands.map((brand, index) => (
            <span
              key={brand}
              className={styles.accountModelAvatar}
              style={{ zIndex: index + 1 }}
            >
              <ModelBrandIcon brand={brand} className={styles.accountModelAvatarImg} />
            </span>
          ))}
          {hasGenericModel ? (
            <span
              className={styles.accountModelAvatar}
              style={{ zIndex: uniqueModelBrands.length + 1 }}
            >
              <Bot aria-hidden="true" className={styles.accountModelAvatarFallback} />
            </span>
          ) : null}
          {props.models.length > 0 ? (
            <span className={styles.accountModelCount}>{props.models.length}</span>
          ) : null}
        </div>
        <div className={styles.accountSummaryActions}>
          <button
            aria-label={props.t('provider.deleteAccount')}
            className={styles.accountSummaryDeleteButton}
            disabled={props.busy}
            title={props.t('provider.deleteAccount')}
            type="button"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              void props.onDelete(props.account.id).catch(() => undefined)
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </summary>
      <div className={styles.accountBody}>
        <span className={styles.extensionId}>{props.account.providerExtensionId}</span>
        {actionError ? <p role="alert">{actionError}</p> : null}

        {fake ? (
          <p className={styles.modelCatalogStatus}>{props.t('provider.fakeAccountHint')}</p>
        ) : (
          <form autoComplete="off" className={`${styles.connectionForm} loom-underlined-fields`} onSubmit={saveConnection}>
          <label>
            <span>{props.t('provider.name')}</span>
            <input
              autoComplete="off"
              name={`loom-provider-name-${props.account.id}`}
              required
              value={displayNameDraft}
              onChange={event => setDisplayNameDraft(event.target.value)}
            />
          </label>
          <label>
            <span>{props.t('provider.baseUrl')}</span>
            <div className={styles.connectionInputRow}>
              <input
                autoComplete="off"
                name={`loom-provider-base-url-${props.account.id}`}
                required
                value={baseUrlDraft}
                onChange={event => setBaseUrlDraft(event.target.value)}
              />
              <IconButton size="small" disabled={!baseUrl} aria-label={copied ? props.t('provider.baseUrlCopied') : props.t('provider.copyBaseUrl')} onClick={() => void copyBaseUrl()}>
                <Copy aria-hidden="true" />
              </IconButton>
            </div>
          </label>
          <label>
            <span>{props.t('provider.apiKey')}</span>
            <input
              autoComplete="new-password"
              name={`loom-provider-api-key-${props.account.id}`}
              placeholder={props.account.credential.configured ? '••••••••' : props.t('provider.apiKeyPlaceholder')}
              type="password"
              value={apiKeyDraft}
              onChange={event => setApiKeyDraft(event.target.value)}
            />
            <small className={props.account.credential.configured ? styles.credentialConfigured : styles.credentialMissing}>
              {props.account.credential.configured
                ? props.t('provider.apiKeyConfiguredHint')
                : props.t('provider.keyMissing')}
            </small>
          </label>
          <button disabled={props.busy || !displayNameDraft.trim() || !baseUrlDraft.trim()} type="submit">{props.t('provider.saveConnection')}</button>
          </form>
        )}

        <section className={styles.models}>
          <h4>{props.t('provider.models')}</h4>
          <div className={styles.enabledModels}>
            {props.models.map(profile => (
              <div key={profile.id} className={styles.modelRow}>
                <Toggle checked className={styles.enabledToggle} disabled label={`${profile.providerModelId} · ${props.t('provider.modelEnabled')}`} onChange={() => {}} />
                <ModelBrandIcon brand={resolveModelBrand(profile.providerModelId)} fallback={<Bot aria-hidden="true" className={styles.brandIconFallback} />} />
                <span>{profile.providerModelId}</span>
                {props.onUpdateTokenMultiplier ? <label title="o200k_base 基础计数的估算系数">
                  Token × <input key={`${profile.id}:${profile.version}`} aria-label={`${profile.providerModelId} Token 估算系数`}
                    type="number" min="0.01" step="0.05" defaultValue={profile.tokenMultiplier ?? 1}
                    style={{ width: 64 }} disabled={props.busy} onBlur={event => {
                      const value = event.currentTarget.valueAsNumber
                      if (!Number.isFinite(value) || value <= 0) {
                        setActionError('Token 系数必须为正数')
                        return
                      }
                      if (value !== (profile.tokenMultiplier ?? 1)) void props.onUpdateTokenMultiplier!(profile.id, value)
                        .catch(error => setActionError(String(error)))
                    }} />
                </label> : null}
                {!fake ? (
                  <IconButton size="small" variant="danger" disabled={props.busy} aria-label={props.t('provider.modelDelete')} onClick={() => void props.onDeleteModel(profile.id).catch(() => undefined)}>
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                ) : null}
              </div>
            ))}
          </div>

          {!fake ? (
            <div ref={pickerRef} className={`${styles.modelPicker} loom-underlined-fields`}>
              <form onSubmit={addModel}>
                <input
                  aria-label={props.t('provider.modelSearchPlaceholder')}
                  placeholder={props.t('provider.modelSearchPlaceholder')}
                  value={query}
                  onChange={event => {
                    setQuery(event.target.value)
                    if (!menuOpen) setMenuOpen(true)
                  }}
                  onFocus={() => {
                    setMenuOpen(true)
                    void loadModelCatalog()
                  }}
                />
                <button aria-label={props.t('provider.modelAdd')} disabled={!query.trim() || props.busy} title={props.t('provider.modelAdd')} type="submit">
                  <Plus aria-hidden="true" />
                </button>
              </form>
              {menuOpen ? (
                <div className={styles.modelMenu}>
                  {modelCatalogState === 'loading' ? <p className={styles.modelCatalogStatus}>{props.t('provider.modelsLoading')}</p> : null}
                  {modelCatalogState === 'error' ? <p className={styles.modelCatalogStatus}>{props.t('provider.modelsLoadFailed')}</p> : null}
                  {modelCatalogState === 'loaded' && catalog.every(item => item.enabled)
                    ? <p className={styles.modelCatalogStatus}>{props.t('provider.modelsNoMatches')}</p>
                    : null}
                  {catalog.filter(item => !item.enabled).map(item => {
                    const isPending = pendingModelIds.has(item.id)
                    return (
                      <div
                        key={item.id}
                        className={styles.availableModel}
                        role="button"
                        tabIndex={0}
                        onClick={() => void enableModel(item.id)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            void enableModel(item.id)
                          }
                        }}
                      >
                        <Toggle
                          checked={isPending}
                          disabled={isPending}
                          label={item.id}
                          onChange={() => void enableModel(item.id)}
                        />
                        <ModelBrandIcon brand={resolveModelBrand(item.id)} fallback={<Bot aria-hidden="true" className={styles.brandIconFallback} />} />
                        <span>{item.id}</span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </details>
  )
}
