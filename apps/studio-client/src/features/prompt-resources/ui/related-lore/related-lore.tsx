import { useEffect, useState } from 'react'
import { Button, Toggle } from '@loom-studio/ui'
import type { LoreReference } from '@loom-studio/shared/loom-scripts'
import type { StudioApi } from '../../../../shared/api/studio-api.js'
import styles from './related-lore.module.scss'
import { findContextAssetNode } from '../../model/context-asset-tree.js'

type Resource = Awaited<ReturnType<StudioApi['promptResources']['get']>>['resource']
export function RelatedLore({ references, api, onNavigate, onChanged }: {
  references: readonly LoreReference[]
  api: Pick<StudioApi['promptResources'], 'get' | 'updateAsset'>
  onNavigate(path: string): void
  onChanged(): void | Promise<void>
}) {
  const [resources, setResources] = useState<Record<string, Resource>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string>()
  const key = JSON.stringify(references)
  useEffect(() => {
    let active = true
    setResources({}); setErrors({})
    for (const id of new Set(references.map(item => item.resourceId))) void api.get(id).then(result => {
      if (active) setResources(current => ({ ...current, [id]: result.resource }))
    }).catch(cause => { if (active) setErrors(current => ({ ...current, [id]: cause instanceof Error ? cause.message : String(cause) })) })
    return () => { active = false }
  }, [api, key])
  if (!references.length) return null
  return <details className={styles.root}>
    <summary>关联世界书</summary>
    <p>这里修改世界书条目本身的开关，会影响它的所有采用处；不会自动采用世界书。父级开关与触发条件仍然有效。</p>
    {[...new Map(references.map(ref => [JSON.stringify([ref.resourceId, ref.nodeId]), ref])).values()].map(ref => {
      const resource = resources[ref.resourceId]
      const node = resource && findContextAssetNode([resource.rootNode], ref.nodeId)
      const id = JSON.stringify(ref)
      return <div key={id} className={styles.item}>
        <Button variant="ghost" size="small" disabled={!node} onClick={() => onNavigate(`/studio/resources/reference/${encodeURIComponent(ref.resourceId)}/node/${encodeURIComponent(ref.nodeId)}`)}>{node ? node.id === resource!.rootNode.id ? node.label : `${resource!.rootNode.label} · ${node.label}` : `${ref.resourceId} / ${ref.nodeId}`}</Button>
        {node && <Toggle label={`启用 ${node.label}`} checked={node.enabled !== false} disabled={!!busy} onChange={async enabled => {
          setBusy(id)
          try {
            const result = await api.updateAsset({ resourceId: ref.resourceId, assetId: ref.nodeId, expectedVersion: resource!.version, enabled })
            setResources(current => ({ ...current, [ref.resourceId]: result.resource }))
            setErrors(current => { const next = { ...current }; delete next[ref.resourceId]; return next })
            await onChanged()
          } catch (cause) { setErrors(current => ({ ...current, [ref.resourceId]: cause instanceof Error ? cause.message : String(cause) })) }
          finally { setBusy(undefined) }
        }} />}
        {errors[ref.resourceId] ? <p role="alert">{errors[ref.resourceId]}</p> : !resource ? <p role="status">正在读取关联…</p> : !node ? <p role="alert">关联条目已不存在，请修正引用。</p> : null}
      </div>
    })}
  </details>
}
