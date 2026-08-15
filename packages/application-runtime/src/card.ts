import type { DocumentRecord } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import { isObject } from './json.js'
import { isPromptActivation } from './prompt-activation.js'
import type {
  CardPresetContent,
  CardPresetInput,
  CardMediaRefs,
  CardSourceContent,
  OpeningChatContent,
  OpeningChatEntryContent,
  OpeningChatInput,
  SettingActivation,
  SettingEntryContent,
  SettingLayerContent,
  SettingLayerInput,
} from './types.js'

export function cardToSnapshot(card: DocumentRecord<CardSourceContent>): JsonObject {
  const content = normalizeCardContent(card.content)

  return {
    id: card.id,
    version: card.version,
    name: content.name,
    userName: content.userName ?? '',
    description: content.description ?? '',
    preset: content.preset as unknown as JsonValue,
    opening: content.opening as unknown as JsonValue,
    settingLayer: content.settingLayer as unknown as JsonValue,
  }
}

export function toCardSource(card: DocumentRecord<CardSourceContent>): CardSourceContent & { id: string; version: number } {
  return {
    ...normalizeCardContent(card.content),
    id: card.id,
    version: card.version,
  }
}

export function normalizeCardContent(content: CardSourceContent): CardSourceContent {
  const legacyContent = content as Partial<CardSourceContent> & {
    opening?: OpeningChatInput | string
    setting?: JsonObject
    settingLayer?: SettingLayerInput
  }

  return {
    name: typeof legacyContent.name === 'string' && legacyContent.name.trim().length > 0 ? legacyContent.name : 'Untitled Card',
    userName: normalizeOptionalString(legacyContent.userName),
    description: typeof legacyContent.description === 'string' ? legacyContent.description : undefined,
    importBundleId: normalizeOptionalString(legacyContent.importBundleId),
    promptResourceIds: normalizeOptionalIdList(legacyContent.promptResourceIds),
    media: normalizeCardMedia(legacyContent.media),
    preset: normalizePreset(legacyContent.preset),
    opening: normalizeOpening(legacyContent.opening),
    settingLayer: normalizeSettingLayer(legacyContent.settingLayer, legacyContent.setting),
    createdAt: typeof legacyContent.createdAt === 'string' ? legacyContent.createdAt : nowIso(),
    updatedAt: typeof legacyContent.updatedAt === 'string' ? legacyContent.updatedAt : nowIso(),
  }
}

export function normalizeCardMedia(input: unknown): CardMediaRefs | undefined {
  if (!isObject(input)) return undefined
  const avatarAssetId = normalizeOptionalString(input.avatarAssetId)
  const coverAssetId = normalizeOptionalString(input.coverAssetId)
  return avatarAssetId || coverAssetId ? { avatarAssetId, coverAssetId } : undefined
}

export function normalizeOptionalString(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim().length > 0 ? input : undefined
}

function normalizeOptionalIdList(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  return input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

export function normalizePreset(input: CardPresetInput | undefined): CardPresetContent {
  if (!isObject(input)) return {}

  return {
    system: normalizeOptionalString(input.system),
  }
}

export function normalizeOpening(input: OpeningChatInput | string | undefined): OpeningChatContent {
  if (typeof input === 'string') {
    return input.trim().length > 0
      ? { entries: [{ role: 'assistant', content: input }] }
      : { entries: [] }
  }

  if (!isObject(input)) return { entries: [] }

  return {
    entries: (Array.isArray(input.entries) ? input.entries : [])
      .filter(entry => isObject(entry) && typeof entry.content === 'string' && entry.content.trim().length > 0)
      .map(entry => ({
        role: entry.role === 'user' || entry.role === 'assistant' ? entry.role : 'assistant',
        content: entry.content,
      })),
  }
}

export function normalizeSettingLayer(input: SettingLayerInput | undefined, legacySetting: JsonObject | undefined): SettingLayerContent {
  if (isObject(input) && Array.isArray(input.entries)) {
    return {
      entries: input.entries
        .filter(entry => isObject(entry) && typeof entry.content === 'string' && entry.content.trim().length > 0)
        .map(entry => ({
          id: typeof entry.id === 'string' ? entry.id : createId('setting'),
          path: typeof entry.path === 'string' ? entry.path : undefined,
          title: typeof entry.title === 'string' ? entry.title : undefined,
          content: entry.content,
          enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
          activation: isActivation(entry.activation) ? entry.activation : { kind: 'always' },
          tags: Array.isArray(entry.tags) && entry.tags.every(tag => typeof tag === 'string') ? entry.tags : [],
        })),
    }
  }

  if (legacySetting && Object.keys(legacySetting).length > 0) {
    return {
      entries: [
        {
          id: 'legacy.setting',
          path: 'legacy.setting',
          title: 'Imported Setting',
          content: JSON.stringify(legacySetting),
          enabled: true,
          activation: { kind: 'always' },
          tags: ['legacy'],
        },
      ],
    }
  }

  return { entries: [] }
}

export function readOpeningEntries(snapshot: JsonObject): OpeningChatEntryContent[] {
  const opening = snapshot.opening
  if (!isObject(opening) || !Array.isArray(opening.entries)) return []
  const macroContext = getMacroContext(snapshot)

  return opening.entries.filter(isOpeningEntry).map(entry => ({
    role: entry.role,
    content: renderMacros(entry.content, macroContext),
  }))
}

export function isOpeningEntry(value: JsonValue): value is OpeningChatEntryContent {
  return isObject(value) && (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string'
}

export function isSettingEntry(value: JsonValue): value is SettingEntryContent {
  return isObject(value)
    && typeof value.id === 'string'
    && typeof value.content === 'string'
    && typeof value.enabled === 'boolean'
    && isActivation(value.activation)
    && Array.isArray(value.tags)
    && value.tags.every(tag => typeof tag === 'string')
}

export function isActivation(value: JsonValue | undefined): value is SettingActivation {
  return isPromptActivation(value)
}

export function getMacroContext(snapshot: JsonObject): { user: string } {
  const user = typeof snapshot.userName === 'string' && snapshot.userName.trim().length > 0
    ? snapshot.userName
    : 'User'

  return { user }
}

export function renderMacros(input: string, context: { user: string }): string {
  return input.replace(/\{\{\s*User\s*\}\}/g, context.user)
}
