import type { DocumentTransaction } from '@loom-studio/document-store'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'

const avatarMediaTypes = new Set(['image/png', 'image/apng', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export async function validateProfileAvatar(ctx: Pick<ApplicationRuntimeContext, 'mediaAssets'>, assetId: string): Promise<void> {
  const asset = await ctx.mediaAssets?.get(assetId)
  if (!asset) throw new Error(`Media Asset not found: ${assetId}`)
  if (!asset.mediaType || !avatarMediaTypes.has(asset.mediaType)) throw new Error('User profile avatar must be a supported raster image')
}

export type UserProfile = {
  id: string
  name: string
  description: string
  avatarAssetId?: string
}

export type UserProfilesContent = {
  profiles: UserProfile[]
  currentProfileId: string | null
}

export type UserProfilesConfig = UserProfilesContent & { version: number }
export type ResolvedUserProfile = Omit<UserProfile, 'id'> & { id?: string }
export type CreateUserProfileInput = { expectedVersion: number; name?: string; description?: string }
export type UpdateUserProfileInput = CreateUserProfileInput & { profileId: string; avatarAssetId?: string | null }
export type SelectUserProfileInput = { expectedVersion: number; profileId: string }
export type DeleteUserProfileInput = SelectUserProfileInput

export const userProfilesDocumentId = 'user-profiles:global'

export async function readUserProfiles(documents: DocumentTransaction): Promise<UserProfilesConfig> {
  const record = await documents.get(userProfilesDocumentId)
  if (!record) return { profiles: [], currentProfileId: null, version: 0 }
  if (record.type !== applicationDocumentTypes.userProfiles) throw new Error('Unexpected user profiles document type')
  return { ...record.content as UserProfilesContent, version: record.version }
}

export function resolveCurrentUserProfile(config: UserProfilesConfig): ResolvedUserProfile {
  if (config.currentProfileId === null) return { name: 'User', description: '' }
  const profile = config.profiles.find(profile => profile.id === config.currentProfileId)
  if (!profile) throw new Error(`User profile not found: ${config.currentProfileId}`)
  return { ...profile, name: profile.name.trim() || 'User' }
}
