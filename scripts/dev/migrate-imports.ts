#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

type ImportReplacement = {
  line: number
  oldSpecifier: string
  newSpecifier: string
  originalLine: string
  updatedLine: string
}

type FileModification = {
  filePath: string
  replacements: ImportReplacement[]
  newContent: string
}

const defaultScopes = ['apps', 'packages', 'tests', 'scripts', 'examples']
const defaultExtensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.scss']

const { values, positionals } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    'package-from': { type: 'string' },
    'package-to': { type: 'string' },
    scope: { type: 'string' },
    ext: { type: 'string' },
    write: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

const isHelp = values.help || positionals.includes('--help') || positionals.includes('-h')

if (isHelp || (!values.from && !values['package-from'])) {
  printHelp()
  process.exit(isHelp ? 0 : 1)
}

const root = process.cwd()
const isWrite = Boolean(values.write)
const scopes = (values.scope ? values.scope.split(',') : defaultScopes).map(s => resolve(root, s.trim()))
const extensions = new Set((values.ext ? values.ext.split(',') : defaultExtensions).map(e => e.trim().startsWith('.') ? e.trim() : `.${e.trim()}`))

const fileMoveMode = Boolean(values.from && values.to)
const packageMode = Boolean(values['package-from'] && values['package-to'])

if (fileMoveMode && packageMode) {
  console.error('Error: Choose either file-move mode (--from, --to) or package-rewrite mode (--package-from, --package-to), not both.')
  process.exit(1)
}

const allFiles = collectSourceFiles(scopes, extensions)
const modifications: FileModification[] = []

if (packageMode) {
  executePackageRewrite(values['package-from']!, values['package-to']!)
} else if (fileMoveMode) {
  executeFileMove(resolve(root, values.from!), resolve(root, values.to!))
}

printSummaryAndApply(modifications, isWrite)

function executePackageRewrite(oldPkg: string, newPkg: string): void {
  const specifierRegex = new RegExp(`(['"\`])${escapeRegex(oldPkg)}((?:/[^'"\`]+)?)(['"\`])`, 'g')

  for (const filePath of allFiles) {
    const content = readFileSync(filePath, 'utf8')
    if (!content.includes(oldPkg)) continue

    const lines = content.split('\n')
    const replacements: ImportReplacement[] = []
    const updatedLines = lines.map((line, idx) => {
      if (!isImportOrRequireLine(line)) return line
      if (!line.includes(oldPkg)) return line

      const updated = line.replace(specifierRegex, (_match, q1, subpath, q2) => {
        const oldSpec = `${oldPkg}${subpath}`
        const newSpec = `${newPkg}${subpath}`
        replacements.push({
          line: idx + 1,
          oldSpecifier: oldSpec,
          newSpecifier: newSpec,
          originalLine: line,
          updatedLine: line.replace(oldSpec, newSpec),
        })
        return `${q1}${newSpec}${q2}`
      })
      return updated
    })

    if (replacements.length > 0) {
      modifications.push({
        filePath,
        replacements,
        newContent: updatedLines.join('\n'),
      })
    }
  }
}

function executeFileMove(fromAbs: string, toAbs: string): void {
  const fromRelToRoot = normalizePosix(relative(root, fromAbs))
  const toRelToRoot = normalizePosix(relative(root, toAbs))

  // 1. Scan external files importing fromAbs and recompute their relative path to toAbs
  for (const filePath of allFiles) {
    if (filePath === fromAbs) continue
    const content = readFileSync(filePath, 'utf8')
    const fileDir = dirname(filePath)
    const lines = content.split('\n')
    const replacements: ImportReplacement[] = []

    const updatedLines = lines.map((line, idx) => {
      if (!isImportOrRequireLine(line)) return line
      const matchedSpecifiers = extractRelativeSpecifiers(line)
      if (matchedSpecifiers.length === 0) return line

      let modifiedLine = line
      for (const spec of matchedSpecifiers) {
        const resolvedTarget = resolve(fileDir, spec)
        // Check if resolved specifier points to fromAbs (with or without extension)
        if (isPathEquivalent(resolvedTarget, fromAbs)) {
          const newRelSpecifier = computeRelativeSpecifier(fileDir, toAbs, spec)
          replacements.push({
            line: idx + 1,
            oldSpecifier: spec,
            newSpecifier: newRelSpecifier,
            originalLine: line,
            updatedLine: line.replace(spec, newRelSpecifier),
          })
          modifiedLine = replaceSpecifier(modifiedLine, spec, newRelSpecifier)
        }
      }
      return modifiedLine
    })

    if (replacements.length > 0) {
      modifications.push({
        filePath,
        replacements,
        newContent: updatedLines.join('\n'),
      })
    }
  }

  // 2. If the moved file itself has relative imports, recompute them relative to its new home
  if (existsSync(fromAbs)) {
    const fromContent = readFileSync(fromAbs, 'utf8')
    const oldDir = dirname(fromAbs)
    const newDir = dirname(toAbs)

    if (oldDir !== newDir) {
      const lines = fromContent.split('\n')
      const internalReplacements: ImportReplacement[] = []
      const updatedLines = lines.map((line, idx) => {
        if (!isImportOrRequireLine(line)) return line
        const matchedSpecifiers = extractRelativeSpecifiers(line)
        if (matchedSpecifiers.length === 0) return line

        let modifiedLine = line
        for (const spec of matchedSpecifiers) {
          const absoluteTarget = resolve(oldDir, spec)
          const newRelSpecifier = computeRelativeSpecifier(newDir, absoluteTarget, spec)
          if (newRelSpecifier !== spec) {
            internalReplacements.push({
              line: idx + 1,
              oldSpecifier: spec,
              newSpecifier: newRelSpecifier,
              originalLine: line,
              updatedLine: line.replace(spec, newRelSpecifier),
            })
            modifiedLine = replaceSpecifier(modifiedLine, spec, newRelSpecifier)
          }
        }
        return modifiedLine
      })

      modifications.push({
        filePath: fromAbs,
        replacements: internalReplacements,
        newContent: updatedLines.join('\n'),
      })
    }
  }
}

function computeRelativeSpecifier(fromDir: string, targetFile: string, oldSpecifier: string): string {
  let rel = normalizePosix(relative(fromDir, targetFile))
  if (!rel.startsWith('.') && !rel.startsWith('/')) {
    rel = `./${rel}`
  }

  const oldExt = extname(oldSpecifier)
  const targetExt = extname(targetFile)

  if (oldSpecifier.endsWith('.js') && (targetExt === '.ts' || targetExt === '.tsx' || targetExt === '.js')) {
    // ESM TypeScript project conventions (.js suffix preserved)
    return rel.replace(/\.(ts|tsx)$/, '.js')
  } else if (!oldExt && targetExt) {
    // Original had no extension, strip extension
    return rel.slice(0, -targetExt.length)
  }
  return rel
}

function isPathEquivalent(resolvedTarget: string, expectedFile: string): boolean {
  if (resolvedTarget === expectedFile) return true
  // Try matching with extensions (.ts, .tsx, .js, /index.ts, /index.js)
  for (const ext of ['.ts', '.tsx', '.js', '.mjs', '.json']) {
    if (`${resolvedTarget}${ext}` === expectedFile) return true
    if (resolvedTarget.endsWith('.js') && resolvedTarget.slice(0, -3) + ext === expectedFile) return true
  }
  for (const indexFile of ['/index.ts', '/index.tsx', '/index.js']) {
    if (`${resolvedTarget}${indexFile}` === expectedFile) return true
  }
  return false
}

function extractRelativeSpecifiers(line: string): string[] {
  const matches: string[] = []
  const regex = /['"`](\.{1,2}\/[^'"`]+)['"`]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(line)) !== null) {
    matches.push(match[1]!)
  }
  return matches
}

function replaceSpecifier(line: string, oldSpec: string, newSpec: string): string {
  return line.replace(new RegExp(`(['"\`])${escapeRegex(oldSpec)}(['"\`])`, 'g'), `$1${newSpec}$2`)
}

function isImportOrRequireLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('import ')
    || trimmed.startsWith('export ')
    || trimmed.includes('import(')
    || trimmed.includes('require(')
    || trimmed.startsWith('@import ')
}

function collectSourceFiles(dirs: string[], allowedExts: Set<string>): string[] {
  const results: string[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    walk(dir)
  }
  return results

  function walk(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && allowedExts.has(extname(entry.name))) {
        results.push(fullPath)
      }
    }
  }
}

function printSummaryAndApply(mods: FileModification[], write: boolean): void {
  const changedMods = mods.filter(m => m.replacements.length > 0)
  if (changedMods.length === 0) {
    console.log('No matching import references found.')
    return
  }

  const modeTag = write ? '\x1b[32m[WRITE]\x1b[0m' : '\x1b[33m[DRY-RUN]\x1b[0m'
  console.log(`\n${modeTag} Found ${changedMods.length} file(s) with import references to update:\n`)

  for (const mod of changedMods) {
    const relFile = relative(root, mod.filePath)
    console.log(`\x1b[36m${relFile}\x1b[0m (${mod.replacements.length} change${mod.replacements.length > 1 ? 's' : ''}):`)
    for (const rep of mod.replacements) {
      console.log(`  Line ${rep.line}:`)
      console.log(`    \x1b[31m- ${rep.oldSpecifier}\x1b[0m`)
      console.log(`    \x1b[32m+ ${rep.newSpecifier}\x1b[0m`)
    }
    console.log('')
  }

  if (!write) {
    console.log('\x1b[33mDry-run complete. No files were modified on disk. Pass --write to execute.\x1b[0m\n')
    return
  }

  for (const mod of changedMods) {
    writeFileSync(mod.filePath, mod.newContent, 'utf8')
  }

  // If moving a file physically
  if (fileMoveMode && values.from && values.to) {
    const fromAbs = resolve(root, values.from)
    const toAbs = resolve(root, values.to)
    if (existsSync(fromAbs) && fromAbs !== toAbs) {
      mkdirSync(dirname(toAbs), { recursive: true })
      renameSync(fromAbs, toAbs)
      console.log(`\x1b[32m[MOVED]\x1b[0m ${relative(root, fromAbs)} -> ${relative(root, toAbs)}`)
    }
  }

  console.log(`\x1b[32mSuccessfully updated ${changedMods.length} file(s)!\x1b[0m\n`)
}

function normalizePosix(p: string): string {
  return p.split('\\').join('/')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function printHelp(): void {
  console.log(`
Usage:
  tsx scripts/migrate-imports.ts [options]

Modes:
  1. File Move / Rename Mode:
     tsx scripts/migrate-imports.ts --from <old-path> --to <new-path> [--write]
     Moves a file and automatically updates all relative imports across the codebase.

  2. Package / Specifier Rewrite Mode:
     tsx scripts/migrate-imports.ts --package-from <old-pkg> --package-to <new-pkg> [--write]
     Rewrites package imports across the codebase (e.g. --package-from @loom-studio/old --package-to @loom-studio/new).

Options:
  --write         Actually write changes to disk (default: false, dry-run only)
  --scope <dirs>  Comma-separated scan roots (default: apps,packages,tests,scripts,examples)
  --ext <exts>    Comma-separated extensions (default: .ts,.tsx,.js,.mjs,.cjs,.css,.scss)
  --help          Show this help message
`)
}
