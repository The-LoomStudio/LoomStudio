import type { JsonValue } from '@loom-studio/shared'

export type DocumentRecord<T = JsonValue> = {
  id: string
  type: string
  version: number
  content: T
  meta: {
    createdAt: string
    updatedAt: string
    ownerExtensionId?: string
  }
}

export type DocumentStore = {
  get(id: string): Promise<DocumentRecord | null>
}
