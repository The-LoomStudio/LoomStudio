import { createId } from '@loom-studio/shared'
import { useEffect, useState } from 'react'
import type { CharacterCardSummary } from './character-card-summary.js'
import { notify } from '../../../shared/notifications/index.js'

type CardProfilePatch = { cardId: string; expectedVersion: number; name: string; userName: string; description: string; opening?: CharacterCardSummary['opening'] }

export function useCharacterProfileEditor({ selected, onUpdateCardProfile, refreshDetail, onRefreshCards }: {
  selected: CharacterCardSummary | undefined
  onUpdateCardProfile(patch: CardProfilePatch): Promise<unknown>
  refreshDetail(): Promise<unknown>
  onRefreshCards?(): Promise<unknown>
}) {
  const [nameDraft, setNameDraft] = useState('')
  const [authorDraft, setAuthorDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [activeOpeningIndex, setActiveOpeningIndex] = useState(0)
  const [openingDraft, setOpeningDraft] = useState('')
  const [openingTitleDraft, setOpeningTitleDraft] = useState('')

  const totalOpenings = 1 + (selected?.opening?.alternatives?.length ?? 0)
  const activeOpening = activeOpeningIndex === 0 ? selected?.opening : selected?.opening?.alternatives?.[activeOpeningIndex - 1]

  useEffect(() => {
    if (selected) {
      setNameDraft(selected.name ?? '')
      setAuthorDraft(selected.userName ?? '')
      setDescDraft(selected.description ?? '')
    }
  }, [selected?.id, selected?.version])

  useEffect(() => {
    setActiveOpeningIndex(0)
  }, [selected?.id])

  useEffect(() => {
    setOpeningDraft(activeOpening?.content ?? '')
    setOpeningTitleDraft(activeOpening?.title ?? '')
  }, [selected?.id, activeOpening])

  async function saveCardField(patch: Partial<{ name: string; userName: string; description: string; opening: CharacterCardSummary['opening'] }>) {
    if (!selected) return
    try {
      await onUpdateCardProfile({
        cardId: selected.id,
        expectedVersion: selected.version,
        name: patch.name ?? selected.name,
        userName: patch.userName ?? (selected.userName ?? ''),
        description: patch.description ?? (selected.description ?? ''),
        opening: patch.opening !== undefined ? patch.opening : selected.opening,
      })
      await refreshDetail()
      await onRefreshCards?.()
      return true
    } catch (err) {
      notify.failure('保存角色资料失败', err)
    }
  }

  async function handleOpeningBlur(field: 'content' | 'title' = 'content') {
    if (!selected?.opening || !activeOpening) return
    const value = field === 'content' ? openingDraft : openingTitleDraft
    if (value === (activeOpening[field] ?? '')) return
    const updated = { ...activeOpening, [field]: value }
    const updatedOpening = activeOpeningIndex === 0 ? updated : {
      ...selected.opening,
      alternatives: selected.opening.alternatives?.map(candidate => candidate.id === activeOpening.id ? updated : candidate),
    }
    await saveCardField({ opening: updatedOpening })
  }

  async function handleAddAlternative() {
    if (!selected?.opening) return
    const currentAlts = selected.opening.alternatives ?? []
    const newAlts = [...currentAlts, { id: createId(), content: '' }]
    const updatedOpening = {
      ...selected.opening,
      alternatives: newAlts,
    }
    if (await saveCardField({ opening: updatedOpening })) setActiveOpeningIndex(newAlts.length)
  }

  async function handleDeleteAlternative() {
    if (!selected?.opening || activeOpeningIndex === 0) return
    const altIdx = activeOpeningIndex - 1
    const currentAlts = selected.opening?.alternatives ?? []
    const newAlts = currentAlts.filter((_, idx) => idx !== altIdx)
    const updatedOpening = {
      ...selected.opening,
      alternatives: newAlts,
    }
    if (await saveCardField({ opening: updatedOpening })) setActiveOpeningIndex(prev => Math.max(0, prev - 1))
  }

  return { nameDraft, setNameDraft, authorDraft, setAuthorDraft, descDraft, setDescDraft, activeOpeningIndex, setActiveOpeningIndex, activeOpening, openingTitleDraft, setOpeningTitleDraft, openingDraft, setOpeningDraft, totalOpenings, saveCardField, handleOpeningBlur, handleAddAlternative, handleDeleteAlternative }
}
