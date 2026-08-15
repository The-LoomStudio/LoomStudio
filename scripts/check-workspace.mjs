import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPackage = readJson(resolve(repositoryRoot, 'package.json'))
const expectedPnpm = readPackageManagerVersion(rootPackage.packageManager)
const expectedNode = readFileSync(resolve(repositoryRoot, '.node-version'), 'utf8').trim()
const actualPnpm = runPnpm(['--version'])
const failures = []

check(process.versions.node === expectedNode, `Node ${expectedNode} is required; current ${process.versions.node}`)
check(actualPnpm === expectedPnpm, `pnpm ${expectedPnpm} is required; current ${actualPnpm}`)
check(readFileSync(resolve(repositoryRoot, '.nvmrc'), 'utf8').trim() === expectedNode, '.nvmrc must match .node-version')
checkNoFloatingVersions()
runPnpm(['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'])
runPnpm(['run', 'build:packages'])
await checkRuntimeExports()

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`)
  process.exit(1)
}

console.log('Workspace health check passed')

function checkNoFloatingVersions() {
  const workspaces = JSON.parse(runPnpm(['list', '-r', '--depth', '-1', '--json']))
  for (const workspace of workspaces) {
    const packageFile = resolve(workspace.path, 'package.json')
    const manifest = readJson(packageFile)
    const displayPath = workspace.path === repositoryRoot
      ? 'package.json'
      : `${workspace.path.slice(repositoryRoot.length + 1)}/package.json`
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        if (version === 'latest' || version === '*') failures.push(`${displayPath}: ${section}.${name} uses ${version}`)
      }
    }
  }
}

async function checkRuntimeExports() {
  const checks = [
    ['apps/studio-server', '@loom-studio/kernel', 'createKernel'],
    ['apps/studio-server', '@loom-studio/logging', 'createRootLogger'],
    ['apps/studio-client', '@loom-studio/client-bridge', 'createClientBridge'],
    ['apps/studio-client', '@loom-studio/logging', 'createRootLogger'],
    ['extensions/example-echo', '@loom-studio/extension-sdk', 'defineServerExtension'],
  ]

  for (const [consumer, packageName, exportName] of checks) {
    try {
      const packageJson = resolve(repositoryRoot, consumer, 'node_modules', packageName, 'package.json')
      check(existsSync(packageJson), `${consumer} is missing workspace link ${packageName}`)
      if (!existsSync(packageJson)) continue
      const module = await import(`${pathToFileURL(resolve(dirname(packageJson), readExportEntry(packageJson))).href}?workspace-check=${Date.now()}`)
      check(exportName in module, `${packageName} is missing runtime export ${exportName}`)
    } catch (error) {
      failures.push(`${consumer} cannot import ${packageName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function readExportEntry(packageJson) {
  const manifest = readJson(packageJson)
  const entry = typeof manifest.exports === 'string'
    ? manifest.exports
    : typeof manifest.exports?.['.'] === 'string'
      ? manifest.exports['.']
      : manifest.exports?.['.']?.default ?? manifest.exports?.['.']?.import
  if (typeof entry !== 'string') throw new Error(`Unsupported package export shape: ${packageJson}`)
  return entry
}

function readPackageManagerVersion(packageManager) {
  const match = /^pnpm@(.+)$/.exec(packageManager ?? '')
  if (!match) throw new Error('packageManager must pin pnpm')
  return match[1]
}

function readJson(filename) {
  return JSON.parse(readFileSync(filename, 'utf8'))
}

function runPnpm(args) {
  return run('pnpm', args).trim()
}

function run(command, args) {
  return execFileSync(command, args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function check(condition, message) {
  if (!condition) failures.push(message)
}
