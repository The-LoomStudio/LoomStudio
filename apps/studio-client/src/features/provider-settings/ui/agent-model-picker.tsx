import { useRef, useState } from 'react'
import { Bot, Check, RefreshCw, Server } from 'lucide-react'
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
}) {
  const [query, setQuery] = useState('')
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({})
  const requests = useRef(new Set<string>())
  const search = normalizeSearchText(query)
  const manualId = query.trim()
  const currentAccount = props.providerAccounts.find(account => account.id === props.current?.providerProfileId)

  async function load(accountId: string) {
    if (requests.current.has(accountId)) return
    requests.current.add(accountId)
    setCatalogs(previous => ({ ...previous, [accountId]: { ...previous[accountId], loading: true, error: undefined } }))
    try {
      const models = await props.onListModels(accountId)
      setCatalogs(previous => ({ ...previous, [accountId]: { models } }))
    } catch (error) {
      setCatalogs(previous => ({ ...previous, [accountId]: { ...previous[accountId], loading: false,
        error: error instanceof Error ? error.message : String(error) } }))
    } finally {
      requests.current.delete(accountId)
    }
  }

  return <Dialog open={props.open} onClose={props.onClose} dismissible={!props.pending}
    className={styles.dialog} title={props.t('agent.profile.selectModel')} closeLabel={props.t('agent.close')}>
    <div className={styles.picker}>
      <SearchField autoFocus value={query} disabled={props.pending} placeholder={props.t('agent.model.search')}
        aria-label={props.t('agent.model.search')} clearLabel={props.t('agent.clearSearch')}
        onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />
      <div className={styles.current}>
        <span>{props.t('agent.model.current')}</span>
        {props.current ? <ModelBrandIcon brand={resolveModelBrand(props.current.modelId)} className={styles.modelIcon}
          fallback={<Bot className={styles.modelIcon} aria-hidden="true" />} /> : null}
        <strong>{props.current ? `${currentAccount?.displayName ?? props.current.providerProfileId} / ${props.current.modelId}` : props.t('agent.model.unbound')}</strong>
        {props.current ? <Button size="small" variant="ghost" disabled={props.pending}
          onClick={() => void props.onSelect(undefined, false)}>{props.t('agent.model.unbind')}</Button> : null}
      </div>
      {props.error ? <p className={styles.error} role="alert">{props.error}</p> : null}
      <div className={styles.accounts} aria-busy={props.pending}>
        {props.providerAccounts.length === 0 ? <p className={styles.empty}>{props.t('agent.model.noAccounts')}</p> : null}
        {props.providerAccounts.map(account => {
          const catalog = catalogs[account.id]
          const enabled = new Set(props.modelProfiles.filter(model => model.providerAccountId === account.id).map(model => model.providerModelId))
          const models = [...new Set([...enabled, ...(catalog?.models ?? [])])]
          const accountMatches = normalizeSearchText(account.displayName).includes(search)
          const visible = models.filter(model => accountMatches || normalizeSearchText(model).includes(search))
          const baseUrl = typeof account.config.baseUrl === 'string' ? account.config.baseUrl : ''
          const brand = resolveProviderBrand(account.displayName, baseUrl, account.providerExtensionId)
          return <section key={account.id} className={styles.account} aria-label={account.displayName}>
            <header className={styles.accountHeader}>
              <span className={styles.brand}><ModelBrandIcon brand={brand} fallback={<Server aria-hidden="true" />} /></span>
              <h3>{account.displayName}</h3>
              <Button size="small" variant="ghost" disabled={props.pending || catalog?.loading}
                onClick={() => void load(account.id)}>
                <RefreshCw size={14} aria-hidden="true" />
                {props.t(catalog?.loading ? 'provider.modelsLoading' : catalog?.models ? 'agent.model.refresh' : 'agent.model.fetch')}
              </Button>
            </header>
            {catalog?.error ? <p role="alert" className={styles.error}>{catalog.error}</p> : null}
            {visible.map(modelId => {
              const selected = props.current?.providerProfileId === account.id && props.current.modelId === modelId
              return <button key={modelId} type="button" className={styles.model} data-selected={selected || undefined}
                aria-pressed={selected} disabled={props.pending} onClick={() => void props.onSelect({ providerProfileId: account.id, modelId }, !enabled.has(modelId))}>
                <ModelBrandIcon brand={resolveModelBrand(modelId)} className={styles.modelIcon}
                  fallback={<Bot className={styles.modelIcon} aria-hidden="true" />} />
                <span className={styles.modelName}>{modelId}</span>
                {selected ? <Check size={16} aria-hidden="true" /> : <span className={styles.action}>{props.t(enabled.has(modelId) ? 'agent.model.select' : 'agent.model.addAndSelect')}</span>}
              </button>
            })}
            {!visible.length ? <p className={styles.empty}>{props.t(models.length || search ? 'agent.model.noMatches' : 'agent.model.fetchHint')}</p> : null}
            {manualId && !models.includes(manualId) ? <Button variant="ghost" className={styles.manual} disabled={props.pending}
              onClick={() => void props.onSelect({ providerProfileId: account.id, modelId: manualId }, true)}>
              {props.t('agent.model.manual', { id: manualId })}
            </Button> : null}
          </section>
        })}
      </div>
    </div>
  </Dialog>
}
