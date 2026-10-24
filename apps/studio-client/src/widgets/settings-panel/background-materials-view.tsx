import type { UserBackgroundLibrary } from '../../features/backgrounds/model/use-user-backgrounds.js'
import { BackgroundImportButton } from '../../features/backgrounds/ui/background-import-button.js'
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Eye, ImageOff, Sparkles, SunMedium, Trash2, X } from 'lucide-react'
import { Button, Dialog, IconButton, RadioGroup, SearchField, Slider } from '@loom-studio/ui'
import type { Translator } from '../../shared/i18n/index.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import styles from './background-materials-view.module.scss'

export type BackgroundOption = {
  group: { id: string; label: string }
  personalId?: string
  scope?: { cardId: string; ownerKey: string }
  id: string
  name: string
  description: string
  source: string
  image: string
}

export type MaterialValue = {
  mode: 'solid' | 'translucent' | 'glass'
  blur: number
  opacity: number
  glassPanels?: boolean
}

type AppearancePage = 'background' | 'material' | 'general'

export function BackgroundMaterialsView(props: {
  previewBackgroundId?: string
  library?: UserBackgroundLibrary
  t: Translator
  backgrounds: readonly BackgroundOption[]
  selectedId: string | null
  followState: boolean
  material: MaterialValue
  general?: ReactNode
  onSelect(id: string | null): void
  onFollowStateChange(value: boolean): void
  onMaterialChange(value: MaterialValue): void
}) {
  const [page, setPage] = useState<AppearancePage>('background')
  const [query, setQuery] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'image' | 'material'>('image')
  useEffect(() => {
    if (props.previewBackgroundId) { setPage('background'); setPreviewId(props.previewBackgroundId); setPreviewMode('image') }
  }, [props.previewBackgroundId])
  const tabId = useId()
  const current = props.backgrounds.find(item => item.id === props.selectedId)
  const preview = props.backgrounds.find(item => item.id === previewId)
  const visible = props.backgrounds.filter(item => `${item.name} ${item.description} ${item.source} ${item.group.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const groups = new Map<string, { id: string; label: string; items: BackgroundOption[] }>()
  for (const item of visible) {
    const group = groups.get(item.group.id)
    if (group) group.items.push(item)
    else groups.set(item.group.id, { ...item.group, items: [item] })
  }
  const pages: { id: AppearancePage; label: string }[] = [
    { id: 'background', label: props.t('appearance.background') },
    { id: 'material', label: props.t('appearance.material') },
    ...(props.general ? [{ id: 'general' as const, label: props.t('appearance.general') }] : []),
  ]
  const modes = { solid: props.t('appearance.solid'), translucent: props.t('appearance.translucent'), glass: props.t('appearance.glass') }

  return (
    <section className={styles.view} data-loom-component="background-materials-view">
      <div className={styles.tabsWrapper}>
        <PanelTabs<AppearancePage>
          activeId={page}
          ariaLabel={props.t('settings.appearance')}
          items={pages}
          onChange={setPage}
        />
      </div>
      <div aria-labelledby={`${tabId}-${page}`} id={`${tabId}-panel`} role="tabpanel">
        {page === 'general' ? props.general : (
          <div>
            <div className={styles.controls}>
              {page === 'background' ? (
                <>
                  <label className={styles.switchRow}>
                    <span>{props.t('appearance.followScene')}</span>
                    <input type="checkbox" role="switch" checked={props.followState} onChange={event => props.onFollowStateChange(event.target.checked)} />
                  </label>
                  {props.library?.error ? <p role="alert">{props.library.error}<Button onClick={props.library.refresh}>{props.t('appError.reload')}</Button></p> : null}
                  {props.library?.loading || props.library?.busy ? <p role="status">{props.t(props.library.loading ? 'appearance.backgroundLoading' : 'appearance.backgroundWorking')}</p> : null}
                  <SearchField containerClassName={styles.search} aria-label={props.t('appearance.search')} placeholder={props.t('appearance.searchPlaceholder')}
                    clearLabel={props.t('agent.clearSearch')} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />
                  <div className={styles.resourceHeader}>
                    <span>{props.t('appearance.count', { count: visible.length })}</span>
                    {props.library ? <BackgroundImportButton t={props.t} disabled={!props.library.ready || props.library.busy} onImport={files => { void props.library!.importFiles(files) }} /> : null}
                    <Button aria-pressed={props.selectedId === null} onClick={() => props.onSelect(null)}>
                      <ImageOff aria-hidden="true" size={15} />{props.t('appearance.noManualBackground')}
                    </Button>
                  </div>
                  {Array.from(groups.values()).map(group => <section className={styles.sourceGroup} key={group.id} aria-labelledby={`${tabId}-source-${encodeURIComponent(group.id)}`}>
                    <h4 className={styles.sourceHeading} id={`${tabId}-source-${encodeURIComponent(group.id)}`}>
                      {group.label}<span>{group.items.length}</span>
                    </h4>
                    <div className={styles.grid}>
                      {group.items.map(item => (
                        <article className={styles.card} key={item.id} data-selected={props.selectedId === item.id}>
                          <button className={styles.selectCard} aria-label={props.t('appearance.selectNamed', { name: item.name })}
                            aria-pressed={props.selectedId === item.id} type="button" onClick={() => props.onSelect(item.id)}>
                            <span className={styles.thumbnail}>
                              <img alt="" src={item.image} loading="lazy" />
                              {props.selectedId === item.id ? <span className={styles.selected}><Check aria-hidden="true" size={14} /></span> : null}
                            </span>
                            <span className={styles.cardText}>
                              <strong title={item.name}>{item.name}</strong>
                              <span title={item.description}>{item.description === item.name ? '' : item.description}</span>
                            </span>
                          </button>
                          <div className={styles.cardFooter}>
                            <small title={item.source}>{item.source}</small>
                            {item.personalId && props.library ? <IconButton disabled={props.library.busy} aria-label={props.t('appearance.removeNamedBackground', { name: item.name })} onClick={() => { void props.library!.remove(item.personalId!) }}><Trash2 aria-hidden="true" size={16} /></IconButton> : null}
                            <IconButton aria-label={props.t('appearance.previewNamed', { name: item.name })} onClick={() => { setPreviewId(item.id); setPreviewMode('image') }}>
                              <Eye aria-hidden="true" size={16} />
                            </IconButton>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>)}
                  {visible.length === 0 ? <p className={styles.empty}>{props.t(query ? 'appearance.noMatches' : 'appearance.empty')}</p> : null}
                </>
              ) : (
                <>
                  <fieldset className={styles.modeChoices}>
                    <legend>{props.t('appearance.surfaceMode')}</legend>
                    <RadioGroup
                      name={`${tabId}-mode`}
                      options={([
                        { value: 'solid', label: modes.solid },
                        { value: 'translucent', label: modes.translucent },
                        { value: 'glass', label: modes.glass },
                      ] as const)}
                      value={props.material.mode}
                      onChange={mode => props.onMaterialChange({ ...props.material, mode })}
                    />
                  </fieldset>
                  <label className={styles.switchRow}>
                    <span>{props.t('appearance.glassPanels')}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      disabled={props.material.mode !== 'glass'}
                      checked={props.material.glassPanels ?? true}
                      onChange={event => props.onMaterialChange({ ...props.material, glassPanels: event.target.checked })}
                    />
                  </label>
                  <div className={styles.sliderGroup}>
                    <Slider
                      icon={<Sparkles size={14} />}
                      label={props.t('appearance.blur')}
                      disabled={props.material.mode !== 'glass'}
                      min={0}
                      max={32}
                      step={1}
                      value={props.material.blur}
                      formatValue={v => `${v}px`}
                      onValueChange={blur => props.onMaterialChange({ ...props.material, blur })}
                    />
                    <Slider
                      icon={<SunMedium size={14} />}
                      label={props.t('appearance.opacity')}
                      disabled={props.material.mode === 'solid'}
                      min={0}
                      max={100}
                      step={1}
                      value={props.material.opacity}
                      formatValue={v => `${v}%`}
                      onValueChange={opacity => props.onMaterialChange({ ...props.material, opacity })}
                    />
                  </div>
                  <Button disabled={!current} onClick={() => { setPreviewId(current!.id); setPreviewMode('material') }}>
                    <Eye aria-hidden="true" size={16} />{props.t('appearance.previewMaterial')}
                  </Button>
                  {!current ? <p className={styles.note}>{props.t('appearance.unselected')}</p> : null}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <Dialog open={!!preview} onClose={() => setPreviewId(null)} closeOnBackdrop
        className={styles.previewDialog} title={preview?.name ?? props.t('appearance.preview')}
        showCloseButton={false} headerActions={<IconButton aria-label={props.t('appearance.closePreview')} onClick={() => setPreviewId(null)}><X aria-hidden="true" size={18} /></IconButton>}
        actions={preview ? <Button disabled={props.selectedId === preview.id} onClick={() => { props.onSelect(preview.id); setPreviewId(null) }}>
          <Check aria-hidden="true" size={16} />{props.t(props.selectedId === preview.id ? 'appearance.selected' : 'appearance.useBackground')}
        </Button> : undefined}>
        {preview ? (
          <>
            <div className={styles.previewModes} role="group" aria-label={props.t('appearance.previewMode')}>
              <Button aria-pressed={previewMode === 'image'} onClick={() => setPreviewMode('image')}>{props.t('appearance.original')}</Button>
              <Button aria-pressed={previewMode === 'material'} onClick={() => setPreviewMode('material')}>{props.t('appearance.materialEffect')}</Button>
            </div>
            {previewMode === 'image'
              ? <img className={styles.fullImage} src={preview.image} alt={preview.name} />
              : <MaterialScene background={preview} material={props.material} t={props.t} />}
            <div className={styles.previewMeta}>
              <span>{preview.source}</span>
              {preview.description !== preview.name ? <p>{preview.description}</p> : null}
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  )
}

function MaterialScene(props: { background?: BackgroundOption; material: MaterialValue; t: Translator }) {
  const glass = props.material.mode === 'glass'
  const variables = {
    '--loom-material-blur': `${glass ? props.material.blur : 0}px`,
    '--loom-material-fill-opacity': `${props.material.mode === 'solid' ? 100 : props.material.opacity}%`,
    '--loom-solid-fade-display': glass ? 'none' : 'block',
  } as CSSProperties

  return (
    <div className={styles.scene} data-material-mode={props.material.mode} style={variables}>
      {props.background ? <img alt="" className={styles.sceneBackground} src={props.background.image} /> : null}
      <div className={styles.sceneContent}>
        <header className={styles.material}>Loom Studio</header>
        <div className={styles.reading}>
          <p>{props.t('appearance.sampleIntro')}</p>
          <article className={styles.material}>
            <strong>{props.t('appearance.sampleTitle')}</strong>
            <div className={styles.scrollText}>
              <p>{props.t('appearance.sampleBody')}</p>
              <p>{props.t('appearance.sampleEnd')}</p>
            </div>
          </article>
        </div>
        <footer className={styles.material}>{props.t('appearance.sampleContinue')}</footer>
      </div>
    </div>
  )
}
