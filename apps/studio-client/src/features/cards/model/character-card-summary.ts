export type CharacterCardSummary = {
  id: string
  artifactId?: string
  derivedFrom?: { artifactId: string }
  version: number
  name: string
  userName?: string
  description?: string
  validationError?: string
  media?: { avatarAssetId?: string; coverAssetId?: string }
  promptResourceIds?: string[]
  lore?: { entries: unknown[] }
  opening?: import('../../../entities/card.js').Card['opening']
  updatedAt?: string
}
