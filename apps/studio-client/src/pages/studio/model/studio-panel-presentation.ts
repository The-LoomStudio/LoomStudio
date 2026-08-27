import { Bot, Braces, Folders, ListOrdered, Plug, Regex, Settings, SquareTerminal, Users, Waypoints, Wrench, type LucideIcon } from 'lucide-react'
import type { StudioPanelId } from './studio-layout-store.js'

export type StudioPanelLabelKey = 'rail.model' | 'rail.agent' | 'rail.sessions' | 'rail.character' | 'rail.preset' | 'rail.resource' | 'rail.state' | 'rail.textTransform' | 'rail.inspector' | 'rail.logs' | 'rail.settings'

export const STUDIO_PANEL_PRESENTATION = {
  model: { Icon: Plug, labelKey: 'rail.model' },
  agent: { Icon: Bot, labelKey: 'rail.agent' },
  sessions: { Icon: Waypoints, labelKey: 'rail.sessions' },
  character: { Icon: Users, labelKey: 'rail.character' },
  preset: { Icon: ListOrdered, labelKey: 'rail.preset' },
  resource: { Icon: Folders, labelKey: 'rail.resource' },
  state: { Icon: Braces, labelKey: 'rail.state' },
  'text-transform': { Icon: Regex, labelKey: 'rail.textTransform' },
  inspector: { Icon: Wrench, labelKey: 'rail.inspector' },
  logs: { Icon: SquareTerminal, labelKey: 'rail.logs' },
  settings: { Icon: Settings, labelKey: 'rail.settings' },
} satisfies Record<StudioPanelId, { Icon: LucideIcon; labelKey: StudioPanelLabelKey }>
