import type { JsonObject } from './index.js'
import type { StateEntityId, StateEntityType } from './state-contribution.js'

export type PlayerProfileState = {
  name: string
  description: string
  avatarAssetId?: string
}

export const playerEntityType: StateEntityType = { id: 'loom-player', collectionPath: '$loom.players', label: '玩家' }
export const playerEntity: StateEntityId = { typeId: playerEntityType.id, entityId: 'User' }
export const playerProfileComponentKey = 'loom_profile'
export const playerProfileTemplateId = 'loom.player-profile'
export const playerEntityPath = `${playerEntityType.collectionPath}.${playerEntity.entityId}`
export const playerProfilePath = `${playerEntityPath}.components.${playerProfileComponentKey}`

export function readPlayerProfile(snapshot: JsonObject): PlayerProfileState {
  let value: unknown = snapshot
  for (const segment of playerProfilePath.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, segment)) {
      throw new Error('Timeline player profile is missing')
    }
    value = (value as Record<string, unknown>)[segment]
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Timeline player profile')
  const profile = value as Record<string, unknown>
  if (typeof profile.name !== 'string' || typeof profile.description !== 'string'
    || (profile.avatarAssetId !== undefined && typeof profile.avatarAssetId !== 'string')) {
    throw new Error('Invalid Timeline player profile')
  }
  return { name: profile.name.trim() || 'User', description: profile.description,
    ...(typeof profile.avatarAssetId === 'string' ? { avatarAssetId: profile.avatarAssetId } : {}) }
}
