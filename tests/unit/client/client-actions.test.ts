import { describe, expect, it } from 'vitest'
import type { ManagedExtensionPackage } from '../../../apps/studio-client/src/entities/index.js'
import { listClientActions } from '../../../apps/studio-client/src/features/extension-renderers/model/client-actions.js'

function extensionPackage(): ManagedExtensionPackage {
  return {
    packageId: 'example.actions',
    version: '0.0.0',
    displayName: 'Actions',
    tags: [],
    available: true,
    sourceKinds: ['test'],
    modules: [{
      packageId: 'example.actions',
      moduleId: 'client',
      runtimeKind: 'client',
      entryUrl: '/extension.js',
      desired: { enabled: true },
      contributions: {
        commands: [
          { id: 'second', title: 'Second' },
          { id: 'first', title: 'First' },
        ],
        actions: [
          { commandId: 'second', surface: 'composer.quick-actions', suggestedOrder: 20 },
          { commandId: 'first', surface: 'composer.quick-actions', suggestedOrder: -10, when: { active: 'timeline' } },
          { commandId: 'first', surface: 'extension.workbench.actions' },
        ],
      },
    }],
  }
}

describe('Client Action projection', () => {
  it('filters by surface and active context, then applies stable author ordering', () => {
    const packages = [extensionPackage()]
    expect(listClientActions({
      packages,
      surface: 'composer.quick-actions',
      context: { sourceSurface: 'composer.quick-actions', workspaceId: 'workspace' },
    }).map(action => action.command.id)).toEqual(['second'])
    expect(listClientActions({
      packages,
      surface: 'composer.quick-actions',
      context: { sourceSurface: 'composer.quick-actions', workspaceId: 'workspace', timelineId: 'timeline-1' },
    }).map(action => action.command.id)).toEqual(['first', 'second'])
  })

  it('does not project actions from disabled modules', () => {
    const disabled = extensionPackage()
    disabled.modules[0]!.desired.enabled = false
    expect(listClientActions({
      packages: [disabled],
      surface: 'extension.workbench.actions',
      context: { sourceSurface: 'extension.workbench.actions', workspaceId: 'workspace' },
    })).toEqual([])
  })
})
