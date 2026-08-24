import type {
  DataActorRef,
  DataCommitFact,
  SqliteDataTransaction,
  SqliteDataEngine,
} from '@loom-studio/data-engine'
import type { JsonObject, JsonValue } from '@loom-studio/shared'

export type PromptResourceKind = 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt'
export type PromptResourceNodeKind = 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'order'

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

export type PromptResourceWriteContext = {
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

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

export type ListPromptResourcesInput = {
  resourceKind?: PromptResourceKind
  includeTombstone?: boolean
  cursor?: string
  limit?: number
}

export type PromptResourcePage = {
  resources: PromptResource[]
  nextCursor?: string
}

export type SettingMountSource =
  | { kind: 'manual'; id?: 'global' }
  | { kind: 'preset'; id: string }

export type SettingMount = {
  id: string
  settingResourceId: string
  source: SettingMountSource
  orderIndex: number
  origin: JsonObject
  createdAt: string
}

export type AddSettingMountInput = PromptResourceWriteContext & {
  settingResourceId: string
  source: SettingMountSource
  orderIndex: number
  origin?: JsonObject
}

export type ReplaceSettingMountsInput = PromptResourceWriteContext & {
  source: SettingMountSource
  mounts: Array<Pick<AddSettingMountInput, 'settingResourceId' | 'orderIndex' | 'origin'>>
}

export type ListSettingMountsInput = {
  source?: SettingMountSource
  settingResourceId?: string
}

export type PresetToolMount = {
  id: string
  presetResourceId: string
  toolId: string
  orderIndex: number
  defaultEnabled: boolean
  activation?: JsonObject
  provider?: { order?: number }
  content?: {
    zone?: string
    slot?: string
    rankKey?: string
    orderHint?: number
  }
  origin: JsonObject
  createdAt: string
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

export type SettingMountMutationResult = {
  mounts: SettingMount[]
  commit: DataCommitFact
}

export type PresetToolMountMutationResult = {
  mounts: PresetToolMount[]
  commit: DataCommitFact
}

export type PromptResourceTransaction = {
  createResource(input: Omit<CreatePromptResourceInput, keyof PromptResourceWriteContext>): PromptResource
  mutateResource(input: Omit<MutatePromptResourceInput, keyof PromptResourceWriteContext>): PromptResource
  deleteResource(input: Omit<DeletePromptResourceInput, keyof PromptResourceWriteContext>): PromptResource
  addSettingMount(input: Omit<AddSettingMountInput, keyof PromptResourceWriteContext>): SettingMount
  replaceSettingMounts(input: Omit<ReplaceSettingMountsInput, keyof PromptResourceWriteContext>): SettingMount[]
  addPresetToolMount(input: Omit<AddPresetToolMountInput, keyof PromptResourceWriteContext>): PresetToolMount
  replacePresetToolMounts(input: Omit<ReplacePresetToolMountsInput, keyof PromptResourceWriteContext>): PresetToolMount[]
}

export type PromptResourceStore = {
  getResource(id: string, options?: { includeTombstone?: boolean }): Promise<PromptResource | null>
  listResources(input?: ListPromptResourcesInput): Promise<PromptResourcePage>
  listSettingMounts(input?: ListSettingMountsInput): Promise<SettingMount[]>
  listPresetToolMounts(input?: ListPresetToolMountsInput): Promise<PresetToolMount[]>
  createResource(input: CreatePromptResourceInput): Promise<PromptResourceMutationResult>
  mutateResource(input: MutatePromptResourceInput): Promise<PromptResourceMutationResult>
  deleteResource(input: DeletePromptResourceInput): Promise<PromptResourceMutationResult>
  addSettingMount(input: AddSettingMountInput): Promise<SettingMountMutationResult>
  replaceSettingMounts(input: ReplaceSettingMountsInput): Promise<SettingMountMutationResult>
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
