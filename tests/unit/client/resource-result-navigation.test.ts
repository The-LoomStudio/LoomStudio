import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { formatEntityReference } from '@loom-studio/shared'
import { StudioResourcePanels } from '../../../apps/studio-client/src/app/studio-resource-panels.js'

describe('Resource result navigation', () => {
  it.each(['preset', 'resource'] as const)('opens a new %s by its committed ID without relying on the old catalog', kind => {
    let current = true
    const navigation = {
      route: { panel: kind === 'preset' ? 'agent' : kind },
      searchParams: new URLSearchParams(),
      isCurrent: () => current,
      openUri: vi.fn(),
      openResource: vi.fn(),
    }
    const uiState = { setSelectedPresetId: vi.fn() }
    const panels = StudioResourcePanels({
      state: { api: {}, promptResourceDrafts: [], startup: { ready: () => true } }, uiState, navigation, assetWorkspaceId: 'workspace',
    } as unknown as Parameters<typeof StudioResourcePanels>[0])
    const props = (panels[kind](true) as ReactElement<{ onSelectResource(id: string): void }>).props
    props.onSelectResource('created')
    expect(navigation.openUri.mock.calls[0]?.[0]).toBe(formatEntityReference({ kind: 'entity', type: 'resource', id: 'created' }))
    expect(navigation.openResource).not.toHaveBeenCalled()
    navigation.openUri.mockClear()
    current = false
    props.onSelectResource('late')
    expect(navigation.openUri).not.toHaveBeenCalled()
    expect(uiState.setSelectedPresetId).not.toHaveBeenCalledWith('late')
  })
})
