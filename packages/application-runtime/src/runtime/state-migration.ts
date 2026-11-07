import { isDeepStrictEqual } from 'node:util'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ExtensionTimelineLease, ExtensionStateSnapshot } from '@loom-studio/extension-sdk'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { TimelineRuntimeContextContent } from '../types.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { timelineRuntimeContextId } from '../narrative/timeline-runtime-context.js'
import { readDocument } from '../foundation/document-store.js'
import { getApplicationStateSnapshot, applyStateOperations, notifyStateChange } from '../state/state.js'
import { validateStateDefinitionDraft, validateStateValue } from '../state/state-definition.js'
import { assertTimelineExtensionLease } from '../extensions/timeline-participation.js'
import { requireDocumentParticipant } from './context.js'

export type StateDefinitionMigrationInput = {
  target: { scope: 'timeline'; timelineId: string; branchId: string }
  expectedRevisionId: string
  expectedDefinitionVersion: number
  idempotencyKey: string
  bindings: Array<{ path: string; schema: JsonObject; value: JsonValue }>
}
export type StateMigrationOwner = { packageId: string; lease: ExtensionTimelineLease }

/** Definition changes are Timeline-wide; values are written only to this branch.
 * Authors must provide a schema compatible with branches they intend to keep using.
 * This does not rewrite historical revisions or infer any conversion. */
export function createStateMigrationMethods(ctx: ApplicationRuntimeContext) {
  async function definitions(target: StateDefinitionMigrationInput['target'], owner: StateMigrationOwner) {
    if (owner.lease.timelineId !== target.timelineId) throw new Error('State migration is outside the active Timeline')
    await assertTimelineExtensionLease(ctx, ctx.documents, owner.lease)
    const document = await readDocument<TimelineRuntimeContextContent>(ctx.documents, timelineRuntimeContextId(target.timelineId), applicationDocumentTypes.timelineRuntimeContext)
    if (!document.content.stateContributionSources.some(source => source.installationId === owner.lease.installationId && source.packageId === owner.packageId)) throw new Error('No accepted State contribution belongs to this installation')
    return document
  }
  return {
    getExtensionStateDefinitions: async (target: StateDefinitionMigrationInput['target'], owner: StateMigrationOwner) => {
      const document = await definitions(target, owner)
      return { version: document.version, bindings: structuredClone(document.content.stateBindings.filter(binding => binding.installationId === owner.lease.installationId)) }
    },
    migrateExtensionState: async (input: StateDefinitionMigrationInput, owner: StateMigrationOwner): Promise<{ snapshot: ExtensionStateSnapshot; changesetId: string }> => {
      const document = await definitions(input.target, owner)
      if (!input.idempotencyKey.trim() || !input.bindings.length || input.bindings.length > 100) throw new Error('Migration requires an idempotency key and 1–100 bindings')
      const current = await getApplicationStateSnapshot(ctx, input.target)
      const paths = new Set<string>()
      for (const binding of input.bindings) {
        if (paths.has(binding.path)) throw new Error('Duplicate migration binding')
        paths.add(binding.path)
        if (!document.content.stateBindings.some(accepted => accepted.path === binding.path && accepted.installationId === owner.lease.installationId)) throw new Error(`Migration cannot change unowned binding: ${binding.path}`)
        validateStateDefinitionDraft({ kind: 'global', path: 'global.migration', schema: binding.schema })
        validateStateValue(binding.value, binding.schema, binding.path)
      }
      const operations = input.bindings.map(binding => ({ op: 'set' as const, path: '/' + binding.path.split('.').map(part => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/'), value: binding.value }))
      const key = JSON.stringify(['state-definition-migration', owner.lease.installationId, input.target.branchId, input.idempotencyKey])
      const storedOperations = operations as unknown as JsonObject[]
      const previous = await ctx.states.getRevisionByIdempotencyKey(current.scopeId, key)
      if (previous) {
        if (previous.parentRevisionId !== input.expectedRevisionId || !isDeepStrictEqual(previous.operations, storedOperations) || input.bindings.some(binding => !isDeepStrictEqual(document.content.stateBindings.find(item => item.path === binding.path)?.schema, binding.schema))) throw new Error('Migration idempotency key was reused with different input')
        return { snapshot: { ...current, revisionId: previous.id, value: previous.snapshot, createdAt: previous.createdAt }, changesetId: previous.changesetId }
      }
      if (current.revisionId !== input.expectedRevisionId || document.version !== input.expectedDefinitionVersion) throw new Error('State or definition changed; read again before migration')
      const nextValue = applyStateOperations(current.value, operations)
      const next = structuredClone(document.content)
      for (const binding of next.stateBindings) {
        const replacement = input.bindings.find(item => item.path === binding.path)
        if (replacement) binding.schema = structuredClone(replacement.schema)
        let value: JsonValue | undefined = nextValue
        for (const key of binding.path.split('.')) value = value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key) ? value[key] : undefined
        if (value === undefined) {
          if (binding.installationId) continue
          throw new Error(`Required binding missing: ${binding.path}`)
        }
        validateStateValue(value, binding.schema, binding.path)
      }
      const result = await ctx.dataEngine.transact({ actor: { kind: 'extension', id: owner.packageId }, reason: 'state.definition.migrate' }, async transaction => {
        await requireDocumentParticipant(ctx).participateTransaction(transaction, async documents => {
          await assertTimelineExtensionLease({ narratives: ctx.narratives!.transaction(transaction) }, documents, owner.lease)
          await documents.write({ id: document.id, type: document.type, expectedVersion: document.version, content: next })
        })
        const revision = ctx.states.transaction(transaction).createRevision({ scopeId: current.scopeId, parentRevisionId: current.revisionId, snapshot: nextValue, operations: storedOperations, idempotencyKey: key }).revision
        ctx.narratives!.transaction(transaction).setBranchStateHead({ timelineId: input.target.timelineId, branchId: input.target.branchId, expectedStateHeadRevisionId: current.revisionId, stateRevisionId: revision.id })
        return revision
      })
      notifyStateChange(ctx, { target: input.target, revisionId: result.value.id, changesetId: result.commit.changesetId, paths: operations.map(operation => operation.path) })
      return { snapshot: { ...current, revisionId: result.value.id, value: nextValue, createdAt: result.value.createdAt }, changesetId: result.commit.changesetId }
    },
  }
}
