import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { useUserProfilesQuery, userProfilesQueryKey, type UserProfile, type UserProfilesConfig, type UserProfilesResult } from './use-user-profiles-query.js'

type Draft = { profile: UserProfile; version: number }
type Patch = Partial<Pick<UserProfile, 'name' | 'description' | 'avatarAssetId'>>

export function useUserProfilesController(api: StudioApi['userProfiles'], endpoint: string, t: Translator) {
  const query = useUserProfilesQuery(api, endpoint)
  const client = useQueryClient()
  const key = userProfilesQueryKey(endpoint)
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const saveRef = useRef<Promise<void> | null>(null)
  const actionRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  function writeDraft(next: Draft | null) {
    draftRef.current = next
    setDraft(next)
  }
  function readConfig() {
    const config = client.getQueryData<UserProfilesResult>(key)?.config
    if (!config) throw new Error(t('userProfile.loadFailed'))
    return config
  }
  async function apply(config: UserProfilesConfig) {
    await client.cancelQueries({ queryKey: key, exact: true })
    client.setQueryData<UserProfilesResult>(key, { config })
  }
  function change(profileId: string, patch: Patch) {
    const config = readConfig()
    const base = draftRef.current
    const profile = base?.profile ?? config.profiles.find(item => item.id === profileId)
    if (!profile || profile.id !== profileId) return
    writeDraft({ profile: { ...profile, ...patch }, version: base?.version ?? config.version })
    setFeedback(t('userProfile.unsaved'))
  }
  function save(): Promise<void> {
    if (saveRef.current) return saveRef.current
    const pending = (async () => {
      setSaving(true)
      try {
        // Keep the captured CAS baseline after failure. Edits made during a request
        // remain in the draft and are saved against the returned version next.
        while (draftRef.current) {
          const sent = draftRef.current
          const result = await api.update({ expectedVersion: sent.version, profileId: sent.profile.id,
            name: sent.profile.name, description: sent.profile.description, avatarAssetId: sent.profile.avatarAssetId ?? null })
          await apply(result.config)
          const latest = draftRef.current
          writeDraft(latest === sent ? null : latest ? { ...latest, version: result.config.version } : null)
        }
        setError('')
        setFeedback(t('userProfile.saved'))
      } finally { setSaving(false) }
    })()
    saveRef.current = pending
    void pending.finally(() => { saveRef.current = null }).catch(() => undefined)
    return pending
  }
  async function report(operation: () => Promise<void>) {
    try { await operation(); return true }
    catch (cause) {
      setError(`${t('userProfile.operationFailed')} ${cause instanceof Error ? cause.message : String(cause)}`)
      return false
    }
  }
  async function action(operation: () => Promise<void>) {
    if (actionRef.current) return false
    actionRef.current = true
    setBusy(true)
    try { return await report(operation) }
    finally { actionRef.current = false; setBusy(false) }
  }
  async function mutate(operation: (config: UserProfilesConfig) => Promise<{ config: UserProfilesConfig }>) {
    return action(async () => {
      await save()
      const result = await operation(readConfig())
      await apply(result.config)
      setError('')
      setFeedback(t('userProfile.saved'))
    })
  }
  async function upload(profileId: string, file: File) {
    return action(async () => {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 64 * 1024 * 1024) {
        throw new Error(t('userProfile.imageLimit'))
      }
      await save()
      const response = await fetch('/assets', { method: 'POST', headers: { 'content-type': file.type, 'x-loom-asset-kind': 'image' }, body: file })
      const body: unknown = await response.json()
      const asset = typeof body === 'object' && body !== null && 'asset' in body ? body.asset : undefined
      const id = typeof asset === 'object' && asset !== null && 'id' in asset ? asset.id : undefined
      if (!response.ok || typeof id !== 'string') throw new Error(t('userProfile.uploadFailed'))
      change(profileId, { avatarAssetId: id })
      await save()
    })
  }
  const config = query.data?.config
  const currentProfileId = draft?.profile.id ?? config?.currentProfileId ?? null
  const profiles = (config?.profiles ?? []).map(profile => draft?.profile.id === profile.id ? draft.profile : profile)
  // A remote deletion must not make unsaved text inaccessible.
  if (draft && !profiles.some(profile => profile.id === draft.profile.id)) profiles.push(draft.profile)
  return {
    profiles, currentProfileId, busy, saving, dirty: !!draft, feedback,
    error: error || (draft && config && draft.version !== config.version ? t('userProfile.changedElsewhere') : '') || (query.error ? t('userProfile.loadFailed') : ''), loading: query.isPending, ready: !!config,
    revalidate: query.refetch,
    change, commit: () => report(save), upload,
    create: () => mutate(config => api.create({ expectedVersion: config.version, name: t('userProfile.newName') })),
    select: (profileId: string) => mutate(config => api.select({ expectedVersion: config.version, profileId })),
    remove: (profileId: string) => mutate(config => api.delete({ expectedVersion: config.version, profileId })),
    clearAvatar: (profileId: string) => action(async () => { change(profileId, { avatarAssetId: undefined }); await save() }),
    refresh: () => action(async () => {
      if (saveRef.current) await saveRef.current.catch(() => undefined)
      const result = await query.refetch()
      if (result.error) throw result.error
      writeDraft(null)
      setError('')
      setFeedback('')
    }),
  }
}
