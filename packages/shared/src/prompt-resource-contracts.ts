import { z } from 'zod'

export const settingMountSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual'), id: z.literal('global').optional() }),
  z.object({ kind: z.literal('preset'), id: z.string() }),
])

export const settingMountSchema = z.object({
  id: z.string(),
  settingResourceId: z.string(),
  resolvedSettingResourceId: z.string().nullable().optional(),
  reference: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('package'), contributionId: z.string() }),
    z.object({ kind: z.literal('external'), resourceId: z.string(), origin: z.object({
      packageId: z.string(), contributionId: z.string(), target: z.enum(['global', 'card']),
    }).optional() }),
  ]).optional(),
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
  settingResourceIds: z.array(z.string()).optional(),
  mounts: z.array(z.union([
    z.object({ id: z.string() }),
    z.object({ settingResourceId: z.string() }),
  ])).optional(),
}).refine(input => (input.settingResourceIds === undefined) !== (input.mounts === undefined), {
  message: 'Specify exactly one Setting mount list',
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
