import { HeroArtwork } from '../../shared/ui/story-hero/hero-artwork.js'
import { StoryHero } from '../../shared/ui/story-hero/story-hero.js'
import type { CardSummary } from '../../entities/index.js'
import { useWorkbenchView } from '../../shared/studio-shell/use-workbench-view.js'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, Dialog, Tabs } from '@loom-studio/ui'
import { ArrowRightLeft, ArrowUpRight, Camera, Check, Plus, Search, Trash2, UserRound, Pencil } from 'lucide-react'
import { t as defaultT, type Translator } from '../../shared/i18n/index.js'
import styles from './my-profile.module.scss'

export type UserProfileView = {
  id: string
  name: string
  description: string
  avatarUrl?: string
}

export type MyProfileProps = {
  profiles: readonly UserProfileView[]
  currentProfileId: string | null
  resources: ReactNode
  currentStory?: { title?: string; character?: CardSummary; onOpen(): void | Promise<void> }
  t?: Translator
  busy?: boolean
  saving?: boolean
  dirty?: boolean
  loading?: boolean
  ready?: boolean
  onCommit?(): void
  onDelete?(id: string): Promise<boolean> | boolean | void
  onRefresh?(): void
  feedback?: string
  error?: string
  onSelect(id: string): Promise<boolean> | boolean | void
  onCreate(): Promise<boolean> | boolean | void
  onChange(id: string, patch: Partial<Pick<UserProfileView, 'name' | 'description'>>): void
  onAvatarChange(id: string, file: File): void
  onAvatarClear(id: string): void
}

function Avatar({ profile, hero = false }: { profile: UserProfileView; hero?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  return profile.avatarUrl && profile.avatarUrl !== failedUrl
    ? hero ? <HeroArtwork src={profile.avatarUrl} onError={() => setFailedUrl(profile.avatarUrl)} /> : <img src={profile.avatarUrl} alt="" onError={() => setFailedUrl(profile.avatarUrl)} />
    : <span data-monogram="" aria-hidden="true">{Array.from(profile.name.trim())[0] || <UserRound size={32} />}</span>
}

// Persistence stays in the feature controller; the developer preview uses memory only.
export function MyProfile(props: MyProfileProps) {
  const t = props.t ?? defaultT
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [tab, setTab] = useWorkbenchView('profile.tab', 'profile', ['profile', 'resources'] as const)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const nameId = useId()
  const current = props.profiles.find(profile => profile.id === props.currentProfileId)
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    if (!props.dirty || props.busy || props.error) return
    const timer = window.setTimeout(() => latest.current.onCommit?.(), 600)
    return () => window.clearTimeout(timer)
  }, [current?.id, current?.name, current?.description, props.dirty, props.busy, props.error])
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const field = descriptionRef.current
    if (field) { field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px` }
  }, [editing, current?.description])
  const matches = props.profiles.filter(profile => profile.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  async function createProfile() {
    if (await props.onCreate() === false) return
    setTab('profile')
    setPickerOpen(false)
  }

  return <section data-loom-mobile-tab-scope="" className={styles.panel} aria-label={t('userProfile.title')}>
    <div className={styles.content}>
      <header className={styles.hero}>
        {current ? <>
          <button className={styles.portrait} type="button" disabled={props.busy} aria-label={t('userProfile.edit')} onClick={() => setEditing(true)}>
            <Avatar profile={current} hero />
          </button>
          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>{t('userProfile.title')} · {t('userProfile.profileTab')}</span>
            <h1>{current.name.trim() || 'User'}</h1>
            <p className={styles.bio}>{current.description || t('userProfile.aboutHint')}</p>
            <div className={styles.heroActions}>
              <Button variant="ghost" disabled={props.busy} onClick={() => setEditing(true)}><Pencil size={15} />{t('userProfile.edit')}</Button>
              <Button disabled={props.busy} variant="ghost" onClick={() => { setQuery(''); setPickerOpen(true) }}><ArrowRightLeft size={15} />{t('userProfile.switch')}<span className={styles.count}>{props.profiles.length}</span></Button>
              <span className={styles.saveStatus} role="status">{props.saving ? t('userProfile.saving') : props.feedback}</span>
            </div>
          </div>
        </> : <div className={styles.heroContent}>
          <span className={styles.eyebrow}>{t('userProfile.title')}</span><h1>{t('userProfile.emptyHeading')}</h1>
          <p className={styles.bio}>{t(props.loading ? 'userProfile.loading' : props.ready === false ? 'userProfile.loadFailed' : 'userProfile.emptyIntro')}</p>
          <Button disabled={props.busy || props.loading || props.ready === false} onClick={createProfile}><Plus size={16} />{t('userProfile.create')}</Button>
        </div>}
      </header>
      <input ref={uploadRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
        const file = event.currentTarget.files?.[0]
        if (file && current) props.onAvatarChange(current.id, file)
        event.currentTarget.value = ''
      }} />
      {props.error ? <div className={styles.error} role="alert"><p>{props.error}</p>
        {props.dirty && props.onCommit && <Button variant="ghost" disabled={props.busy || props.saving} onClick={props.onCommit}>{t('userProfile.retry')}</Button>}
        {props.onRefresh && <Button variant="ghost" disabled={props.busy || props.saving} onClick={() => props.dirty ? setRefreshOpen(true) : props.onRefresh?.()}>{t('userProfile.refresh')}</Button>}
      </div> : null}

      <Tabs ariaLabel={t('userProfile.title')} activeId={tab} onChange={setTab} items={[{ id: 'profile', label: t('userProfile.profileTab') }, { id: 'resources', label: t('userProfile.resourcesTab') }]} />
      {tab === 'profile' && props.currentStory ? <div className={styles.currentStory}><StoryHero
        character={props.currentStory.character} label={t('userProfile.currentStory')}
        title={props.currentStory.title || t('userProfile.currentStory')} description={t('userProfile.currentStoryHint')}
        actions={<Button className={styles.storyLink} variant="ghost" disabled={props.busy} onClick={() => { void props.currentStory?.onOpen() }}>
          {t('userProfile.openCurrentStory')}<ArrowUpRight size={15} aria-hidden="true" />
        </Button>} />
      </div> : null}

      {tab === 'resources' ? <div className={styles.body}>{props.resources}</div> : null}
    </div>

    <Dialog open={editing && !!current} onClose={() => { props.onCommit?.(); setEditing(false) }} title={t('userProfile.edit')} className={styles.editDialog}>
      {current && <div className={styles.editFields}>
        <label htmlFor={nameId}>{t('userProfile.name')}</label>
        <input id={nameId} className={styles.editName} value={current.name} disabled={props.busy} onChange={event => props.onChange(current.id, { name: event.target.value })} onBlur={() => props.onCommit?.()} />
        <label htmlFor={`${nameId}-description`}>{t('userProfile.about')}</label>
        <textarea ref={descriptionRef} id={`${nameId}-description`} className={styles.descriptionInput} value={current.description} disabled={props.busy} placeholder={t('userProfile.placeholder')}
          onChange={event => props.onChange(current.id, { description: event.target.value })} onBlur={() => props.onCommit?.()} />
        <div className={styles.editActions}>
          <Button variant="ghost" disabled={props.busy} onClick={() => uploadRef.current?.click()}><Camera size={15} />{t('userProfile.changeAvatar')}</Button>
          {current.avatarUrl && <Button variant="ghost" disabled={props.busy} onClick={() => props.onAvatarClear(current.id)}>{t('userProfile.removeAvatar')}</Button>}
          {props.onDelete && <Button variant="ghost" disabled={props.busy} onClick={() => setDeleteOpen(true)}><Trash2 size={15} />{t('userProfile.delete')}</Button>}
        </div>
        <span role="status" className={styles.saveStatus}>{props.saving ? t('userProfile.saving') : props.feedback}</span>
        {props.error && <div className={styles.error} role="alert">{props.error}
          <Button variant="ghost" disabled={props.busy || props.saving} onClick={props.onCommit}>{t('userProfile.retry')}</Button>
          {props.onRefresh && <Button variant="ghost" disabled={props.busy || props.saving} onClick={() => setRefreshOpen(true)}>{t('userProfile.refresh')}</Button>}
        </div>}
      </div>}
    </Dialog>
    <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('userProfile.deleteTitle', { name: current?.name.trim() || 'User' })} description={t('userProfile.deleteHint')}
      actions={<><Button disabled={props.busy} variant="secondary" onClick={() => setDeleteOpen(false)}>{t('userProfile.cancel')}</Button><Button disabled={props.busy} onClick={async () => { if (current && await props.onDelete?.(current.id) !== false) { setDeleteOpen(false); setEditing(false) } }}>{t('userProfile.delete')}</Button></>}>{props.error ? <p className={styles.error} role="alert">{props.error}</p> : null}</Dialog>
    <Dialog open={refreshOpen} onClose={() => setRefreshOpen(false)} title={t('userProfile.refreshTitle')} description={t('userProfile.refreshHint')}
      actions={<><Button variant="secondary" onClick={() => setRefreshOpen(false)}>{t('userProfile.cancel')}</Button><Button onClick={() => { props.onRefresh?.(); setRefreshOpen(false) }}>{t('userProfile.refresh')}</Button></>} />
    <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} title={t('userProfile.switchTitle')} description={t('userProfile.switchHint')} className={styles.picker}
      actions={<Button disabled={props.busy || props.loading || props.ready === false} onClick={createProfile}><Plus size={15} />{t('userProfile.createUse')}</Button>}>
      {props.error ? <p className={styles.error} role="alert">{props.error}</p> : null}
      <label className={styles.search}><Search size={16} aria-hidden="true" /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('userProfile.search')} aria-label={t('userProfile.searchLabel')} /></label>
      <div className={styles.profileList}>
        {matches.map(profile => <button type="button" key={profile.id} className={styles.profileOption} aria-pressed={profile.id === current?.id} disabled={props.busy} onClick={async () => { if (await props.onSelect(profile.id) !== false) setPickerOpen(false) }}>
          <span className={styles.smallAvatar}><Avatar profile={profile} /></span>
          <span className={styles.optionText}><strong>{profile.name.trim() || 'User'}</strong><span>{profile.description || t('userProfile.noDescription')}</span></span>
          {profile.id === current?.id ? <span className={styles.selected}><Check size={16} /><span>{t('userProfile.selected')}</span></span> : null}
        </button>)}
        {!matches.length ? <p className={styles.noResults}>{t('userProfile.noResults')}</p> : null}
      </div>
    </Dialog>
  </section>
}
