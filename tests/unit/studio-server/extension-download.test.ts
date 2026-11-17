import { describe, expect, it } from 'vitest'
import { downloadExtensionZip, isPublicAddress, parseDownloadSource, satisfiesExtensionVersion } from '@loom-studio/kernel/extension-manager'

describe('extension source boundaries', () => {
  it('accepts public HTTPS sources across Git providers and rejects credentials or unsafe refs', () => {
    expect(parseDownloadSource({ kind: 'git', url: 'https://gitlab.com/team/project.git', ref: 'feature/next' })).toMatchObject({ ref: 'feature/next' })
    expect(parseDownloadSource({ kind: 'git', url: 'https://codeberg.org/team/project.git' })).toMatchObject({ kind: 'git' })
    for (const url of ['file:///tmp/package', 'ssh://git@example.com/repo', 'https://user:secret@example.com/repo']) {
      expect(() => parseDownloadSource({ kind: 'git', url })).toThrow()
    }
    expect(() => parseDownloadSource({ kind: 'git', url: 'https://example.com/repo', ref: '--upload-pack=bad' })).toThrow()
    expect(() => parseDownloadSource({ kind: 'git', url: 'https://example.com/repo', ref: '../main' })).toThrow()
  })
  it('blocks local and private ZIP endpoints before making a request', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1']) expect(isPublicAddress(address)).toBe(false)
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    await expect(downloadExtensionZip({ kind: 'zip', url: 'https://127.0.0.1/package.zip' })).rejects.toThrow('private network')
  })
  it('uses version constraints rather than URL equality as a version check', () => {
    expect(satisfiesExtensionVersion('1.3.0', '^1.0.0')).toBe(true)
    expect(satisfiesExtensionVersion('2.0.0', '^1.0.0')).toBe(false)
    expect(() => satisfiesExtensionVersion('1.0.0', 'not-a-range')).toThrow('Invalid')
  })
})
