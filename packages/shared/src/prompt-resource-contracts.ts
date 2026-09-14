import { z } from 'zod'

export const settingMountSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual'), id: z.literal('global').optional() }),
  z.object({ kind: z.literal('preset'), id: z.string() }),
])

export const settingMountSchema = z.object({
  id: z.string(),
  settingResourceId: z.string(),
  source: settingMountSourceSchema,
  orderIndex: z.number().int(),
  origin: z.record(z.string(), z.json()),
  createdAt: z.string(),
})

export const listSettingMountsInputSchema = z.object({
  source: settingMountSourceSchema.optional(),
})

export const listSettingMountsResultSchema = z.object({
  mounts: z.array(settingMountSchema),
})

export const replaceSettingMountsInputSchema = z.object({
  source: settingMountSourceSchema,
  settingResourceIds: z.array(z.string()),
})

export const replaceSettingMountsResultSchema = z.object({
  mounts: z.array(settingMountSchema),
  mutation: z.object({ changesetId: z.string() }),
})

export type SettingMountSource = z.infer<typeof settingMountSourceSchema>
export type SettingMount = z.infer<typeof settingMountSchema>
export type ListSettingMountsInput = z.infer<typeof listSettingMountsInputSchema>
export type ListSettingMountsResult = z.infer<typeof listSettingMountsResultSchema>
export type ReplaceSettingMountsInput = z.infer<typeof replaceSettingMountsInputSchema>
export type ReplaceSettingMountsResult = z.infer<typeof replaceSettingMountsResultSchema>
