import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(join(root, 'packages/application-runtime/package.json'))
const { parse } = require('yaml')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const lock = parse(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'))
const destination = resolve(process.argv[2] ?? join(root, '.artifacts', `loom-studio-${manifest.version}`))
// A fresh directory prevents mixing stale code into a release or overwriting user data.
await mkdir(dirname(destination), { recursive: true })
await mkdir(destination)

const packages = new Map()
const paths = ['apps/studio-server', 'packages/extension-sdk/extension-host']
for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
  if (entry.isDirectory()) paths.push(`packages/${entry.name}`)
}
for (const path of paths) {
  if (!existsSync(join(root, path, 'package.json'))) continue
  const pkg = JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'))
  packages.set(pkg.name, { path, pkg })
}

const selected = new Map()
function include(name) {
  if (selected.has(name)) return
  const entry = packages.get(name)
  if (!entry) throw new Error(`Unknown runtime workspace: ${name}`)
  selected.set(name, entry)
  for (const [dependency, version] of Object.entries(entry.pkg.dependencies ?? {})) {
    if (version.startsWith('workspace:')) include(dependency)
  }
}
include('@loom-studio/studio-server')

const dependencies = {}
for (const [name, { path, pkg }] of selected) {
  await mkdir(join(destination, path), { recursive: true })
  await cp(join(root, path, 'dist'), join(destination, path, 'dist'), {
    recursive: true,
    filter: source => !source.endsWith('.tsbuildinfo'),
  })
  const runtimeManifest = {
    name: pkg.name, version: pkg.version, private: true, type: pkg.type,
    ...(pkg.main ? { main: pkg.main } : {}),
    ...(pkg.exports ? { exports: pkg.exports } : {}),
  }
  if (name === '@loom/core') delete runtimeManifest.exports['.'].development
  await writeFile(join(destination, path, 'package.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`)
  dependencies[name] = `file:${path}`
  for (const [dependency, specifier] of Object.entries(pkg.dependencies ?? {})) {
    if (specifier.startsWith('workspace:')) continue
    const locked = lock.importers[path]?.dependencies?.[dependency]?.version
    if (typeof locked !== 'string') throw new Error(`Missing locked runtime dependency: ${path} / ${dependency}`)
    const version = locked.split('(')[0]
    if (dependencies[dependency] && dependencies[dependency] !== version) {
      throw new Error(`Conflicting runtime dependency versions: ${dependency}`)
    }
    dependencies[dependency] = version
  }
}

for (const path of [
  'apps/studio-client/dist', 'official/starter', 'public/images/default-card.png',
  'scripts/start.mjs', 'start.sh', 'start.command', 'start.bat',
]) {
  await mkdir(dirname(join(destination, path)), { recursive: true })
  await cp(join(root, path), join(destination, path), { recursive: true })
}
await cp(join(root, 'apps/studio-server/src/banner.txt'), join(destination, 'apps/studio-server/dist/banner.txt'))
await cp(join(root, 'docs/guide/beta-release.md'), join(destination, 'README.md'))
await writeFile(join(destination, 'package.json'), `${JSON.stringify({
  name: 'loom-studio',
  version: manifest.version,
  private: true,
  type: 'module',
  loomStudioRelease: true,
  engines: { node: manifest.engines.node },
  scripts: { start: 'node scripts/start.mjs' },
  dependencies,
}, null, 2)}\n`)
const npm = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: destination,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (npm.error) throw npm.error
if (npm.status !== 0) throw new Error(`Release dependency lock generation failed (${npm.status})`)
if ((await stat(join(destination, 'apps/studio-client/dist/index.html'))).size === 0) throw new Error('Empty client entry')
console.log(`Release prepared: ${relative(root, destination)} (${selected.size} runtime workspaces)`)
