import { useEffect, useRef, type ReactNode } from 'react'
import { useUserProfilesController } from '../../features/user-profiles/model/use-user-profiles-controller.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { Translator } from '../../shared/i18n/index.js'
import { MyProfile } from './my-profile.js'

export function MyProfilePanel(props: { api: StudioApi['userProfiles']; endpoint: string; t: Translator; resources: ReactNode; active: boolean }) {
  return <ProfileEditor key={props.endpoint} {...props} />
}
function ProfileEditor(props: { api: StudioApi['userProfiles']; endpoint: string; t: Translator; resources: ReactNode; active: boolean }) {
  const controller = useUserProfilesController(props.api, props.endpoint, props.t)
  const wasActive = useRef(props.active)
  // The panel can stay mounted while hidden; re-read when returning to it.
  useEffect(() => {
    if (props.active && !wasActive.current) void controller.revalidate()
    wasActive.current = props.active
  }, [props.active])
  return <MyProfile t={props.t} resources={props.resources}
    profiles={controller.profiles.map(profile => ({ ...profile, avatarUrl: profile.avatarAssetId ? `/assets/${encodeURIComponent(profile.avatarAssetId)}` : undefined }))}
    currentProfileId={controller.currentProfileId} feedback={controller.feedback} error={controller.error}
    busy={controller.busy} saving={controller.saving} dirty={controller.dirty} loading={controller.loading} ready={controller.ready}
    onChange={controller.change} onCommit={() => { void controller.commit() }} onSelect={controller.select} onCreate={controller.create}
    onAvatarChange={(id, file) => { void controller.upload(id, file) }} onAvatarClear={id => { void controller.clearAvatar(id) }}
    onDelete={controller.remove} onRefresh={() => { void controller.refresh() }} />
}
