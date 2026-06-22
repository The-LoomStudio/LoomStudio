import { parseExtensionManifest } from '@loom-studio/extension-host'
import { describe, expect, it } from 'vitest'

describe('extension manifest contract', () => {
  it('validates required manifest fields', () => {
    expect(() => parseExtensionManifest({ manifestVersion: 1 })).toThrow('Manifest id is required')
  })
})
