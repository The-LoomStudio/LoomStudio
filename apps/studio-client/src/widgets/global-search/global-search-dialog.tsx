import { InfoDialog } from '../../shared/ui/info-dialog/info-dialog.js'
import { SearchHighlight as Highlight } from '../../shared/ui/search-highlight.js'
import { globalSearchResourceValue, globalSearchScopeValue } from '../../features/global-search/model/global-search-model.js'
import { useEffect, useRef, useState } from 'react'
import { CommandMenu, Dialog } from '@loom-studio/ui'
import { ArrowLeft, ArrowUpDown, BookOpen, Check, CornerDownLeft, Filter, FolderSearch, Layers, LoaderCircle, MessageSquare, Search, Sparkles, UserRound, X } from 'lucide-react'
import type { GlobalSearchHit, GlobalSearchKind } from '@loom-studio/shared'
import type { useGlobalSearch } from '../../features/global-search/model/use-global-search.js'
import type { StudioPanelId } from '../../shared/studio-shell/studio-layout-store.js'
import type { Translator } from '../../shared/i18n/index.js'
import { useEffectiveMotion } from '../../shared/hooks/use-motion-preference.js'
import styles from './global-search-dialog.module.scss'

type GlobalSearchDialogProps = {
  open: boolean
  search: ReturnType<typeof useGlobalSearch>
  recent: GlobalSearchHit[]
  t: Translator
  onClose(): void
  onOpenPanel(panel: StudioPanelId): void
  onOpenResult(hit: GlobalSearchHit): void
}

const kindIcons = { card: UserRound, lore: BookOpen, preset: Sparkles, timeline: Layers, session: MessageSquare }
const scopeIcons = { card: UserRound, resource: BookOpen, extension: Layers }

export function GlobalSearchDialog({ open, search, recent, t, onClose, onOpenPanel, onOpenResult }: GlobalSearchDialogProps) {
  const motion = useEffectiveMotion()
  const [presented, setPresented] = useState(open)
  const [selected, setSelected] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const emptyQuery = !search.query.trim() && !search.scope && !search.kind
  const items = emptyQuery ? recent : search.results
  const candidateMode = search.mode !== 'results'
  const selectionKey = JSON.stringify([search.mode, search.inputValue, search.scope?.kind, search.scope?.id, search.kind])

  useEffect(() => {
    if (open) { setPresented(true); return }
    if (motion === 'reduce') { setPresented(false); return }
    const timer = window.setTimeout(() => setPresented(false), 140)
    return () => window.clearTimeout(timer)
  }, [open, motion])
  useEffect(() => { setSelected('') }, [selectionKey])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, search.mode])

  const placeholder = search.mode === 'scopes' ? t('search.scopePlaceholder')
    : search.mode === 'types' ? t('search.typePlaceholder') : t('search.placeholder')
  const hasItems = search.mode === 'scopes' ? search.scopes.length > 0
    : search.mode === 'types' ? search.types.length > 0 : search.navigation.length + items.length > 0

  return (
    <Dialog open={open || presented} onClose={onClose} title={t('search.title')} closeOnBackdrop
      className={`${styles.dialog} ${!open ? styles.closing : ''}`}
      headerActions={search.diagnostics?.length ? <InfoDialog title={t('promptResource.invalidResources')}>
        {search.diagnostics.map(item => <section key={item.resourceId}><h3>{item.resourceId}</h3><p>{item.message}</p></section>)}
      </InfoDialog> : undefined}>
      <CommandMenu shouldFilter={false} loop vimBindings={false} value={selected} onValueChange={setSelected} label={t('search.title')}
        className={styles.command} onKeyDownCapture={event => {
          if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) {
            event.preventDefault()
            event.stopPropagation()
          } else if (event.key === 'Enter' && event.target instanceof Element) {
            const button = event.target.closest('button')
            if (button && !button.hasAttribute('cmdk-item')) event.stopPropagation()
          }
          if (event.key === 'Escape' && candidateMode) {
            event.preventDefault()
            event.stopPropagation()
            search.showResults()
          }
        }}>
        <div className={styles.inputRow}>
          {candidateMode ? <button className={styles.iconButton} type="button" aria-label={t('search.back')} onClick={search.showResults}><ArrowLeft size={19} /></button>
            : <Search size={21} aria-hidden="true" className={styles.searchIcon} />}
          <CommandMenu.Input ref={inputRef} autoFocus value={search.inputValue} onValueChange={search.setInputValue}
            placeholder={placeholder} aria-label={placeholder} maxLength={256} className={styles.input} />
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('search.closeHint')}><X size={17} /></button>
        </div>
        <div className={styles.filters}>
          {search.scope ? <button className={styles.token} type="button" onClick={search.removeScope} aria-label={`${t('search.removeScope')}: ${search.scope.label}`}>
            <FolderSearch size={13} /><span>{search.scope.label}</span><X size={12} />
          </button> : <button type="button" className={styles.filterButton} onClick={search.showScopes} aria-pressed={search.mode === 'scopes'}><FolderSearch size={13} />{t('search.scopes')}<kbd>in:</kbd></button>}
          {search.kind ? <button className={styles.token} type="button" onClick={search.removeKind} aria-label={t('search.removeType')}>
            <Filter size={13} /><span>{kindLabel(search.kind, t)}</span><X size={12} />
          </button> : <button type="button" className={styles.filterButton} onClick={search.showTypes} aria-pressed={search.mode === 'types'}><Filter size={13} />{t('search.types')}<kbd>type:</kbd></button>}
          {search.loading ? <LoaderCircle size={14} className={styles.spinner} aria-label={t('search.loading')} /> : null}
        </div>
        <CommandMenu.List className={styles.list} label={t('search.resources')} aria-busy={search.loading || search.loadingMore}>
          {search.mode === 'results' && search.navigation.length > 0 ? <CommandMenu.Group heading={t('search.navigation')}>
            {search.navigation.map(item => <CommandMenu.Item className={styles.item} key={item.id} value={item.id} onSelect={() => onOpenPanel(item.panel)}>
              <item.Icon size={17} className={styles.resultIcon} /><span className={styles.title}><Highlight text={item.title} query={search.query} /></span><CornerDownLeft size={13} className={styles.enter} />
            </CommandMenu.Item>)}
          </CommandMenu.Group> : null}
          {search.mode === 'results' && items.length > 0 ? <CommandMenu.Group heading={t(emptyQuery ? 'search.recent' : 'search.resources')}>
            {items.map(item => {
              const Icon = kindIcons[item.kind]
              return <CommandMenu.Item className={styles.item} key={item.id} value={globalSearchResourceValue(item)} onSelect={() => onOpenResult(item)}>
                <Icon size={17} className={styles.resultIcon} />
                <span className={styles.resultBody}>
                  <span className={styles.resultHeading}><span className={styles.title}><Highlight text={item.title} query={search.query} /></span><span className={styles.kind}>{kindLabel(item.kind, t)}</span></span>
                  {item.path.length > 0 && !(item.path.length === 1 && item.path[0] === item.title) ? <span className={styles.path}>{item.path.join(' / ')}</span> : null}
                  {item.snippet && item.snippet !== item.title ? <span className={styles.snippet}><Highlight text={item.snippet} query={search.query} /></span> : null}
                  {item.source ? <span className={styles.source}>{sourceLabel(item.source, t)}</span> : null}
                </span><CornerDownLeft size={13} className={styles.enter} />
              </CommandMenu.Item>
            })}
          </CommandMenu.Group> : null}
          {search.mode === 'scopes' ? <CommandMenu.Group heading={t('search.scopes')}>
            {search.scopes.map(item => {
              const Icon = scopeIcons[item.kind]
              return <CommandMenu.Item className={styles.item} key={`${item.kind}:${item.id}`} value={globalSearchScopeValue(item)} onSelect={() => search.selectScope(item)}>
                <Icon size={17} className={styles.resultIcon} /><span className={styles.resultBody}><span className={styles.resultHeading}><span className={styles.title}>{item.label}</span><span className={styles.kind}>{t(`search.scope.${item.kind}`)}</span></span>{item.description || item.sources?.length ? <span className={styles.path}>{item.sources?.map(source => sourceLabel(source, t)).join(' / ') ?? item.description}</span> : null}</span>
              </CommandMenu.Item>
            })}
          </CommandMenu.Group> : null}
          {search.mode === 'types' ? <CommandMenu.Group heading={t('search.types')}>
            {search.types.map(item => {
              const Icon = kindIcons[item.kind]
              return <CommandMenu.Item className={styles.item} key={item.kind} value={`kind:${item.kind}`} onSelect={() => search.selectKind(item.kind)}><Icon size={17} className={styles.resultIcon} /><span className={styles.title}>{item.label}</span>{search.kind === item.kind ? <Check size={15} /> : null}</CommandMenu.Item>
            })}
          </CommandMenu.Group> : null}
          {search.diagnostics?.length ? <div className={styles.status} role="status">{t('promptResource.invalidResources')}</div> : null}
          {search.error ? <div role="alert" className={styles.status}><span>{t('search.error')}</span><span className={styles.errorDetail}>{search.error.message}</span><button type="button" onClick={search.retry}>{t('search.retry')}</button>{search.scope || search.kind ? <button type="button" onClick={search.clearFilters}>{t('search.clearFilters')}</button> : null}</div> : null}
          {!hasItems && !search.error ? <div className={styles.status} role="status">{search.loading ? t('search.loading') : search.mode === 'results' && emptyQuery ? t('search.enterQuery') : t('search.empty')}{!search.loading && (search.scope || search.kind) ? <button type="button" onClick={search.clearFilters}>{t('search.clearFilters')}</button> : null}</div> : null}
          {search.hasMore && !(emptyQuery && search.mode === 'results') ? <CommandMenu.Item className={`${styles.item} ${styles.more}`} value="search:more" disabled={search.loadingMore} onSelect={search.loadMore}>{search.loadingMore ? t('search.loading') : t('search.more')}</CommandMenu.Item> : null}
        </CommandMenu.List>
        <footer className={styles.footer}><span><ArrowUpDown size={12} />{t('search.moveHint')}</span><span><CornerDownLeft size={12} />{t('search.openHint')}</span><span className={styles.escape}><kbd>esc</kbd>{t('search.closeHint')}</span></footer>
      </CommandMenu>
    </Dialog>
  )
}

function kindLabel(kind: GlobalSearchKind, t: Translator) { return t(`search.kind.${kind}`) }

function sourceLabel(source: NonNullable<GlobalSearchHit['source']>, t: Translator): string {
  const location = source.cardId ? t('search.cardSource', { name: source.cardName ?? source.cardId }) : t('search.globalSource')
  return `${source.packageId} · ${location}`
}
