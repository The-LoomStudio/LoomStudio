import { parseCardFrameworkFields } from './card-framework.js'
import type { DocumentRecord } from '@loom-studio/document-store'
import type { JsonObject } from '@loom-studio/shared'
import { createId, nowIso, normalizeMacroOptions } from '@loom-studio/shared'
import { isObject } from '../foundation/json.js'
import { isPromptActivation } from '../prompt/prompt-activation.js'
import { createVariableRenderContext, renderVariableMacros } from '../prompt/variables.js'
import { assertWritableMacroName } from '../prompt/macro-provider-registry.js'
import type {
  CardSummary,
  CardPresetContent,
  CardPresetInput,
  CardMediaRefs,
  CardSourceContent,
  CardExtensionAdoption,
  OpeningChatContent,
  OpeningChatInput,
  LoreContent,
  LoreInput,
} from '../types.js'

export function toCardSource(card: DocumentRecord<CardSourceContent>): CardSourceContent & { id: string; version: number } {
  return {
    ...normalizeCardContent(card.content),
    id: card.id,
    version: card.version,
  }
}

export function toCardSummary(card: DocumentRecord<CardSourceContent>): CardSummary {
  let content: CardSourceContent
  try {
    content = normalizeCardContent(card.content)
  } catch (error) {
    const raw: JsonObject = isObject(card.content) ? card.content : {}
    return {
      id: card.id,
      version: card.version,
      artifactId: typeof raw.artifactId === 'string' ? raw.artifactId : '',
      name: normalizeOptionalString(raw.name) ?? card.id,
      userName: normalizeOptionalString(raw.userName),
      description: typeof raw.description === 'string' ? raw.description : undefined,
      media: normalizeCardMedia(raw.media),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : card.meta.createdAt,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : card.meta.updatedAt,
      validationError: error instanceof Error ? error.message : String(error),
    }
  }
  return {
    id: card.id,
    artifactId: content.artifactId,
    ...(content.derivedFrom ? { derivedFrom: structuredClone(content.derivedFrom) } : {}),
    version: card.version,
    name: content.name,
    userName: content.userName,
    description: content.description,
    openingPreview: content.opening.content.slice(0, 240),
    ...(content.catalogSource ? { catalogSource: structuredClone(content.catalogSource) } : {}),
    media: content.media,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
  }
}

type CardContentInput = Omit<CardSourceContent, 'preset' | 'opening' | 'lore'> & {
  preset?: CardPresetInput
  opening?: OpeningChatInput | string
  lore?: LoreInput
}

export function normalizeCardContent(content: CardContentInput): CardSourceContent {
  const legacyContent = content

  return {
    ...parseCardFrameworkFields(content as unknown as Record<string, unknown>),
    artifactId: content.artifactId,
    ...(content.derivedFrom ? { derivedFrom: structuredClone(content.derivedFrom) } : {}),
    name: typeof legacyContent.name === 'string' && legacyContent.name.trim().length > 0 ? legacyContent.name : 'Untitled Card',
    userName: normalizeOptionalString(legacyContent.userName),
    description: typeof legacyContent.description === 'string' ? legacyContent.description : undefined,
    importBundleId: normalizeOptionalString(legacyContent.importBundleId),
    portableExtensionPayloadIds: normalizeOptionalIdList(legacyContent.portableExtensionPayloadIds),
    ...(legacyContent.extensionPackages !== undefined ? { extensionPackages: structuredClone(legacyContent.extensionPackages) } : {}),
    promptResourceIds: normalizeOptionalIdList(legacyContent.promptResourceIds),
    ...(legacyContent.externalPromptResourceIds !== undefined ? {
      externalPromptResourceIds: legacyContent.externalPromptResourceIds.filter(id => legacyContent.promptResourceIds?.includes(id)),
    } : {}),
    stateDefinitionIds: normalizeOptionalIdList(legacyContent.stateDefinitionIds),
    ...(Array.isArray(legacyContent.stateTemplates) ? {
      stateTemplates: structuredClone(legacyContent.stateTemplates),
    } : {}),
    ...(Array.isArray(legacyContent.stateEntityTypes) ? {
      stateEntityTypes: structuredClone(legacyContent.stateEntityTypes),
    } : {}),
    ...(Array.isArray(legacyContent.timelineStateEntities) ? {
      timelineStateEntities: structuredClone(legacyContent.timelineStateEntities),
    } : {}),
    ...(Array.isArray(legacyContent.timelineComponentMounts) ? {
      timelineComponentMounts: structuredClone(legacyContent.timelineComponentMounts),
    } : {}),
    stateContributionIds: normalizeOptionalIdList(legacyContent.stateContributionIds),
    ...(legacyContent.extensionAdoptions !== undefined ? {
      extensionAdoptions: parseCardExtensionAdoptions(legacyContent.extensionAdoptions),
    } : {}),
    timelineStateBindings: structuredClone(legacyContent.timelineStateBindings ?? []),
    media: normalizeCardMedia(legacyContent.media),
    preset: normalizePreset(legacyContent.preset),
    opening: normalizeOpening(legacyContent.opening),
    lore: normalizeLore(legacyContent.lore),
    ...(legacyContent.macros !== undefined ? { macros: normalizeMacros(legacyContent.macros, 'Card') } : {}),
    ...(legacyContent.macroOptions !== undefined ? { macroOptions: normalizeMacroOptions(legacyContent.macroOptions) } : {}),
    createdAt: typeof legacyContent.createdAt === 'string' ? legacyContent.createdAt : nowIso(),
    updatedAt: typeof legacyContent.updatedAt === 'string' ? legacyContent.updatedAt : nowIso(),
  }
}

export function parseCardExtensionAdoptions(input: unknown): CardExtensionAdoption[] {
  if (!Array.isArray(input)) throw new Error('Card extensionAdoptions must be an array')
  const references = new Set<string>()
  return input.map(reference => {
    if (!isObject(reference) || typeof reference.packageId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(reference.packageId)
      || (reference.target !== 'global' && reference.target !== 'card')) {
      throw new Error('Card extension adoption requires a packageId and global or card target')
    }
    const key = JSON.stringify([reference.target, reference.packageId])
    if (references.has(key)) throw new Error('Duplicate Card extension adoption')
    references.add(key)
    return { packageId: reference.packageId, target: reference.target }
  })
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
    ...(input.macros !== undefined ? { macros: normalizeMacros(input.macros, 'Preset') } : {}),
    ...(input.macroOptions !== undefined ? { macroOptions: normalizeMacroOptions(input.macroOptions) } : {}),
  }
}

export function normalizeMacros(input: unknown, subject: string): Record<string, string> {
  if (!isObject(input)) throw new Error(`${subject} macros must be an object`)
  const macros: Record<string, string> = {}
  for (const [name, value] of Object.entries(input)) {
    assertWritableMacroName(name, subject.toLowerCase() + ' macro')
    if (typeof value !== 'string') throw new Error(`${subject} macro value must be a string: ${name}`)
    Object.defineProperty(macros, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    })
  }
  return macros
}

export function normalizeOpening(input: OpeningChatInput | string | undefined): OpeningChatContent {
  const ids = new Set<string>()
  function candidate(value: Omit<OpeningChatInput, 'alternatives'>): Omit<OpeningChatContent, 'alternatives'> {
    if (!isObject(value) || typeof value.content !== 'string' || 'entries' in value || 'role' in value) {
      throw new Error('Opening must contain a single string content')
    }
    if (value.id !== undefined && (typeof value.id !== 'string' || !value.id.trim())) throw new Error('Invalid opening ID')
    if (value.title !== undefined && typeof value.title !== 'string') throw new Error('Invalid opening title')
    const id = value.id ?? createId('opening')
    if (ids.has(id)) throw new Error(`Duplicate opening ID: ${id}`)
    ids.add(id)
    return {
      id,
      ...(value.title !== undefined ? { title: value.title } : {}),
      content: value.content,
    }
  }
  const opening: OpeningChatInput = typeof input === 'string' ? { content: input } : input ?? { content: '' }
  if (opening.alternatives !== undefined && !Array.isArray(opening.alternatives)) throw new Error('Opening alternatives must be an array')
  return {
    ...candidate(opening),
    ...(opening.alternatives?.length ? { alternatives: opening.alternatives.map(candidate) } : {}),
  }
}

export function normalizeLore(input: LoreInput | undefined): LoreContent {
  if (isObject(input) && Array.isArray(input.entries)) {
    return {
      entries: input.entries
        .filter(entry => isObject(entry) && typeof entry.content === 'string' && entry.content.trim().length > 0)
        .map(entry => ({
          id: typeof entry.id === 'string' ? entry.id : createId('lore'),
          path: typeof entry.path === 'string' ? entry.path : undefined,
          title: typeof entry.title === 'string' ? entry.title : undefined,
          content: entry.content,
          enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
          activation: isPromptActivation(entry.activation) ? entry.activation : { kind: 'always' },
          tags: Array.isArray(entry.tags) && entry.tags.every(tag => typeof tag === 'string') ? entry.tags : [],
        })),
    }
  }

  return { entries: [] }
}

export function readOpening(
  content: CardSourceContent,
  variables?: import('../prompt/variables.js').VariableRenderContext,
  openingId?: string,
): { id: string; title?: string; content: string } {
  const renderContext = variables ?? createVariableRenderContext({
    computed: {
      char: { name: content.name },
      bot: { name: content.name },
    },
  })

  const opening = openingId === undefined || openingId === content.opening.id
    ? content.opening : content.opening.alternatives?.find(candidate => candidate.id === openingId)
  if (!opening) throw new Error(`Opening not found: ${openingId}`)
  return {
    id: opening.id,
    ...(opening.title !== undefined ? { title: opening.title } : {}),
    content: renderVariableMacros(opening.content, renderContext),
  }
}
