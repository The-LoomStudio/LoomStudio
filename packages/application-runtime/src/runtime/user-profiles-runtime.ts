import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { writeDocument } from '../foundation/document-store.js'
import {
  readUserProfiles,
  userProfilesDocumentId,
  type CreateUserProfileInput,
  type DeleteUserProfileInput,
  type SelectUserProfileInput,
  type UpdateUserProfileInput,
  type UserProfilesContent,
} from '../profiles/user-profiles.js'
import type { RuntimeRequestContext } from '../types.js'
import { narrativeWriteContext, requireDocumentParticipant } from './context.js'

const avatarMediaTypes = new Set(['image/png', 'image/apng', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

type UserProfilesRuntimeContext = Pick<ApplicationRuntimeContext, 'documents' | 'dataEngine' | 'createId' | 'mediaAssets'>

export function createUserProfilesRuntimeMethods(ctx: UserProfilesRuntimeContext) {
  async function mutate(
    expectedVersion: number,
    reason: string,
    update: (content: UserProfilesContent) => void,
    context?: RuntimeRequestContext,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('Invalid user profiles configuration version')
    const result = await ctx.dataEngine.transact(
      narrativeWriteContext(context, reason),
      dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
        const { profiles, currentProfileId } = await readUserProfiles(documents)
        const content: UserProfilesContent = { profiles, currentProfileId }
        update(content)
        return writeDocument(documents, {
          id: userProfilesDocumentId,
          type: applicationDocumentTypes.userProfiles,
          content,
          expectedVersion: expectedVersion === 0 ? 'new' : expectedVersion,
        })
      }),
    )
    const document = result.value.value
    return { config: { ...document.content, version: document.version }, mutation: { changesetId: result.commit.changesetId } }
  }

  function requireProfile(content: UserProfilesContent, profileId: string) {
    const profile = content.profiles.find(profile => profile.id === profileId)
    if (!profile) throw new Error(`User profile not found: ${profileId}`)
    return profile
  }

  return {
    getUserProfiles: async () => ({ config: await readUserProfiles(ctx.documents) }),
    createUserProfile: async (input: CreateUserProfileInput, context?: RuntimeRequestContext) => mutate(
      input.expectedVersion, 'application.createUserProfile', content => {
        const id = ctx.createId('user-profile')
        content.profiles.push({ id, name: input.name ?? '', description: input.description ?? '' })
        content.currentProfileId = id
      }, context,
    ),
    updateUserProfile: async (input: UpdateUserProfileInput, context?: RuntimeRequestContext) => {
      if (typeof input.avatarAssetId === 'string') {
        const asset = await ctx.mediaAssets?.get(input.avatarAssetId)
        if (!asset) throw new Error(`Media Asset not found: ${input.avatarAssetId}`)
        if (!asset.mediaType || !avatarMediaTypes.has(asset.mediaType)) throw new Error('User profile avatar must be a supported raster image')
      }
      return mutate(input.expectedVersion, 'application.updateUserProfile', content => {
        const profile = requireProfile(content, input.profileId)
        if (input.name !== undefined) profile.name = input.name
        if (input.description !== undefined) profile.description = input.description
        if (input.avatarAssetId === null) delete profile.avatarAssetId
        else if (input.avatarAssetId !== undefined) profile.avatarAssetId = input.avatarAssetId
      }, context)
    },
    selectUserProfile: async (input: SelectUserProfileInput, context?: RuntimeRequestContext) => mutate(
      input.expectedVersion, 'application.selectUserProfile', content => {
        requireProfile(content, input.profileId)
        content.currentProfileId = input.profileId
      }, context,
    ),
    deleteUserProfile: async (input: DeleteUserProfileInput, context?: RuntimeRequestContext) => mutate(
      input.expectedVersion, 'application.deleteUserProfile', content => {
        requireProfile(content, input.profileId)
        content.profiles = content.profiles.filter(profile => profile.id !== input.profileId)
        if (content.currentProfileId === input.profileId) content.currentProfileId = null
      }, context,
    ),
  }
}
