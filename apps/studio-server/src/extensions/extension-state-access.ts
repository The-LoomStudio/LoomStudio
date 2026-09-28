import type { NarrativeStore } from '@loom-studio/application-data'
import type { ExtensionInstallationTarget } from '@loom-studio/application-runtime'

export async function canAccessExtensionState(
  narratives: Pick<NarrativeStore, 'getTimeline'> | undefined,
  installation: ExtensionInstallationTarget,
  target: { scope: 'global' } | { scope: 'timeline'; timelineId: string },
): Promise<boolean> {
  if (installation.kind === 'global') return true
  if (target.scope === 'global') return false
  const timeline = await narratives?.getTimeline(target.timelineId)
  return Boolean(timeline && !timeline.deletedAt && timeline.createdFrom?.cardId === installation.cardId)
}
