import { ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'
import { mergeModelCatalog } from '../../features/provider-settings/model/model-catalog.js'
import { resolveModelBrand, resolveProviderBrand } from '../../features/provider-settings/model/model-brand.js'
import type { Translator } from '../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import { Toggle } from '../../shared/ui/toggle/toggle.js'
import styles from './model-panel.module.scss'
import { ModelBrandIcon } from './model-brand-icon.js'

type ProviderAccountListProps = {
  accounts: ProviderAccount[]
  busy: boolean
  modelProfiles: ModelProfile[]
  onCreateModel(providerAccountId: string, providerModelId: string): void
  onDelete(id: string): void
  onDeleteModel(id: string): void
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
              t={props.t}
            />
          ))}
    </div>
  )
}

function ProviderAccountItem(props: {
  account: ProviderAccount
  busy: boolean
  models: ModelProfile[]
  onCreateModel(providerAccountId: string, providerModelId: string): void
  onDelete(id: string): void
  onDeleteModel(id: string): void
  onListModels(providerAccountId: string): Promise<string[]>
  onUpdateConnection(providerAccountId: string, connection: { displayName: string; baseUrl: string; apiKey?: string }): Promise<boolean>
  t: Translator
}) {
  const [query, setQuery] = useState('')
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [modelCatalogState, setModelCatalogState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [displayNameDraft, setDisplayNameDraft] = useState(props.account.displayName)
  const [baseUrlDraft, setBaseUrlDraft] = useState(() => typeof props.account.config.baseUrl === 'string' ? props.account.config.baseUrl : '')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const copyRequestRef = useRef(0)
  const mountedRef = useRef(true)
  const baseUrl = typeof props.account.config.baseUrl === 'string' ? props.account.config.baseUrl : ''
  const catalog = mergeModelCatalog(props.models.map(profile => profile.providerModelId), fetchedModels, query)
  const providerBrand = resolveProviderBrand(props.account.displayName, baseUrl, props.account.providerExtensionId)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setBaseUrlDraft(baseUrl)
  }, [baseUrl])

  useEffect(() => {
    setDisplayNameDraft(props.account.displayName)
  }, [props.account.displayName])


  function addModel(event: FormEvent) {
    event.preventDefault()
    enableModel(query)
  }

  function enableModel(modelId: string) {
    const model = modelId.trim()
    if (!model || props.models.some(profile => profile.providerModelId === model)) return
    props.onCreateModel(props.account.id, model)
    setQuery('')
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
    const succeeded = await props.onUpdateConnection(props.account.id, {
      displayName: displayNameDraft,
      baseUrl: baseUrlDraft,
      ...(apiKey ? { apiKey } : {}),
    })
    if (!succeeded || !mountedRef.current) return
    setApiKeyDraft('')
    setFetchedModels([])
    setModelCatalogState('idle')
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

  return (
    <details className={styles.accountCard}>
      <summary>
        <ChevronRight aria-hidden="true" />
        <ModelBrandIcon brand={providerBrand} />
        <span>{props.account.displayName}</span>
        <small>{props.models.length}</small>
      </summary>
      <div className={styles.accountBody}>
        <span className={styles.extensionId}>{props.account.providerExtensionId}</span>

        <form className={`${styles.connectionForm} loom-underlined-fields`} onSubmit={saveConnection}>
          <label>
            <span>{props.t('provider.name')}</span>
            <input required value={displayNameDraft} onChange={event => setDisplayNameDraft(event.target.value)} />
          </label>
          <label>
            <span>{props.t('provider.baseUrl')}</span>
            <div className={styles.connectionInputRow}>
              <input required value={baseUrlDraft} onChange={event => setBaseUrlDraft(event.target.value)} />
              <IconButton disabled={!baseUrl} label={copied ? props.t('provider.baseUrlCopied') : props.t('provider.copyBaseUrl')} onClick={() => void copyBaseUrl()}>
                <Copy aria-hidden="true" />
              </IconButton>
            </div>
          </label>
          <label>
            <span>{props.t('provider.apiKey')}</span>
            <input
              autoComplete="off"
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

        <section className={styles.models}>
          <h4>{props.t('provider.models')}</h4>
          <div className={styles.enabledModels}>
            {props.models.map(profile => (
              <div key={profile.id} className={styles.modelRow}>
                <Toggle checked className={styles.enabledToggle} disabled label={`${profile.providerModelId} · ${props.t('provider.modelEnabled')}`} onChange={() => {}} />
                <ModelBrandIcon brand={resolveModelBrand(profile.providerModelId) ?? providerBrand} />
                <span>{profile.providerModelId}</span>
                <IconButton danger disabled={props.busy} label={props.t('provider.modelDelete')} onClick={() => props.onDeleteModel(profile.id)}>
                  <Trash2 aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </div>

          <div className={`${styles.modelPicker} loom-underlined-fields`}>
            <form onSubmit={addModel}>
              <input
                aria-label={props.t('provider.modelSearchPlaceholder')}
                placeholder={props.t('provider.modelSearchPlaceholder')}
                value={query}
                onChange={event => setQuery(event.target.value)}
                onFocus={() => void loadModelCatalog()}
              />
              <button aria-label={props.t('provider.modelAdd')} disabled={!query.trim() || props.busy} title={props.t('provider.modelAdd')} type="submit">
                <Plus aria-hidden="true" />
              </button>
            </form>
            <div className={styles.modelMenu}>
              {modelCatalogState === 'loading' ? <p className={styles.modelCatalogStatus}>{props.t('provider.modelsLoading')}</p> : null}
              {modelCatalogState === 'error' ? <p className={styles.modelCatalogStatus}>{props.t('provider.modelsLoadFailed')}</p> : null}
              {modelCatalogState === 'loaded' && catalog.every(item => item.enabled)
                ? <p className={styles.modelCatalogStatus}>{props.t('provider.modelsNoMatches')}</p>
                : null}
              {catalog.filter(item => !item.enabled).map(item => (
                <div key={item.id} className={styles.availableModel}>
                  <Toggle checked={false} disabled={props.busy} label={item.id} onChange={() => enableModel(item.id)} />
                  <ModelBrandIcon brand={resolveModelBrand(item.id) ?? providerBrand} />
                  <span>{item.id}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <button className={styles.deleteProvider} disabled={props.busy} type="button" onClick={() => props.onDelete(props.account.id)}>
          <Trash2 aria-hidden="true" />
          <span>{props.t('provider.deleteAccount')}</span>
        </button>
      </div>
    </details>
  )
}

function IconButton(props: { children: ReactNode; danger?: boolean; disabled?: boolean; label: string; onClick(): void }) {
  return (
    <button
      aria-label={props.label}
      className={props.danger ? styles.iconButtonDanger : styles.iconButton}
      disabled={props.disabled}
      title={props.label}
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
