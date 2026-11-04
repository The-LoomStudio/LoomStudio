import { z } from 'zod'
import type { JsonValue } from './index.js'
import { stripPromptAuthorDepth, canPlacePromptNode, loreMountSchema, promptResourceDisplayMetadataSchema } from './prompt-resource-contracts.js'
import { authoringToolMountSchema } from './tool-mount-contracts.js'

export type AuthoringNode = {
  id: string; kind: 'module' | 'folder' | 'entry' | 'virtual' | 'message'; label: string
  category?: string; meta?: string; enabled?: boolean; body?: string
  capabilities?: Record<string, JsonValue> & { roleHint?: 'system' | 'user' | 'assistant'; targetAnchorId?: string }; extra?: Record<string, JsonValue>
  children?: AuthoringNode[]
}
export const authoringNodeSchema: z.ZodType<AuthoringNode> = z.lazy(() => z.strictObject({
  id: z.string().min(1), kind: z.enum(['module', 'folder', 'entry', 'virtual', 'message']), label: z.string(),
  category: z.string().optional(), meta: z.string().refine(value => value !== 'message.developer', 'Unsupported Prompt message role').optional(), enabled: z.boolean().optional(), body: z.string().optional(),
  capabilities: z.object({ roleHint: z.enum(['system', 'user', 'assistant']).optional(), targetAnchorId: z.string().optional() }).catchall(z.json()).transform(stripPromptAuthorDepth).optional(), extra: z.record(z.string(), z.json()).optional(),
  children: z.array(authoringNodeSchema).optional(),
}))
export const authoringResourceSchema = z.strictObject({
  format: z.literal('loom.resource.authoring'), schemaVersion: z.literal(1),
  id: z.string().min(1), resourceKind: z.enum(['preset', 'lore']), rootNode: authoringNodeSchema,
  metadata: z.strictObject({ icon: promptResourceDisplayMetadataSchema.shape.icon.unwrap().omit({ target: true }).optional() }).optional(),
  macros: z.record(z.string(), z.string()).optional(), macroOptions: z.record(z.string(), z.array(z.strictObject({ id: z.string(), label: z.string(), value: z.string() }))).optional(),
  useCardLore: z.boolean().optional(), useGlobalLore: z.boolean().optional(),
  useCardText: z.boolean().optional(), useGlobalText: z.boolean().optional(),
  loreMounts: z.array(loreMountSchema.shape.reference.unwrap()).optional(),
  toolMounts: z.array(authoringToolMountSchema).optional(),
}).superRefine((resource, ctx) => {
  const ids = new Set<string>()
  const walk = (node: AuthoringNode, depth: number) => {
    if (depth > 128) { ctx.addIssue({ code: 'custom', message: 'Tree exceeds 128 levels' }); return }
    if (ids.has(node.id)) ctx.addIssue({ code: 'custom', message: `Duplicate node ID: ${node.id}` })
    ids.add(node.id)
    for (const child of node.children ?? []) {
      if (!canPlacePromptNode(resource.rootNode, node.id, child)) ctx.addIssue({ code: 'custom', message: `Invalid child placement: ${child.id}` })
      walk(child, depth + 1)
    }
  }
  if (resource.rootNode.kind !== 'module') ctx.addIssue({ code: 'custom', message: 'Root must be a module' })
  walk(resource.rootNode, 0)
})
export type AuthoringResource = z.infer<typeof authoringResourceSchema>
export const authoringApplySchema = z.strictObject({
  resources: z.array(z.strictObject({ resource: authoringResourceSchema, expectedVersion: z.number().int().positive().optional(), expectedDigest: z.string().optional(), create: z.boolean().optional() })).min(1),
})
export type AuthoringApplyInput = z.infer<typeof authoringApplySchema>
export const authoringStateSchema = z.strictObject({
  schemaVersion: z.literal(1), endpoint: z.string().url(),
  resources: z.array(z.strictObject({ directory: z.string(), resourceId: z.string(), version: z.number().int().positive(), digest: z.string(), contributionId: z.string().optional() })),
})
export type AuthoringState = z.infer<typeof authoringStateSchema>
