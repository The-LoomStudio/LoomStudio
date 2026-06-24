import type { JsonObject } from './common.js'

export type Card = {
  id: string
  version: number
  name: string
  userName?: string
  description?: string
  preset?: {
    system?: string
  }
  opening: {
    entries: Array<{ role: 'user' | 'assistant'; content: string }>
  }
  setting?: JsonObject
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
}

export type CreateCardResult = {
  card: Card
}

export type ListCardsResult = {
  cards: Card[]
  nextCursor?: string
}

export type UpdateCardResult = {
  card: Card
}

export type DeleteCardResult = {
  deleted: true
}
