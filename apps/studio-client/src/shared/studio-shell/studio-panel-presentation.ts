import { Blocks, BookOpen, Bot, Braces, Clock3, FolderGit2, Folders, ListOrdered, Plug, Regex, Settings, SlidersHorizontal, SquareTerminal, UserRound, Users, Wrench, type LucideIcon } from 'lucide-react'
import type { StudioPanelId } from './studio-layout-store.js'

export type StudioPanelLabelKey = 'rail.model' | 'rail.agent' | 'rail.user' | 'rail.play' | 'rail.recent' | 'rail.sessions' | 'rail.character' | 'rail.preset' | 'rail.resource' | 'rail.state' | 'rail.macro' | 'rail.textTransform' | 'rail.inspector' | 'rail.logs' | 'rail.extensions' | 'rail.settings'

export const STUDIO_PANEL_PRESENTATION = {
  model: { Icon: Plug, labelKey: 'rail.model' },
  agent: { Icon: Bot, labelKey: 'rail.agent' },
  user: { Icon: UserRound, labelKey: 'rail.user' },
  play: { Icon: Users, labelKey: 'rail.play' },
  recent: { Icon: Clock3, labelKey: 'rail.recent' },
  sessions: { Icon: FolderGit2, labelKey: 'rail.sessions' },
  character: { Icon: Users, labelKey: 'rail.character' },
  preset: { Icon: ListOrdered, labelKey: 'rail.preset' },
  resource: { Icon: BookOpen, labelKey: 'rail.resource' },
  state: { Icon: SlidersHorizontal, labelKey: 'rail.state' },
  macro: { Icon: Braces, labelKey: 'rail.macro' },
  'text-transform': { Icon: Regex, labelKey: 'rail.textTransform' },
  inspector: { Icon: Wrench, labelKey: 'rail.inspector' },
  logs: { Icon: SquareTerminal, labelKey: 'rail.logs' },
  extensions: { Icon: Blocks, labelKey: 'rail.extensions' },
  settings: { Icon: Settings, labelKey: 'rail.settings' },
} satisfies Record<StudioPanelId, { Icon: LucideIcon; labelKey: StudioPanelLabelKey }>
