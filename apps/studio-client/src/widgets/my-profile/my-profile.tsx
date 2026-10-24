import { useId, useRef, useState, type ReactNode } from 'react'
import { Button, Dialog, Tabs } from '@loom-studio/ui'
import { ArrowRightLeft, Camera, Check, Globe2, Plus, Search, Trash2, UserRound } from 'lucide-react'
import { LongTextEditor } from '../../shared/ui/long-text-editor/long-text-editor.js'
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

function Avatar({ profile }: { profile: UserProfileView }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  return profile.avatarUrl && profile.avatarUrl !== failedUrl
    ? <img src={profile.avatarUrl} alt="" onError={() => setFailedUrl(profile.avatarUrl)} />
    : <span aria-hidden="true">{Array.from(profile.name.trim())[0] || <UserRound size={32} />}</span>
}

// Persistence stays in the feature controller; the developer preview uses memory only.
export function MyProfile(props: MyProfileProps) {
  const t = props.t ?? defaultT
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [tab, setTab] = useState<'profile' | 'resources'>('profile')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [editorMode, setEditorMode] = useState<'source' | 'preview'>('source')
  const uploadRef = useRef<HTMLInputElement>(null)
  const nameId = useId()
  const current = props.profiles.find(profile => profile.id === props.currentProfileId)
  const matches = props.profiles.filter(profile => profile.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  async function createProfile() {
    if (await props.onCreate() === false) return
    setTab('profile')
    setPickerOpen(false)
  }

  return <section className={styles.panel} aria-label={t('userProfile.title')}>
    <div className={styles.content}>
      <header className={styles.hero}>
        <div className={styles.identity}>
          {current ? <>
            <button className={styles.avatar} type="button" disabled={props.busy} aria-label={t('userProfile.changeAvatar')} onClick={() => uploadRef.current?.click()}>
              <Avatar profile={current} />
              <span className={styles.camera}><Camera size={16} /></span>
            </button>
            <input ref={uploadRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
              const file = event.currentTarget.files?.[0]
              if (file) props.onAvatarChange(current.id, file)
              event.currentTarget.value = ''
            }} />
            <div className={styles.identityText}>
              <label className={styles.eyebrow} htmlFor={nameId}>{t('userProfile.name')}</label>
              <input id={nameId} className={styles.name} disabled={props.busy} onBlur={() => props.onCommit?.()} value={current.name} placeholder="User" onChange={event => props.onChange(current.id, { name: event.target.value })} />
              <p className={styles.scope}><Globe2 size={13} aria-hidden="true" />{t('userProfile.scope')}</p>
              {current.avatarUrl ? <button className={styles.clearAvatar} type="button" disabled={props.busy} onClick={() => props.onAvatarClear(current.id)}>{t('userProfile.removeAvatar')}</button> : null}
            </div>
          </> : <>
            <div className={styles.avatar}><UserRound size={36} aria-hidden="true" /></div>
            <div className={styles.identityText}><h1>{t('userProfile.emptyHeading')}</h1><p className={styles.scope}>{t('userProfile.emptyIntro')}</p></div>
          </>}
        </div>
        {props.profiles.length > 0 ? <Button disabled={props.busy} variant="secondary" onClick={() => { setQuery(''); setPickerOpen(true) }}><ArrowRightLeft size={15} />{t('userProfile.switch')}<span className={styles.count}>{props.profiles.length}</span></Button>
          : <Button disabled={props.busy || props.loading || props.ready === false} onClick={createProfile}><Plus size={16} />{t('userProfile.create')}</Button>}
      </header>

      <Tabs ariaLabel={t('userProfile.title')} bordered activeId={tab} onChange={setTab} items={[{ id: 'profile', label: t('userProfile.profileTab') }, { id: 'resources', label: t('userProfile.resourcesTab') }]} />

      <div className={styles.body} role="tabpanel" aria-label={tab === 'profile' ? t('userProfile.profileTab') : t('userProfile.resourcesTab')}>
        {tab === 'profile' ? <div className={styles.actions}>
          {current && props.onCommit ? <Button disabled={props.busy || props.saving || !props.dirty} variant="secondary" onClick={props.onCommit}>{t(props.error ? 'userProfile.retry' : 'userProfile.save')}</Button> : null}
          {props.onRefresh ? <Button disabled={props.busy || props.saving} variant="ghost" onClick={() => props.dirty ? setRefreshOpen(true) : props.onRefresh?.()}>{t('userProfile.refresh')}</Button> : null}
          {current && props.onDelete ? <Button disabled={props.busy} variant="ghost" onClick={() => setDeleteOpen(true)}><Trash2 size={14} />{t('userProfile.delete')}</Button> : null}
        </div> : null}
        {tab === 'profile' ? props.loading || props.ready === false ? <p role="status">{t(props.loading ? 'userProfile.loading' : 'userProfile.loadFailed')}</p> : current ? <>
          <div className={styles.sectionHeading}><div><h2>{t('userProfile.about')}</h2><p>{t('userProfile.aboutHint')}</p></div><span className={styles.characterCount}>{t('userProfile.characters', { count: current.description.length })}</span></div>
          <LongTextEditor key={current.id} label={t('userProfile.description')} hideLabel value={current.description} onChange={description => props.onChange(current.id, { description })}
            onCommit={() => props.onCommit?.()} disabled={props.busy} mode={editorMode} onModeChange={setEditorMode} minHeight={320} showLineNumbers={false}
            placeholder={t('userProfile.placeholder')}
            clearLabel={t('longTextEditor.clear')} clearedLabel={t('longTextEditor.cleared')} copiedLabel={t('longTextEditor.copied')} copyFailedLabel={t('longTextEditor.copyFailed')} copyLabel={t('longTextEditor.copy')}
            restoreInitialLabel={t('longTextEditor.restoreInitial')} undoEditLabel={t('longTextEditor.undoEdit')} undoLabel={t('longTextEditor.undoClear')}
            disableCodeWrapLabel={t('markdown.code.disableWrap')} enableCodeWrapLabel={t('markdown.code.enableWrap')} previewEmptyLabel={t('longTextEditor.previewEmpty')} previewModeLabel={t('longTextEditor.previewMode')} sourceModeLabel={t('longTextEditor.sourceMode')} />
          <div className={styles.editorFooter}><span>{t('userProfile.fixedHint')}</span><span role="status">{props.saving ? t('userProfile.saving') : props.feedback}</span></div>
        </> : <div className={styles.empty}><UserRound size={28} /><h2>{t('userProfile.emptyTitle')}</h2><p>{t('userProfile.emptyBody')}</p><Button disabled={props.busy} onClick={createProfile}><Plus size={15} />{t('userProfile.first')}</Button></div>
          : props.resources}
        {props.error ? <p className={styles.error} role="alert">{props.error}</p> : null}
      </div>
    </div>

    <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('userProfile.deleteTitle', { name: current?.name.trim() || 'User' })} description={t('userProfile.deleteHint')}
      actions={<><Button disabled={props.busy} variant="secondary" onClick={() => setDeleteOpen(false)}>{t('userProfile.cancel')}</Button><Button disabled={props.busy} onClick={async () => { if (current && await props.onDelete?.(current.id) !== false) setDeleteOpen(false) }}>{t('userProfile.delete')}</Button></>}>{props.error ? <p className={styles.error} role="alert">{props.error}</p> : null}</Dialog>
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
