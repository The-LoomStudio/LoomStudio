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
