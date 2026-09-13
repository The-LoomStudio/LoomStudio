import { randomUUID } from 'node:crypto'
import type { PromptActivation, PromptResourceArtifact, PromptResourceNode } from '@loom-studio/application-runtime'
import type { LorebookConversionResult, SillyTavernLorebookData, SillyTavernLorebookEntry } from '../types.js'

export function extractLorebookKeys(entry: SillyTavernLorebookEntry): string[] {
  const raw = entry.key ?? entry.keys ?? []
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : [])
  return [...new Set(list
    .map(k => String(k).trim())
    .filter(k => k.length > 0 && k !== '[object Undefined]' && k !== 'undefined' && k !== 'null'))]
}

export function convertSillyTavernLorebook(
  source: Uint8Array | string | SillyTavernLorebookData,
  defaultName?: string,
): LorebookConversionResult {
  let lorebook: SillyTavernLorebookData

  if (source instanceof Uint8Array || Buffer.isBuffer(source)) {
    const text = Buffer.from(source).toString('utf8')
    lorebook = JSON.parse(text) as SillyTavernLorebookData
  } else if (typeof source === 'string') {
    lorebook = JSON.parse(source) as SillyTavernLorebookData
  } else {
    lorebook = source
  }

  const rawEntries: SillyTavernLorebookEntry[] = (Array.isArray(lorebook.entries)
    ? lorebook.entries
    : Object.values(lorebook.entries ?? {}))
    .filter((entry): entry is SillyTavernLorebookEntry => Boolean(entry && entry.content))

  const getEntryOrder = (entry: SillyTavernLorebookEntry): number => {
    if (typeof entry.order === 'number') return entry.order
    if (typeof entry.insertion_order === 'number') return entry.insertion_order
    return 100
  }

  // Sort rawEntries by natural ascending order (smaller order on top, larger order at bottom)
  const sortedEntries = [...rawEntries].sort((a, b) => getEntryOrder(a) - getEntryOrder(b))

  const rootId = `lorebook-root-${randomUUID().slice(0, 8)}`
  const lorebookTitle = lorebook.name?.trim() || defaultName?.trim() || 'SillyTavern Lorebook'
  const children: PromptResourceNode[] = []

  for (const [index, entry] of sortedEntries.entries()) {
    const entryId = entry.uid !== undefined ? String(entry.uid) : (entry.id !== undefined ? String(entry.id) : `entry-${index + 1}`)
    const keys = extractLorebookKeys(entry)
    const label = entry.comment?.trim()
      || (keys.length > 0 ? keys[0] : undefined)
      || `Lorebook Entry ${index + 1}`

    const isConstant = Boolean(entry.constant ?? (entry as Record<string, unknown>).alwaysActive)
    const isEnabled = entry.disable !== undefined ? !entry.disable : entry.enabled !== false
    const isCaseSensitive = Boolean(entry.keysearch_case ?? entry.case_sensitive ?? entry.caseSensitive)

    let activation: PromptActivation
    let lifecycle: string
    if (isConstant) {
      activation = { kind: 'always' }
      lifecycle = 'always'
    } else if (keys.length > 0) {
      activation = {
        kind: 'keyword',
        keywords: keys,
        caseSensitive: isCaseSensitive,
      }
      lifecycle = 'keyword'
    } else {
      activation = { kind: 'always' }
      lifecycle = 'always'
    }

    // In SillyTavern, position 4 or 'at_depth' explicitly means @chat.session.post injection.
    // In Character Cards, the advanced position is stored in entry.extensions.position.
    const rawPos = entry.extensions?.position !== undefined ? entry.extensions.position : entry.position
    const isAtDepth = rawPos === 4 || rawPos === 'at_depth' || rawPos === 'atDepth'
    let targetAnchorId: string
    if (isAtDepth) {
      targetAnchorId = '@chat.session.post'
    } else if (isConstant) {
      targetAnchorId = '@setting.stable'
    } else {
      targetAnchorId = '@setting.lower'
    }

    const depthValue = typeof entry.extensions?.depth === 'number' ? entry.extensions.depth : 4
    const localDepth = isAtDepth ? (depthValue * 100 + (index + 1)) : (index + 1) * 10

    children.push({
      id: `lorebook-node-${entryId}-${randomUUID().slice(0, 6)}`,
      label,
      kind: 'entry',
      category: 'setting',
      enabled: isEnabled,
      body: entry.content,
      capabilities: {
        targetAnchorId,
        localDepth,
        roleHint: 'system',
        activation,
        lifecycle: { lifecycle },
      },
    })
  }

  const artifact: PromptResourceArtifact = {
    format: 'loom.promptResource',
    schemaVersion: 1,
    resourceKind: 'setting',
    rootNode: {
      id: rootId,
      label: lorebookTitle,
      kind: 'module',
      category: 'setting',
      enabled: true,
      children,
    },
  }

  return { artifact }
}
