import type { ObservationBuild } from '../observability/types.js'
import type {
  ExtensionPromptEntry,
  ExtensionPromptProcessingContext,
  ExtensionPromptProcessingSession,
} from '@loom-studio/extension-sdk'
import type { PromptProcessorRegistry } from './prompt-processor-registry.js'
import { appendBuildEvidence, captureBuildEvidence, recordPromptSources, emitObservedPromptBlocks, planPromptBlocks, type PromptDataModel } from './prompt-build-pipeline.js'
import type { CompiledPrompt, PromptContribution, SourceNode } from './prompt-builder.js'

export type ProcessedPromptSnapshot = {
  sourceNodes: PromptDataModel['sourceNodes']
  contributions: PromptDataModel['contributions']
  projection: CompiledPrompt
}

export type PromptProcessingExecution = {
  processorId: string
  stage: 'prepare' | 'render'
  entryId?: string
}

export async function processPrompt(input: PromptDataModel, processing: {
  registry: PromptProcessorRegistry
  context: ExtensionPromptProcessingContext
  observation?: ObservationBuild
  renderText?: (content: string, hostId: string) => string
}) {
  recordPromptSources(input, processing.observation)
  // Raw source evidence remains on the caller's input; do not duplicate it into
  // the mutable processor model or the recovery snapshot.
  const model: PromptDataModel = structuredClone({
    ...input, sourceNodes: input.sourceNodes.map(({ evidence: _evidence, ...node }) => node),
  })
  const nodes = new Map(model.sourceNodes.map(node => [node.id, node]))
  const entries = new Map<string, ProcessedEntry>()
  const groups = new Map<string, ExtensionPromptEntry[]>()
  for (const contribution of model.contributions) {
    const processorId = contribution.capabilities.processorId
    if (!processorId) continue
    const kind = contribution.sourceRef.kind
    if (contribution.messages || (kind !== 'preset' && kind !== 'lore'))
      throw new Error('Prompt processors only accept authored Preset and Lore text')
    const node = nodes.get(contribution.sourceRef.sourceNodeId)
    if (node?.enabled === false) continue
    if (entries.has(contribution.id)) throw new Error(`Duplicate processed Prompt entry: ${contribution.id}`)
    const entry: ExtensionPromptEntry = {
      id: contribution.id,
      ...contribution.sourceRef,
      kind,
      label: node?.displayName ?? contribution.id,
      sourceLabel: nodes.get(contribution.sourceRef.sourceId)?.displayName,
      ...(node?.metadata ? { metadata: structuredClone(node.metadata) } : {}),
      content: contribution.content,
    }
    entries.set(entry.id, { processorId, entry, contribution, node })
    const group = groups.get(processorId) ?? []
    group.push(entry)
    groups.set(processorId, group)
  }
  const sessions = new Map<string, ExtensionPromptProcessingSession>()
  const executions: PromptProcessingExecution[] = []
  const signal = processing.context.signal
  const diagnostics: Array<{ severity: 'warning'; code: string; processorId: string; resourceId?: string; entryId?: string; message: string }> = []
  const skipped = new Set<string>()
  const skipOrThrow = (processorId: string, group: ExtensionPromptEntry[], stage: string, error: unknown) => {
    appendBuildEvidence(processing.observation, 'diagnostics', { code: 'prompt.processor_failed', processorId, stage, message: error instanceof Error ? error.message : String(error) })
    signal.throwIfAborted()
    const location = group.map(entry => `${entry.sourceId}/${entry.sourceNodeId}`).join(', ')
    if (isBlockingProcessingError(error)) throw error
    if (group.some(entry => entry.kind === 'preset')) {
      throw new Error(`Prompt processor ${processorId} failed during ${stage} (${location}): ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    for (const entry of group) {
      skipped.add(entry.id)
      const selected = entries.get(entry.id)!
      applyProcessedEntryPatch(selected, { active: false })
      if (selected.node) selected.node.enabled = false
      captureBuildEvidence(() => {
        const source = processing.observation?.sources?.find(source => source.id === entry.sourceNodeId)
        if (source) { source.active = false; source.reason = `processor ${processorId} ${stage} failed` }
      })
      diagnostics.push({ severity: 'warning', code: 'prompt.processor_entry_skipped', processorId,
        resourceId: entry.sourceId, entryId: entry.sourceNodeId,
        message: `Skipped Lore ${entry.sourceId}/${entry.sourceNodeId}: ${processorId} ${stage} failed: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
  let failed = false
  let primaryError: unknown
  try {
    for (const [processorId, group] of groups) {
      signal.throwIfAborted()
      try {
        const session = await processing.registry.create(processorId, processing.context)
        sessions.set(processorId, session)
        if (!session.prepare) continue
        const patches = await session.prepare(structuredClone(group))
        signal.throwIfAborted()
        if (!Array.isArray(patches)) throw new Error(`Invalid Prompt preparation result: ${processorId}`)
        for (const patch of patches) {
          if (!patch || entries.get(patch.id)?.processorId !== processorId
            || (patch.content !== undefined && typeof patch.content !== 'string')
            || (patch.active !== undefined && typeof patch.active !== 'boolean'))
            throw new Error(`Invalid Prompt preparation patch: ${processorId}`)
        }
        for (const patch of patches) {
          const selected = entries.get(patch.id)!
          appendBuildEvidence(processing.observation, 'transformations', { kind: 'processor', stage: 'prepare', processorId,
            hostId: selected.entry.sourceNodeId, entryId: patch.id, before: selected.entry.content,
            after: patch.content ?? selected.entry.content, active: patch.active })
          applyProcessedEntryPatch(selected, patch)
        }
        executions.push({ processorId, stage: 'prepare' })
      } catch (error) {
        skipOrThrow(processorId, group, 'prepare', error)
      }
    }
    const blocks = planPromptBlocks(model, processing.observation)
    const rendered = new Map<string, string>()
    for (const fragment of blocks.flat()) {
      const selected = entries.get(fragment.id)
      if (!selected || skipped.has(fragment.id)) continue
      signal.throwIfAborted()
      let content = rendered.get(fragment.id)
      if (content === undefined) {
        try {
          content = await sessions.get(selected.processorId)!.render(structuredClone(selected.entry))
          signal.throwIfAborted()
          if (typeof content !== 'string') throw new Error(`Prompt processor must return text: ${selected.processorId}`)
          appendBuildEvidence(processing.observation, 'transformations', { kind: 'processor', stage: 'render',
            processorId: selected.processorId, hostId: selected.entry.sourceNodeId, entryId: fragment.id,
            before: selected.entry.content, after: content })
          if (processing.renderText) content = processing.renderText(content, selected.entry.sourceNodeId)
          rendered.set(fragment.id, content)
          applyProcessedEntryPatch(selected, { content })
          executions.push({ processorId: selected.processorId, stage: 'render', entryId: fragment.id })
        } catch (error) {
          skipOrThrow(selected.processorId, [selected.entry], 'render', error)
          continue
        }
      }
      fragment.content = content
    }
    signal.throwIfAborted()
    return { projection: emitObservedPromptBlocks(blocks.map(block => block.filter(fragment => !skipped.has(fragment.id))), input, processing.observation), model, executions, diagnostics }
  } catch (error) {
    failed = true
    primaryError = error
    throw error
  } finally {
    const owners = [...sessions.keys()]
    const cleanup = await Promise.allSettled([...sessions.values()].map(async session => session.dispose?.()))
    const errors = cleanup.flatMap((result, index) => {
      if (result.status === 'fulfilled') return []
      appendBuildEvidence(processing.observation, 'diagnostics', { code: 'prompt.processor_cleanup_failed', processorId: owners[index], message: String(result.reason) })
      diagnostics.push({ severity: 'warning', code: 'prompt.processor_cleanup_failed', processorId: owners[index]!,
        message: `Prompt processor cleanup failed: ${owners[index]}: ${String(result.reason)}` })
      return [result.reason]
    })
    if (failed && errors.length) throw new AggregateError([primaryError, ...errors], primaryError instanceof Error ? primaryError.message : String(primaryError), { cause: primaryError })
    if (!failed) {
      signal.throwIfAborted()
      const blocking = errors.find(isBlockingProcessingError)
      if (blocking !== undefined) throw blocking
    }
  }
}

type ProcessedEntry = {
  processorId: string
  entry: ExtensionPromptEntry
  contribution: PromptContribution
  node?: SourceNode
}

/**
 * The processor entry supplies each accepted update. Contributions retain it for
 * snapshots/tools; inline skeleton nodes mirror it for planning and compilation.
 * Authored input remains untouched in the caller's model (the build uses a clone).
 */
function applyProcessedEntryPatch(
  { entry, contribution, node }: ProcessedEntry,
  patch: { content?: string; active?: boolean },
): void {
  const inline = !contribution.capabilities.targetAnchorId
  if (patch.content !== undefined) {
    entry.content = patch.content
    contribution.content = patch.content
    if (inline && node?.body !== undefined) node.body = patch.content
  }
  if (patch.active !== undefined) {
    contribution.capabilities.activation = { kind: patch.active ? 'always' : 'manual' }
    if (inline && node) {
      node.capabilities = { ...node.capabilities, activation: contribution.capabilities.activation }
    }
  }
}

function isBlockingProcessingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const name = 'name' in error ? String(error.name) : ''
  if (/permission|denied|forbidden|unauthorized|cancel|abort/i.test(code)
    || ['AbortError', 'NotAllowedError', 'SecurityError'].includes(name)) return true
  // ponytail: Host access guards still include plain Errors; retain their fail-closed
  // behavior until all host permission boundaries expose structured error codes.
  return error instanceof Error && /permission|access denied|was not granted|outside .*scope|not authorized|not allowed|history read was denied|cannot (?:access|read|write|delete).*owned by|access validation is not available|execution checks are unavailable|must run inside ctx.timeline.run|Extension instance is stopping/i.test(error.message)
}
