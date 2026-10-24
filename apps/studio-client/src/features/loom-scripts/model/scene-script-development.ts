import initialSource from '../../../../../../docs/architecture/extensions/examples/scene-background-card.loom.js?raw'

export const sceneScriptMetadataId = 'example.scene-background-card'
let source = initialSource
let revision = 0
const mounts = new Set<string>()
const listeners = new Set<() => void>()
function emit() { revision++; for (const listener of listeners) listener() }
export const sceneScriptDevelopment = {
  source: () => source,
  revision: () => revision,
  enabled: (mountId: string) => mounts.has(mountId),
  setEnabled(mountId: string, enabled: boolean) {
    if (!import.meta.env.DEV) return
    if (enabled) mounts.add(mountId)
    else mounts.delete(mountId)
    emit()
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  overrides: () => new Map([...mounts].map(id => [id, source])),
}

if (import.meta.hot) {
  import.meta.hot.accept('../../../../../../docs/architecture/extensions/examples/scene-background-card.loom.js?raw', next => {
    if (!next) return
    source = next.default
    emit()
  })
}
