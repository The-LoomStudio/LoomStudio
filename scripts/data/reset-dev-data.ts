#!/usr/bin/env tsx
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const { values, positionals } = parseArgs({
  options: {
    target: { type: 'string' },
    apply: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    backup: { type: 'boolean', default: true },
    'no-backup': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

const isHelp = values.help || positionals.includes('--help') || positionals.includes('-h')
if (isHelp) {
  printHelp()
  process.exit(0)
}

const shouldApply = Boolean(values.apply || values.force)
const shouldBackup = !values['no-backup'] && Boolean(values.backup)

// Determine target data directory
const targetDir = resolve(repositoryRoot, values.target ?? (process.env.LOOM_STUDIO_HOME ? join(process.env.LOOM_STUDIO_HOME, 'data') : 'data'))

// Safety boundary: Ensure target is strictly within the repository and named either data or .loomstudio-dev
const relToRoot = relative(repositoryRoot, targetDir)
if (relToRoot.startsWith('..') || (!relToRoot.includes('data') && !relToRoot.includes('.loomstudio-dev'))) {
  console.error(`\x1b[31mRefusing to reset unsafe directory:\x1b[0m ${targetDir}`)
  console.error('Target data directory must reside within repository data/ or .loomstudio-dev/.')
  process.exit(1)
}

console.log(`Target development data directory: \x1b[36m${targetDir}\x1b[0m`)

const exists = existsSync(targetDir)
const existingFiles = exists ? readdirSync(targetDir) : []

if (!shouldApply) {
  console.log('\n\x1b[33m[DRY-RUN]\x1b[0m This operation will:')
  if (exists && existingFiles.length > 0) {
    if (shouldBackup) {
      console.log(`  1. Back up existing ${existingFiles.length} file(s)/folder(s) to .loomstudio-dev/backups/data-<timestamp>`)
    }
    console.log(`  2. Clean out old database and resource files in ${targetDir}`)
  }
  console.log(`  3. Initialize clean folder structure in ${targetDir}`)
  console.log('\nTo execute, run: \x1b[32mpnpm run data:reset -- --apply\x1b[0m (or --force)\n')
  process.exit(0)
}

// Execute Reset
if (exists && existingFiles.length > 0) {
  if (shouldBackup) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = resolve(repositoryRoot, '.loomstudio-dev', 'backups', `data-${timestamp}`)
    mkdirSync(dirname(backupDir), { recursive: true })
    cpSync(targetDir, backupDir, { recursive: true })
    console.log(`\x1b[32m[BACKUP]\x1b[0m Saved previous data state to \x1b[36m${relative(repositoryRoot, backupDir)}\x1b[0m`)
  }

  // Remove existing content safely
  for (const item of existingFiles) {
    const itemPath = join(targetDir, item)
    rmSync(itemPath, { recursive: true, force: true })
  }
  console.log(`\x1b[32m[CLEAN]\x1b[0m Removed ${existingFiles.length} item(s) from data directory.`)
}

// Ensure base subdirectories
const standardSubdirs = ['cards', 'extensions', 'resources']
for (const sub of standardSubdirs) {
  mkdirSync(join(targetDir, sub), { recursive: true })
}

console.log(`\x1b[32m[INIT]\x1b[0m Development sandbox initialized successfully at \x1b[36m${relative(repositoryRoot, targetDir)}\x1b[0m.\n`)

function printHelp(): void {
  console.log(`
Usage:
  tsx scripts/reset-dev-data.ts [options]
  pnpm run data:reset [-- --apply]

Description:
  Safely resets the local development data sandbox (data/ or .loomstudio-dev/data/).
  By default, creates a timestamped backup before clearing data.

Options:
  --apply, --force    Execute the actual reset (default: false, dry-run only)
  --target <dir>      Target data directory (default: data/)
  --no-backup         Skip creating backup of existing data
  --help              Show this help message
`)
}
