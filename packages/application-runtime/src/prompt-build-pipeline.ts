import { PassRegistry, run, type Fragment, type Mutation, type PassFactory, type Trace, type TraceExecution } from '@loom/core'
import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
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
import { readPromptResourceInputs } from './workspace.js'

type PromptBuildMeta = {
  kind: 'promptBuild.input' | 'promptBuild.output'
  activationFacts?: ActivationFacts
  contributionCount?: number
  contributionIds?: string[]
  messageCount?: number
  orderProfileId?: string
  promptRowCount?: number
  promptRowSlotRankCount?: number
  sourceNodeCount?: number
  sourceRowCount?: number
  userInput?: string
  zoneCount?: number
}

type PromptBuildFragment = Fragment<PromptBuildMeta>
type PreparedPromptBuildInput = {
  activationFacts?: ActivationFacts
  contributions: PromptContribution[]
  orderProfile: ProjectionOrderProfile
  sourceNodes: SourceNode[]
  userInput: string
}

export type PromptBuildPipelineResult = {
  messages: ProviderMessage[]
  projection: CompiledPrompt
  trace: JsonValue
}

export async function runPromptBuildPipeline(input: {
  activationFacts?: ActivationFacts
  branch: DocumentRecord<NarrativeBranchContent>
  documents: DocumentStore
  orderProfile?: ProjectionOrderProfile
  session: DocumentRecord<SessionContent>
  userInput: string
}): Promise<PromptBuildPipelineResult> {
  const prepared = await preparePromptBuildInput(input)
  let compiled: { messages: ProviderMessage[]; projection: CompiledPrompt } | undefined
  const registry = new PassRegistry<PromptBuildMeta>()
  registry.register(createPromptSourcePreparedFactory(toPromptBuildInputMeta(prepared)))
  registry.register(createPromptCompileFactory(prepared, value => {
    compiled = value
  }))
  const result = run<PromptBuildMeta>({
    fragments: [],
    passes: [
      { name: 'prompt.source.prepared' },
      { name: 'prompt.compile' },
    ],
    registry,
    trace: { mode: 'on' },
  })

  if (result.status === 'error') {
    throw new Error(result.error?.message ?? 'PromptBuild pipeline failed')
  }

  if (!compiled) {
    throw new Error('PromptBuild pipeline did not produce output')
  }

  return {
    messages: compiled.messages,
    projection: compiled.projection,
    trace: compactPromptBuildTrace(result.trace),
  }
}

function compactPromptBuildTrace(trace: Trace<PromptBuildMeta>): JsonValue {
  return {
    version: trace.version,
    mode: trace.mode,
    status: trace.status,
    ...(trace.error ? { error: trace.error as unknown as JsonValue } : {}),
    passConfigs: trace.passConfigs as unknown as JsonValue,
    diagnostics: trace.diagnostics as unknown as JsonValue,
    executions: trace.executions.map((execution: TraceExecution<PromptBuildMeta>) => ({
      passName: execution.passName,
      passIndex: execution.passIndex,
      durationMs: execution.durationMs,
      diagnostics: execution.diagnostics as unknown as JsonValue,
      mutations: execution.mutations.map((mutation: Mutation<PromptBuildMeta>) => {
        if (mutation.op === 'add' || mutation.op === 'remove') {
          return {
            op: mutation.op,
            fragmentId: mutation.fragmentId,
            index: mutation.index,
            fragment: compactPromptBuildFragment(mutation.fragment as PromptBuildFragment),
          }
        }
        if (mutation.op === 'update') {
          return {
            op: mutation.op,
            fragmentId: mutation.fragmentId,
            index: mutation.index,
            before: compactPromptBuildFragment(mutation.before as PromptBuildFragment),
            after: compactPromptBuildFragment(mutation.after as PromptBuildFragment),
          }
        }
        return mutation
      }) as unknown as JsonValue,
    })),
  } as JsonValue
}

function compactPromptBuildFragment(fragment: PromptBuildFragment): JsonValue {
  return {
    id: fragment.id,
    contentLength: fragment.content.length,
    contentPreview: fragment.content.slice(0, 240),
    meta: compactPromptBuildMeta(fragment.meta),
  }
}

function compactPromptBuildMeta(meta: PromptBuildMeta): JsonValue {
  if (meta.kind === 'promptBuild.input') {
    return {
      kind: meta.kind,
      ...(meta.activationFacts ? { activationFacts: meta.activationFacts } : {}),
      contributionCount: meta.contributionCount ?? 0,
      contributionIds: meta.contributionIds ?? [],
      ...(meta.orderProfileId ? { orderProfileId: meta.orderProfileId } : {}),
      promptRowSlotRankCount: meta.promptRowSlotRankCount ?? 0,
      sourceNodeCount: meta.sourceNodeCount ?? 0,
      ...(meta.userInput ? { userInput: meta.userInput } : {}),
    } satisfies JsonObject
  }

  return {
    kind: meta.kind,
    messageCount: meta.messageCount ?? 0,
    promptRowCount: meta.promptRowCount ?? 0,
    sourceRowCount: meta.sourceRowCount ?? 0,
    zoneCount: meta.zoneCount ?? 0,
  } satisfies JsonObject
}

async function preparePromptBuildInput(input: {
  activationFacts?: ActivationFacts
  branch: DocumentRecord<NarrativeBranchContent>
  documents: DocumentStore
  orderProfile?: ProjectionOrderProfile
  session: DocumentRecord<SessionContent>
  userInput: string
}): Promise<PreparedPromptBuildInput> {
  const entries = await readBranchPath(input.documents, input.session.id, input.branch.content.headEntryId)
  const snapshot = input.session.content.cardSnapshot
  const macroContext = getMacroContext(snapshot)
  const resourceInputs = input.session.content.promptResourceIds?.length
    ? await readPromptResourceInputs({
        documents: input.documents,
        resourceIds: input.session.content.promptResourceIds,
        macroContext,
      })
    : undefined
  const promptInputs = resourceInputs
  const sourceNodes = promptInputs
    ? [...promptInputs.sourceNodes, ...buildRuntimeSourceNodes(snapshot, entries)]
    : buildM0SourceNodes(snapshot, entries)
  const contributions = promptInputs
    ? [...promptInputs.contributions, ...buildNarrativeRuntimeContributions(snapshot, entries, input.userInput)]
    : buildM0PromptContributions(snapshot, entries, input.userInput, macroContext)
  const orderProfile = input.orderProfile && input.orderProfile !== emptyProjectionOrderProfile
    ? input.orderProfile
    : promptInputs ? promptInputs.orderProfile : emptyProjectionOrderProfile

  return {
    activationFacts: input.activationFacts,
    contributions,
    orderProfile,
    sourceNodes,
    userInput: input.userInput,
  }
}

function toPromptBuildInputMeta(input: PreparedPromptBuildInput): PromptBuildMeta {
  return {
    kind: 'promptBuild.input',
    ...(input.activationFacts ? { activationFacts: input.activationFacts } : {}),
    contributionCount: input.contributions.length,
    contributionIds: input.contributions.map(contribution => contribution.id),
    orderProfileId: input.orderProfile.id,
    promptRowSlotRankCount: input.orderProfile.slotRanks.length,
    sourceNodeCount: input.sourceNodes.length,
    userInput: input.userInput,
  }
}

function createPromptSourcePreparedFactory(meta: PromptBuildMeta): PassFactory<unknown, PromptBuildMeta> {
  return {
    name: 'prompt.source.prepared',
    create: () => ({
      name: 'prompt.source.prepared',
      run: (fragments: readonly PromptBuildFragment[]): readonly PromptBuildFragment[] => [
        ...fragments,
        {
          id: 'prompt-build.input',
          content: 'PromptBuild prepared source nodes and contributions.',
          meta,
        },
      ],
    }),
  }
}

function createPromptCompileFactory(
  input: PreparedPromptBuildInput,
  onCompiled: (value: { messages: ProviderMessage[]; projection: CompiledPrompt }) => void,
): PassFactory<unknown, PromptBuildMeta> {
  return {
    name: 'prompt.compile',
    create: () => ({
      name: 'prompt.compile',
      run: (fragments: readonly PromptBuildFragment[]): readonly PromptBuildFragment[] => {
        const projection = compilePromptDataModel({
          skeleton: defaultCompositionSkeleton,
          sourceNodes: input.sourceNodes,
          contributions: input.contributions,
          orderProfile: input.orderProfile,
          currentInput: input.userInput,
          activationFacts: input.activationFacts,
        })
        onCompiled({ messages: projection.messages, projection })

        return [
          ...fragments,
          {
            id: 'prompt-build.output',
            content: 'PromptBuild compiled provider messages.',
            meta: {
              kind: 'promptBuild.output',
              messageCount: projection.messages.length,
              promptRowCount: projection.editorProjection.promptRows.length,
              sourceRowCount: projection.editorProjection.sourceRows.length,
              zoneCount: projection.zones.length,
            },
          },
        ]
      },
    }),
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
      id: `session.chat.${entry.id}`,
      sourceNodeId: `node.chat.${entry.id}`,
      sourceId: `session:${snapshot.id ?? 'unknown'}`,
      kind: 'narrativeChat',
      content: entry.content,
      zoneId: 'chat.history',
      entryOrderHint: index + 1,
    })),
    runtimeContribution({
      id: 'runtime.current-input',
      sourceNodeId: 'node.runtime.current-input',
      sourceId: 'runtime.current-turn',
      kind: 'runtime',
      content: userInput,
      zoneId: 'chat.inside',
      entryOrderHint: 1,
    }),
  ]
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
      zoneId: 'preset.system',
      entryOrderHint: 10,
    }))
  }

  contributions.push(runtimeContribution({
    id: 'm0.preset.agent-contract',
    sourceNodeId: 'node.preset.agent',
    sourceId: 'm0-card-preset',
    kind: 'preset',
    content: `You are the AIRP agent for ${cardName}. Continue the accepted narrative.`,
    zoneId: 'preset.system',
    entryOrderHint: 20,
  }))

  if (description) {
    contributions.push(runtimeContribution({
      id: 'm0.preset.card-description',
      sourceNodeId: 'node.preset.description',
      sourceId: 'm0-card-preset',
      kind: 'preset',
      content: `Card description: ${renderMacros(description, macroContext)}`,
      zoneId: 'preset.system',
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
      zoneId: 'setting.stable',
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
      zoneId: 'chat.history',
      entryOrderHint: index + 1,
    }))
  }

  contributions.push(runtimeContribution({
    id: 'm0.runtime.current-input',
    sourceNodeId: 'node.runtime.current-input',
    sourceId: 'runtime.current-turn',
    kind: 'runtime',
    content: userInput,
    zoneId: 'chat.inside',
    entryOrderHint: 1,
  }))

  return contributions
}

function runtimeContribution(input: {
  activation?: PromptActivation
  content: string
  entryOrderHint?: number
  id: string
  zoneId: string
  joinSlotKey?: string
  kind: PromptContribution['sourceRef']['kind']
  sourceId: string
  sourceNodeId: string
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
        zoneId: input.zoneId,
        ...(input.joinSlotKey ? { joinSlotKey: input.joinSlotKey } : {}),
        ...(input.entryOrderHint !== undefined ? { entryOrderHint: input.entryOrderHint } : {}),
      },
    },
  }
}

function readSnapshotString(snapshot: JsonObject, key: string): string {
  return typeof snapshot[key] === 'string' ? snapshot[key] : ''
}

function readPresetSystem(snapshot: JsonObject): string {
  const preset = snapshot.preset
  return isObject(preset) && typeof preset.system === 'string' ? preset.system : ''
}

function readSettingEntries(snapshot: JsonObject): SettingEntryContent[] {
  const settingLayer = snapshot.settingLayer
  if (!isObject(settingLayer) || !Array.isArray(settingLayer.entries)) return []
  return settingLayer.entries.filter(isSettingEntry)
}

function toPromptActivation(activation: SettingEntryContent['activation']): PromptActivation {
  return activation
}
