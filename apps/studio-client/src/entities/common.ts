import type { ClientJsonValue } from '@loom-studio/client-bridge'

export type JsonObject = { [key: string]: ClientJsonValue }

export type MutationReceipt = {
  changesetId: string
}
