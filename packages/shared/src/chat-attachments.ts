import { z } from 'zod'

export const chatAttachmentSchema = z.strictObject({
  assetId: z.string().min(1).max(255),
  name: z.string().min(1).max(1024),
  mediaType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  kind: z.enum(['image', 'text']),
})
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>

export function readChatAttachments(value: unknown): ChatAttachment[] | undefined {
  return value === undefined ? undefined : z.array(chatAttachmentSchema).max(20).parse(value)
}

export function sameChatAttachments(left: readonly ChatAttachment[] = [], right: readonly ChatAttachment[] = []): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]!
    return item.assetId === other.assetId && item.name === other.name && item.mediaType === other.mediaType
      && item.sizeBytes === other.sizeBytes && item.kind === other.kind
  })
}
