import { z } from 'zod'

export * from './loom-script-metadata.js'
import { loomScriptSettingsSchema } from './loom-script-metadata.js'

export const loomScriptMountTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('workspace'), workspaceId: z.string() }),
  z.strictObject({ kind: z.literal('card'), cardId: z.string() }),
  z.strictObject({ kind: z.literal('preset'), presetId: z.string() }),
  z.strictObject({ kind: z.literal('user') }),
])
export const loomScriptOwnerSchema = z.union([
  loomScriptMountTargetSchema,
  z.strictObject({ kind: z.literal('extension'),
    packageId: z.string().refine(value => value.trim().length > 0),
    installationId: z.string().refine(value => value.trim().length > 0),
  }),
])
export type LoomScriptMountTarget = z.infer<typeof loomScriptMountTargetSchema>
export type LoomScriptOwner = z.infer<typeof loomScriptOwnerSchema>

export const loomScriptMountSchema = z.object({
  id: z.string(), version: z.number(), target: loomScriptMountTargetSchema,
  scriptDocumentId: z.string(), enabled: z.boolean(), orderIndex: z.number(),
  pinnedDocumentVersion: z.number().optional(), grantedCapabilities: z.array(z.string()),
  adoptedDocumentVersion: z.number().optional(),
  settings: loomScriptSettingsSchema.optional(), adoptedSettings: loomScriptSettingsSchema.optional(),
  runtimeRevision: z.number().int().nonnegative().optional(),
  origin: z.record(z.string(), z.json()), createdAt: z.string(), updatedAt: z.string(),
})
export type LoomScriptMount = z.infer<typeof loomScriptMountSchema>
export const createLoomScriptMountInputSchema = z.strictObject({
  target: loomScriptMountTargetSchema, scriptDocumentId: z.string(), orderIndex: z.number(),
  pinnedDocumentVersion: z.number().optional(), origin: z.record(z.string(), z.json()).optional(),
})
export const updateLoomScriptMountInputSchema = z.strictObject({
  mountId: z.string(), expectedVersion: z.number(), enabled: z.boolean(), orderIndex: z.number(),
  pinnedDocumentVersion: z.number().optional(), grantedCapabilities: z.array(z.string()),
  settings: loomScriptSettingsSchema.optional(),
})
export const listLoomScriptMountsInputSchema = z.strictObject({
  target: loomScriptMountTargetSchema.optional(), scriptDocumentId: z.string().optional(),
})
export type CreateLoomScriptMountInput = z.infer<typeof createLoomScriptMountInputSchema>
export type UpdateLoomScriptMountInput = z.infer<typeof updateLoomScriptMountInputSchema>
export type ListLoomScriptMountsInput = z.infer<typeof listLoomScriptMountsInputSchema>
export type MutateLoomScriptMountResult = { mount: LoomScriptMount; mutation: { changesetId: string } }
export type ListLoomScriptMountsResult = { mounts: LoomScriptMount[] }
