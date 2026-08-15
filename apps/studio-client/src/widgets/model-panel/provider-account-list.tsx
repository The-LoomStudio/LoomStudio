import { ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'
import { mergeModelCatalog, mockModelCatalog } from '../../features/provider-settings/model/model-catalog.js'
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
  t: Translator
}) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const copyRequestRef = useRef(0)
  const mountedRef = useRef(true)
  const baseUrl = typeof props.account.config.baseUrl === 'string' ? props.account.config.baseUrl : ''
  const catalog = mergeModelCatalog(props.models.map(profile => profile.providerModelId), import.meta.env.DEV ? mockModelCatalog : [], query)
  const providerBrand = resolveProviderBrand(props.account.displayName, baseUrl, props.account.providerExtensionId)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

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

        <div className={styles.accountField}>
          <span>{props.t('provider.baseUrl')}</span>
          <code>{baseUrl || '—'}</code>
          <IconButton disabled={!baseUrl} label={copied ? props.t('provider.baseUrlCopied') : props.t('provider.copyBaseUrl')} onClick={() => void copyBaseUrl()}>
            <Copy aria-hidden="true" />
          </IconButton>
        </div>

        <section className={styles.keys}>
          <h4>{props.t('provider.keys')}</h4>
          {Object.keys(props.account.secretRefs).length === 0
            ? <p>{props.t('provider.keyMissing')}</p>
            : Object.entries(props.account.secretRefs).map(([name, value]) => (
                <div key={name} className={styles.keyRow}>
                  <span>{name}</span>
                  <code>{value.startsWith('env:') ? value : '••••••••'}</code>
                  <small>{props.t('provider.keyConfigured')}</small>
                </div>
              ))}
        </section>

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
              />
              <button aria-label={props.t('provider.modelAdd')} disabled={!query.trim() || props.busy} title={props.t('provider.modelAdd')} type="submit">
                <Plus aria-hidden="true" />
              </button>
            </form>
            <div className={styles.modelMenu}>
              {catalog.filter(item => !item.enabled).map(item => (
                <div key={item.id} className={styles.availableModel}>
                  <Toggle checked={false} disabled={props.busy} label={item.id} onChange={() => enableModel(item.id)} />
                  <ModelBrandIcon brand={resolveModelBrand(item.id) ?? providerBrand} />
                  <span>{item.id}</span>
                </div>
              ))}
              {import.meta.env.DEV ? <p className={styles.mockNotice}>{props.t('provider.modelMock')}</p> : null}
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
