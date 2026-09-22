import type { StudioPanelId } from '../../shared/studio-shell/studio-layout-store.js'

export function resolveRailPresentation(activePanel: StudioPanelId | null, preferredWidth: number) {
  const resolvedPreferredWidth = preferredWidth < 96 ? 160 : preferredWidth
  const compact = activePanel !== null
  return {
    compact,
    preferredWidth: resolvedPreferredWidth,
    visibleWidth: compact ? 42 : resolvedPreferredWidth,
  }
}
