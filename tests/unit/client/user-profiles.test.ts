// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { renderHook } from '../../support/client/render-hook.js'
import { useUserProfilesController } from '../../../apps/studio-client/src/features/user-profiles/model/use-user-profiles-controller.js'
import { userProfilesQueryKey, type UserProfilesConfig } from '../../../apps/studio-client/src/features/user-profiles/model/use-user-profiles-query.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { t } from '../../../apps/studio-client/src/shared/i18n/index.js'

const state = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }))
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => state.client,
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data: state.client!.getQueryData(queryKey), isPending: false, error: null,
    refetch: vi.fn(async () => ({ data: state.client!.getQueryData(queryKey), error: null })),
  }),
}))
const endpoint = '/test-rpc'
const initial: UserProfilesConfig = { version: 1, currentProfileId: 'one', profiles: [
  { id: 'one', name: 'First', description: 'Original' }, { id: 'two', name: 'Second', description: '' },
] }
function fixture(update: StudioApi['userProfiles']['update']) {
  return { update, select: vi.fn(), create: vi.fn(), delete: vi.fn(), get: vi.fn() } satisfies StudioApi['userProfiles']
}
function result(config: UserProfilesConfig) {
  return { config, mutation: { changesetId: 'test' } }
}
beforeEach(() => {
  state.client = new QueryClient()
  state.client.setQueryData(userProfilesQueryKey(endpoint), { config: structuredClone(initial) })
})

it('keeps a failed draft and its CAS baseline and prevents switching', async () => {
  const update = vi.fn<StudioApi['userProfiles']['update']>().mockRejectedValue(new Error('conflict'))
  const api = fixture(update)
  const hook = renderHook(() => useUserProfilesController(api, endpoint, t))
  try {
    act(() => hook.current.change('one', { description: 'Unsaved' }))
    await act(async () => { expect(await hook.current.select('two')).toBe(false) })
    expect(api.select).not.toHaveBeenCalled()
    expect(hook.current.profiles[0]?.description).toBe('Unsaved')
    expect(hook.current.dirty).toBe(true)
    state.client!.setQueryData(userProfilesQueryKey(endpoint), { config: { ...initial, version: 9 } })
    await act(async () => { await hook.current.commit() })
    expect(update.mock.calls.map(([input]) => input.expectedVersion)).toEqual([1, 1])
    expect(hook.current.error).toContain('conflict')
  } finally { hook.unmount() }
})

it('preserves edits typed during a save and uses the committed version for the next save', async () => {
  let finish!: (value: Awaited<ReturnType<StudioApi['userProfiles']['update']>>) => void
  const update = vi.fn<StudioApi['userProfiles']['update']>()
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockImplementationOnce(async input => result({ ...initial, version: 3, profiles: [{ ...initial.profiles[0]!, name: input.name!, description: input.description! }, initial.profiles[1]!] }))
  const hook = renderHook(() => useUserProfilesController(fixture(update), endpoint, t))
  try {
    act(() => hook.current.change('one', { name: 'First edit' }))
    let save!: Promise<boolean>
    act(() => { save = hook.current.commit() })
    act(() => hook.current.change('one', { name: 'Newer edit' }))
    await act(async () => {
      finish(result({ ...initial, version: 2, profiles: [{ ...initial.profiles[0]!, name: 'First edit' }, initial.profiles[1]!] }))
      await save
    })
    expect(update.mock.calls.map(([input]) => [input.expectedVersion, input.name])).toEqual([[1, 'First edit'], [2, 'Newer edit']])
    expect(hook.current.dirty).toBe(false)
    expect(state.client!.getQueryData<{ config: UserProfilesConfig }>(userProfilesQueryKey(endpoint))?.config.profiles[0]?.name).toBe('Newer edit')
    expect(state.client!.getQueryData(userProfilesQueryKey('/other'))).toBeUndefined()
  } finally { hook.unmount() }
})

it('retains an uploaded avatar draft when saving its reference fails, and retries without uploading again', async () => {
  const fetchUpload = vi.fn().mockResolvedValue(new Response(JSON.stringify({ asset: { id: 'avatar-new' } }), { status: 201 }))
  vi.stubGlobal('fetch', fetchUpload)
  const update = vi.fn<StudioApi['userProfiles']['update']>().mockRejectedValueOnce(new Error('save failed'))
    .mockImplementationOnce(async input => result({ ...initial, version: 2, profiles: [{ ...initial.profiles[0]!, avatarAssetId: input.avatarAssetId! }, initial.profiles[1]!] }))
  const hook = renderHook(() => useUserProfilesController(fixture(update), endpoint, t))
  try {
    await act(async () => { expect(await hook.current.upload('one', new File(['image'], 'avatar.png', { type: 'image/png' }))).toBe(false) })
    expect(hook.current.dirty).toBe(true)
    expect(hook.current.profiles[0]?.avatarAssetId).toBe('avatar-new')
    expect(state.client!.getQueryData<{ config: UserProfilesConfig }>(userProfilesQueryKey(endpoint))?.config.profiles[0]?.avatarAssetId).toBeUndefined()
    await act(async () => { expect(await hook.current.commit()).toBe(true) })
    expect(fetchUpload).toHaveBeenCalledOnce()
    expect(update.mock.calls.map(([input]) => [input.expectedVersion, input.avatarAssetId])).toEqual([[1, 'avatar-new'], [1, 'avatar-new']])
    expect(hook.current.dirty).toBe(false)
  } finally { hook.unmount(); vi.unstubAllGlobals() }
})
