import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import type { JsonObject } from '@loom-studio/shared'
import { getMacroContext, isSettingEntry, renderMacros } from './card.js'
import { isObject } from './json.js'
import {
  compilePromptDataModel,
  defaultCompositionSkeleton,
  emptyProjectionOrderProfile,
  type CompiledPrompt,
  type PromptContribution,
  type ProjectionOrderProfile,
  type SourceNode,
} from './prompt-builder.js'
import type { ActivationFacts, PromptActivation } from './prompt-activation.js'
import { readBranchPath } from './timeline.js'
import type { NarrativeBranchContent, ProviderMessage, SessionContent, SettingEntryContent } from './types.js'
import { readWorkspacePromptInputs } from './workspace.js'

export async function composePromptForInput(
  documents: DocumentStore,
  session: DocumentRecord<SessionContent>,
  branch: DocumentRecord<NarrativeBranchContent>,
  userInput: string,
): Promise<ProviderMessage[]> {
  const entries = await readBranchPath(documents, session.id, branch.content.headEntryId)
  const cardName = typeof session.content.cardSnapshot.name === 'string' ? session.content.cardSnapshot.name : 'Untitled Card'
  const macroContext = getMacroContext(session.content.cardSnapshot)
  const description = readSnapshotString(session.content.cardSnapshot, 'description')
  const presetSystem = readPresetSystem(session.content.cardSnapshot)
  const settingProjection = projectSettingLayer(session.content.cardSnapshot, userInput)
  const systemParts = [
    presetSystem ? renderMacros(presetSystem, macroContext) : undefined,
    `You are the AIRP agent for ${cardName}. Continue the accepted narrative.`,
    description ? `Card description: ${renderMacros(description, macroContext)}` : undefined,
    settingProjection ? `Setting Layer:\n${settingProjection}` : undefined,
  ].filter((part): part is string => typeof part === 'string')
  const messages: ProviderMessage[] = [
    {
      role: 'system',
      content: systemParts.join('\n'),
    },
  ]

  for (const entry of entries) {
    messages.push({
      role: entry.role,
      content: entry.content,
    })
  }

  messages.push({ role: 'user', content: userInput })

  return messages
}

export async function composePromptBuildForInput(
  documents: DocumentStore,
  session: DocumentRecord<SessionContent>,
  branch: DocumentRecord<NarrativeBranchContent>,
  userInput: string,
  orderProfile: ProjectionOrderProfile = emptyProjectionOrderProfile,
  workspaceId?: string,
  activationFacts?: ActivationFacts,
): Promise<{ messages: ProviderMessage[]; projection: CompiledPrompt }> {
  const entries = await readBranchPath(documents, session.id, branch.content.headEntryId)
  const snapshot = session.content.cardSnapshot
  const macroContext = getMacroContext(snapshot)
  const workspaceInputs = workspaceId
    ? await readWorkspacePromptInputs({ documents, workspaceId, macroContext })
    : undefined
  const sourceNodes = workspaceInputs
    ? [...workspaceInputs.sourceNodes, ...buildRuntimeSourceNodes(snapshot, entries)]
    : buildM0SourceNodes(snapshot, entries)
  const contributions = workspaceInputs
    ? [...workspaceInputs.contributions, ...buildNarrativeRuntimeContributions(snapshot, entries, userInput)]
    : buildM0PromptContributions(snapshot, entries, userInput, macroContext)
  const projection = compilePromptDataModel({
    skeleton: defaultCompositionSkeleton,
    sourceNodes,
    contributions,
    orderProfile: orderProfile === emptyProjectionOrderProfile && workspaceInputs ? workspaceInputs.orderProfile : orderProfile,
    currentInput: userInput,
    activationFacts,
  })

  return {
    messages: projection.messages,
    projection,
  }
}

function buildRuntimeSourceNodes(snapshot: JsonObject, entries: Array<{ id: string }>): SourceNode[] {
  return [
    { id: 'node.chat.root', sourceId: `session:${snapshot.id ?? 'unknown'}`, parentId: null, displayName: 'Narrative Timeline', orderIndex: 20 },
    ...entries.map((entry, index): SourceNode => ({
      id: `node.chat.${entry.id}`,
      sourceId: `session:${snapshot.id ?? 'unknown'}`,
      parentId: 'node.chat.root',
      displayName: `Entry ${index + 1}`,
      orderIndex: index + 1,
    })),
    { id: 'node.runtime.root', sourceId: 'runtime.current-turn', parentId: null, displayName: 'Runtime', orderIndex: 30 },
    { id: 'node.runtime.current-input', sourceId: 'runtime.current-turn', parentId: 'node.runtime.root', displayName: 'Current Input', orderIndex: 1 },
  ]
}

function buildNarrativeRuntimeContributions(
  snapshot: JsonObject,
  entries: Array<{ id: string; role: 'user' | 'assistant'; content: string }>,
  userInput: string,
): PromptContribution[] {
  return [
    ...entries.map((entry, index): PromptContribution => runtimeContribution({
      id: `workspace.chat.${entry.id}`,
      sourceNodeId: `node.chat.${entry.id}`,
      sourceId: `session:${snapshot.id ?? 'unknown'}`,
      kind: 'narrativeChat',
      content: entry.content,
      injectionGroupKey: 'chat.history',
      entryOrderHint: index + 1,
    })),
    runtimeContribution({
      id: 'workspace.runtime.current-input',
      sourceNodeId: 'node.runtime.current-input',
      sourceId: 'runtime.current-turn',
      kind: 'runtime',
      content: userInput,
      injectionGroupKey: 'chat.inside',
      entryOrderHint: 1,
    }),
  ]
}

function readSnapshotString(snapshot: JsonObject, key: string): string {
  return typeof snapshot[key] === 'string' ? snapshot[key] : ''
}

function readPresetSystem(snapshot: JsonObject): string {
  const preset = snapshot.preset
  return isObject(preset) && typeof preset.system === 'string' ? preset.system : ''
}

function projectSettingLayer(snapshot: JsonObject, userInput: string): string {
  const macroContext = getMacroContext(snapshot)

  return readSettingEntries(snapshot)
    .filter(entry => entry.enabled && inputMatchesSetting(entry, userInput))
    .map(entry => {
      const label = entry.title ?? entry.path ?? entry.id
      return `- ${renderMacros(label, macroContext)}: ${renderMacros(entry.content, macroContext)}`
    })
    .join('\n')
}

function readSettingEntries(snapshot: JsonObject): SettingEntryContent[] {
  const settingLayer = snapshot.settingLayer
  if (!isObject(settingLayer) || !Array.isArray(settingLayer.entries)) return []
  return settingLayer.entries.filter(isSettingEntry)
}

function inputMatchesSetting(entry: SettingEntryContent, userInput: string): boolean {
  if (entry.activation.kind === 'always') return true
  if (entry.activation.kind === 'manual') return false
  if (entry.activation.kind === 'keyword') {
    return entry.activation.keywords.some(keyword => userInput.includes(keyword))
  }
  return false
}

function buildM0SourceNodes(snapshot: JsonObject, entries: Array<{ id: string }>): SourceNode[] {
  const settingEntries = readSettingEntries(snapshot)

  return [
    { id: 'node.preset.root', sourceId: 'm0-card-preset', parentId: null, displayName: 'Preset', orderIndex: 0 },
    { id: 'node.preset.system', sourceId: 'm0-card-preset', parentId: 'node.preset.root', displayName: 'System', orderIndex: 10 },
    { id: 'node.preset.agent', sourceId: 'm0-card-preset', parentId: 'node.preset.root', displayName: 'Agent Contract', orderIndex: 20 },
    { id: 'node.preset.description', sourceId: 'm0-card-preset', parentId: 'node.preset.root', displayName: 'Card Description', orderIndex: 30 },
    { id: 'node.setting.root', sourceId: 'm0-card-setting-layer', parentId: null, displayName: 'Setting Layer', orderIndex: 10 },
    ...settingEntries.map((entry, index): SourceNode => ({
      id: `node.setting.${entry.id}`,
      sourceId: 'm0-card-setting-layer',
      parentId: 'node.setting.root',
      displayName: entry.title ?? entry.path ?? entry.id,
      orderIndex: index + 1,
    })),
    { id: 'node.chat.root', sourceId: `session:${snapshot.id ?? 'unknown'}`, parentId: null, displayName: 'Narrative Timeline', orderIndex: 20 },
    ...entries.map((entry, index): SourceNode => ({
      id: `node.chat.${entry.id}`,
      sourceId: `session:${snapshot.id ?? 'unknown'}`,
      parentId: 'node.chat.root',
      displayName: `Entry ${index + 1}`,
      orderIndex: index + 1,
    })),
    { id: 'node.runtime.root', sourceId: 'runtime.current-turn', parentId: null, displayName: 'Runtime', orderIndex: 30 },
    { id: 'node.runtime.current-input', sourceId: 'runtime.current-turn', parentId: 'node.runtime.root', displayName: 'Current Input', orderIndex: 1 },
  ]
}

function buildM0PromptContributions(
  snapshot: JsonObject,
  entries: Array<{ id: string; role: 'user' | 'assistant'; content: string }>,
  userInput: string,
  macroContext: { user: string },
): PromptContribution[] {
  const contributions: PromptContribution[] = []
  const cardName = typeof snapshot.name === 'string' ? snapshot.name : 'Untitled Card'
  const presetSystem = readPresetSystem(snapshot)
  const description = readSnapshotString(snapshot, 'description')

  if (presetSystem) {
    contributions.push(runtimeContribution({
      id: 'm0.preset.system',
      sourceNodeId: 'node.preset.system',
      sourceId: 'm0-card-preset',
      kind: 'preset',
      content: renderMacros(presetSystem, macroContext),
      injectionGroupKey: 'preset.system',
      entryOrderHint: 10,
    }))
  }

  contributions.push(runtimeContribution({
    id: 'm0.preset.agent-contract',
    sourceNodeId: 'node.preset.agent',
    sourceId: 'm0-card-preset',
    kind: 'preset',
    content: `You are the AIRP agent for ${cardName}. Continue the accepted narrative.`,
    injectionGroupKey: 'preset.system',
    entryOrderHint: 20,
  }))

  if (description) {
    contributions.push(runtimeContribution({
      id: 'm0.preset.card-description',
      sourceNodeId: 'node.preset.description',
      sourceId: 'm0-card-preset',
      kind: 'preset',
      content: `Card description: ${renderMacros(description, macroContext)}`,
      injectionGroupKey: 'preset.system',
      entryOrderHint: 30,
    }))
  }

  for (const [index, entry] of readSettingEntries(snapshot).entries()) {
    contributions.push(runtimeContribution({
      id: `m0.setting.${entry.id}`,
      sourceNodeId: `node.setting.${entry.id}`,
      sourceId: 'm0-card-setting-layer',
      kind: 'settingLayer',
      content: `${renderMacros(entry.title ?? entry.path ?? entry.id, macroContext)}: ${renderMacros(entry.content, macroContext)}`,
      injectionGroupKey: 'setting.stable',
      activation: entry.enabled ? toPromptActivation(entry.activation) : { kind: 'manual' },
      entryOrderHint: index + 1,
      joinSlotKey: 'setting-layer:m0-card-setting-layer@setting.stable',
    }))
  }

  for (const [index, entry] of entries.entries()) {
    contributions.push(runtimeContribution({
      id: `m0.chat.${entry.id}`,
      sourceNodeId: `node.chat.${entry.id}`,
      sourceId: `session:${snapshot.id ?? 'unknown'}`,
      kind: 'narrativeChat',
      content: entry.content,
      injectionGroupKey: 'chat.history',
      entryOrderHint: index + 1,
    }))
  }

  contributions.push(runtimeContribution({
    id: 'm0.runtime.current-input',
    sourceNodeId: 'node.runtime.current-input',
    sourceId: 'runtime.current-turn',
    kind: 'runtime',
    content: userInput,
    injectionGroupKey: 'chat.inside',
    entryOrderHint: 1,
  }))

  return contributions
}

function runtimeContribution(input: {
  id: string
  sourceNodeId: string
  sourceId: string
  kind: PromptContribution['sourceRef']['kind']
  content: string
  injectionGroupKey: string
  activation?: PromptActivation
  joinSlotKey?: string
  entryOrderHint?: number
}): PromptContribution {
  return {
    id: input.id,
    sourceRef: {
      kind: input.kind,
      sourceId: input.sourceId,
      sourceNodeId: input.sourceNodeId,
    },
    content: input.content,
    capabilities: {
      content: { kind: 'text' },
      ...(input.activation ? { activation: input.activation } : {}),
      lifecycle: { lifecycle: 'always' },
      projection: {
        injectionGroupKey: input.injectionGroupKey,
        ...(input.joinSlotKey ? { joinSlotKey: input.joinSlotKey } : {}),
        ...(input.entryOrderHint !== undefined ? { entryOrderHint: input.entryOrderHint } : {}),
      },
    },
  }
}

function toPromptActivation(activation: SettingEntryContent['activation']): PromptActivation {
  return activation
}
