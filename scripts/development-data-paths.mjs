import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

export function developmentDataEnvironment(repositoryRoot, environment = process.env) {
  const home = environment.LOOM_STUDIO_HOME ?? resolve(repositoryRoot, '.loomstudio-dev')
  const dataRoot = environment.LOOM_STUDIO_DATA_ROOT
    ?? (environment.LOOM_STUDIO_HOME ? join(resolve(home), 'data') : join(repositoryRoot, 'data'))
  return { ...environment, LOOM_STUDIO_HOME: home, LOOM_STUDIO_DATA_ROOT: resolve(dataRoot) }
}

export function assertDevelopmentDataReady(repositoryRoot, environment = process.env) {
  if (environment.LOOM_STUDIO_HOME || environment.LOOM_STUDIO_DATA_ROOT) return
  const source = resolve(repositoryRoot, '.loomstudio-dev/data')
  const target = resolve(repositoryRoot, 'data')
  if (!existsSync(join(source, 'studio.sqlite'))) return
  const receiptFile = join(target, '.loom/data-migration.json')
  if (existsSync(receiptFile)) {
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'))
    if (receipt.version === 1 && receipt.source === source && receipt.target === target
      && existsSync(join(target, 'studio.sqlite'))) return
    throw new Error('Data migration receipt does not match the development data directories.')
  }
  throw new Error(
    'Existing development data requires an explicit offline migration. Stop LS, run "pnpm data:migrate" to inspect, then "pnpm data:migrate --apply". '
    + 'To keep using the old directory for now, explicitly set LOOM_STUDIO_HOME=.loomstudio-dev.',
  )
}
