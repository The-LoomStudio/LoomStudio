type ModelCatalogItem = {
  enabled: boolean
  id: string
}

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
