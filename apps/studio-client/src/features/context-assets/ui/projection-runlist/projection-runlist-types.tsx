import type { DragEvent, ReactNode } from 'react'
import { Bot, Code2, Cog, Diamond, History, UserRound } from 'lucide-react'
import type { PromptCompositionItem, PromptMessageBlock } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import type { ProjectionOrderEntry, ProjectionZoneDefinition } from '../../model/projection-order.js'
import type { ProviderToolSurfaceItem } from '../../model/preset-tool-projection.js'
import styles from './projection-runlist.module.scss'

export type DragTarget = { id: string; type: 'row' | 'zone' | 'block' }
export type CompositionDropTarget = { id: string; position: 'before' | 'after' | 'inside' }
export type ProjectionDropTarget = CompositionDropTarget & { valid: boolean }

export function hideNativeDragPreview(event: DragEvent<HTMLElement>): void {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setDragImage(canvas, 0, 0)
}

export type ProjectionRunlistProps = {
  compositionItems?: PromptCompositionItem[]
  entries: ProjectionOrderEntry[]
  providerTools?: ProviderToolSurfaceItem[]
  onSelectProviderTool?: (toolId: string) => void
  onReorder?: (draggedId: string, targetId: string) => void
  onReorderZone?: (draggedZoneId: string, targetZoneId: string) => void
  onSelect?: (id: string) => void
  selectedId?: string
  selectedProviderToolId?: string
  selectedZoneId?: string
  showSummary?: boolean
  t: Translator
  zoneDefinitions?: ProjectionZoneDefinition[]
  onSelectZone?: (zoneId: string) => void
  onDeleteNode?: (id: string) => void
  onDuplicateNode?: (id: string) => void
  onToggleEnabled?: (id: string, enabled: boolean) => void
  onRename?: (id: string) => void
  onAddZone?: (afterZoneId?: string) => void
  onDeleteZone?: (zoneId: string) => void
  onAddEntryInZone?: (zoneId: string) => void
  onAddDirectEntry?: (blockId: string) => void
  onAddMessageBlock?: () => void
  onAddSlotToMessageBlock?: (blockId: string) => void
  onAddZoneToMessageBlock?: (blockId: string) => void
  onDeleteCompositionItem?: (id: string) => void
  onMoveCompositionItem?: (id: string, direction: 'up' | 'down') => void
  onDropCompositionItem?: (draggedId: string, targetId: string, position: CompositionDropTarget['position']) => void
}

export function messageRoleClass(role: PromptMessageBlock['role']): string {
  return role === 'system'
    ? styles.messageRoleSystem
    : role === 'developer'
      ? styles.messageRoleDeveloper
      : role === 'assistant'
        ? styles.messageRoleAssistant
        : styles.messageRoleUser
}

export function renderMessageRoleIcon(role: PromptMessageBlock['role']): ReactNode {
  if (role === 'system') return <Cog aria-hidden="true" />
  if (role === 'developer') return <Code2 aria-hidden="true" />
  if (role === 'assistant') return <Bot aria-hidden="true" />
  return <UserRound aria-hidden="true" />
}

export function renderZoneIcon(zoneId: string): ReactNode {
  return zoneId === 'chat.history'
    ? <History className={styles.zoneIcon} aria-hidden="true" />
    : <Diamond className={styles.zoneIcon} aria-hidden="true" />
}
