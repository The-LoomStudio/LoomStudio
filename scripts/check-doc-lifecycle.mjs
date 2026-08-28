import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findMarkdownLinks,
  parseMarkdownTarget,
} from './documentation-markdown.mjs'

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsRoot, '..')
const docsRoot = path.join(repositoryRoot, 'docs')
const workbenchRoot = path.join(docsRoot, 'workbench')
const archiveRoot = path.join(docsRoot, 'archive')
const markdownFiles = []
const problems = []

function collectMarkdownFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      collectMarkdownFiles(entryPath)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      markdownFiles.push(entryPath)
    }
  }
}

function resolveMarkdownTargets(markdownFile) {
  const content = readFileSync(markdownFile, 'utf8')
  const targets = []

  for (const link of findMarkdownLinks(content)) {
    const rawTarget = parseMarkdownTarget(link.rawTarget)

    if (
      !rawTarget ||
      rawTarget.startsWith('#') ||
      /^(?:https?:|mailto:|data:|file:)/iu.test(rawTarget)
    ) {
      continue
    }

    const targetWithoutFragment = rawTarget.split('#', 1)[0].split('?', 1)[0]
    let decodedTarget = targetWithoutFragment

    try {
      decodedTarget = decodeURIComponent(targetWithoutFragment)
    } catch {
      continue
    }

    let targetPath = path.resolve(path.dirname(markdownFile), decodedTarget)

    if (!existsSync(targetPath)) {
      continue
    }

    if (statSync(targetPath).isDirectory()) {
      targetPath = path.join(targetPath, 'README.md')
    }

    targets.push(targetPath)
  }

  return targets
}

function relativePath(file) {
  return path.relative(repositoryRoot, file)
}

function addProblem(file, message, line = 1) {
  problems.push({ file: relativePath(file), line, message })
}

function readDocumentStatus(markdownFile) {
  const lines = readFileSync(markdownFile, 'utf8').split('\n').slice(0, 20)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/^\s*>\s?/u, '').trim()
    const match = line.match(
      /^(?:[-*]\s*)?\*{0,2}(?:status|状态)\*{0,2}\s*[:：]\s*(.*?)\*{0,2}\s*$/iu,
    )

    if (match) {
      return { line: index + 1, value: match[1].trim() }
    }
  }

  return null
}

function normalizeStatus(status) {
  return status.replace(/[*_`]/gu, '').replace(/\s+/gu, ' ').trim()
}

collectMarkdownFiles(docsRoot)

const forbiddenArchiveRoot = path.join(workbenchRoot, 'archive')

if (existsSync(forbiddenArchiveRoot)) {
  addProblem(
    forbiddenArchiveRoot,
    'docs/archive/ is the only archive root; docs/workbench/archive/ must not exist',
  )
}

const activeWorkbenchFiles = markdownFiles.filter(
  (file) =>
    file.startsWith(`${workbenchRoot}${path.sep}`) &&
    path.basename(file) !== 'README.md',
)

const workbenchIndexFiles = markdownFiles.filter(
  (file) =>
    file.startsWith(`${workbenchRoot}${path.sep}`) &&
    path.basename(file) === 'README.md',
)
const reachableWorkbenchFiles = new Set(workbenchIndexFiles)
const pendingWorkbenchFiles = [...workbenchIndexFiles]

while (pendingWorkbenchFiles.length > 0) {
  const sourceFile = pendingWorkbenchFiles.shift()

  for (const targetFile of resolveMarkdownTargets(sourceFile)) {
    if (
      targetFile.startsWith(`${workbenchRoot}${path.sep}`) &&
      !reachableWorkbenchFiles.has(targetFile)
    ) {
      reachableWorkbenchFiles.add(targetFile)
      pendingWorkbenchFiles.push(targetFile)
    }
  }
}

const terminalWorkbenchStatusPattern =
  /(^|\b)(archived|historical|superseded|closed)(\b|$)|已归档|历史快照|已关闭|已被取代/iu
const standaloneCompletedWorkbenchStatusPattern =
  /^(?:complete|completed|implemented|resolved|done|已完成|已实施|已解决)$/iu

for (const workbenchFile of activeWorkbenchFiles) {
  const status = readDocumentStatus(workbenchFile)

  if (!status) {
    addProblem(
      workbenchFile,
      'active Workbench document must declare Status in the first 20 lines',
    )
  } else if (
    !workbenchFile.startsWith(
      `${path.join(workbenchRoot, 'adr')}${path.sep}`,
    ) &&
    (terminalWorkbenchStatusPattern.test(status.value) ||
      standaloneCompletedWorkbenchStatusPattern.test(status.value))
  ) {
    addProblem(
      workbenchFile,
      `active Workbench document declares a terminal lifecycle status: ${status.value}`,
      status.line,
    )
  }

  if (!reachableWorkbenchFiles.has(workbenchFile)) {
    addProblem(
      workbenchFile,
      'active Workbench document is not reachable from a Workbench README index',
    )
  }
}

const plansRoot = path.join(workbenchRoot, 'plans')
const plansReadme = path.join(plansRoot, 'README.md')
const indexedPlans = new Set(resolveMarkdownTargets(plansReadme))
const topLevelPlans = readdirSync(plansRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      entry.name !== 'README.md',
  )
  .map((entry) => path.join(plansRoot, entry.name))

for (const planFile of topLevelPlans) {
  if (!indexedPlans.has(planFile)) {
    addProblem(
      planFile,
      'top-level active Plan is missing from plans/README.md',
    )
  }
}

const archivePlansReadme = path.join(archiveRoot, 'plans', 'README.md')
const indexedArchivePlans = new Set(resolveMarkdownTargets(archivePlansReadme))
const archivePlanFiles = readdirSync(path.join(archiveRoot, 'plans'), {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      entry.name !== 'README.md',
  )
  .map((entry) => path.join(archiveRoot, 'plans', entry.name))

for (const archivePlanFile of archivePlanFiles) {
  if (!indexedArchivePlans.has(archivePlanFile)) {
    addProblem(
      archivePlansReadme,
      `archived Plan is missing from the Archive index: ${path.basename(archivePlanFile)}`,
    )
  }
}

const explicitArchiveLifecyclePattern =
  /\b(?:archived|historical|superseded|sealed|frozen)\b|已归档|历史|被取代|封存|冻结/iu
const completedArchiveLifecyclePattern =
  /\b(?:complete|completed|implemented|resolved|passed)\b|已完成|已实施|已解决|通过/iu
const openArchiveLifecyclePattern =
  /\b(?:active|open|pending|unresolved|incomplete|unfinished)\b|\bnot\s+(?:implemented|complete|completed|resolved)\b|待实施|待处理|未完成|开放/iu
const governedArchiveFiles = markdownFiles.filter(
  (file) =>
    file.startsWith(`${archiveRoot}${path.sep}`) &&
    path.basename(file) !== 'README.md' &&
    !file.startsWith(path.join(archiveRoot, 'loom-project', path.sep)),
)

for (const archiveFile of governedArchiveFiles) {
  const status = readDocumentStatus(archiveFile)

  if (!status) {
    addProblem(
      archiveFile,
      'Archive document must declare its lifecycle status in the first 20 lines',
    )
  } else if (
    !explicitArchiveLifecyclePattern.test(status.value) &&
    (openArchiveLifecyclePattern.test(status.value) ||
      !completedArchiveLifecyclePattern.test(status.value))
  ) {
    addProblem(
      archiveFile,
      `Archive status does not identify a historical, superseded, or completed lifecycle: ${status.value}`,
      status.line,
    )
  }
}

const adrRoot = path.join(workbenchRoot, 'adr')
const adrReadme = path.join(adrRoot, 'README.md')
const adrReadmeLines = readFileSync(adrReadme, 'utf8').split('\n')
const adrFiles = readdirSync(adrRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^ADR-\d+.*\.md$/u.test(entry.name))
  .map((entry) => path.join(adrRoot, entry.name))

for (const adrFile of adrFiles) {
  const adrStatus = readDocumentStatus(adrFile)
  const indexLine = adrReadmeLines.findIndex((line) => {
    const firstLinkTarget = line.match(/\]\(([^)]+)\)/u)?.[1]
    return firstLinkTarget === path.basename(adrFile)
  })

  if (!adrStatus) {
    addProblem(adrFile, 'ADR must declare Status in the first 20 lines')
    continue
  }

  if (indexLine === -1) {
    addProblem(adrFile, 'ADR is missing from adr/README.md')
    continue
  }

  const indexedStatus = adrReadmeLines[indexLine].split('|')[2]?.trim()

  if (!indexedStatus) {
    addProblem(
      adrReadme,
      `ADR index row has no status for ${path.basename(adrFile)}`,
    )
  } else if (
    normalizeStatus(indexedStatus) !== normalizeStatus(adrStatus.value)
  ) {
    addProblem(
      adrReadme,
      `ADR index status does not match ${path.basename(adrFile)}: ${indexedStatus} != ${adrStatus.value}`,
      indexLine + 1,
    )
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`${problem.file}:${problem.line} -> ${problem.message}`)
  }

  console.error(`Found ${problems.length} documentation lifecycle problem(s).`)
  process.exitCode = 1
} else {
  console.log(
    `Checked documentation lifecycle: ${topLevelPlans.length} active Plans indexed, ${activeWorkbenchFiles.length} active Workbench documents classified and reachable from ${workbenchIndexFiles.length} indexes, ${archivePlanFiles.length} archived Plans indexed, ${governedArchiveFiles.length} Archive documents classified, and ${adrFiles.length} ADR statuses aligned.`,
  )
}
