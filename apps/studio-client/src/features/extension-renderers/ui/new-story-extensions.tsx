import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Checkbox, Dialog, Textarea, TextInput } from '@loom-studio/ui'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { PlayerProfileState } from '@loom-studio/shared'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './new-story-extensions.module.scss'

export type NewStorySetup = {
  extensionAdoptions: Array<{ packageId: string; target: 'global' | 'card' }>
  playerProfile: PlayerProfileState
}
type Candidate = NewStorySetup['extensionAdoptions'][number] & { id: string; name: string; selected: boolean; issue?: string }
type Profile = Awaited<ReturnType<StudioApi['userProfiles']['get']>>['config']['profiles'][number]
type Prompt = {
  source: StudioApi
  name: string
  candidates: Candidate[]
  profiles: Profile[]
  profileId: string
  playerProfile: PlayerProfileState
  loading: boolean
  error?: string
}

function copyProfile(profile?: Profile): PlayerProfileState {
  if (!profile) return { name: 'User', description: '' }
  return { name: profile.name, description: profile.description,
    ...(profile.avatarAssetId ? { avatarAssetId: profile.avatarAssetId } : {}) }
}

/** Each creation owns a draft; selecting a template never updates the global profile. */
export function useNewStoryExtensions(api: StudioApi, t: Translator) {
  const [prompt, setPrompt] = useState<Prompt>()
  const profileId = useId()
  const nameId = useId()
  const descriptionId = useId()
  const profileHintId = useId()
  const pending = useRef<{ resolve(value: NewStorySetup | undefined): void } | undefined>(undefined)
  const finish = useCallback((value: NewStorySetup | undefined) => {
    const request = pending.current
    pending.current = undefined
    setPrompt(undefined)
    request?.resolve(value)
  }, [])
  useEffect(() => () => {
    pending.current?.resolve(undefined)
    pending.current = undefined
  }, [api])

  const choose = useCallback((cardId: string): Promise<NewStorySetup | undefined> => {
    pending.current?.resolve(undefined)
    const initial: Prompt = { source: api, name: '', candidates: [], profiles: [], profileId: '', playerProfile: copyProfile(), loading: true }
    setPrompt(initial)
    return new Promise(resolve => {
      const request = { resolve }
      pending.current = request
      void Promise.all([
        api.cards.get(cardId), api.extensions.list(), api.extensions.list({ kind: 'card', cardId }),
        api.extensionInstallations.list(), api.userProfiles.get(),
      ]).then(([{ card }, global, local, { installations }, { config }]) => {
        if (pending.current !== request) return
        const candidates = [...global.items, ...local.items].filter(pkg => pkg.participation === 'timeline').map(pkg => {
          const target = pkg.target ?? { kind: 'global' as const }
          const id = extensionInstallationId(pkg.packageId, target)
          const installation = installations.find(item => item.id === id)
          const enabled = pkg.modules.some(module => module.desired.enabled)
          const issue = !pkg.available ? t('newStory.extensionUnavailable')
            : !enabled ? t('newStory.extensionDisabled')
              : !installation || installation.participation !== 'timeline' || installation.packageVersion !== pkg.version
                ? t('newStory.extensionUpdateRequired') : undefined
          return { id, packageId: pkg.packageId, target: target.kind, name: pkg.displayName, selected: enabled && !issue, issue }
        })
        const selected = config.profiles.find(profile => profile.id === config.currentProfileId)
        if (config.currentProfileId !== null && !selected) throw new Error(t('userProfile.loadFailed'))
        setPrompt({ source: api, name: card.name, candidates, profiles: config.profiles,
          profileId: selected?.id ?? '', playerProfile: copyProfile(selected), loading: false })
      }).catch(error => {
        if (pending.current === request) setPrompt({ ...initial, loading: false,
          error: error instanceof Error ? error.message : String(error) })
      })
    })
  }, [api, t])

  const dialog = prompt?.source === api ? <Dialog open title={t('newStory.title')} onClose={() => finish(undefined)}
    closeLabel={t('newStory.close')} className={styles.dialog}
    description={t('newStory.intro', { name: prompt.name || t('newStory.currentCard') })}
    actions={<>
      <Button variant="ghost" onClick={() => finish(undefined)}>{t('newStory.cancel')}</Button>
      <Button disabled={prompt.loading || Boolean(prompt.error)} onClick={() => finish({
        extensionAdoptions: prompt.candidates.filter(item => item.selected && !item.issue).map(({ packageId, target }) => ({ packageId, target })),
        playerProfile: prompt.playerProfile,
      })}>{t('newStory.start')}</Button>
    </>}>
    {prompt.loading ? <p role="status">{t('newStory.loading')}</p> : prompt.error ? <p role="alert" className={styles.error}>{prompt.error}</p> : <div className={styles.content}>
      <section className={styles.section} aria-labelledby={profileId}>
        <h3 id={profileId}>{t('newStory.playerProfile')}</h3>
        <label className={styles.field}>
          <span>{t('newStory.template')}</span>
          <select autoFocus value={prompt.profileId} aria-describedby={profileHintId} onChange={event => {
            const selectedId = event.currentTarget.value
            setPrompt(current => current ? { ...current, profileId: selectedId,
              playerProfile: copyProfile(current.profiles.find(profile => profile.id === selectedId)) } : current)
          }}>
            <option value="">{t('newStory.blankProfile')}</option>
            {prompt.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name.trim() || 'User'}</option>)}
          </select>
        </label>
        <p id={profileHintId} className={styles.hint}>{t('newStory.profileHint')}</p>
        <div className={styles.field}>
          <label htmlFor={nameId}>{t('newStory.name')}</label>
          <TextInput id={nameId} value={prompt.playerProfile.name} placeholder="User" onChange={event => {
            const name = event.currentTarget.value
            setPrompt(current => current ? { ...current, playerProfile: { ...current.playerProfile, name } } : current)
          }} />
        </div>
        <div className={styles.field}>
          <label htmlFor={descriptionId}>{t('newStory.description')}</label>
          <Textarea id={descriptionId} rows={5} value={prompt.playerProfile.description} placeholder={t('newStory.descriptionPlaceholder')} onChange={event => {
            const description = event.currentTarget.value
            setPrompt(current => current ? { ...current, playerProfile: { ...current.playerProfile, description } } : current)
          }} />
        </div>
      </section>
      <section className={styles.section} aria-label={t('newStory.extensions')}>
        <h3>{t('newStory.extensions')}</h3>
        <p className={styles.hint}>{t('newStory.extensionsHint')}</p>
        {prompt.candidates.length ? <ul className={styles.list}>{prompt.candidates.map(item => <li key={item.id} className={styles.choiceRow}>
          <Checkbox checked={item.selected} disabled={Boolean(item.issue)} label={<span className={styles.identity}>
            <strong>{item.name}</strong><small>{item.issue ?? t(item.target === 'card' ? 'newStory.cardExtension' : 'newStory.globalExtension')}</small>
          </span>} onChange={event => {
            const selected = event.currentTarget.checked
            setPrompt(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.id === item.id ? { ...candidate, selected } : candidate) } : current)
          }} />
        </li>)}</ul> : <p className={styles.hint}>{t('newStory.noExtensions')}</p>}
      </section>
      <p className={styles.hint}>{t('newStory.confirmHint')}</p>
    </div>}
  </Dialog> : null
  return { choose, dialog }
}
