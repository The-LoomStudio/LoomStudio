import type { MacroInspection } from '@loom-studio/shared'
import { useEffect, useState } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type UseMacroPreviewInput = {
  api: StudioApi['macros']
  branchId?: string
  cardId?: string
  cardVersion?: number
  key: string
  lastRunId?: string
  presetId?: string
  resourceRevision: unknown
  selections: Record<string, string>
  timelineId?: string
}

export function useMacroPreview(input: UseMacroPreviewInput) {
  const [refreshToken, setRefreshToken] = useState(0)
  const [preview, setPreview] = useState<{
    key: string
    inspection?: MacroInspection
    error?: string
    loading: boolean
  }>({ key: '', loading: false })

  useEffect(() => {
    let cancelled = false
    setPreview(current => ({ key: input.key, inspection: current.key === input.key ? current.inspection : undefined, loading: true }))
    void input.api.inspect({
      ...(input.timelineId
        ? { timelineTarget: { timelineId: input.timelineId, branchId: input.branchId } }
        : { cardId: input.cardId }),
      presetId: input.presetId,
      macroSelections: input.selections,
    }).then(result => {
      if (!cancelled) setPreview({ key: input.key, inspection: result.macroInspection, loading: false })
    }, error => {
      if (!cancelled) setPreview({ key: input.key, loading: false, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [input.api, input.branchId, input.cardId, input.cardVersion, input.key, input.lastRunId, input.presetId, input.resourceRevision, input.selections, input.timelineId, refreshToken])

  return {
    preview,
    refresh: () => setRefreshToken(current => current + 1),
  }
}
