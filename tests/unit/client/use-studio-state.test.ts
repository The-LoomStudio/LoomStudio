import { describe, expect, it } from 'vitest'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { readHistoryAssetTarget } from '../../../apps/studio-client/src/app/use-studio-state.js'

const nodes: ContextAssetNode[] = [
  {
    id: 'resource-root',
    kind: 'module',
    label: 'Resources',
    category: 'setting',
    children: [{ id: 'resource-entry', kind: 'entry', label: 'Entry', category: 'setting' }],
  },
  { id: 'preset-root', kind: 'module', label: 'Preset', category: 'preset' },
]

describe('history asset target', () => {
  it('maps restored assets to their persisted workspace selection', () => {
    expect(readHistoryAssetTarget(nodes, 'resource-entry')).toEqual({ assetId: 'resource-entry', layoutId: 'resources' })
    expect(readHistoryAssetTarget(nodes, 'preset-root')).toEqual({ assetId: 'preset-root', layoutId: 'preset' })
  })

  it('uses the resource root when the previous subject no longer exists', () => {
    expect(readHistoryAssetTarget(nodes, 'deleted-entry', 'resource-root')).toEqual({ assetId: 'resource-root', layoutId: 'resources' })
  })
})
