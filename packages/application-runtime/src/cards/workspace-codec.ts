import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { PromptContribution, SourceNode } from '../prompt/prompt-builder.js'
import { combineActivationGates, isPromptActivation, type PromptActivation } from '../prompt/prompt-activation.js'
import { renderVariableMacros, type VariableRenderContext } from '../prompt/variables.js'
import { isObject } from '../foundation/json.js'
import { validateStateDefinitionDraft, validateTimelineStateBinding } from '../state/state-definition.js'
import { parseStateArtifact } from '../state/state-contribution.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import { validateTextExtractorDraft, validateTextTransformRuleDraft, type TextExtractorDraft, type TextTransformRuleDraft } from '../transforms/history-text.js'
import type { LoomScriptAttachmentArtifact } from '../scripts/loom-script-contracts.js'
import type { StateDefinitionDraft, TimelineStateBinding } from '../types.js'
import type {
  CardBundleArtifact,
  CardBundleImportManifest,
  CardBundleSourceArtifactRef,
  ImportBundleContent,
  PortableExtensionPayloadArtifact,
  PortableExtensionPayloadContent,
  PromptResourceArtifact,
  PromptResourceCompositionCapabilities,
  PromptResourceContent,
  PromptResourceKind,
  PromptResourceNode,
} from './workspace-types.js'

export function isPromptResourceArtifact(value: JsonValue | undefined): value is PromptResourceArtifact {
  try {
    assertPromptResourceArtifact(value)
    return true
  } catch {
    return false
  }
}

export function normalizePromptResourceArtifact(artifact: PromptResourceArtifact): PromptResourceArtifact {
  assertPromptResourceArtifact(artifact)
  return {
    ...structuredClone(artifact),
    schemaVersion: 2,
    scriptAttachments: structuredClone(artifact.scriptAttachments ?? []),
    ...(artifact.textTransformRules !== undefined ? { textTransformRules: structuredClone(artifact.textTransformRules) } : {}),
  }
}
type PromptContributionResourceNode = PromptResourceNode & {
  body: string
  capabilities: PromptResourceCompositionCapabilities & {
    targetAnchorId: NonNullable<PromptResourceCompositionCapabilities['targetAnchorId']>
  }
}
export function normalizeCardBundleArtifact(artifact: CardBundleArtifact): CardBundleArtifact {
  assertCardBundleArtifact(artifact)

  return {
    ...artifact,
    schemaVersion: 4,
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    description: artifact.description,
    card: artifact.card,
    contextAssets: artifact.contextAssets ?? [],
    extensionPayloads: structuredClone(artifact.extensionPayloads ?? []),
    scriptAttachments: structuredClone(artifact.scriptAttachments ?? []),
    metadata: artifact.metadata ?? {},
  }
}

export function toPortableExtensionPayloadArtifact(content: PortableExtensionPayloadContent): PortableExtensionPayloadArtifact {
  return {
    id: content.artifactPayloadId,
    packageId: content.packageId,
    fileName: content.fileName,
    format: content.format,
    mediaType: content.mediaType,
    ...(content.schemaVersion !== undefined ? { schemaVersion: content.schemaVersion } : {}),
    ...(content.requirement !== undefined ? { requirement: structuredClone(content.requirement) } : {}),
    ...(content.metadata !== undefined ? { metadata: structuredClone(content.metadata) } : {}),
    content: content.content,
    ...(content.resourceOrigin !== undefined ? { resourceOrigin: content.resourceOrigin } : {}),
  }
}

export function createSourceArtifactRef(
  artifact: CardBundleArtifact,
  importedAt: string,
  stored?: Pick<
    CardBundleSourceArtifactRef,
    'sourceArtifactId' | 'blobId' | 'sha256' | 'sizeBytes' | 'originalFileName' | 'mediaType'
  >,
): CardBundleSourceArtifactRef {
  return {
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    format: 'loom.cardBundle',
    importedAt,
    schemaVersion: artifact.schemaVersion,
    ...stored,
  }
}

export function collectPromptInputs(input: {
  contributions: PromptContribution[]
  inheritedCategory: PromptResourceNode['category'] | undefined
  inheritedSourceId: string | undefined
  variables: VariableRenderContext
  nodes: PromptResourceNode[]
  parentActivationGates: PromptActivation[]
  parentEnabled: boolean
  parentId: string | null
  sourceNodes: SourceNode[]
}): void {
  for (const [index, node] of input.nodes.entries()) {
    const category = node.category ?? input.inheritedCategory
    const sourceId = node.kind === 'module' ? node.id : input.inheritedSourceId ?? node.id
    const effectiveEnabled = input.parentEnabled && node.enabled !== false
    const activationGates = node.capabilities?.activation
      ? [...input.parentActivationGates, node.capabilities.activation]
      : input.parentActivationGates
    input.sourceNodes.push({
      id: node.id,
      sourceId,
      parentId: input.parentId,
      displayName: node.label,
      orderIndex: index + 1,
      kind: node.kind,
      ...(node.capabilities ? { capabilities: node.capabilities } : {}),
    })

    if (effectiveEnabled && category && isPromptContributionNode(node)) {
      const kind = readSourceKind(category)
      if (kind) {
        const effectiveActivation = combineActivationGates(activationGates)
        input.contributions.push({
          id: `resource.${node.id}`,
          sourceRef: {
            kind,
            sourceId,
            sourceNodeId: node.id,
          },
          content: renderVariableMacros(node.body, input.variables),
          capabilities: {
            ...(effectiveActivation ? { activation: effectiveActivation } : {}),
            ...(node.capabilities.targetAnchorId ? { targetAnchorId: node.capabilities.targetAnchorId } : {}),
            ...(node.capabilities.localDepth !== undefined ? { localDepth: node.capabilities.localDepth } : {}),
            ...(node.capabilities.roleHint ? { roleHint: node.capabilities.roleHint } : {}),
            ...(node.capabilities.lifecycle ? { lifecycle: node.capabilities.lifecycle } : {}),
          },
        })
      }
    }

    if (node.children) {
      collectPromptInputs({
        ...input,
        parentActivationGates: activationGates,
        parentEnabled: effectiveEnabled,
        nodes: node.children,
        parentId: node.id,
        inheritedCategory: category,
        inheritedSourceId: sourceId,
      })
    }
  }
}

function isPromptContributionNode(node: PromptResourceNode): node is PromptContributionResourceNode {
  return node.kind === 'entry'
    && node.enabled !== false
    && typeof node.body === 'string'
    && Boolean(node.capabilities?.targetAnchorId)
}

function readSourceKind(category: PromptResourceNode['category']): PromptContribution['sourceRef']['kind'] | undefined {
  if (category === 'preset') return 'preset'
  if (category === 'setting') return 'settingLayer'
  if (category === 'runtime') return 'runtime'
  if (category === 'history') return 'narrativeChat'
  return undefined
}

export function findNodes(nodes: PromptResourceNode[], predicate: (node: PromptResourceNode) => boolean): PromptResourceNode[] {
  const results: PromptResourceNode[] = []
  for (const node of nodes) {
    if (predicate(node)) results.push(node)
    if (node.children) results.push(...findNodes(node.children, predicate))
  }
  return results
}

export function applyDefaultPromptProjection(asset: PromptResourceNode, resource: PromptResourceContent): PromptResourceNode {
  if (asset.kind !== 'entry' || asset.capabilities?.targetAnchorId) return asset
  if (resource.resourceKind !== 'preset' && resource.resourceKind !== 'setting') return asset

  const preset = resource.resourceKind === 'preset'
  const targetAnchorId = '@chat.system'
  const entryOrders = findNodes([resource.rootNode], node => node.capabilities?.targetAnchorId === targetAnchorId)
    .map(node => node.capabilities?.localDepth)
    .filter((value): value is number => typeof value === 'number')
  const localDepth = entryOrders.length ? Math.max(...entryOrders) + 10 : 10

  return {
    ...asset,
    capabilities: {
      ...asset.capabilities,
      ...(preset ? {} : { activation: asset.capabilities?.activation ?? { kind: 'always' as const } }),
      lifecycle: asset.capabilities?.lifecycle ?? { lifecycle: 'always' },
      targetAnchorId,
      localDepth,
      roleHint: 'system',
    },
  }
}


function assertPromptResourceArtifact(value: unknown): asserts value is PromptResourceArtifact {
  if (!isObject(value)) throw new Error('Prompt Resource artifact must be an object')
  if (value.format !== 'loom.promptResource') throw new Error(`Unsupported Prompt Resource artifact format: ${String(value.format)}`)
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new Error(`Unsupported Prompt Resource artifact schemaVersion: ${String(value.schemaVersion)}`)
  if (!isPromptResourceKind(value.resourceKind)) throw new Error(`Invalid Prompt Resource kind: ${String(value.resourceKind)}`)
  assertPromptResourceNode(value.rootNode, 'rootNode')
  assertUniquePromptResourceNodeIds(value.rootNode)
  assertLoomScriptAttachments(value.scriptAttachments)
}

function isPromptResourceKind(value: unknown): value is PromptResourceKind {
  return value === 'preset'
    || value === 'setting'
    || value === 'logic'
    || value === 'runtime'
    || value === 'history'
    || value === 'prompt'
}

export function isCardBundleArtifact(value: JsonValue | undefined): value is CardBundleArtifact {
  try {
    assertCardBundleArtifact(value)
    return true
  } catch {
    return false
  }
}

function assertCardBundleArtifact(value: unknown): asserts value is CardBundleArtifact {
  if (!isObject(value)) throw new Error('Card bundle must be an object')
  if (value.schemaVersion !== 4) throw new Error(`Unsupported card bundle schemaVersion: ${String(value.schemaVersion)}`)
  assertNonEmptyString(value.artifactId, 'Card bundle artifactId')
  assertNonEmptyString(value.displayName, 'Card bundle displayName')
  if (value.description !== undefined && typeof value.description !== 'string') throw new Error('Card bundle description must be a string')
  assertCardBundleCard(value.card)
  if (!Array.isArray(value.contextAssets)) throw new Error('Card bundle contextAssets must be an array')
  for (const [index, node] of value.contextAssets.entries()) {
    assertPromptResourceNode(node, `contextAssets[${index}]`)
    assertUniquePromptResourceNodeIds(node)
  }
  if (value.externalContextAssetIds !== undefined) {
    const rootIds = new Set(value.contextAssets.map(node => (node as JsonObject).id))
    if (!Array.isArray(value.externalContextAssetIds)
      || value.externalContextAssetIds.some(id => typeof id !== 'string'
        || !rootIds.has(id))
      || new Set(value.externalContextAssetIds).size !== value.externalContextAssetIds.length) {
      throw new Error('Invalid externalContextAssetIds')
    }
  }
  if (value.state !== undefined) parseStateArtifact(value.state)
  if (value.stateTemplates !== undefined) {
    if (!Array.isArray(value.stateTemplates)) throw new Error('Card bundle stateTemplates must be an array')
    const ids = new Set<string>()
    for (const [index, template] of value.stateTemplates.entries()) {
      if (!isObject(template)) throw new Error(`Card bundle state template must be an object: ${index}`)
      assertNonEmptyString(template.id, `Card bundle state template id: ${index}`)
      if (ids.has(template.id)) throw new Error(`Duplicate State template id: ${template.id}`)
      ids.add(template.id)
      validateStateDefinitionDraft({
        kind: 'timeline-template',
        templateVersion: template.templateVersion as number,
        schema: template.schema as JsonObject,
        initial: template.initial as JsonObject,
        ...(typeof template.componentKey === 'string' ? { componentKey: template.componentKey } : {}),
        ...(Array.isArray(template.targetEntityTypeIds) ? { targetEntityTypeIds: template.targetEntityTypeIds as string[] } : {}),
        ...(typeof template.label === 'string' ? { label: template.label } : {}),
      })
    }
  }
  if (value.timelineStateBindings !== undefined) {
    if (!Array.isArray(value.timelineStateBindings)) throw new Error('Card bundle timelineStateBindings must be an array')
    for (const binding of value.timelineStateBindings) validateTimelineStateBinding(binding as TimelineStateBinding)
  }
  assertPortableExtensionPayloads(value.extensionPayloads)
  assertLoomScriptAttachments(value.scriptAttachments)
  assertCardTextPipeline(value.textTransformRules, false)
  assertCardTextPipeline(value.textExtractors, true)
  if (value.metadata !== undefined && !isObject(value.metadata)) throw new Error('Card bundle metadata must be an object')
}

function assertCardTextPipeline(value: unknown, extractor: boolean): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error('Card text pipeline declarations must be an array')
  for (const item of value) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.enabled !== 'boolean'
      || !Number.isInteger(item.orderIndex) || !Array.isArray(item.targets)
      || item.targets.some(target => target !== 'narrative' && target !== 'agent-session')
      || !isObject(item.matcher) || item.matcher.kind !== 'regex'
      || typeof item.matcher.pattern !== 'string' || typeof item.matcher.flags !== 'string'
      || ['owner', 'origin', 'id', 'version', 'createdAt', 'updatedAt'].some(key => item[key] !== undefined)) {
      throw new Error('Invalid Card text pipeline declaration')
    }
    const draft = { ...item, owner: { kind: 'card' as const, cardId: 'bundle' } }
    if (extractor) {
      if ((item.strategy !== 'latest-valid' && item.strategy !== 'all-matches')
        || (item.parser !== 'text' && item.parser !== 'key-value-lines')
        || (item.artifactType !== undefined && typeof item.artifactType !== 'string')
        || (item.outputSchema !== undefined && !isObject(item.outputSchema))) {
        throw new Error('Invalid Card text extractor')
      }
      validateTextExtractorDraft(draft as TextExtractorDraft)
    } else {
      if (!Array.isArray(item.phases) || item.phases.some(phase => !['classify', 'prompt', 'display'].includes(String(phase)))
        || (item.range !== undefined && !isObject(item.range))
        || !isObject(item.effect)
        || !['replace', 'mark', 'promote-reasoning'].includes(String(item.effect.kind))
        || (item.effect.kind === 'replace' && typeof item.effect.replacement !== 'string')
        || (item.effect.kind === 'mark' && item.effect.markerType !== undefined && typeof item.effect.markerType !== 'string')
        || (item.effect.kind === 'promote-reasoning'
          && (!['collapsed', 'hidden', 'visible'].includes(String(item.effect.visibility))
            || !['omit', 'assistant-content'].includes(String(item.effect.replay))
            || (item.effect.dialect !== undefined && typeof item.effect.dialect !== 'string')))) {
        throw new Error('Invalid Card text transform rule')
      }
      validateTextTransformRuleDraft(draft as TextTransformRuleDraft)
    }
    const group = extractor ? item.matcher.contentGroup : (item.effect as Record<string, unknown>).contentGroup
    if (group !== undefined && typeof group !== 'string' && !(Number.isInteger(group) && Number(group) >= 0)) {
      throw new Error('Invalid Card text pipeline contentGroup')
    }
  }
}

function assertResourceOrigin(value: unknown): void {
  if (value !== undefined && value !== 'card' && value !== 'external') throw new Error('Invalid resourceOrigin')
}

function assertLoomScriptAttachments(value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error('Loom Script attachments must be an array')
  const metadataIds = new Set<string>()
  for (const [index, attachment] of value.entries()) {
    if (!isObject(attachment) || !Number.isSafeInteger(attachment.orderIndex)) throw new Error(`Invalid Loom Script attachment: ${index}`)
    assertResourceOrigin(attachment.resourceOrigin)
    if (!isObject(attachment.script)
      || attachment.script.format !== 'loom.script'
      || attachment.script.schemaVersion !== 1
      || typeof attachment.script.fileName !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.loom\.js$/.test(attachment.script.fileName)
      || typeof attachment.script.source !== 'string') {
      throw new Error(`Invalid Loom Script attachment artifact: ${index}`)
    }
    const metadata = parseLoomScriptSource(attachment.script.source)
    if (metadataIds.has(metadata.metadataId)) throw new Error(`Duplicate Loom Script Metadata id in artifact: ${metadata.metadataId}`)
    metadataIds.add(metadata.metadataId)
  }
}

const portablePayloadTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const portablePayloadFileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const maxPortablePayloadCount = 64
const maxPortablePayloadBytes = 8 * 1024 * 1024
const maxPortablePayloadTotalBytes = 32 * 1024 * 1024

function assertPortableExtensionPayloads(value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error('Card bundle extensionPayloads must be an array')
  if (value.length > maxPortablePayloadCount) {
    throw new Error(`Card bundle extensionPayloads exceed ${maxPortablePayloadCount} entries`)
  }

  const ids = new Set<string>()
  let totalBytes = 0
  for (const [index, payload] of value.entries()) {
    if (!isObject(payload)) throw new Error(`Card bundle Extension Payload must be an object: ${index}`)
    assertResourceOrigin(payload.resourceOrigin)
    assertPortablePayloadToken(payload.id, `Card bundle Extension Payload id: ${index}`)
    if (ids.has(payload.id)) throw new Error(`Duplicate Extension Payload id: ${payload.id}`)
    ids.add(payload.id)
    assertPortablePayloadToken(payload.packageId, `Card bundle Extension Payload packageId: ${index}`)
    if (typeof payload.fileName !== 'string' || !portablePayloadFileNamePattern.test(payload.fileName)) {
      throw new Error(`Card bundle Extension Payload fileName is invalid: ${index}`)
    }
    assertBoundedNonEmptyString(payload.format, `Card bundle Extension Payload format: ${index}`, 128)
    assertBoundedNonEmptyString(payload.mediaType, `Card bundle Extension Payload mediaType: ${index}`, 255)
    if (payload.schemaVersion !== undefined
      && (typeof payload.schemaVersion !== 'number'
        || !Number.isSafeInteger(payload.schemaVersion)
        || payload.schemaVersion < 1)) {
      throw new Error(`Card bundle Extension Payload schemaVersion is invalid: ${index}`)
    }
    if (payload.requirement !== undefined) {
      if (!isObject(payload.requirement)) throw new Error(`Card bundle Extension Payload requirement is invalid: ${index}`)
      if (payload.requirement.versionRange !== undefined) {
        assertBoundedNonEmptyString(
          payload.requirement.versionRange,
          `Card bundle Extension Payload requirement.versionRange: ${index}`,
          128,
        )
      }
    }
    if (payload.metadata !== undefined && !isObject(payload.metadata)) {
      throw new Error(`Card bundle Extension Payload metadata is invalid: ${index}`)
    }
    if (typeof payload.content !== 'string') throw new Error(`Card bundle Extension Payload content must be a string: ${index}`)
    // ponytail: 首版只运输 UTF-8 JSON/text；需要任意二进制时改为 Blob-backed Payload，不引入 Base64。
    const contentBytes = new TextEncoder().encode(payload.content).byteLength
    if (contentBytes > maxPortablePayloadBytes) {
      throw new Error(`Card bundle Extension Payload exceeds ${maxPortablePayloadBytes} bytes: ${payload.id}`)
    }
    totalBytes += contentBytes
    if (totalBytes > maxPortablePayloadTotalBytes) {
      throw new Error(`Card bundle Extension Payloads exceed ${maxPortablePayloadTotalBytes} total bytes`)
    }
  }
}

export function normalizePortableExtensionPayloadArtifact(
  payload: PortableExtensionPayloadArtifact,
): PortableExtensionPayloadArtifact {
  assertPortableExtensionPayloads([payload])
  return structuredClone(payload)
}

function assertPortablePayloadToken(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !portablePayloadTokenPattern.test(value)) throw new Error(`${label} is invalid`)
}

function assertBoundedNonEmptyString(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`)
  }
}

export function sameTimelineTemplate(value: JsonValue, definition: Extract<StateDefinitionDraft, { kind: 'timeline-template' }>): boolean {
  if (!isObject(value) || value.kind !== 'timeline-template') return false
  return value.templateVersion === definition.templateVersion
    && JSON.stringify(value.schema) === JSON.stringify(definition.schema)
    && JSON.stringify(value.initial) === JSON.stringify(definition.initial)
    && value.componentKey === definition.componentKey
    && JSON.stringify(value.targetEntityTypeIds) === JSON.stringify(definition.targetEntityTypeIds)
    && value.label === definition.label
}

function assertCardBundleCard(value: unknown): asserts value is CardBundleArtifact['card'] {
  if (!isObject(value)) throw new Error('Card bundle card must be an object')
  assertNonEmptyString(value.name, 'Card bundle card.name')
  assertOptionalString(value.userName, 'Card bundle card.userName')
  assertOptionalString(value.description, 'Card bundle card.description')
  if (value.macros !== undefined) validateBundleMacros(value.macros)
  if (value.stateContributionIds !== undefined
    && (!Array.isArray(value.stateContributionIds) || !value.stateContributionIds.every(id => typeof id === 'string' && id.trim().length > 0))) {
    throw new Error('Card bundle card.stateContributionIds must be non-empty strings')
  }

  if (value.preset !== undefined) {
    if (!isObject(value.preset)) throw new Error('Card bundle card.preset must be an object')
    assertOptionalString(value.preset.system, 'Card bundle card.preset.system')
    if (value.preset.macros !== undefined) validateBundleMacros(value.preset.macros)
  }

  if (value.opening !== undefined && typeof value.opening !== 'string') {
    if (!isObject(value.opening)) throw new Error('Card bundle card.opening must be a string or object')
    if (value.opening.entries !== undefined && !Array.isArray(value.opening.entries)) {
      throw new Error('Card bundle card.opening.entries must be an array')
    }
    for (const [index, entry] of (value.opening.entries ?? []).entries()) {
      if (!isObject(entry) || typeof entry.content !== 'string') {
        throw new Error(`Card bundle opening entry must contain string content: ${index}`)
      }
      if (entry.role !== undefined && entry.role !== 'user' && entry.role !== 'assistant') {
        throw new Error(`Card bundle opening entry role is invalid: ${index}`)
      }
    }
  }

  if (value.settingLayer !== undefined) {
    if (!isObject(value.settingLayer)) throw new Error('Card bundle card.settingLayer must be an object')
    if (value.settingLayer.entries !== undefined && !Array.isArray(value.settingLayer.entries)) {
      throw new Error('Card bundle card.settingLayer.entries must be an array')
    }
    for (const [index, entry] of (value.settingLayer.entries ?? []).entries()) {
      if (!isObject(entry) || typeof entry.content !== 'string') {
        throw new Error(`Card bundle setting entry must contain string content: ${index}`)
      }
      assertOptionalString(entry.id, `Card bundle setting entry id: ${index}`)
      assertOptionalString(entry.path, `Card bundle setting entry path: ${index}`)
      assertOptionalString(entry.title, `Card bundle setting entry title: ${index}`)
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
        throw new Error(`Card bundle setting entry enabled must be boolean: ${index}`)
      }
      if (entry.activation !== undefined && !isPromptActivation(entry.activation)) {
        throw new Error(`Card bundle setting entry activation is invalid: ${index}`)
      }
      if (entry.tags !== undefined && (!Array.isArray(entry.tags) || !entry.tags.every(tag => typeof tag === 'string'))) {
        throw new Error(`Card bundle setting entry tags must be strings: ${index}`)
      }
      
    }
  }
}

function validateBundleMacros(value: unknown): void {
  if (!isObject(value)) throw new Error('Card bundle macros must be an object')
  for (const [name, macroValue] of Object.entries(value)) {
    if (typeof macroValue !== 'string') throw new Error(`Card bundle macro value must be a string: ${name}`)
  }
}

function assertPromptResourceNode(value: unknown, path: string): asserts value is PromptResourceNode {
  if (!isObject(value)) throw new Error(`Prompt resource node must be an object: ${path}`)
  assertNonEmptyString(value.id, `Prompt resource node id: ${path}`)
  if (typeof value.label !== 'string') throw new Error(`Prompt resource node label must be a string: ${path}`)
  if (!isPromptResourceNodeKind(value.kind)) throw new Error(`Prompt resource node kind is invalid: ${path}`)
  if (value.category !== undefined && !isPromptResourceNodeCategory(value.category)) {
    throw new Error(`Prompt resource node category is invalid: ${path}`)
  }
  assertOptionalString(value.body, `Prompt resource node body: ${path}`)
  assertOptionalString(value.meta, `Prompt resource node meta: ${path}`)
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error(`Prompt resource node enabled must be boolean: ${path}`)
  if (value.isSection !== undefined && typeof value.isSection !== 'boolean') throw new Error(`Prompt resource node isSection must be boolean: ${path}`)

  if (value.configRows !== undefined) {
    if (!Array.isArray(value.configRows) || !value.configRows.every(row => isObject(row) && typeof row.label === 'string' && typeof row.value === 'string')) {
      throw new Error(`Prompt resource node configRows are invalid: ${path}`)
    }
  }
  assertOptionalStringArray(value.orderList, `Prompt resource node orderList: ${path}`)
  assertPromptResourceCapabilities(value.capabilities, path)

  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) throw new Error(`Prompt resource node children must be an array: ${path}`)
    value.children.forEach((child, index) => assertPromptResourceNode(child, `${path}.children[${index}]`))
  }
}

function assertUniquePromptResourceNodeIds(rootNode: PromptResourceNode): void {
  const ids = new Set<string>()
  const visit = (node: PromptResourceNode): void => {
    if (ids.has(node.id)) throw new Error(`Duplicate prompt resource node id: ${node.id}`)
    ids.add(node.id)
    node.children?.forEach(visit)
  }
  visit(rootNode)
}

function assertPromptResourceCapabilities(value: JsonValue | undefined, path: string): void {
  if (value === undefined) return
  if (!isObject(value)) throw new Error(`Prompt resource capabilities must be an object: ${path}`)
  if (value.activation !== undefined && !isPromptActivation(value.activation)) throw new Error(`Prompt resource activation is invalid: ${path}`)
  if (value.content !== undefined && (!isObject(value.content) || value.content.kind !== 'text')) throw new Error(`Prompt resource content capability is invalid: ${path}`)
  if (value.lifecycle !== undefined && (!isObject(value.lifecycle) || typeof value.lifecycle.lifecycle !== 'string')) throw new Error(`Prompt resource lifecycle is invalid: ${path}`)
  if (value.projection !== undefined) {
    if (!isObject(value.projection)) throw new Error(`Prompt resource projection is invalid: ${path}`)
    assertOptionalString(value.projection.targetAnchorId, `Prompt resource projection targetAnchorId: ${path}`)
    assertOptionalNumber(value.projection.localDepth, `Prompt resource projection localDepth: ${path}`)
  }
  if (value.resolution !== undefined) {
    if (!isObject(value.resolution) || typeof value.resolution.semanticSlotKey !== 'string') throw new Error(`Prompt resource resolution is invalid: ${path}`)
    if (!['append', 'merge', 'replace', 'single'].includes(String(value.resolution.policy))) throw new Error(`Prompt resource resolution policy is invalid: ${path}`)
    assertOptionalNumber(value.resolution.priorityHint, `Prompt resource resolution priorityHint: ${path}`)
  }
  if (value.render !== undefined) {
    if (!isObject(value.render)) throw new Error(`Prompt resource render capability is invalid: ${path}`)
    if (value.render.wrapper !== undefined && !['section', 'message', 'inline'].includes(String(value.render.wrapper))) throw new Error(`Prompt resource render wrapper is invalid: ${path}`)
    if (value.render.roleHint !== undefined && !['system', 'developer', 'assistant', 'user'].includes(String(value.render.roleHint))) throw new Error(`Prompt resource render roleHint is invalid: ${path}`)
    assertOptionalString(value.render.label, `Prompt resource render label: ${path}`)
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
}

function assertOptionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label} must be a string`)
}

function assertOptionalNumber(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'number') throw new Error(`${label} must be a number`)
}

function assertOptionalStringArray(value: unknown, label: string): void {
  if (value !== undefined && (!Array.isArray(value) || !value.every(item => typeof item === 'string'))) {
    throw new Error(`${label} must be a string array`)
  }
}

function isPromptResourceNodeKind(value: unknown): value is PromptResourceNode['kind'] {
  return typeof value === 'string' && value.trim().length > 0
}

function isPromptResourceNodeCategory(value: unknown): value is NonNullable<PromptResourceNode['category']> {
  return typeof value === 'string' && value.trim().length > 0
}

