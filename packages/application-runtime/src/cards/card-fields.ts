import { normalizeMacroOptions } from '@loom-studio/shared'
import type { CardSourceContent } from '../types.js'
import type { CardBundleArtifact } from './card-bundle-types.js'
import { normalizeLore, normalizeMacros, normalizeOpening, normalizeOptionalString, normalizePreset } from './card.js'

// Identity, media, State and extension adoption have separate ownership and validation.
type CardEditableFields = Pick<CardSourceContent,
  'name' | 'userName' | 'description' | 'preset' | 'opening' | 'lore' | 'macros' | 'macroOptions'
>

export function readCardEditableFields(card: CardEditableFields): CardEditableFields {
  return {
    name: card.name,
    userName: card.userName,
    description: card.description,
    preset: card.preset,
    opening: card.opening,
    lore: card.lore,
    macros: card.macros,
    macroOptions: card.macroOptions,
  }
}

type CardEditableInput = Pick<CardBundleArtifact['card'], keyof CardEditableFields>

export function normalizeCardEditableFields(card: CardEditableInput): CardEditableFields {
  return readCardEditableFields({
    ...card,
    userName: normalizeOptionalString(card.userName),
    preset: normalizePreset(card.preset),
    opening: normalizeOpening(card.opening),
    lore: normalizeLore(card.lore),
    macros: card.macros === undefined ? undefined : normalizeMacros(card.macros, 'Card'),
    macroOptions: card.macroOptions === undefined ? undefined : normalizeMacroOptions(card.macroOptions),
  })
}
