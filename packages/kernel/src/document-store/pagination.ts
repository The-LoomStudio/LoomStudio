import { DocumentStoreError, type ListDocumentsInput } from './types.js'

export function readDocumentPage(input?: ListDocumentsInput) {
  const limit = input?.limit ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new DocumentStoreError('document.input_invalid', 'Document page limit must be an integer between 1 and 1000')
  }
  const filters = [input?.type || null, input?.ownerExtensionId || null, Boolean(input?.includeTombstone),
    ...(input?.ownerInstallationId === undefined ? [] : [input.ownerInstallationId])] as const
  let after = 0
  if (input?.cursor !== undefined) {
    let cursor: unknown
    try {
      cursor = JSON.parse(input.cursor)
    } catch {
      throw new DocumentStoreError('document.input_invalid', 'Invalid Document cursor')
    }
    if (!Array.isArray(cursor) || cursor.length !== filters.length + 1
      || !Number.isSafeInteger(cursor[0]) || cursor[0] < 1
      || !filters.every((value, index) => value === cursor[index + 1])) {
      throw new DocumentStoreError('document.input_invalid', 'Document cursor is invalid or belongs to different filters')
    }
    after = cursor[0] as number
  }
  return {
    limit,
    after,
    cursor: (position: number) => JSON.stringify([position, ...filters]),
  }
}
