import { Folders, ListOrdered, Plug, Settings, SquareTerminal, Users, Wrench, type LucideIcon } from 'lucide-react'
import type { StudioPanelId } from './studio-layout-store.js'

export type StudioPanelLabelKey = 'rail.model' | 'rail.character' | 'rail.preset' | 'rail.resource' | 'rail.inspector' | 'rail.logs' | 'rail.settings'

export const STUDIO_PANEL_PRESENTATION = {
  model: { Icon: Plug, labelKey: 'rail.model' },
  character: { Icon: Users, labelKey: 'rail.character' },
  preset: { Icon: ListOrdered, labelKey: 'rail.preset' },
  resource: { Icon: Folders, labelKey: 'rail.resource' },
  inspector: { Icon: Wrench, labelKey: 'rail.inspector' },
  logs: { Icon: SquareTerminal, labelKey: 'rail.logs' },
  settings: { Icon: Settings, labelKey: 'rail.settings' },
} satisfies Record<StudioPanelId, { Icon: LucideIcon; labelKey: StudioPanelLabelKey }>
