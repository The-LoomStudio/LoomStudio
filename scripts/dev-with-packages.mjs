import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const target = process.argv[2]
if (target !== 'server' && target !== 'client') {
  console.error('Usage: node scripts/dev-with-packages.mjs <server|client>')
  process.exit(1)
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const developmentEnvironment = {
  ...process.env,
  LOOM_STUDIO_HOME: process.env.LOOM_STUDIO_HOME ?? resolve(repositoryRoot, '.loomstudio-dev'),
}
const initialBuild = spawnSync('pnpm', ['run', 'build:packages'], {
  cwd: repositoryRoot,
  env: developmentEnvironment,
  stdio: 'inherit',
})
if (initialBuild.status !== 0) process.exit(initialBuild.status ?? 1)

const processes = [
  start('loom-core', ['--filter', '@loom/core', 'exec', 'tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']),
  start('studio-packages', ['exec', 'tsc', '-b', 'tsconfig.packages.json', '--watch', '--preserveWatchOutput']),
  target === 'server'
    ? start('studio-server', ['exec', 'tsx', 'watch', '--include', 'packages/**/dist/**/*', 'apps/studio-server/src/main.ts'])
    : start('studio-client', ['exec', 'vite', '--config', 'apps/studio-client/vite.config.ts']),
]

let stopping = false
let exitCode = 0

for (const child of processes) {
  child.on('exit', (code, signal) => {
    if (stopping) return
    exitCode = signal ? 1 : code ?? 1
    process.exitCode = exitCode
    console.error(`Development process exited: ${child.spawnargs.join(' ')}`)
    shutdown()
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function start(label, args) {
  const child = spawn('pnpm', args, {
    cwd: repositoryRoot,
    env: developmentEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => writePrefixed(process.stdout, label, chunk))
  child.stderr.on('data', chunk => writePrefixed(process.stderr, label, chunk))
  return child
}

function writePrefixed(stream, label, chunk) {
  for (const line of String(chunk).split(/(?<=\n)/)) {
    if (!line) continue
    if (line.startsWith('\x1b[?loom-raw]')) {
      stream.write(line.replace('\x1b[?loom-raw]', ''))
      continue
    }
    if (/^\r?\n$/.test(line)) {
      stream.write(line)
      continue
    }
    if (label === 'studio-server') {
      stream.write(line)
      continue
    }
    const dim = '\x1b[2m'
    const reset = '\x1b[0m'
    stream.write(`${dim}[${label}]${reset} ${line}`)
  }
}

function shutdown() {
  if (stopping) return
  stopping = true
  for (const child of processes) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    process.exit(exitCode)
  }, 1_000).unref()
}
