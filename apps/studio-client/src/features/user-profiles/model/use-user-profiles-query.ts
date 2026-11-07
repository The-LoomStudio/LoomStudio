import { useQuery } from '@tanstack/react-query'
import type { StudioApi } from '../../../shared/api/studio-api.js'

export const userProfilesQueryKey = (endpoint: string) => ['user-profiles', endpoint] as const
export type UserProfilesResult = Awaited<ReturnType<StudioApi['userProfiles']['get']>>
export type UserProfilesConfig = UserProfilesResult['config']
export type UserProfile = UserProfilesConfig['profiles'][number]

export function useUserProfilesQuery(api: StudioApi['userProfiles'], endpoint: string) {
  return useQuery({
    queryKey: userProfilesQueryKey(endpoint),
    queryFn: () => api.get(),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  })
}

