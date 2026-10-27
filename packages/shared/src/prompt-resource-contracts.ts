import { z } from 'zod'

/** The Session inlet expands native messages; all other anchors receive text. */
export function promptAnchorOutput(anchorId: string): 'text' | 'messages' {
  return anchorId === '@chat.session' ? 'messages' : 'text'
}

export type PromptAuthoringNode = {
  id: string
  kind: string
  capabilities?: { targetAnchorId?: string }
  children?: readonly PromptAuthoringNode[]
}

export function isPromptMessageSequence(node: PromptAuthoringNode): boolean {
  return node.kind === 'virtual' && promptAnchorOutput(node.capabilities?.targetAnchorId ?? node.id) === 'messages'
}

/** Folders preserve their surrounding level; they cannot hide nested message units. */
export function canPlacePromptNode(root: PromptAuthoringNode, parentId: string, child: PromptAuthoringNode): boolean {
  function path(node: PromptAuthoringNode): PromptAuthoringNode[] | undefined {
    if (node.id === parentId) return [node]
    for (const item of node.children ?? []) {
      const found = path(item)
      if (found) return [node, ...found]
    }
  }
  const parents = path(root)
  if (!parents || !['module', 'folder', 'message'].includes(parents.at(-1)!.kind)) return false
  function valid(node: PromptAuthoringNode, insideMessage: boolean): boolean {
    if (isPromptMessageSequence(node)) return !insideMessage && !node.children?.length
    if (node.kind === 'message' && insideMessage) return false
    if (!['module', 'folder', 'message'].includes(node.kind) && node.children?.length) return false
    return (node.children ?? []).every(item => valid(item, insideMessage || node.kind === 'message'))
  }
  const incomingIds = new Set<string>()
  let incomingSequences = 0
  function inspect(node: PromptAuthoringNode) {
    incomingIds.add(node.id)
    if (isPromptMessageSequence(node)) incomingSequences++
    for (const item of node.children ?? []) inspect(item)
  }
  inspect(child)
  function hasOtherSequence(node: PromptAuthoringNode): boolean {
    return (!incomingIds.has(node.id) && isPromptMessageSequence(node)) || (node.children ?? []).some(hasOtherSequence)
  }
  if (incomingSequences > 1 || (incomingSequences === 1 && hasOtherSequence(root))) return false
  return valid(child, parents.some(node => node.kind === 'message'))
}

export const loreMountSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual'), id: z.literal('global').optional() }),
  z.object({ kind: z.literal('preset'), id: z.string() }),
])

export const loreMountSchema = z.object({
  id: z.string(),
  loreResourceId: z.string(),
  resolvedLoreResourceId: z.string().nullable().optional(),
  reference: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('package'), contributionId: z.string() }),
    z.object({ kind: z.literal('external'), resourceId: z.string(), origin: z.object({
      packageId: z.string(), contributionId: z.string(), target: z.enum(['global', 'card']),
    }).optional() }),
  ]).optional(),
  source: loreMountSourceSchema,
  orderIndex: z.number().int(),
  origin: z.record(z.string(), z.json()),
  createdAt: z.string(),
})

export const listLoreMountsInputSchema = z.object({
  source: loreMountSourceSchema.optional(),
})

export const listLoreMountsResultSchema = z.object({
  mounts: z.array(loreMountSchema),
})

export const replaceLoreMountsInputSchema = z.object({
  source: loreMountSourceSchema,
  loreResourceIds: z.array(z.string()).optional(),
  mounts: z.array(z.union([
    z.object({ id: z.string() }),
    z.object({ loreResourceId: z.string() }),
  ])).optional(),
}).refine(input => (input.loreResourceIds === undefined) !== (input.mounts === undefined), {
  message: 'Specify exactly one Lore mount list',
})

export const replaceLoreMountsResultSchema = z.object({
  mounts: z.array(loreMountSchema),
  mutation: z.object({ changesetId: z.string() }),
})

export type LoreMountSource = z.infer<typeof loreMountSourceSchema>
export type LoreMount = z.infer<typeof loreMountSchema>
export type ListLoreMountsInput = z.infer<typeof listLoreMountsInputSchema>
export type ListLoreMountsResult = z.infer<typeof listLoreMountsResultSchema>
export type ReplaceLoreMountsInput = z.infer<typeof replaceLoreMountsInputSchema>
export type ReplaceLoreMountsResult = z.infer<typeof replaceLoreMountsResultSchema>

/** Package-owned display metadata; references remain meaningful when a preset is copied. */
export const promptResourceDisplayMetadataSchema = z.object({
  icon: z.object({
    kind: z.literal('package'),
    packageId: z.string().regex(/^[A-Za-z0-9._-]+$/),
    path: z.string().min(1).refine(path => !path.startsWith('/') && !path.includes('\\')
      && !path.includes(':') && path.split('/').every(part => part !== '..' && part !== '.' && part !== ''), 'Expected a package-relative file path'),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('global') }),
      z.object({ kind: z.literal('card'), cardId: z.string().min(1) }),
    ]).optional(),
  }).strict().optional(),
}).strict()
export type PromptResourceDisplayMetadata = z.infer<typeof promptResourceDisplayMetadataSchema>
