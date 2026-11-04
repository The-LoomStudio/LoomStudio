import { resolve, join } from 'node:path'

export function developmentDataEnvironment(repositoryRoot, environment = process.env) {
  const home = environment.LOOM_STUDIO_HOME ?? resolve(repositoryRoot, '.loomstudio-dev')
  const dataRoot = environment.LOOM_STUDIO_DATA_ROOT
    ?? (environment.LOOM_STUDIO_HOME ? join(resolve(home), 'data') : join(repositoryRoot, 'data'))
  return { ...environment, LOOM_STUDIO_HOME: home, LOOM_STUDIO_DATA_ROOT: resolve(dataRoot) }
}
