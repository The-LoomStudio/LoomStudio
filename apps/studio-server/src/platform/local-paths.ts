import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type LoomStudioLocalPaths = {
  dataRoot: string
  databaseFile: string
  blobRoot: string
  extensionRoot: string
  extensionInstalledRoot: string
  extensionStateFile: string
  extensionDevLinksFile: string
  configRoot: string
  backupRoot: string
  cacheRoot: string
  extensionCacheRoot: string
  logRoot: string
}

export type ResolveLoomStudioLocalPathsOptions = {
  home?: string
  homeDirectory?: string
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
}

export function resolveLoomStudioLocalPaths(
  options: ResolveLoomStudioLocalPathsOptions = {},
): LoomStudioLocalPaths {
  const environment = options.environment ?? process.env
  const overrideHome = options.home ?? environment.LOOM_STUDIO_HOME
  let dataRoot: string
  let cacheRoot: string
  let logRoot: string

  if (overrideHome) {
    const root = resolve(overrideHome)
    dataRoot = join(root, 'data')
    cacheRoot = join(root, 'cache')
    logRoot = join(root, 'logs')
  } else {
    const userHome = options.homeDirectory ?? homedir()
    const platform = options.platform ?? process.platform
    const roots = resolvePlatformRoots(platform, userHome, environment)
    dataRoot = roots.dataRoot
    cacheRoot = roots.cacheRoot
    logRoot = roots.logRoot
  }

  const extensionRoot = join(dataRoot, 'extensions')
  return {
    dataRoot,
    databaseFile: join(dataRoot, 'studio.sqlite'),
    blobRoot: join(dataRoot, 'blobs'),
    extensionRoot,
    extensionInstalledRoot: join(extensionRoot, 'installed'),
    extensionStateFile: join(extensionRoot, 'state.json'),
    extensionDevLinksFile: join(extensionRoot, 'dev-links.json'),
    configRoot: join(dataRoot, 'config'),
    backupRoot: join(dataRoot, 'backups'),
    cacheRoot,
    extensionCacheRoot: join(cacheRoot, 'extensions'),
    logRoot,
  }
}

function resolvePlatformRoots(
  platform: NodeJS.Platform,
  userHome: string,
  environment: NodeJS.ProcessEnv,
): Pick<LoomStudioLocalPaths, 'dataRoot' | 'cacheRoot' | 'logRoot'> {
  if (platform === 'darwin') {
    return {
      dataRoot: join(userHome, 'Library', 'Application Support', 'LoomStudio'),
      cacheRoot: join(userHome, 'Library', 'Caches', 'LoomStudio'),
      logRoot: join(userHome, 'Library', 'Logs', 'LoomStudio'),
    }
  }

  if (platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA ?? join(userHome, 'AppData', 'Local')
    const root = join(localAppData, 'LoomStudio')
    return {
      dataRoot: root,
      cacheRoot: join(root, 'Cache'),
      logRoot: join(root, 'Logs'),
    }
  }

  return {
    dataRoot: join(environment.XDG_DATA_HOME ?? join(userHome, '.local', 'share'), 'loom-studio'),
    cacheRoot: join(environment.XDG_CACHE_HOME ?? join(userHome, '.cache'), 'loom-studio'),
    logRoot: join(environment.XDG_STATE_HOME ?? join(userHome, '.local', 'state'), 'loom-studio', 'logs'),
  }
}
