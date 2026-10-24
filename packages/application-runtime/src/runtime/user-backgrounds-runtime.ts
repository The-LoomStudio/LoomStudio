import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { writeDocument } from '../foundation/document-store.js'
import {
  readUserBackgrounds,
  userBackgroundsDocumentId,
  type AddUserBackgroundInput,
  type RemoveUserBackgroundInput,
  type UserBackgroundsContent,
} from '../profiles/user-backgrounds.js'
import type { RuntimeRequestContext } from '../types.js'
import { narrativeWriteContext, requireDocumentParticipant } from './context.js'

const backgroundMediaTypes = new Set(['image/png', 'image/apng', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
type UserBackgroundsRuntimeContext = Pick<ApplicationRuntimeContext, 'documents' | 'dataEngine' | 'createId' | 'mediaAssets'>

export function createUserBackgroundsRuntimeMethods(ctx: UserBackgroundsRuntimeContext) {
  async function mutate(
    expectedVersion: number,
    reason: string,
    update: (content: UserBackgroundsContent) => void,
    context?: RuntimeRequestContext,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('Invalid user backgrounds configuration version')
    const result = await ctx.dataEngine.transact(
      narrativeWriteContext(context, reason),
      dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
        const { backgrounds } = await readUserBackgrounds(documents)
        const content: UserBackgroundsContent = { backgrounds }
        update(content)
        return writeDocument(documents, {
          id: userBackgroundsDocumentId,
          type: applicationDocumentTypes.userBackgrounds,
          content,
          expectedVersion: expectedVersion === 0 ? 'new' : expectedVersion,
        })
      }),
    )
    const document = result.value.value
    return { config: { ...document.content, version: document.version }, mutation: { changesetId: result.commit.changesetId } }
  }

  return {
    getUserBackgrounds: async () => ({ config: await readUserBackgrounds(ctx.documents) }),
    addUserBackground: async (input: AddUserBackgroundInput, context?: RuntimeRequestContext) => {
      const asset = await ctx.mediaAssets?.get(input.assetId)
      if (!asset) throw new Error(`Media Asset not found: ${input.assetId}`)
      if (!asset.mediaType || !backgroundMediaTypes.has(asset.mediaType)) throw new Error('User background must be a supported raster image')
      return mutate(input.expectedVersion, 'application.addUserBackground', content => {
        content.backgrounds.push({ id: ctx.createId('user-background'), name: input.name, assetId: input.assetId })
      }, context)
    },
    removeUserBackground: async (input: RemoveUserBackgroundInput, context?: RuntimeRequestContext) => mutate(
      input.expectedVersion, 'application.removeUserBackground', content => {
        if (!content.backgrounds.some(background => background.id === input.backgroundId)) throw new Error(`User background not found: ${input.backgroundId}`)
        content.backgrounds = content.backgrounds.filter(background => background.id !== input.backgroundId)
      }, context,
    ),
  }
}
