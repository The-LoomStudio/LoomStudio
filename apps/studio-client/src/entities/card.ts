import type { JsonObject, MutationReceipt } from './common.js'

export type Card = {
  id: string
  version: number
  name: string
  userName?: string
  description?: string
  importBundleId?: string
  portableExtensionPayloadIds?: string[]
  promptResourceIds?: string[]
  stateDefinitionIds?: string[]
  timelineStateBindings?: Array<{ path: string; templateId: string; templateVersion: number; initial?: JsonObject }>
  media?: CardMedia
  preset?: {
    system?: string
  }
  opening: {
    entries: Array<{ role: 'user' | 'assistant'; content: string }>
  }
  settingLayer: {
    entries: Array<{
      id?: string
      path?: string
      title?: string
      content: string
      enabled?: boolean
      activation?: JsonObject
      tags?: string[]
    }>
  }
  createdAt: string
  updatedAt: string
}

export type CardMedia = {
  avatarAssetId?: string
  coverAssetId?: string
}

export type CardSummary = Pick<Card,
  'id' | 'version' | 'name' | 'userName' | 'description' | 'media' | 'createdAt' | 'updatedAt'
>

export type CardPresetInput = {
  system?: string
}

export type OpeningChatInput = {
  entries?: Array<{ role?: 'user' | 'assistant'; content: string }>
}

export type SettingLayerInput = {
  entries?: Array<{
    id?: string
    path?: string
    title?: string
    content: string
    enabled?: boolean
    activation?: JsonObject
    tags?: string[]
  }>
}

export type CreateCardResult = {
  card: Card
  mutation: MutationReceipt
}

export type ListCardsResult = {
  cards: CardSummary[]
  nextCursor?: string
}

export type GetCardResult = {
  card: Card
}

export type UpdateCardResult = {
  card: Card
  mutation: MutationReceipt
}

export type DeleteCardResult = {
  deleted: true
  mutation: MutationReceipt
}

export type PreviewCardDeletionResult = {
  cardId: string
  timelines: Array<{ id: string; title?: string }>
  extensionData: {
    cardScoped: { configs: number; records: number }
    timelineScoped: { configs: number; records: number }
  }
  textTransformRuleIds: string[]
}
