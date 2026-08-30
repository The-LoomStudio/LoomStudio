import { parseExtensionManifest } from '@loom-studio/extension-host'
import { describe, expect, it } from 'vitest'

describe('extension manifest contract', () => {
  it('validates required manifest fields', () => {
    expect(() => parseExtensionManifest({ manifestVersion: 2 })).toThrow('Manifest id is required')
  })

  it('requires runtime contributions to use the package namespace', () => {
    const base = {
      manifestVersion: 2,
      id: 'example.secure',
      version: '0.0.0',
      displayName: 'Secure',
      engines: { studio: '^0.1.0' },
    } as const

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'server',
        runtime: 'server',
        entry: './dist/index.js',
        contributes: { rpc: [{ name: 'other.package.call' }] },
      }],
    })).toThrow('Manifest RPC must use package namespace')

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'server',
        runtime: 'server',
        entry: './dist/index.js',
        contributes: { documentTypes: [{ type: 'other.package.note' }] },
      }],
    })).toThrow('Manifest document type must use package namespace')
  })

  it('rejects package identities in Studio-reserved namespaces', () => {
    expect(() => parseExtensionManifest({
      manifestVersion: 2,
      id: 'application.custom',
      version: '0.0.0',
      displayName: 'Reserved',
      engines: { studio: '^0.1.0' },
    })).toThrow('reserved Studio namespace')
  })

  it('validates static Package presentation metadata', () => {
    const manifest = parseExtensionManifest({
      manifestVersion: 2,
      id: 'example.presented',
      version: '1.0.0',
      displayName: 'Presented',
      description: 'A presented extension.',
      icon: './icon.png',
      author: 'Loom Studio',
      homepage: 'https://example.com/extension',
      repository: 'https://github.com/example/extension',
      tags: ['prompt', 'developer-tool'],
      engines: { studio: '^0.1.0' },
    })
    expect(manifest.tags).toEqual(['prompt', 'developer-tool'])

    expect(() => parseExtensionManifest({ ...manifest, roles: ['prompt'] })).toThrow('use tags')
    expect(() => parseExtensionManifest({ ...manifest, homepage: 'javascript:alert(1)' })).toThrow('HTTP(S)')
    expect(() => parseExtensionManifest({ ...manifest, icon: './icon.svg' })).toThrow('PNG, JPEG, WebP, or GIF')
    expect(() => parseExtensionManifest({ ...manifest, tags: ['prompt', 'prompt'] })).toThrow('unique')
  })

  it('validates client Renderer contributions and their surface scopes', () => {
    const base = {
      manifestVersion: 2,
      id: 'example.renderer',
      version: '0.0.0',
      displayName: 'Renderer',
      engines: { studio: '^0.1.0' },
    } as const
    const manifest = parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/index.js',
        contributes: {
          renderers: [{
            id: 'timeline-tail',
            name: 'Timeline Tail',
            surface: 'narrative.timeline.tail',
            instanceScope: 'timeline',
            adapter: 'shadow',
          }],
        },
      }],
    })
    expect(manifest.modules?.[0]?.contributes?.renderers?.[0]?.surface).toBe('narrative.timeline.tail')
    expect(manifest.modules?.[0]?.contributes?.renderers?.[0]?.adapter).toBe('shadow')

    expect(parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/index.js',
        contributes: { renderers: [{ id: 'background', name: 'Background', surface: 'shell.background', instanceScope: 'workspace' }] },
      }],
    }).modules?.[0]?.contributes?.renderers?.[0]?.surface).toBe('shell.background')

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'server',
        runtime: 'server',
        entry: './dist/index.js',
        contributes: { renderers: [{ id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' }] },
      }],
    })).toThrow('requires a client module')

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/index.js',
        contributes: { renderers: [{ id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'workspace' }] },
      }],
    })).toThrow('scope does not match surface')

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/index.js',
        contributes: { renderers: [{ id: 'background', name: 'Background', surface: 'shell.background', instanceScope: 'timeline' }] },
      }],
    })).toThrow('scope does not match surface')

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/index.js',
        contributes: { renderers: [{ id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline', adapter: 'unsafe-dom' }] },
      }],
    })).toThrow('adapter is invalid')
  })

  it('validates manifest-declared Client Commands and Action Placements', () => {
    const base = {
      manifestVersion: 2,
      id: 'example.commands',
      version: '0.0.0',
      displayName: 'Commands',
      engines: { studio: '^0.1.0' },
    } as const
    const manifest = parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/index.js',
        contributes: {
          commands: [{ id: 'toggle', title: 'Toggle', icon: 'sparkles' }],
          actions: [
            { commandId: 'toggle', surface: 'composer.quick-actions', suggestedOrder: 10 },
            { commandId: 'toggle', surface: 'extension.workbench.actions', group: 'primary' },
          ],
        },
      }],
    })
    expect(manifest.modules?.[0]?.contributes?.commands?.[0]?.id).toBe('toggle')
    expect(manifest.modules?.[0]?.contributes?.actions).toHaveLength(2)

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/index.js',
        contributes: {
          commands: [{ id: 'toggle', title: 'Toggle' }],
          actions: [{ commandId: 'missing', surface: 'composer.quick-actions' }],
        },
      }],
    })).toThrow('undeclared Command')

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'server',
        runtime: 'server',
        entry: './dist/index.js',
        contributes: { commands: [{ id: 'toggle', title: 'Toggle' }] },
      }],
    })).toThrow('requires a client module')

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/index.js',
        contributes: {
          commands: [{ id: 'toggle', title: 'Toggle' }],
          actions: [
            { commandId: 'toggle', surface: 'composer.quick-actions' },
            { commandId: 'toggle', surface: 'composer.quick-actions' },
          ],
        },
      }],
    })).toThrow('placement must be unique')
  })

  it('validates Package Prompt Resources and Agent Tool handlers', () => {
    const base = {
      manifestVersion: 2,
      id: 'example.capability-pack',
      version: '0.1.0',
      displayName: 'Capability Pack',
      engines: { studio: '^0.1.0' },
      contributes: {
        promptResources: [
          { id: 'setting', resourceKind: 'setting', source: './resources/setting.json' },
          {
            id: 'preset',
            resourceKind: 'preset',
            source: './resources/preset.json',
            settingMounts: [{ resourceId: 'setting' }],
            toolMounts: [
              { toolId: 'example.capability-pack/echo', defaultEnabled: true },
              { toolId: 'example.capability-pack/write', content: { zone: 'tools.content', slot: 'official' } },
            ],
          },
        ],
        agentTools: [
          { id: 'example.capability-pack/echo', source: './resources/echo.tool.json' },
          { id: 'example.capability-pack/write', source: './resources/write.tool.json' },
        ],
      },
    } as const
    const manifest = parseExtensionManifest({
      ...base,
      modules: [{
        id: 'server',
        runtime: 'server',
        entry: './dist/index.js',
        contributes: {
          agentToolHandlers: [
            { toolId: 'example.capability-pack/echo' },
            { toolId: 'example.capability-pack/write' },
          ],
        },
      }],
    })
    expect(manifest.contributes?.promptResources).toHaveLength(2)
    expect(manifest.modules?.[0]?.contributes?.agentToolHandlers).toHaveLength(2)

    expect(() => parseExtensionManifest({
      ...base,
      modules: [{
        id: 'client',
        runtime: 'client',
        entry: './dist/client.js',
        contributes: { agentToolHandlers: [{ toolId: 'example.capability-pack/echo' }] },
      }],
    })).toThrow('requires a server module')
    expect(() => parseExtensionManifest({
      ...base,
      contributes: {
        ...base.contributes,
        agentTools: [{ id: 'other.package/echo', source: './resources/echo.tool.json' }],
      },
    })).toThrow('must use package namespace')
  })
})
