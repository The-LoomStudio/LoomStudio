import {
  playerEntity, playerEntityType, playerProfileComponentKey, playerProfilePath, playerProfileTemplateId,
  type PlayerProfileState, type StateContribution,
} from '@loom-studio/shared'
import type { TimelineRuntimeContextContent } from '../types.js'

export function hasPlayerProfile(context: TimelineRuntimeContextContent | undefined): boolean {
  return context?.stateBindings.some(binding => binding.path === playerProfilePath) ?? false
}

export function createPlayerStateContribution(profile: PlayerProfileState): StateContribution {
  return {
    id: 'loom.player',
    entityTypes: [structuredClone(playerEntityType)],
    entities: [structuredClone(playerEntity)],
    templates: [{
      id: playerProfileTemplateId, templateVersion: 1, componentKey: playerProfileComponentKey,
      targetEntityTypeIds: [playerEntityType.id], label: '玩家资料',
      schema: { type: 'object', required: ['name', 'description'], additionalProperties: false,
        properties: { name: { type: 'string' }, description: { type: 'string' }, avatarAssetId: { type: 'string' } } },
      initial: { ...profile },
    }],
    componentMounts: [{ templateId: playerProfileTemplateId, templateVersion: 1,
      componentKey: playerProfileComponentKey, target: { kind: 'entity', entity: structuredClone(playerEntity) } }],
    bindings: [],
  }
}

/** Author resources reference built-ins; only the application declares them. */
export function assertAuthorPlayerState(contribution: StateContribution): void {
  const overlaps = (path: string, reserved: string) => {
    const segments = path.split('.')
    const reservedSegments = reserved.split('.')
    return segments.slice(0, Math.min(segments.length, reservedSegments.length))
      .every((segment, index) => segment === '*' || segment === reservedSegments[index])
  }
  if (contribution.entityTypes.some(type => type.id === playerEntityType.id || overlaps(type.collectionPath, '$loom'))
    || contribution.entities.some(entity => entity.typeId === playerEntityType.id)
    || contribution.templates.some(template => template.id === playerProfileTemplateId || template.componentKey === playerProfileComponentKey)
    || contribution.componentMounts.some(mount => mount.componentKey === playerProfileComponentKey
      && (mount.target.kind === 'entity-type' ? mount.target.typeId === playerEntityType.id
        : mount.target.entity.typeId === playerEntity.typeId && mount.target.entity.entityId === playerEntity.entityId))
    || contribution.bindings.some(binding => overlaps(binding.path, playerProfilePath))) {
    throw new Error('Application player Entity and profile component are reserved; mount your own components instead')
  }
}
