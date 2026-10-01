import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error('Loom Studio requires Node.js 22.18 or newer. Install Node.js, then start again.')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

try {
  if (!existsSync(join(root, 'node_modules'))) {
    if (manifest.loomStudioRelease) run('npm', ['ci', '--omit=dev'])
    else run('npm', ['exec', '--yes', '--package=pnpm@9.15.0', '--', 'pnpm', 'install', '--frozen-lockfile'])
  }
  if (!existsSync(join(root, 'apps/studio-server/dist/main.js'))
    || !existsSync(join(root, 'apps/studio-client/dist/index.html'))) {
    if (manifest.loomStudioRelease) throw new Error('Release files are incomplete. Download and extract the full release again.')
    run('npm', ['exec', '--yes', '--package=pnpm@9.15.0', '--', 'pnpm', 'build:app'])
  }
  process.env.NODE_ENV = 'production'
  const { main } = await import('../apps/studio-server/dist/main.js')
  await main()
} catch (error) {
  console.error(`Loom Studio could not start: ${error.message}`)
  if (error.code === 'EADDRINUSE') console.error('The port is in use. Stop the other instance, or set PORT to another port.')
  process.exitCode = 1
}
