import type { JsonObject } from '@loom-studio/shared'
import type { SillyTavernCard, SillyTavernLorebookData, SillyTavernPresetData, SniffResult } from '../types.js'
import { extractStCardFromPng, isPngFile } from './png-reader.js'

export function sniffData(source: Uint8Array | string | unknown): SniffResult {
  if (source instanceof Uint8Array || Buffer.isBuffer(source)) {
    if (isPngFile(source)) {
      const stCard = extractStCardFromPng(source)
      if (stCard) {
        const name = (stCard.card as { data?: { name?: string }; name?: string }).data?.name
          ?? (stCard.card as { name?: string }).name
          ?? 'Unknown ST Card'
        return {
          detected: true,
          format: 'st.card.png',
          summary: `SillyTavern PNG Card (${stCard.format}): ${name}`,
          details: {
            format: stCard.format,
            name,
          },
        }
      }
      return {
        detected: false,
        format: 'unknown',
      }
    }

    try {
      const text = Buffer.from(source).toString('utf8').trim()
      if (text.startsWith('{') && text.endsWith('}')) {
        return sniffJsonObject(JSON.parse(text) as unknown)
      }
    } catch {
      return { detected: false, format: 'unknown' }
    }
  }

  if (typeof source === 'string') {
    const trimmed = source.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return sniffJsonObject(JSON.parse(trimmed) as unknown)
      } catch {
        return { detected: false, format: 'unknown' }
      }
    }
  }

  if (typeof source === 'object' && source !== null) {
    return sniffJsonObject(source)
  }

  return { detected: false, format: 'unknown' }
}

function sniffJsonObject(value: unknown): SniffResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { detected: false, format: 'unknown' }
  }

  const record = value as Record<string, unknown>

  // 1. Check ST Card V3 / V2
  if (
    record.spec === 'chara_card_v3'
    || record.spec === 'chara_card_v2'
    || (record.data && typeof record.data === 'object' && ('first_mes' in (record.data as Record<string, unknown>) || 'character_book' in (record.data as Record<string, unknown>)))
    || ('first_mes' in record && 'description' in record && 'name' in record)
  ) {
    const card = record as SillyTavernCard
    const name = card.data?.name ?? (card as { name?: string }).name ?? 'Unnamed Card'
    return {
      detected: true,
      format: 'st.card.json',
      summary: `SillyTavern Card JSON: ${name}`,
      details: {
        spec: (card as { spec?: string }).spec ?? 'v2_compatible',
        name,
      } as JsonObject,
    }
  }

  // 2. Check ST Lorebook / Worldbook
  if ('entries' in record && typeof record.entries === 'object' && record.entries !== null) {
    const entries = record.entries as Record<string, unknown> | unknown[]
    const firstEntry = Array.isArray(entries) ? entries[0] : Object.values(entries)[0]
    if (
      firstEntry === undefined
      || (typeof firstEntry === 'object' && firstEntry !== null && ('keys' in firstEntry || 'content' in firstEntry || 'keysearch_case' in firstEntry))
    ) {
      const lorebook = record as SillyTavernLorebookData
      const count = Array.isArray(entries) ? entries.length : Object.keys(entries).length
      return {
        detected: true,
        format: 'st.lorebook.json',
        summary: `SillyTavern Lorebook: ${lorebook.name ?? 'Unnamed'} (${count} entries)`,
        details: {
          name: lorebook.name,
          entryCount: count,
        } as JsonObject,
      }
    }
  }

  // 3. Check ST Preset
  if (Array.isArray(record.prompts) && record.prompts.length > 0) {
    const firstPrompt = record.prompts[0] as Record<string, unknown>
    if (firstPrompt && (('identifier' in firstPrompt && 'role' in firstPrompt) || 'system_prompt' in firstPrompt || 'marker' in firstPrompt)) {
      const preset = record as SillyTavernPresetData
      return {
        detected: true,
        format: 'st.preset.json',
        summary: `SillyTavern Preset with ${preset.prompts?.length ?? 0} prompts`,
        details: {
          promptCount: preset.prompts?.length ?? 0,
        } as JsonObject,
      }
    }
  }

  return {
    detected: false,
    format: 'unknown',
  }
}
