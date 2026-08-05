export type ModelCatalogItem = {
  enabled: boolean
  id: string
}

export const mockModelCatalog = ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini']
// ponytail: 临时目录只验证 Model Catalog UI；Provider listModels RPC 落地后删除该常量。

export function mergeModelCatalog(enabledIds: string[], fetchedIds: string[], query: string): ModelCatalogItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const enabled = [...new Set(enabledIds)]
    .filter(id => id.toLocaleLowerCase().includes(normalizedQuery))
    .map(id => ({ enabled: true, id }))
  const enabledSet = new Set(enabledIds)
  const available = [...new Set(fetchedIds)]
    .filter(id => !enabledSet.has(id) && id.toLocaleLowerCase().includes(normalizedQuery))
    .map(id => ({ enabled: false, id }))

  return [...enabled, ...available]
}
