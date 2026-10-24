import type { DocumentTransaction } from '@loom-studio/document-store'
import { applicationDocumentTypes } from '../foundation/document-types.js'

export type UserBackground = { id: string; name: string; assetId: string }
export type UserBackgroundsContent = { backgrounds: UserBackground[] }
export type UserBackgroundsConfig = UserBackgroundsContent & { version: number }
export type AddUserBackgroundInput = { expectedVersion: number; name: string; assetId: string }
export type RemoveUserBackgroundInput = { expectedVersion: number; backgroundId: string }

export const userBackgroundsDocumentId = 'user-backgrounds:global'

export async function readUserBackgrounds(documents: DocumentTransaction): Promise<UserBackgroundsConfig> {
  const record = await documents.get(userBackgroundsDocumentId)
  if (!record) return { backgrounds: [], version: 0 }
  if (record.type !== applicationDocumentTypes.userBackgrounds) throw new Error('Unexpected user backgrounds document type')
  return { ...record.content as UserBackgroundsContent, version: record.version }
}
