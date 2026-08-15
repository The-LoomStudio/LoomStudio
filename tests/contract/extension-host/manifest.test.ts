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
})
