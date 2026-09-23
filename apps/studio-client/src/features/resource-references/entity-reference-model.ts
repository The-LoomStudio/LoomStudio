import { formatEntityReference, type EntityReference } from '@loom-studio/shared'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { cardMediaUrl } from '../../shared/lib/card-media.js'

export type EntityReferenceView = { title: string; uri?: string; avatarUrl?: string; note?: string }

export async function loadEntityReference(api: StudioApi, reference: EntityReference): Promise<EntityReferenceView> {
  const { id, type } = reference
  if (type === 'card') {
    const { card } = await api.cards.get(id)
    return { title: card.name, uri: formatEntityReference({ kind: 'entity', type, id: card.id }), avatarUrl: cardMediaUrl(card.id, 'avatar', card.media?.avatarAssetId, card.version) }
  }
  if (type === 'timeline') {
    const { timeline } = await api.narratives.get(id)
    return { title: timeline.title ?? '剧情时间线', uri: formatEntityReference({ ...reference, id: timeline.id }) }
  }
  if (type === 'session') {
    const { session } = await api.agentSessions.get(id)
    return { title: session.title ?? 'Agent 会话', note: '此会话暂不支持直接定位；完整运行详情将由 Runs Inspector 承接。' }
  }
  if (type === 'run') return { title: '本次运行日志', uri: formatEntityReference(reference), note: '仅查询当前可用日志，不代表完整运行快照。' }
  if (type === 'resource') {
    const { resource } = await api.promptResources.get(id)
    const target = { kind: 'entity' as const, type, id: resource.id, nodeId: resource.rootNode.id }
    return { title: resource.rootNode.label, uri: formatEntityReference(target) }
  }
  if (type === 'extension') {
    const extension = (await api.extensions.list()).items.find(item => item.packageId === id)
    if (!extension) throw new Error('扩展已不存在或无法访问。')
    return { title: extension.displayName, uri: formatEntityReference(reference) }
  }
  // No direct provider lookup is exposed; do not claim a missing first-page entry was deleted.
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const result = await api.providerProfiles.list({ cursor, limit: 100 })
    const provider = result.providerProfiles.find(item => item.id === id)
    if (provider) return { title: provider.displayName, uri: formatEntityReference(reference), note: '打开模型管理；暂不支持定位具体提供方。' }
    if (!result.nextCursor) throw new Error('提供方已不存在或无法访问。')
    cursor = result.nextCursor
  }
  throw new Error('提供方查询达到范围上限，请在模型管理中查找。')
}
