import type { PromptResource } from '../../../../entities/index.js'

/** Presentation data. Resource ownership and mutations stay with the caller. */
export type PresetLibraryNode = {
  id: string
  kind: 'message' | 'folder' | 'entry' | 'anchor' | 'sequence'
  label: string
  role?: 'system' | 'user' | 'assistant'
  body?: string
  children?: PresetLibraryNode[]
}
export type PresetLibrarySource = {
  id: string
  name: string
  kind: 'personal' | 'package' | 'official'
  author?: string
  version?: string
  description: string
}
export type PresetLibraryResource = {
  id: string
  sourceId: string
  name: string
  kind: 'Lore' | '正则' | '脚本' | '模块'
  description: string
  body: string
}
export type PresetLibraryOption = {
  id: string
  name: string
  description: string
}
export type PresetLibraryConfiguration = {
  modelId?: string
  delivery?: 'stream' | 'complete'
  approvalPolicy?: PromptResource['approvalPolicy']
  useGlobalLore?: boolean
  useCharacterLore?: boolean
  toolIds: string[]
}
export type PresetLibraryItem = PresetLibraryConfiguration & {
  id: string
  sourceId: string
  name: string
  description: string
  tag: string
  nodes: PresetLibraryNode[]
  resourceIds: string[]
}
export type PresetCopyRequest = {
  sourceId: string
  targetId: string
  nodeIds: string[]
  messageId?: string
  includeResources: boolean
}
export function flattenPresetLibraryNodes(nodes: PresetLibraryNode[]): PresetLibraryNode[] {
  return nodes.flatMap(node => [node, ...flattenPresetLibraryNodes(node.children ?? [])])
}
/** A selected parent already includes its descendants. */
export function selectedPresetLibraryNodes(nodes: PresetLibraryNode[], ids: string[]): PresetLibraryNode[] {
  return nodes.flatMap(node => ids.includes(node.id) ? [node] : selectedPresetLibraryNodes(node.children ?? [], ids))
}
