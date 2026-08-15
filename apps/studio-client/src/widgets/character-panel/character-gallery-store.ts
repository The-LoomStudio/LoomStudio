import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeLocalStorage } from '../../shared/browser/safe-local-storage.js'

type CharacterGroup = {
  id: string
  name: string
  order: number
}

export type CharacterGroupFilter = 'ungrouped' | string | undefined

type CharacterGalleryState = {
  activeGroupId: CharacterGroupFilter
  assignments: Record<string, string | undefined>
  groupsOpen: boolean
  groups: CharacterGroup[]
  assignCards(cardIds: string[], groupId?: string): void
  createGroup(name: string): string | undefined
  deleteGroup(groupId: string): void
  removeCards(cardIds: string[]): void
  renameGroup(groupId: string, name: string): void
  setActiveGroup(groupId: CharacterGroupFilter): void
  setGroupsOpen(open: boolean): void
}

type PersistedCharacterGalleryState = Pick<CharacterGalleryState, 'activeGroupId' | 'assignments' | 'groups'>

const STORAGE_KEY = 'loom-character-gallery'
export function createDefaultCharacterGalleryState(): PersistedCharacterGalleryState {
  return { activeGroupId: undefined, assignments: {}, groups: [] }
}

export function sanitizeCharacterGalleryState(value: unknown): PersistedCharacterGalleryState {
  const defaults = createDefaultCharacterGalleryState()
  if (!isRecord(value)) return defaults

  const groups = Array.isArray(value.groups)
    ? value.groups.flatMap((group, index) => isRecord(group) && typeof group.id === 'string' && group.id && typeof group.name === 'string'
      ? [{ id: group.id, name: group.name.trim().slice(0, 40), order: Number.isFinite(group.order) ? Number(group.order) : index }]
      : [])
        .filter(group => group.name)
        .sort((left, right) => left.order - right.order)
    : []
  const groupIds = new Set(groups.map(group => group.id))
  const assignments: Record<string, string> = {}
  if (isRecord(value.assignments)) {
    for (const [cardId, groupId] of Object.entries(value.assignments)) {
      if (cardId && typeof groupId === 'string' && groupIds.has(groupId)) assignments[cardId] = groupId
    }
  }
  const activeGroupId = value.activeGroupId === 'ungrouped' || (typeof value.activeGroupId === 'string' && groupIds.has(value.activeGroupId))
    ? value.activeGroupId
    : undefined

  return { activeGroupId, assignments, groups }
}

export const useCharacterGalleryStore = create<CharacterGalleryState>()(
  persist(
    (set, get) => ({
      ...createDefaultCharacterGalleryState(),
      groupsOpen: false,
      assignCards: (cardIds, groupId) => set(state => {
        const validGroupId = groupId && state.groups.some(group => group.id === groupId) ? groupId : undefined
        const assignments = { ...state.assignments }
        for (const cardId of cardIds) {
          if (!cardId) continue
          if (validGroupId) assignments[cardId] = validGroupId
          else delete assignments[cardId]
        }
        return { assignments }
      }),
      createGroup: name => {
        const normalizedName = name.trim().slice(0, 40)
        if (!normalizedName) return undefined
        const id = createGroupId()
        set(state => ({ groups: [...state.groups, { id, name: normalizedName, order: state.groups.length }] }))
        return id
      },
      deleteGroup: groupId => set(state => ({
        activeGroupId: state.activeGroupId === groupId ? undefined : state.activeGroupId,
        assignments: Object.fromEntries(Object.entries(state.assignments).filter(([, assignedGroupId]) => assignedGroupId !== groupId)),
        groups: state.groups.filter(group => group.id !== groupId),
      })),
      removeCards: cardIds => set(state => ({
        assignments: Object.fromEntries(Object.entries(state.assignments).filter(([cardId]) => !cardIds.includes(cardId))),
      })),
      renameGroup: (groupId, name) => {
        const normalizedName = name.trim().slice(0, 40)
        if (!normalizedName || !get().groups.some(group => group.id === groupId)) return
        set(state => ({ groups: state.groups.map(group => group.id === groupId ? { ...group, name: normalizedName } : group) }))
      },
      setActiveGroup: activeGroupId => set(state => ({
        activeGroupId: activeGroupId === 'ungrouped' || state.groups.some(group => group.id === activeGroupId) ? activeGroupId : undefined,
      })),
      setGroupsOpen: groupsOpen => set({ groupsOpen }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
      merge: (persisted, current) => ({ ...current, ...sanitizeCharacterGalleryState(persisted) }),
      partialize: state => ({
        activeGroupId: state.activeGroupId,
        assignments: state.assignments,
        groups: state.groups,
      }),
    },
  ),
)

function createGroupId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
