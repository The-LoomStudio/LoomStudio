import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type RenameItem = {
  from: string
  to: string
}

const root = process.cwd()
const write = process.argv.includes('--write')

const renameManifest: RenameItem[] = [
  file('apps/studio-client/src/app/App.tsx', 'apps/studio-client/src/app/app.tsx'),
  file('apps/studio-client/src/app/App.module.css', 'apps/studio-client/src/app/app.module.css'),
  file('apps/studio-client/src/app/useStudioState.ts', 'apps/studio-client/src/app/use-studio-state.ts'),
  file('apps/studio-client/src/pages/studio/StudioPage.tsx', 'apps/studio-client/src/pages/studio/studio-page.tsx'),
  file('apps/studio-client/src/pages/studio/StudioPage.module.css', 'apps/studio-client/src/pages/studio/studio-page.module.css'),
  file('apps/studio-client/src/shared/i18n/en-US.ts', 'apps/studio-client/src/shared/i18n/en-us.ts'),
  file('apps/studio-client/src/shared/i18n/zh-CN.ts', 'apps/studio-client/src/shared/i18n/zh-cn.ts'),
  file('apps/studio-client/src/shared/ui/file-tree/FileTree.tsx', 'apps/studio-client/src/shared/ui/file-tree/file-tree.tsx'),
  file('apps/studio-client/src/shared/ui/file-tree/FileTree.module.css', 'apps/studio-client/src/shared/ui/file-tree/file-tree.module.css'),
  file('apps/studio-client/src/shared/ui/json-block/JsonBlock.tsx', 'apps/studio-client/src/shared/ui/json-block/json-block.tsx'),
  file('apps/studio-client/src/shared/ui/json-block/JsonBlock.module.css', 'apps/studio-client/src/shared/ui/json-block/json-block.module.css'),
  file('apps/studio-client/src/widgets/api-panel/ApiPanel.tsx', 'apps/studio-client/src/widgets/api-panel/api-panel.tsx'),
  file('apps/studio-client/src/widgets/api-panel/ApiPanel.module.css', 'apps/studio-client/src/widgets/api-panel/api-panel.module.css'),
  file('apps/studio-client/src/widgets/context-workbench/ContextWorkbench.tsx', 'apps/studio-client/src/widgets/context-workbench/context-workbench.tsx'),
  file('apps/studio-client/src/widgets/context-workbench/ContextWorkbench.module.css', 'apps/studio-client/src/widgets/context-workbench/context-workbench.module.css'),
  file('apps/studio-client/src/widgets/input-dashboard/InputDashboard.tsx', 'apps/studio-client/src/widgets/input-dashboard/input-dashboard.tsx'),
  file('apps/studio-client/src/widgets/input-dashboard/InputDashboard.module.css', 'apps/studio-client/src/widgets/input-dashboard/input-dashboard.module.css'),
  file('apps/studio-client/src/widgets/master-detail-editor/MasterDetailEditor.tsx', 'apps/studio-client/src/widgets/master-detail-editor/master-detail-editor.tsx'),
  file('apps/studio-client/src/widgets/master-detail-editor/MasterDetailEditor.module.css', 'apps/studio-client/src/widgets/master-detail-editor/master-detail-editor.module.css'),
  file('apps/studio-client/src/widgets/narrative-canvas/NarrativeCanvas.tsx', 'apps/studio-client/src/widgets/narrative-canvas/narrative-canvas.tsx'),
  file('apps/studio-client/src/widgets/narrative-canvas/NarrativeCanvas.module.css', 'apps/studio-client/src/widgets/narrative-canvas/narrative-canvas.module.css'),
  file('apps/studio-client/src/widgets/preset-workbench/AgentRuntimeManager.tsx', 'apps/studio-client/src/widgets/preset-workbench/agent-runtime-manager.tsx'),
  file('apps/studio-client/src/widgets/preset-workbench/AgentRuntimeManager.module.css', 'apps/studio-client/src/widgets/preset-workbench/agent-runtime-manager.module.css'),
  file('apps/studio-client/src/widgets/preset-workbench/PresetWorkbench.tsx', 'apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx'),
  file('apps/studio-client/src/widgets/preset-workbench/PresetWorkbench.module.css', 'apps/studio-client/src/widgets/preset-workbench/preset-workbench.module.css'),
  file('apps/studio-client/src/widgets/prompt-build-flow/PromptBuildFlow.tsx', 'apps/studio-client/src/widgets/prompt-build-flow/prompt-build-flow.tsx'),
  file('apps/studio-client/src/widgets/prompt-build-flow/PromptBuildFlow.module.css', 'apps/studio-client/src/widgets/prompt-build-flow/prompt-build-flow.module.css'),
  file('apps/studio-client/src/widgets/rendering-lab/RenderingLab.tsx', 'apps/studio-client/src/widgets/rendering-lab/rendering-lab.tsx'),
  file('apps/studio-client/src/widgets/rendering-lab/RenderingLab.module.css', 'apps/studio-client/src/widgets/rendering-lab/rendering-lab.module.css'),
  file('apps/studio-client/src/widgets/resource-panel/ResourcePanel.tsx', 'apps/studio-client/src/widgets/resource-panel/resource-panel.tsx'),
  file('apps/studio-client/src/widgets/resource-panel/ResourcePanel.module.css', 'apps/studio-client/src/widgets/resource-panel/resource-panel.module.css'),
  file('apps/studio-client/src/features/context-assets/ui/context-asset-detail/ContextAssetDetail.tsx', 'apps/studio-client/src/features/context-assets/ui/context-asset-detail/context-asset-detail.tsx'),
  file('apps/studio-client/src/features/context-assets/ui/context-asset-detail/ContextAssetDetail.module.css', 'apps/studio-client/src/features/context-assets/ui/context-asset-detail/context-asset-detail.module.css'),
  file('apps/studio-client/src/features/context-assets/ui/projection-order-editor/ProjectionOrderEditor.tsx', 'apps/studio-client/src/features/context-assets/ui/projection-order-editor/projection-order-editor.tsx'),
  file('apps/studio-client/src/features/context-assets/ui/projection-order-editor/ProjectionOrderEditor.module.css', 'apps/studio-client/src/features/context-assets/ui/projection-order-editor/projection-order-editor.module.css'),
]

const renameBySourcePath = new Map(renameManifest.map(item => [absolute(item.from), absolute(item.to)]))
const pendingRenames = renameManifest.filter(item => {
  const from = absolute(item.from)
  const to = absolute(item.to)
  if (existsSync(from) && existsSync(to) && isSameFile(from, to)) return false
  return existsSync(from) || !existsSync(to)
})
const sourceFiles = listFiles(['apps/studio-client/src', 'tests/unit/client'], filePath => (
  filePath.endsWith('.ts')
  || filePath.endsWith('.tsx')
  || filePath.endsWith('.css')
  || filePath.endsWith('.html')
))

console.log(`${write ? 'write' : 'dry-run'} rename-studio-client-files`)
console.log('\nRenames:')
for (const item of pendingRenames) console.log(`  ${item.from} -> ${item.to}`)
if (pendingRenames.length === 0) console.log('  none')

const edits = sourceFiles
  .map(filePath => ({ filePath, text: readFileSync(filePath, 'utf8') }))
  .map(({ filePath, text }) => ({ filePath, nextText: rewriteSpecifiers(filePath, text) }))
  .filter(item => item.nextText.changed)

console.log('\nImport edits:')
for (const item of edits) {
  console.log(`  ${relative(item.filePath)} (${item.nextText.count})`)
}
console.log(`\nSummary: ${pendingRenames.length} pending renames, ${edits.length} files with import edits`)

if (!write) process.exit(0)

for (const item of edits) {
  writeFileSync(item.filePath, item.nextText.text)
}
for (const item of pendingRenames) {
  renameCaseSafe(absolute(item.from), absolute(item.to))
}

function file(from: string, to: string): RenameItem {
  return { from, to }
}

function rewriteSpecifiers(filePath: string, text: string): { changed: boolean; count: number; text: string } {
  let count = 0
  const nextText = text.replace(/(['"])(\.{1,2}\/[^'"]+)\1/g, (match, quote: string, specifier: string) => {
    const nextSpecifier = rewriteSpecifier(filePath, specifier)
    if (nextSpecifier === specifier) return match
    count += 1
    return `${quote}${nextSpecifier}${quote}`
  })

  return { changed: count > 0, count, text: nextText }
}

function rewriteSpecifier(filePath: string, specifier: string): string {
  const target = resolveSourcePath(path.dirname(filePath), specifier)
  if (!target) return specifier

  const renamedTarget = renameBySourcePath.get(target)
  if (!renamedTarget) return specifier

  const nextSpecifierPath = path.relative(path.dirname(filePath), toSpecifierPath(renamedTarget, specifier)).replaceAll(path.sep, '/')
  return nextSpecifierPath.startsWith('.') ? nextSpecifierPath : `./${nextSpecifierPath}`
}

function resolveSourcePath(fromDir: string, specifier: string): string | undefined {
  const resolved = path.resolve(fromDir, specifier)
  const candidates = specifier.endsWith('.js')
    ? [replaceExtension(resolved, '.ts'), replaceExtension(resolved, '.tsx'), resolved]
    : [resolved]

  return candidates.find(candidate => renameBySourcePath.has(candidate) || existsSync(candidate))
}

function toSpecifierPath(sourcePath: string, oldSpecifier: string): string {
  if (oldSpecifier.endsWith('.js')) return replaceExtension(sourcePath, '.js')
  return sourcePath
}

function replaceExtension(filePath: string, extension: string): string {
  return filePath.replace(/\.[^.]+$/, extension)
}

function renameCaseSafe(from: string, to: string) {
  if (!existsSync(from)) throw new Error(`Missing source: ${relative(from)}`)
  if (existsSync(to) && !isSameFile(from, to)) throw new Error(`Target already exists: ${relative(to)}`)

  mkdirSync(path.dirname(to), { recursive: true })
  const temp = path.join(path.dirname(from), `.rename-${path.basename(from)}-${Date.now()}`)
  renameSync(from, temp)
  renameSync(temp, to)
}

function isSameFile(left: string, right: string): boolean {
  if (!existsSync(left) || !existsSync(right)) return false
  const leftStat = statSync(left)
  const rightStat = statSync(right)
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino
}

function listFiles(dirs: string[], include: (filePath: string) => boolean): string[] {
  return dirs.flatMap(dir => listFilesInner(absolute(dir), include)).sort()
}

function listFilesInner(dir: string, include: (filePath: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  if (!statSync(dir).isDirectory()) return include(dir) ? [dir] : []
  return readdirSync(dir).flatMap(child => listFilesInner(path.join(dir, child), include))
}

function absolute(filePath: string): string {
  return path.resolve(root, filePath)
}

function relative(filePath: string): string {
  return path.relative(root, filePath).replaceAll(path.sep, '/')
}
