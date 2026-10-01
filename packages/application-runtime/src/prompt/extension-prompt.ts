import type { PromptResourceStore } from '@loom-studio/application-data'
import type { ExtensionPromptAddition, ExtensionPromptBuildInput } from '@loom-studio/extension-sdk'
import { renderVariableMacros } from '@loom-studio/shared'
import { readPromptResourceInputs } from '../cards/workspace.js'
import { fromStoredResource } from './prompt-resource-mapper.js'
import { isExtensionResourceAvailable } from '../runtime/extension-resource-access.js'
import { isPromptActivation } from './prompt-activation.js'
import type { PromptContribution, SourceNode } from './prompt-builder.js'
import { compilePromptDataModel } from './prompt-build-pipeline.js'
import { createVariableRenderContext, type VariableRenderContext } from './variables.js'

export async function readExtensionPromptInputs(input: {
  addition: ExtensionPromptAddition
  promptResources: PromptResourceStore
  installations: ReadonlyMap<string, string>
  variables: VariableRenderContext
  sourceId: string
  ownerInstallationId?: string
  ownerPackageId?: string
}): Promise<{ sourceNodes: SourceNode[]; contributions: PromptContribution[] }> {
  if (input.addition.settingResourceIds !== undefined
    && (!Array.isArray(input.addition.settingResourceIds)
      || !input.addition.settingResourceIds.every(id => typeof id === 'string' && id.length > 0)))
    throw new Error('Prompt Setting references must be non-empty resource IDs')
  if (input.addition.content !== undefined && !Array.isArray(input.addition.content))
    throw new Error('Prompt content must be an array')
  const resourceIds = [...new Set(input.addition.settingResourceIds ?? [])]
  for (const id of resourceIds) {
    const resource = await input.promptResources.getResource(id)
    if (!resource || resource.resourceKind !== 'setting') throw new Error(`Setting resource not found: ${id}`)
    if (!isExtensionResourceAvailable(resource.metadata.origin, input.installations))
      throw new Error(`Setting resource is not available in this context: ${id}`)
    if (input.ownerInstallationId && !isOwnedResource(resource.metadata.origin, input.ownerInstallationId, input.ownerPackageId!))
      throw new Error(`Setting resource is not owned by this extension installation: ${id}`)
  }
  const resources = await readPromptResourceInputs({
    promptResources: input.promptResources,
    resourceIds,
    variables: input.variables,
  })
  const sourceNodes = [...resources.sourceNodes]
  const contributions = [...resources.contributions]
  for (const [index, item] of (input.addition.content ?? []).entries()) {
    if (!item || typeof item.targetAnchorId !== 'string' || !item.targetAnchorId
      || typeof item.content !== 'string')
      throw new Error('Prompt content requires a target anchor and text')
    if (item.localDepth !== undefined && (typeof item.localDepth !== 'number' || !Number.isFinite(item.localDepth)))
      throw new Error('Prompt content localDepth must be finite')
    if (item.roleHint !== undefined && !['system', 'developer', 'user', 'assistant'].includes(item.roleHint))
      throw new Error('Invalid Prompt content role')
    if (item.activation && !isPromptActivation(item.activation))
      throw new Error('Invalid Prompt content activation')
    const id = `${input.sourceId}.content.${index}`
    sourceNodes.push({ id, sourceId: input.sourceId, parentId: null, displayName: id, orderIndex: index, kind: 'entry' })
    contributions.push({
      id,
      sourceRef: { kind: 'runtime', sourceId: input.sourceId, sourceNodeId: id },
      content: renderVariableMacros(item.content, input.variables),
      capabilities: {
        targetAnchorId: item.targetAnchorId,
        ...(item.localDepth === undefined ? {} : { localDepth: item.localDepth }),
        ...(item.roleHint ? { roleHint: item.roleHint } : {}),
        ...(item.activation ? { activation: item.activation } : {}),
      },
    })
  }
  return { sourceNodes, contributions }
}

export async function buildExtensionPrompt(input: {
  build: ExtensionPromptBuildInput
  promptResources: PromptResourceStore
  installations: ReadonlyMap<string, string>
  owner?: { installationId: string; packageId: string }
}) {
  if (input.build.presetResourceId !== undefined
    && (typeof input.build.presetResourceId !== 'string' || !input.build.presetResourceId))
    throw new Error('Prompt preset ID must be non-empty')
  const variables = createVariableRenderContext()
  const preset = input.build.presetResourceId
    ? await input.promptResources.getResource(input.build.presetResourceId)
    : undefined
  if (input.build.presetResourceId && (!preset || preset.resourceKind !== 'preset'))
    throw new Error(`Prompt preset not found: ${input.build.presetResourceId}`)
  if (preset && !isExtensionResourceAvailable(preset.metadata.origin, input.installations))
    throw new Error(`Prompt preset is not available in this context: ${preset.id}`)
  if (preset && input.owner && !isOwnedResource(preset.metadata.origin, input.owner.installationId, input.owner.packageId))
    throw new Error(`Prompt preset is not owned by this extension installation: ${preset.id}`)
  const base = preset ? await readPromptResourceInputs({
    promptResources: input.promptResources, resourceIds: [preset.id], variables,
  }) : { sourceNodes: [], contributions: [] }
  const added = await readExtensionPromptInputs({
    addition: input.build, promptResources: input.promptResources,
    installations: input.installations, variables, sourceId: 'extension.prompt',
    ownerInstallationId: input.owner?.installationId,
    ownerPackageId: input.owner?.packageId,
  })
  if (!preset) {
    const anchors = [...new Set(added.contributions.map(item => item.capabilities.targetAnchorId).filter((id): id is string => Boolean(id)))]
    for (const [index, id] of anchors.entries()) {
      if (!added.sourceNodes.some(node => node.id === id))
        added.sourceNodes.push({ id, sourceId: 'extension.prompt', parentId: null, displayName: id, orderIndex: index, kind: 'virtual' })
    }
  }
  return compilePromptDataModel({
    sourceNodes: [...base.sourceNodes, ...added.sourceNodes],
    contributions: [...base.contributions, ...added.contributions],
    ...(preset ? { skeletonRootId: fromStoredResource(preset).rootNode.id } : {}),
    currentInput: input.build.currentInput,
    activationFacts: input.build.activationFacts,
  })
}

function isOwnedResource(origin: unknown, installationId: string, packageId: string): boolean {
  return typeof origin === 'object' && origin !== null && 'kind' in origin && origin.kind === 'extension-package'
    && 'installationId' in origin && origin.installationId === installationId
    && 'packageId' in origin && origin.packageId === packageId
}
