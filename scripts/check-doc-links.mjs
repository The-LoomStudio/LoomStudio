import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findMarkdownLinks,
  maskMarkdownBlocks,
  parseMarkdownTarget,
} from './documentation-markdown.mjs'

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsRoot, '..')
const docsRoot = path.join(repositoryRoot, 'docs')
const workspaceRoots = ['apps', 'packages', 'extensions'].map((directory) =>
  path.join(repositoryRoot, directory),
)
const markdownFiles = []

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

function collectWorkspaceReadmes(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') {
      continue
    }

    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      collectWorkspaceReadmes(entryPath)
    } else if (entry.isFile() && entry.name === 'README.md') {
      markdownFiles.push(entryPath)
    }
  }
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length
}

function hasExactPathCase(targetPath) {
  const relativeTarget = path.relative(repositoryRoot, targetPath)

  if (
    relativeTarget === '' ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    return true
  }

  let currentPath = repositoryRoot

  for (const segment of relativeTarget.split(path.sep)) {
    const exactEntryExists = readdirSync(currentPath).some(
      (entry) => entry === segment,
    )

    if (!exactEntryExists) {
      return false
    }

    currentPath = path.join(currentPath, segment)
  }

  return true
}

function headingSlugBase(rawHeading) {
  const renderedText = rawHeading
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/[`*~]/gu, '')
    .trim()
    .toLowerCase()

  return renderedText
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, '')
    .replace(/\s/gu, '-')
}

function collectAnchors(markdownFile) {
  const content = maskMarkdownBlocks(readFileSync(markdownFile, 'utf8'))
  const anchors = new Set()
  let previousLine = null

  function addHeading(rawHeading) {
    const baseSlug = headingSlugBase(rawHeading)

    if (!baseSlug) {
      return
    }

    let slug = baseSlug
    let duplicateCount = 0

    while (anchors.has(slug)) {
      duplicateCount += 1
      slug = `${baseSlug}-${duplicateCount}`
    }

    anchors.add(slug)
  }

  for (const line of content.split('\n')) {
    const headingMatch = line.match(/^\s{0,3}#{1,6}(?:\s+|$)(.*)$/u)

    if (headingMatch) {
      addHeading(headingMatch[1].replace(/\s+#+\s*$/u, ''))
      previousLine = null
      continue
    }

    const setextMatch = line.match(/^\s{0,3}(?:=+|-+)\s*$/u)

    if (setextMatch && previousLine?.trim()) {
      addHeading(previousLine.trim())
      previousLine = null
      continue
    }

    previousLine = line
  }

  const explicitIdPattern =
    /<[a-z][^>]*\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/giu

  for (const match of content.matchAll(explicitIdPattern)) {
    anchors.add(match[1])
  }

  return anchors
}

function markdownFileForAnchor(targetPath) {
  if (targetPath.endsWith('.md')) {
    return targetPath
  }

  if (statSync(targetPath).isDirectory()) {
    const readmePath = path.join(targetPath, 'README.md')
    return existsSync(readmePath) ? readmePath : null
  }

  return null
}

collectMarkdownFiles(docsRoot)
markdownFiles.push(path.join(repositoryRoot, 'README.md'))
for (const workspaceRoot of workspaceRoots) {
  collectWorkspaceReadmes(workspaceRoot)
}
markdownFiles.sort()

const brokenLinks = []
const anchorCache = new Map()

for (const markdownFile of markdownFiles) {
  const content = readFileSync(markdownFile, 'utf8')

  for (const link of findMarkdownLinks(content)) {
    const rawTarget = parseMarkdownTarget(link.rawTarget)

    if (!rawTarget || /^(?:https?:|mailto:|data:)/iu.test(rawTarget)) {
      continue
    }

    const fragmentIndex = rawTarget.indexOf('#')
    const targetWithQuery =
      fragmentIndex === -1 ? rawTarget : rawTarget.slice(0, fragmentIndex)
    const rawFragment =
      fragmentIndex === -1 ? null : rawTarget.slice(fragmentIndex + 1)
    const targetWithoutQuery = targetWithQuery.split('?', 1)[0]
    let decodedTarget = targetWithoutQuery
    let invalidEncoding = false
    const encodedPathSeparator = /%(?:2f|5c)/iu.test(targetWithoutQuery)

    try {
      decodedTarget = decodeURIComponent(targetWithoutQuery)
    } catch {
      invalidEncoding = true
    }

    const targetPath = decodedTarget
      ? path.resolve(path.dirname(markdownFile), decodedTarget)
      : markdownFile
    const relativeTarget = path.relative(repositoryRoot, targetPath)
    const escapesRepository =
      relativeTarget.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeTarget)

    let reason = null

    if (rawTarget.includes('\\')) {
      reason = 'Markdown links must use forward slashes'
    } else if (
      rawTarget.toLowerCase().startsWith('file://') ||
      path.isAbsolute(decodedTarget)
    ) {
      reason = 'absolute or file URL is not portable'
    } else if (invalidEncoding || encodedPathSeparator) {
      reason = encodedPathSeparator
        ? 'encoded path separator is not allowed'
        : 'invalid URL encoding'
    } else if (escapesRepository) {
      reason = 'relative link escapes the repository'
    } else if (!existsSync(targetPath)) {
      reason = 'missing target'
    } else if (!hasExactPathCase(targetPath)) {
      reason = 'path casing does not match the filesystem'
    } else if (rawFragment) {
      let decodedFragment = rawFragment

      try {
        decodedFragment = decodeURIComponent(rawFragment)
      } catch {
        reason = 'invalid fragment encoding'
      }

      if (!reason) {
        const targetMarkdownFile = markdownFileForAnchor(targetPath)

        if (targetMarkdownFile) {
          if (!hasExactPathCase(targetMarkdownFile)) {
            reason = 'README.md casing does not match the filesystem'
          }

          let anchors = anchorCache.get(targetMarkdownFile)

          if (!reason && !anchors) {
            anchors = collectAnchors(targetMarkdownFile)
            anchorCache.set(targetMarkdownFile, anchors)
          }

          if (!reason && !anchors.has(decodedFragment)) {
            reason = 'missing Markdown heading anchor'
          }
        } else if (statSync(targetPath).isDirectory()) {
          reason = 'directory anchor requires README.md'
        }
      }
    }

    if (reason) {
      brokenLinks.push({
        file: path.relative(repositoryRoot, markdownFile),
        line: lineNumberAt(content, link.index),
        target: rawTarget,
        reason,
      })
    }
  }
}

if (brokenLinks.length > 0) {
  for (const brokenLink of brokenLinks) {
    console.error(
      `${brokenLink.file}:${brokenLink.line} -> ${brokenLink.target} (${brokenLink.reason})`,
    )
  }

  console.error(
    `Found ${brokenLinks.length} broken internal documentation link(s).`,
  )
  process.exitCode = 1
} else {
  console.log(
    `Checked ${markdownFiles.length} Markdown files: internal paths, casing, and anchors are valid.`,
  )
}
