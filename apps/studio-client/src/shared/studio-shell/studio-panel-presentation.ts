import { Brain, Blocks, BookOpen, Bot, Braces, Clock3, FolderGit2, ListOrdered, Plug, Regex, Settings, SlidersHorizontal, SquareTerminal, UserRound, Users, Wrench, type LucideIcon } from 'lucide-react'
import type { StudioPanelId } from './studio-layout-store.js'

export type StudioPanelLabelKey = 'rail.model' | 'rail.agent' | 'rail.user' | 'rail.play' | 'rail.recent' | 'rail.sessions' | 'rail.character' | 'rail.preset' | 'rail.lore' | 'rail.memory' | 'rail.state' | 'rail.macro' | 'rail.textTransform' | 'rail.inspector' | 'rail.logs' | 'rail.extensions' | 'rail.settings'
export type StudioPanelKeywordsKey = `search.keywords.${StudioPanelId}`

export const STUDIO_PANEL_PRESENTATION = {
  model: { Icon: Plug, labelKey: 'rail.model', keywordsKey: 'search.keywords.model' },
  agent: { Icon: Bot, labelKey: 'rail.agent', keywordsKey: 'search.keywords.agent' },
  user: { Icon: UserRound, labelKey: 'rail.user', keywordsKey: 'search.keywords.user' },
  play: { Icon: Users, labelKey: 'rail.play', keywordsKey: 'search.keywords.play' },
  recent: { Icon: Clock3, labelKey: 'rail.recent', keywordsKey: 'search.keywords.recent' },
  sessions: { Icon: FolderGit2, labelKey: 'rail.sessions', keywordsKey: 'search.keywords.sessions' },
  character: { Icon: Users, labelKey: 'rail.character', keywordsKey: 'search.keywords.character' },
  preset: { Icon: ListOrdered, labelKey: 'rail.preset', keywordsKey: 'search.keywords.preset' },
  resource: { Icon: BookOpen, labelKey: 'rail.lore', keywordsKey: 'search.keywords.resource' },
  memory: { Icon: Brain, labelKey: 'rail.memory', keywordsKey: 'search.keywords.memory' },
  state: { Icon: SlidersHorizontal, labelKey: 'rail.state', keywordsKey: 'search.keywords.state' },
  macro: { Icon: Braces, labelKey: 'rail.macro', keywordsKey: 'search.keywords.macro' },
  'text-transform': { Icon: Regex, labelKey: 'rail.textTransform', keywordsKey: 'search.keywords.text-transform' },
  inspector: { Icon: Wrench, labelKey: 'rail.inspector', keywordsKey: 'search.keywords.inspector' },
  logs: { Icon: SquareTerminal, labelKey: 'rail.logs', keywordsKey: 'search.keywords.logs' },
  extensions: { Icon: Blocks, labelKey: 'rail.extensions', keywordsKey: 'search.keywords.extensions' },
  settings: { Icon: Settings, labelKey: 'rail.settings', keywordsKey: 'search.keywords.settings' },
} satisfies Record<StudioPanelId, { Icon: LucideIcon; labelKey: StudioPanelLabelKey; keywordsKey: StudioPanelKeywordsKey }>
