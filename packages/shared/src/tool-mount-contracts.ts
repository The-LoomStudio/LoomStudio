import { z } from 'zod'
import { promptAnchorOutput } from './prompt-resource-contracts.js'

export const toolContentPlacementSchema = z.strictObject({
  targetAnchorId: z.string().trim().min(1).refine(id => promptAnchorOutput(id) === 'text', 'Tool descriptions require a text anchor').optional(),
  localDepth: z.number().finite().optional(),
})
export type ToolContentPlacement = z.infer<typeof toolContentPlacementSchema>

export const presetToolMountInputSchema = z.strictObject({
  toolId: z.string().min(1),
  orderIndex: z.number().int().nonnegative(),
  defaultEnabled: z.boolean(),
  // Runtime owns semantic validation of activation expressions.
  activation: z.record(z.string(), z.json()).optional(),
  provider: z.strictObject({ order: z.number().finite().optional() }).optional(),
  content: toolContentPlacementSchema.optional(),
})
export const presetToolMountSchema = presetToolMountInputSchema.extend({
  id: z.string(),
  presetResourceId: z.string(),
  origin: z.record(z.string(), z.json()),
  createdAt: z.string(),
})
export const listPresetToolMountsInputSchema = z.strictObject({
  presetId: z.string().optional(),
  toolId: z.string().optional(),
})
export const listPresetToolMountsResultSchema = z.object({ mounts: z.array(presetToolMountSchema) })
export const replacePresetToolMountsInputSchema = z.strictObject({
  expectedMountIds: z.array(z.string().min(1)),
  presetId: z.string().min(1),
  mounts: z.array(presetToolMountInputSchema),
})
export const replacePresetToolMountsResultSchema = listPresetToolMountsResultSchema.extend({
  mutation: z.object({ changesetId: z.string() }),
})
export type PresetToolMount = z.infer<typeof presetToolMountSchema>
export type PresetToolMountInput = z.infer<typeof presetToolMountInputSchema>
export type ListPresetToolMountsInput = z.infer<typeof listPresetToolMountsInputSchema>
export type ListPresetToolMountsResult = z.infer<typeof listPresetToolMountsResultSchema>
export type ReplacePresetToolMountsInput = z.infer<typeof replacePresetToolMountsInputSchema>
export type ReplacePresetToolMountsResult = z.infer<typeof replacePresetToolMountsResultSchema>

/** Portable identity; resolving a reference never grants execution permission. */
export const toolReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('host'), toolId: z.string().trim().min(1) }),
  z.strictObject({ kind: z.literal('package'), contributionId: z.string().trim().min(1) }),
  z.strictObject({ kind: z.literal('external'), packageId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/), contributionId: z.string().trim().min(1), target: z.enum(['global', 'card']) }),
])
export type AgentToolReference = z.infer<typeof toolReferenceSchema>
export const extensionToolMountSchema = z.strictObject({
  toolId: z.string().trim().min(1).optional(),
  reference: toolReferenceSchema.optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  defaultEnabled: z.boolean().optional(),
  activation: z.record(z.string(), z.json()).optional(),
  provider: z.strictObject({ order: z.number().finite().optional() }).optional(),
  content: toolContentPlacementSchema.optional(),
}).refine(value => (value.toolId === undefined) !== (value.reference === undefined), 'Specify exactly one toolId or reference')
export type ExtensionToolMount = z.infer<typeof extensionToolMountSchema>
export const authoringToolMountSchema = extensionToolMountSchema.safeExtend({
  orderIndex: z.number().int().nonnegative(), defaultEnabled: z.boolean(),
})
