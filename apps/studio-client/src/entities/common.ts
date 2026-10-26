import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'

export type JsonObject = { [key: string]: ClientJsonValue }

export type MutationReceipt = {
  changesetId: string
}
