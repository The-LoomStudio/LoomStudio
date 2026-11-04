import type { DataTransactionInput } from '@loom-studio/data-engine'
import type { PresetToolMount } from '@loom-studio/shared/tool-mounts'
export type { PresetToolMount } from '@loom-studio/shared/tool-mounts'
import type {
  DataActorRef,
  DataCommitFact,
  SqliteDataTransaction,
  SqliteDataEngine,
} from '@loom-studio/data-engine'
import type { JsonObject, JsonValue, LoreMount, LoreMountSource } from '@loom-studio/shared'
export type { LoreMount, LoreMountSource } from '@loom-studio/shared'

export type PromptResourceKind = 'preset' | 'lore' | 'logic' | 'runtime' | 'history' | 'prompt' | (string & {})
export type PromptResourceNodeKind = 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'slot' | 'message' | (string & {})

export type PromptResourceNode = {
  id: string
  resourceId: string
  parentId?: string
  orderIndex: number
  kind: PromptResourceNodeKind
  category?: PromptResourceKind
  label: string
  meta?: string
  enabled?: boolean
  body?: string
  capabilities?: JsonValue
  extra?: JsonObject
  createdAt: string
  updatedAt: string
}

export type PromptResourceTreeNode = Omit<PromptResourceNode, 'resourceId' | 'parentId' | 'orderIndex' | 'createdAt' | 'updatedAt'> & {
  children?: PromptResourceTreeNode[]
}

export type PromptResource = {
  id: string
  resourceKind: PromptResourceKind
  rootNodeId: string
  label: string
  version: number
  metadata: JsonObject
  rootNode: PromptResourceTreeNode
  createdAt: string
  updatedAt: string
  tombstoned?: boolean
  deletedAt?: string
  deletedBy?: DataActorRef
  deleteReason?: string
}

export type PromptResourceWriteContext = DataTransactionInput

export type CreatePromptResourceInput = PromptResourceWriteContext & {
  id?: string
  resourceKind: PromptResourceKind
  label?: string
  metadata?: JsonObject
  rootNode: PromptResourceTreeNode
}

export type PromptResourceNodeDraft = Omit<PromptResourceTreeNode, 'children'> & {
  orderIndex?: number
}

export type PromptResourceNodePatch = {
  label?: string
  category?: PromptResourceNodeDraft['category'] | null
  meta?: string | null
  enabled?: boolean | null
  body?: string | null
  capabilities?: JsonValue | null
  extra?: JsonObject | null
}

export type PromptResourceMutation =
  | { kind: 'tree.replace'; rootNode: PromptResourceTreeNode }
  | { kind: 'node.create'; parentId: string; node: PromptResourceNodeDraft }
  | { kind: 'node.update'; nodeId: string; patch: PromptResourceNodePatch }
  | { kind: 'node.move'; nodeId: string; parentId: string; orderIndex: number }
  | { kind: 'node.delete'; nodeId: string }
  | { kind: 'resource.update'; patch: { label?: string; metadata?: JsonObject } }

export type MutatePromptResourceInput = PromptResourceWriteContext & {
  resourceId: string
  expectedVersion: number
  mutations: PromptResourceMutation[]
}

export type DeletePromptResourceInput = PromptResourceWriteContext & {
  resourceId: string
  expectedVersion?: number
}

export type RestorePromptResourceInput = PromptResourceWriteContext & {
  resourceId: string
  expectedVersion?: number
}

export type ListPromptResourcesInput = {
  order?: 'updatedAt' | 'id'
  resourceKind?: PromptResourceKind
  includeTombstone?: boolean
  cursor?: string
  limit?: number
}

export type PromptResourceHeader = Pick<PromptResource, 'id' | 'resourceKind' | 'rootNodeId' | 'label' | 'version' | 'createdAt' | 'updatedAt' | 'tombstoned'>

export type PromptResourcePage = {
  resources: PromptResource[]
  nextCursor?: string
}

export type PromptResourceSearchKind = 'lore' | 'preset'

export type PromptResourceSearchHeader = {
  id: string
  resourceKind: PromptResourceSearchKind
  label: string
  rootNodeId: string
  metadata: JsonObject
}

export type SearchPromptResourceNodesInput = {
  query: string
  resourceIds?: string[]
  resourceKinds?: PromptResourceSearchKind[]
  limit?: number
  cursor?: string
}

export type PromptResourceSearchHit = {
  resourceId: string
  nodeId: string
  resourceKind: PromptResourceSearchKind
  resourceLabel: string
  label: string
  path: string[]
  snippet: string
  matchField: 'label' | 'meta' | 'body'
  rank: number
}

export type PromptResourceSearchPage = {
  hits: PromptResourceSearchHit[]
  nextCursor?: string
}

export type AddLoreMountInput = PromptResourceWriteContext & {
  loreResourceId: string | null
  reference?: LoreMount['reference']
  source: LoreMountSource
  orderIndex: number
  origin?: JsonObject
}

export type ReplaceLoreMountsInput = PromptResourceWriteContext & {
  expectedMountIds: string[]
  source: LoreMountSource
  mounts: Array<Pick<AddLoreMountInput, 'loreResourceId' | 'reference' | 'orderIndex' | 'origin'>>
}

export type ListLoreMountsInput = {
  source?: LoreMountSource
  loreResourceId?: string
}

export type AddPresetToolMountInput = PromptResourceWriteContext & {
  presetResourceId: string
  toolId: string
  orderIndex: number
  defaultEnabled: boolean
  activation?: JsonObject
  provider?: PresetToolMount['provider']
  content?: PresetToolMount['content']
  origin?: JsonObject
}

export type ReplacePresetToolMountsInput = PromptResourceWriteContext & {
  expectedMountIds: string[]
  presetResourceId: string
  mounts: Array<Omit<AddPresetToolMountInput, keyof PromptResourceWriteContext | 'presetResourceId'>>
}

export type ListPresetToolMountsInput = {
  presetResourceId?: string
  toolId?: string
}

export type RevertPromptResourceChangesetInput = PromptResourceWriteContext & {
  changesetId: string
  expectedVersion?: number
}

export type PromptResourceMutationResult = {
  resource: PromptResource
  commit: DataCommitFact
}

export type LoreMountMutationResult = {
  mounts: LoreMount[]
  commit: DataCommitFact
}

export type PresetToolMountMutationResult = {
  mounts: PresetToolMount[]
  commit: DataCommitFact
}

export type PromptResourceTransaction = {
  listResources(input?: ListPromptResourcesInput): PromptResourcePage
  listLoreMounts(input?: ListLoreMountsInput): LoreMount[]
  listPresetToolMounts(input?: ListPresetToolMountsInput): PresetToolMount[]
  createResource(input: Omit<CreatePromptResourceInput, keyof PromptResourceWriteContext>): PromptResource
  mutateResource(input: Omit<MutatePromptResourceInput, keyof PromptResourceWriteContext>): PromptResource
  deleteResource(input: Omit<DeletePromptResourceInput, keyof PromptResourceWriteContext>): PromptResource
  restoreResource(input: Omit<RestorePromptResourceInput, keyof PromptResourceWriteContext>): PromptResource
  addLoreMount(input: Omit<AddLoreMountInput, keyof PromptResourceWriteContext>): LoreMount
  replaceLoreMounts(input: Omit<ReplaceLoreMountsInput, keyof PromptResourceWriteContext>): LoreMount[]
  addPresetToolMount(input: Omit<AddPresetToolMountInput, keyof PromptResourceWriteContext>): PresetToolMount
  replacePresetToolMounts(input: Omit<ReplacePresetToolMountsInput, keyof PromptResourceWriteContext>): PresetToolMount[]
}

export type PromptResourceStore = {
  hasResource(id: string): Promise<boolean>
  getResource(id: string, options?: { includeTombstone?: boolean }): Promise<PromptResource | null>
  getResourceMetadataAtVersion(id: string, version: number): Promise<JsonObject | null>
  listResources(input?: ListPromptResourcesInput): Promise<PromptResourcePage>
  listResourceHeaders(input?: ListPromptResourcesInput): Promise<{ resources: PromptResourceHeader[]; nextCursor?: string }>
  listSearchResources(): Promise<Array<PromptResourceSearchHeader | { id: string; label: string; error: string }>>
  searchNodes(input: SearchPromptResourceNodesInput): Promise<PromptResourceSearchPage>
  listSearchNodes(input: { resourceId: string; limit?: number; cursor?: string }): Promise<PromptResourceSearchPage>
  listLoreMounts(input?: ListLoreMountsInput): Promise<LoreMount[]>
  listPresetToolMounts(input?: ListPresetToolMountsInput): Promise<PresetToolMount[]>
  createResource(input: CreatePromptResourceInput): Promise<PromptResourceMutationResult>
  mutateResource(input: MutatePromptResourceInput): Promise<PromptResourceMutationResult>
  deleteResource(input: DeletePromptResourceInput): Promise<PromptResourceMutationResult>
  restoreResource(input: RestorePromptResourceInput): Promise<PromptResourceMutationResult>
  addLoreMount(input: AddLoreMountInput): Promise<LoreMountMutationResult>
  replaceLoreMounts(input: ReplaceLoreMountsInput): Promise<LoreMountMutationResult>
  addPresetToolMount(input: AddPresetToolMountInput): Promise<PresetToolMountMutationResult>
  replacePresetToolMounts(input: ReplacePresetToolMountsInput): Promise<PresetToolMountMutationResult>
  revertChangeset(input: RevertPromptResourceChangesetInput): Promise<PromptResourceMutationResult>
  transaction(tx: SqliteDataTransaction): PromptResourceTransaction
}

export type PromptResourceStoreOptions = {
  engine: SqliteDataEngine
  createId?(prefix: string): string
  now?(): string
}

export class PromptResourceStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PromptResourceStoreError'
  }
}
