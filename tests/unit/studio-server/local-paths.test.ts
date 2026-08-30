import { describe, expect, it } from 'vitest'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'

describe('resolveLoomStudioLocalPaths', () => {
  it('collapses development paths under LOOM_STUDIO_HOME', () => {
    const paths = resolveLoomStudioLocalPaths({
      home: '/tmp/loom-home',
      environment: {},
    })

    expect(paths).toMatchObject({
      dataRoot: '/tmp/loom-home/data',
      databaseFile: '/tmp/loom-home/data/studio.sqlite',
      blobRoot: '/tmp/loom-home/data/blobs',
      extensionInstalledRoot: '/tmp/loom-home/data/extensions/installed',
      cacheRoot: '/tmp/loom-home/cache',
      extensionCacheRoot: '/tmp/loom-home/cache/extensions',
      logRoot: '/tmp/loom-home/logs',
    })
  })

  it('uses macOS native roots by default', () => {
    const paths = resolveLoomStudioLocalPaths({
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      environment: {},
    })

    expect(paths.dataRoot).toBe('/Users/tester/Library/Application Support/LoomStudio')
    expect(paths.cacheRoot).toBe('/Users/tester/Library/Caches/LoomStudio')
    expect(paths.logRoot).toBe('/Users/tester/Library/Logs/LoomStudio')
  })

  it('uses XDG roots on Linux', () => {
    const paths = resolveLoomStudioLocalPaths({
      platform: 'linux',
      homeDirectory: '/home/tester',
      environment: {
        XDG_DATA_HOME: '/data',
        XDG_CACHE_HOME: '/cache',
        XDG_STATE_HOME: '/state',
      },
    })

    expect(paths.dataRoot).toBe('/data/loom-studio')
    expect(paths.cacheRoot).toBe('/cache/loom-studio')
    expect(paths.logRoot).toBe('/state/loom-studio/logs')
  })
})
