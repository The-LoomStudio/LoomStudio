import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { useAppearanceStore } from '../../../shared/studio-shell/appearance-store.js'

type Result = Awaited<ReturnType<StudioApi['userBackgrounds']['get']>>
export const userBackgroundKey = (id: string) => `user-background/${id}`
const imageTypes = ['image/png', 'image/apng', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']

export function useUserBackgrounds(api: StudioApi['userBackgrounds'], endpoint: string, t: Translator) {
  const client = useQueryClient()
  const key = ['user-backgrounds', endpoint] as const
  const query = useQuery({ queryKey: key, queryFn: () => api.get(), retry: false })
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function config() {
    const data = client.getQueryData<Result>(key)
    if (!data) throw new Error(t('appearance.backgroundLoadFailed'))
    return data.config
  }
  async function commit(result: Result) {
    await client.cancelQueries({ queryKey: key, exact: true })
    client.setQueryData<Result>(key, result)
  }
  async function run(operation: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError('')
    try { await operation() }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      void client.invalidateQueries({ queryKey: key })
    } finally { pending.current = false; setBusy(false) }
  }
  const backgrounds = (query.data?.config.backgrounds ?? []).map(background => ({
    ...background, key: userBackgroundKey(background.id), image: `/assets/${encodeURIComponent(background.assetId)}`,
  }))
  return {
    backgrounds, busy, loading: query.isPending, ready: !!query.data,
    error: error || (query.isError ? query.error.message : ''),
    refresh: () => { void query.refetch() },
    importFiles: (files: readonly File[]) => run(async () => {
      config()
      for (const file of files) {
        if (!imageTypes.includes(file.type) || file.size > 64 * 1024 * 1024) throw new Error(t('appearance.backgroundImageLimit'))
        const response = await fetch('/assets', { method: 'POST', headers: {
          'content-type': file.type, 'x-loom-asset-kind': 'background',
        }, body: file })
        const body = await response.json() as { asset?: { id?: unknown }; error?: { message?: string } }
        if (!response.ok || typeof body.asset?.id !== 'string') throw new Error(body.error?.message ?? t('appearance.backgroundUploadFailed'))
        const result = await api.add({ expectedVersion: config().version, name: file.name.replace(/\.[^.]+$/, '') || file.name, assetId: body.asset.id })
        await commit({ config: result.config })
      }
    }),
    remove: (id: string) => run(async () => {
      const result = await api.remove({ expectedVersion: config().version, backgroundId: id })
      await commit({ config: result.config })
      if (useAppearanceStore.getState().background?.id === userBackgroundKey(id)) useAppearanceStore.setState({ background: null })
    }),
  }
}
export type UserBackgroundLibrary = ReturnType<typeof useUserBackgrounds>
